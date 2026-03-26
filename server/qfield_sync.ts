import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import Database from "better-sqlite3";
import type { IStorage } from "./storage";
import type { ProjectDefinition } from "./projects";
import type { InsertAllegato, InsertUS } from "@shared/schema";
import { normalizeUSCode, usCodeKey } from "@shared/normalize_us_code";

const MAX_PREVIEW_CACHE = 24;
const PREVIEW_TTL_MS = 1000 * 60 * 60 * 6; // 6h

const CODE_CANDIDATES = [
  "codice_us",
  "codiceus",
  "cod_us",
  "us",
  "us_code",
  "codice",
];

const FIELD_CANDIDATES: Record<SyncFieldName, string[]> = {
  quota: ["quota", "quota_slm", "quota_slm_m", "z", "elevazione", "altitudine"],
  settore: ["settore", "sector", "trincea", "area"],
  descrizione: ["descrizione", "description", "note", "notes", "osservazioni"],
  interpretazione: ["interpretazione", "interpretation", "interpretazione_us"],
  coperto_da: ["coperto_da", "coperto da"],
  copre: ["copre"],
  si_lega_a: ["si_lega_a", "si lega a", "lega_a"],
  uguale_a: ["uguale_a", "uguale a", "equals"],
  tipo: ["tipo", "type", "tipo_us"],
  definizione: ["definizione", "definition", "classificazione"],
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"]);
const RELATION_FIELDS = new Set<SyncFieldName>(["coperto_da", "copre", "si_lega_a", "uguale_a"]);
const TEXT_MERGE_FIELDS = new Set<SyncFieldName>(["descrizione", "interpretazione"]);

type SyncFieldName =
  | "quota"
  | "settore"
  | "descrizione"
  | "interpretazione"
  | "coperto_da"
  | "copre"
  | "si_lega_a"
  | "uguale_a"
  | "tipo"
  | "definizione";

export type FieldDeltaStatus = "unchanged" | "new" | "conflict" | "redundant" | "complementary";

export type FieldDelta = {
  field: SyncFieldName;
  valueArcheodoc: string | number | null;
  valueIncoming: string | number | null;
  status: FieldDeltaStatus;
  aiSuggestion?: string;
};

export type PhotoDelta = {
  fileName: string;
  relativePath: string;
  status: "new";
  source: "dcim" | "media" | "other";
};

export type SyncPreviewEntry = {
  cantiereId: number;
  usId: number | null;
  codiceUS: string;
  deltas: FieldDelta[];
  photos: PhotoDelta[];
  requiresReview: boolean;
};

export type SyncPreviewResult = {
  uploadId: string;
  cantiereId: number;
  sourceZipName: string;
  qgzProjectName: string | null;
  gpkgFileName: string;
  totalIncoming: number;
  matchedUS: number;
  missingUS: number;
  entries: SyncPreviewEntry[];
  generatedAt: string;
};

export type SyncApplyApproval = {
  usId: number | null;
  codiceUS: string;
  field: SyncFieldName;
  value: string | number | null;
};

export type SyncApplyOptions = {
  approvals?: SyncApplyApproval[];
  includeNonConflicts?: boolean;
  attachPhotos?: boolean;
};

export type SyncApplyResult = {
  updated: number;
  created: number;
  photosAttached: number;
  skippedConflicts: number;
  skippedMissingUs: number;
};

type IncomingUSRecord = {
  codiceUS: string;
  fields: Partial<Record<SyncFieldName, string | number | null>>;
};

type QFieldUploadRecord = {
  id: string;
  projectId: string;
  cantiereId: number;
  sourceZipName: string;
  extractedDir: string;
  gpkgFile: string;
  qgzProjectName: string | null;
  preview: SyncPreviewResult;
  createdAt: number;
};

const qfieldUploads = new Map<string, QFieldUploadRecord>();

function nowIso() {
  return new Date().toISOString();
}

function cleanExpiredUploads() {
  const now = Date.now();
  for (const [id, upload] of Array.from(qfieldUploads.entries())) {
    if (now - upload.createdAt <= PREVIEW_TTL_MS) continue;
    qfieldUploads.delete(id);
    try {
      fs.rmSync(upload.extractedDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  while (qfieldUploads.size > MAX_PREVIEW_CACHE) {
    const oldest = Array.from(qfieldUploads.values()).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    qfieldUploads.delete(oldest.id);
    try {
      fs.rmSync(oldest.extractedDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function codeKey(value: unknown): string {
  return usCodeKey(value);
}

function isEmptyValue(value: unknown): boolean {
  return value == null || String(value).trim() === "";
}

function toNullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function textContains(a: string, b: string) {
  return normalizeToken(a).includes(normalizeToken(b));
}

function splitRelationList(value: string | number | null): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[;,]+/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function mergeRelationValues(current: string | number | null, incoming: string | number | null): string {
  const merged = Array.from(new Set([...splitRelationList(current), ...splitRelationList(incoming)]));
  return merged.join(", ");
}

function classifyDelta(
  field: SyncFieldName,
  currentValue: string | number | null,
  incomingValue: string | number | null,
): FieldDelta {
  const delta: FieldDelta = {
    field,
    valueArcheodoc: currentValue,
    valueIncoming: incomingValue,
    status: "unchanged",
  };

  if (isEmptyValue(incomingValue)) return delta;
  if (isEmptyValue(currentValue)) {
    delta.status = "new";
    return delta;
  }

  const currentText = String(currentValue).trim();
  const incomingText = String(incomingValue).trim();
  if (normalizeToken(currentText) === normalizeToken(incomingText)) {
    delta.status = "unchanged";
    return delta;
  }

  if (RELATION_FIELDS.has(field)) {
    delta.status = "complementary";
    delta.aiSuggestion = mergeRelationValues(currentValue, incomingValue);
    return delta;
  }

  if (TEXT_MERGE_FIELDS.has(field)) {
    if (textContains(currentText, incomingText)) {
      delta.status = "redundant";
      delta.aiSuggestion = currentText;
      return delta;
    }
    if (textContains(incomingText, currentText)) {
      delta.status = "redundant";
      delta.aiSuggestion = incomingText;
      return delta;
    }
    delta.status = "complementary";
    delta.aiSuggestion = `${currentText}. ${incomingText}`.replace(/\.\s+\./g, ". ").trim();
    return delta;
  }

  delta.status = "conflict";
  delta.aiSuggestion = incomingText;
  return delta;
}

function safeZipPath(relativePath: string): string | null {
  const normalized = path.posix.normalize(relativePath).replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function pickColumn(columns: string[], candidates: string[]): string | null {
  const byNormalized = new Map<string, string>();
  for (const column of columns) {
    byNormalized.set(normalizeToken(column), column);
  }
  for (const candidate of candidates) {
    const found = byNormalized.get(normalizeToken(candidate));
    if (found) return found;
  }
  return null;
}

function findQgzProjectName(extractedDir: string): string | null {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        files.push(abs);
      }
    }
  };
  walk(extractedDir);

  const qgz = files.find((file) => file.toLowerCase().endsWith(".qgz"));
  if (!qgz) return null;
  return path.basename(qgz);
}

function findFirstGeoPackage(extractedDir: string): string | null {
  const stack = [extractedDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.name.toLowerCase().endsWith(".gpkg")) return absolute;
    }
  }
  return null;
}

function extractIncomingRecords(gpkgPath: string): IncomingUSRecord[] {
  const db = new Database(gpkgPath, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'gpkg_%'",
      )
      .all() as Array<{ name: string }>;

    const out = new Map<string, IncomingUSRecord>();

    for (const table of tables) {
      const tableName = table.name;
      const columnsRows = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<{ name: string }>;
      const columns = columnsRows.map((row) => row.name);
      const codeColumn = pickColumn(columns, CODE_CANDIDATES);
      if (!codeColumn) continue;

      const fieldMap: Partial<Record<SyncFieldName, string | null>> = {};
      for (const field of Object.keys(FIELD_CANDIDATES) as SyncFieldName[]) {
        fieldMap[field] = pickColumn(columns, FIELD_CANDIDATES[field]);
      }

      const rows = db.prepare(`SELECT * FROM ${quoteIdent(tableName)}`).all() as Record<string, unknown>[];
      for (const row of rows) {
        const rawCode = row[codeColumn];
        const normalized = normalizeUSCode(rawCode);
        const key = codeKey(normalized);
        if (!normalized || !key) continue;

        const current = out.get(key) || { codiceUS: normalized, fields: {} };
        for (const field of Object.keys(fieldMap) as SyncFieldName[]) {
          const column = fieldMap[field];
          if (!column) continue;
          const rawValue = row[column];
          const parsed =
            field === "quota"
              ? toNullableNumber(rawValue)
              : toNullableText(rawValue);
          if (parsed == null || parsed === "") continue;
          current.fields[field] = parsed;
        }
        out.set(key, current);
      }
    }

    return Array.from(out.values());
  } finally {
    db.close();
  }
}

function detectPhotoSource(relativePath: string): "dcim" | "media" | "other" {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/dcim/") || normalized.startsWith("dcim/")) return "dcim";
  if (normalized.includes("/media/") || normalized.startsWith("media/")) return "media";
  return "other";
}

function listImageFiles(extractedDir: string): Array<{ absolutePath: string; relativePath: string; fileName: string }> {
  const out: Array<{ absolutePath: string; relativePath: string; fileName: string }> = [];
  const stack = [extractedDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      out.push({
        absolutePath: absolute,
        relativePath: path.relative(extractedDir, absolute).replace(/\\/g, "/"),
        fileName: entry.name,
      });
    }
  }
  return out;
}

function buildPreview(
  storage: IStorage,
  cantiereId: number,
  incomingRecords: IncomingUSRecord[],
  extractedDir: string,
): SyncPreviewEntry[] {
  const existingUs = storage.getUSList(cantiereId);
  const existingByKey = new Map(existingUs.map((us) => [codeKey(us.codiceUS), us]));
  const imageFiles = listImageFiles(extractedDir);

  const knownCodeKeys = new Set([
    ...Array.from(existingByKey.keys()),
    ...incomingRecords.map((record) => codeKey(record.codiceUS)),
  ]);

  const photosByCode = new Map<string, PhotoDelta[]>();
  for (const image of imageFiles) {
    const normalizedName = image.fileName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    let matchedKey: string | null = null;
    for (const code of Array.from(knownCodeKeys)) {
      if (code && normalizedName.includes(code)) {
        matchedKey = code;
        break;
      }
    }
    if (!matchedKey) continue;
    const bucket = photosByCode.get(matchedKey) || [];
    bucket.push({
      fileName: image.fileName,
      relativePath: image.relativePath,
      status: "new",
      source: detectPhotoSource(image.relativePath),
    });
    photosByCode.set(matchedKey, bucket);
  }

  const fields: SyncFieldName[] = [
    "quota",
    "settore",
    "descrizione",
    "interpretazione",
    "coperto_da",
    "copre",
    "si_lega_a",
    "uguale_a",
    "tipo",
    "definizione",
  ];

  const entries: SyncPreviewEntry[] = [];
  for (const incoming of incomingRecords) {
    const key = codeKey(incoming.codiceUS);
    const current = existingByKey.get(key);
    const deltas = fields.map((field) => {
      const currentValue = current ? (current as Record<string, unknown>)[field] : null;
      const incomingValue = incoming.fields[field] ?? null;
      return classifyDelta(field, currentValue as any, incomingValue as any);
    });

    const photos = photosByCode.get(key) || [];
    entries.push({
      cantiereId,
      usId: current?.id ?? null,
      codiceUS: incoming.codiceUS,
      deltas,
      photos,
      requiresReview: deltas.some((delta) => delta.status === "conflict"),
    });
  }

  for (const us of existingUs) {
    const key = codeKey(us.codiceUS);
    if (incomingRecords.some((item) => codeKey(item.codiceUS) === key)) continue;
    const photos = photosByCode.get(key) || [];
    if (photos.length === 0) continue;
    entries.push({
      cantiereId,
      usId: us.id,
      codiceUS: us.codiceUS,
      deltas: [],
      photos,
      requiresReview: false,
    });
  }

  return entries.sort((a, b) => a.codiceUS.localeCompare(b.codiceUS, "it"));
}

function buildApprovalMap(approvals: SyncApplyApproval[] | undefined) {
  const out = new Map<string, string | number | null>();
  for (const approval of approvals || []) {
    const usKey = approval.usId != null ? String(approval.usId) : codeKey(approval.codiceUS);
    out.set(`${usKey}:${approval.field}`, approval.value);
  }
  return out;
}

function mimeTypeFromExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "application/octet-stream";
}

function ensureUniquePath(baseDir: string, candidate: string): string {
  const clean = candidate.replace(/\\/g, "/");
  const ext = path.extname(clean);
  const name = clean.slice(0, clean.length - ext.length);
  let attempt = clean;
  let index = 1;
  while (fs.existsSync(path.join(baseDir, attempt))) {
    attempt = `${name}_${index}${ext}`;
    index += 1;
  }
  return attempt;
}

export async function createQFieldPreviewFromZip(input: {
  storage: IStorage;
  cantiereId: number;
  projectId: string;
  zipBuffer: Buffer;
  sourceZipName: string;
}): Promise<SyncPreviewResult> {
  cleanExpiredUploads();

  const uploadId = `qfield_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const extractedDir = fs.mkdtempSync(path.join(os.tmpdir(), "archeodoc-qfield-"));
  const zip = await JSZip.loadAsync(input.zipBuffer);

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const safePath = safeZipPath(relativePath);
    if (!safePath) continue;
    const target = path.join(extractedDir, safePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = await zipEntry.async("nodebuffer");
    fs.writeFileSync(target, content);
  }

  const gpkgPath = findFirstGeoPackage(extractedDir);
  if (!gpkgPath) {
    throw new Error("ZIP non valido: nessun file .gpkg trovato");
  }

  const incomingRecords = extractIncomingRecords(gpkgPath);
  const entries = buildPreview(input.storage, input.cantiereId, incomingRecords, extractedDir);
  const matchedUS = entries.filter((entry) => entry.usId != null).length;
  const missingUS = entries.filter((entry) => entry.usId == null).length;

  const preview: SyncPreviewResult = {
    uploadId,
    cantiereId: input.cantiereId,
    sourceZipName: input.sourceZipName,
    qgzProjectName: findQgzProjectName(extractedDir),
    gpkgFileName: path.basename(gpkgPath),
    totalIncoming: incomingRecords.length,
    matchedUS,
    missingUS,
    entries,
    generatedAt: nowIso(),
  };

  qfieldUploads.set(uploadId, {
    id: uploadId,
    projectId: input.projectId,
    cantiereId: input.cantiereId,
    sourceZipName: input.sourceZipName,
    extractedDir,
    gpkgFile: gpkgPath,
    qgzProjectName: preview.qgzProjectName,
    preview,
    createdAt: Date.now(),
  });

  return preview;
}

export function getQFieldPreview(uploadId: string, projectId: string, cantiereId: number): SyncPreviewResult | null {
  cleanExpiredUploads();
  const upload = qfieldUploads.get(uploadId);
  if (!upload) return null;
  if (upload.projectId !== projectId || upload.cantiereId !== cantiereId) return null;
  return upload.preview;
}

export function resolveQFieldMediaPath(
  uploadId: string,
  projectId: string,
  cantiereId: number,
  relativePath: string,
): string | null {
  cleanExpiredUploads();
  const upload = qfieldUploads.get(uploadId);
  if (!upload) return null;
  if (upload.projectId !== projectId || upload.cantiereId !== cantiereId) return null;
  const safe = safeZipPath(relativePath);
  if (!safe) return null;
  const absolute = path.join(upload.extractedDir, safe);
  const normalizedBase = path.resolve(upload.extractedDir);
  const normalizedAbsolute = path.resolve(absolute);
  if (!normalizedAbsolute.startsWith(normalizedBase)) return null;
  if (!fs.existsSync(normalizedAbsolute)) return null;
  return normalizedAbsolute;
}

export function applyQFieldPreview(input: {
  storage: IStorage;
  project: ProjectDefinition;
  uploadId: string;
  projectId: string;
  cantiereId: number;
  options?: SyncApplyOptions;
}): SyncApplyResult {
  cleanExpiredUploads();
  const upload = qfieldUploads.get(input.uploadId);
  if (!upload) throw new Error("Anteprima QField non trovata o scaduta");
  if (upload.projectId !== input.projectId || upload.cantiereId !== input.cantiereId) {
    throw new Error("Anteprima non valida per progetto/cantiere correnti");
  }

  const includeNonConflicts = input.options?.includeNonConflicts ?? true;
  const attachPhotos = input.options?.attachPhotos ?? true;
  const approvals = buildApprovalMap(input.options?.approvals);

  let updated = 0;
  let created = 0;
  let photosAttached = 0;
  let skippedConflicts = 0;
  let skippedMissingUs = 0;

  const usByCode = new Map(
    input.storage.getUSList(input.cantiereId).map((us) => [codeKey(us.codiceUS), us]),
  );

  for (const entry of upload.preview.entries) {
    let us = entry.usId != null ? input.storage.getUS(entry.usId) : usByCode.get(codeKey(entry.codiceUS));
    const patch: Partial<InsertUS> = {};

    for (const delta of entry.deltas) {
      if (delta.status === "unchanged") continue;
      const approvalKey = `${us?.id != null ? String(us.id) : codeKey(entry.codiceUS)}:${delta.field}`;
      const approvedValue = approvals.get(approvalKey);

      if (delta.status === "conflict" && approvedValue === undefined) {
        skippedConflicts += 1;
        continue;
      }

      if (!includeNonConflicts && approvedValue === undefined) continue;

      const chosen = approvedValue !== undefined
        ? approvedValue
        : delta.status === "new"
          ? delta.valueIncoming
          : delta.aiSuggestion ?? delta.valueIncoming;

      if (delta.field === "quota") {
        (patch as any)[delta.field] = toNullableNumber(chosen);
      } else if (RELATION_FIELDS.has(delta.field)) {
        (patch as any)[delta.field] = toNullableText(chosen);
      } else {
        (patch as any)[delta.field] = toNullableText(chosen);
      }
    }

    if (!us) {
      if (Object.keys(patch).length === 0) {
        skippedMissingUs += 1;
        continue;
      }
      const createdUs = input.storage.createUS({
        cantiereId: input.cantiereId,
        codiceUS: entry.codiceUS,
        ...patch,
      } as InsertUS);
      us = createdUs;
      usByCode.set(codeKey(createdUs.codiceUS), createdUs);
      created += 1;
    } else if (Object.keys(patch).length > 0) {
      input.storage.updateUS(us.id, patch);
      updated += 1;
    }

    if (!attachPhotos || !us || entry.photos.length === 0) continue;

    for (const photo of entry.photos) {
      const sourcePath = resolveQFieldMediaPath(upload.id, input.project.id, input.cantiereId, photo.relativePath);
      if (!sourcePath) continue;

      const cantiereDir = path.join(input.project.mediaDir, String(input.cantiereId));
      fs.mkdirSync(cantiereDir, { recursive: true });
      const safeFileName = photo.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const relativeTarget = ensureUniquePath(input.project.mediaDir, `${input.cantiereId}/${Date.now()}_${safeFileName}`);
      const absoluteTarget = path.join(input.project.mediaDir, relativeTarget);
      fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
      fs.copyFileSync(sourcePath, absoluteTarget);

      const stat = fs.statSync(absoluteTarget);
      input.storage.createAllegato({
        cantiereId: input.cantiereId,
        giornataId: us.giornataId ?? null,
        usId: us.id,
        tipo: "foto",
        nomeFile: photo.fileName,
        percorso: relativeTarget.replace(/\\/g, "/"),
        mimeType: mimeTypeFromExt(photo.fileName),
        dimensione: stat.size,
        dataRilievo: null,
        operatore: null,
        descrizione: `Import QFieldSync (${photo.source})`,
        coordX: null,
        coordY: null,
        quota: null,
        descrizionAi: null,
      } as InsertAllegato);
      input.storage.updateUS(us.id, { haFoto: 1 });
      photosAttached += 1;
    }
  }

  return {
    updated,
    created,
    photosAttached,
    skippedConflicts,
    skippedMissingUs,
  };
}
