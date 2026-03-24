import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "../projects";

export function fileToTipo(mimeType: string, originalName: string): string {
  if (mimeType.startsWith("image/")) {
    const name = originalName.toLowerCase();
    if (name.includes("planimetria") || name.includes("pianta") || name.includes("sezione")) return "planimetria";
    if (name.includes("disegno")) return "disegno";
    return "foto";
  }
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/csv" || mimeType.includes("excel")) return "csv";
  return "altro";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isNumericSegment(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

function resolveAttachmentAbsolutePath(project: ProjectDefinition, storedPath: string): string | null {
  if (!storedPath) return null;

  if (path.isAbsolute(storedPath)) {
    const mediaRoot = path.resolve(project.mediaDir);
    const resolved = path.resolve(storedPath);
    if (resolved === mediaRoot || resolved.startsWith(`${mediaRoot}${path.sep}`)) {
      return resolved;
    }
    return null;
  }

  return resolvePathInside(project.mediaDir, storedPath);
}

function sanitizeIncomingUploadName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const base = path.posix.basename(normalized).trim();

  if (!base || base === "." || base === "..") {
    throw new Error("Nome file upload non valido");
  }

  return base.length > 200 ? base.slice(0, 200) : base;
}

export function resolvePathInside(baseDir: string, relativePath: string): string | null {
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export function buildTargetAttachmentRelativePath(
  targetCantiereId: number,
  sourcePath: string,
  sourceFileName: string,
): string {
  const normalized = normalizeRelativePath(sourcePath || "");
  const sourceParts = normalized.split("/").filter(Boolean);
  const tail = sourceParts.length > 0 && isNumericSegment(sourceParts[0]) ? sourceParts.slice(1) : sourceParts;
  const safeFileName = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalTail = tail.length > 0 ? tail : [safeFileName || `file-${Date.now()}`];
  return normalizeRelativePath(path.posix.join(String(targetCantiereId), ...finalTail));
}

export function ensureUniqueRelativePath(baseDir: string, requestedRelativePath: string): string {
  let candidate = normalizeRelativePath(requestedRelativePath);
  const parsed = path.posix.parse(candidate);
  let i = 1;

  while (true) {
    const absolutePath = resolvePathInside(baseDir, candidate);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      return candidate;
    }

    i += 1;
    const nextName = `${parsed.name}_${i}${parsed.ext}`;
    candidate = normalizeRelativePath(path.posix.join(parsed.dir, nextName));
  }
}

export function moveUploadedFileToCantiereDir(
  project: ProjectDefinition,
  cantiereId: number,
  file: Express.Multer.File,
): string {
  const sourceAbsolute = path.resolve(file.path);
  const sourceRoot = path.resolve(project.mediaDir);
  if (!sourceAbsolute.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error("Percorso sorgente upload non valido");
  }

  const safeUploadName = sanitizeIncomingUploadName(file.filename);
  const requestedRelativePath = normalizeRelativePath(path.posix.join(String(cantiereId), safeUploadName));
  const targetRelativePath = ensureUniqueRelativePath(project.mediaDir, requestedRelativePath);
  const targetAbsolute = resolvePathInside(project.mediaDir, targetRelativePath);
  if (!targetAbsolute) {
    throw new Error("Percorso destinazione upload non valido");
  }

  fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true });
  try {
    fs.renameSync(sourceAbsolute, targetAbsolute);
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code !== "EXDEV") throw error;
    fs.copyFileSync(sourceAbsolute, targetAbsolute);
    fs.unlinkSync(sourceAbsolute);
  }

  return targetRelativePath;
}

export function cleanupUploadedTempFiles(files: Express.Multer.File[] | undefined): void {
  if (!files || files.length === 0) return;

  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

export function copyAttachmentIfExists(
  sourceProject: ProjectDefinition,
  targetProject: ProjectDefinition,
  sourceStoredPath: string,
  targetRelativePath: string,
): boolean {
  const sourceAbsolute = resolveAttachmentAbsolutePath(sourceProject, sourceStoredPath);
  if (!sourceAbsolute || !fs.existsSync(sourceAbsolute)) return false;

  const targetAbsolute = resolvePathInside(targetProject.mediaDir, targetRelativePath);
  if (!targetAbsolute) return false;

  fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true });
  fs.copyFileSync(sourceAbsolute, targetAbsolute);
  return true;
}

export function removeAttachmentIfExists(project: ProjectDefinition, storedPath: string): void {
  const absolutePath = resolveAttachmentAbsolutePath(project, storedPath);
  if (!absolutePath) return;

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch {
    // Non bloccare il flusso API se il cleanup file fallisce.
  }
}
