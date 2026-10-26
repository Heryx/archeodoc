import type { Express } from "express";
import type multer from "multer";
import fs from "fs";
import path from "path";
import type { WithProject } from "./types";
import type { IStorage } from "../storage";
import {
  getProjectById,
  getProjectSchemaDefinition,
  getStorageForProject,
  type ProjectDefinition,
} from "../projects";
import {
  getUSModel,
  listUSModels,
  createCustomUSModel,
  updateCustomUSModel,
  normalizeFieldKey,
  syncModelFieldsWithTemplate,
} from "../us_models";
import { usTemplatePath as _usTemplatePathUtil, resolveUSTemplatePath as _resolveUSTemplatePath } from "../us_template_path";
import {
  elencoUsTemplatePath,
  elencoUsTemplateOriginalPath,
  readElencoTemplateChoice,
  writeElencoTemplateChoice,
  clearElencoTemplateChoice,
} from "../elenco_us_template_path";
import { buildModelFieldsFromTemplate, detectTemplatePlaceholders, humanizeFieldKey } from "../docx_template_utils";
import { extractTemplateLoopColumns } from "../docx_table_read";
import { findSimilarField } from "../field_similarity";
import { resolveElencoColumns, buildElencoRowValues, knownFieldsForCantiere } from "../elenco_columns";
import { analyzeElencoTemplate, repairElencoTemplate, describeRepairs } from "../elenco_template_repair";
import { rewriteTemplatePlaceholder } from "../docx_template_rewrite";
import { matchFieldsWithAI, AI_AVAILABLE } from "../ai";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import { buildEntityZodSchema } from "@shared/validation/buildZodSchema";
import { getUsTopLevelThesaurusFromSchema } from "@shared/us_schema_thesaurus";
import { normalizeUsDefinizioneWithVocabulary, normalizeUsTipoWithVocabulary } from "@shared/us_thesaurus";
import { normalizeUSCode, usCodeKey } from "@shared/normalize_us_code";
import {
  importUSFromGeoPackage,
  previewGeoPackage,
  previewGeoPackageWebMap,
  type GeoPackageFieldMap,
} from "../geopackage_import";
import { exportSketchesToGeoPackage } from "../geopackage_export";
import { insertImageIntoDocx } from "../docx_image_insert";
import { syncInverseRelations, computePendingInverses, applyPendingInverses } from "../relations_sync";
import { applyUsInlineFieldEdit } from "../us_field_edit";

type TransferMode = "copy" | "move";
type USSaveMode = "draft" | "final";
const MAP_SNAPSHOT_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function parseGeoPackageFieldMap(raw: unknown): GeoPackageFieldMap | undefined {
  if (!raw) return undefined;

  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: GeoPackageFieldMap = {};
  for (const [key, column] of Object.entries(value as Record<string, unknown>)) {
    if (typeof column !== "string") continue;
    const cleaned = column.trim();
    if (!cleaned) continue;
    (out as Record<string, string>)[key] = cleaned;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseUSSaveMode(value: unknown): USSaveMode {
  return value === "draft" ? "draft" : "final";
}

function isNonEmptyText(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function sanitizeSnapshotName(value: unknown): string {
  const raw = String(value ?? "").trim();
  const base = raw || "snapshot";
  return base
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

function parseSnapshotDataUrl(value: unknown): { mimeType: string; buffer: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!MAP_SNAPSHOT_MIME_TO_EXT[mimeType]) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (buffer.length === 0) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function parseFeatureCollection(value: unknown): { type: "FeatureCollection"; features: Array<any> } | null {
  if (!value || typeof value !== "object") return null;
  const fc = value as { type?: unknown; features?: unknown };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return null;
  return {
    type: "FeatureCollection",
    features: fc.features,
  };
}

function encodeUploadPath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isDocxAttachment(mimeType: string | null | undefined, nameOrPath: string): boolean {
  const normalized = String(nameOrPath || "").toLowerCase();
  if (normalized.endsWith(".docx")) return true;
  const mime = String(mimeType || "").toLowerCase();
  return mime.includes("wordprocessingml");
}

function buildSnapshotDocxName(baseName: string): string {
  const trimmed = baseName.trim();
  const stem = trimmed.replace(/\.docx$/i, "").replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-");
  return `${stem || "documento"}_snapshot_${Date.now()}.docx`;
}

type FieldworkHelpers = {
  withProject: WithProject;
  upload: multer.Multer;
  geopackageUpload: multer.Multer;
  parseDataRecord: (value: unknown) => Record<string, unknown>;
  serializeDataRecord: (value: Record<string, unknown>) => string | null;
  toUSValidationInput: (base: Record<string, unknown>, schedaData: Record<string, unknown>) => Record<string, unknown>;
  pickUSBaseFromPayload: (payload: Record<string, unknown>, fallback: Record<string, unknown>) => Record<string, unknown>;
  stripTopLevelKeysFromSchedaData: (data: Record<string, unknown>) => Record<string, unknown>;
  validationErrors: (error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) => Record<string, string[]>;
  removeAttachmentIfExists: (project: ProjectDefinition, storedPath: string) => void;
  resolvePathInside: (baseDir: string, relativePath: string) => string | null;
  transferCantiere: (
    sourceProject: ProjectDefinition,
    targetProject: ProjectDefinition,
    sourceStorage: IStorage,
    targetStorage: IStorage,
    sourceCantiereId: number,
    mode: TransferMode,
  ) => unknown;
  fileToTipo: (mimeType: string, originalName: string) => string;
  moveUploadedFileToCantiereDir: (project: ProjectDefinition, cantiereId: number, file: Express.Multer.File) => string;
  moveUploadedFileToCantiereDateDir: (project: ProjectDefinition, cantiereId: number, dateStr: string, file: Express.Multer.File) => string;
  cleanupUploadedTempFiles: (files: Express.Multer.File[] | undefined) => void;
};

export function registerFieldworkRoutes(app: Express, helpers: FieldworkHelpers) {
  const {
    withProject,
    upload,
    geopackageUpload,
    parseDataRecord,
    serializeDataRecord,
    toUSValidationInput,
    pickUSBaseFromPayload,
    stripTopLevelKeysFromSchedaData,
    validationErrors,
    removeAttachmentIfExists,
    resolvePathInside,
    transferCantiere,
    fileToTipo,
    moveUploadedFileToCantiereDir,
    moveUploadedFileToCantiereDateDir,
    cleanupUploadedTempFiles,
  } = helpers;

  // Cantieri
  app.get("/api/cantieri", withProject((ctx, _req, res) => {
    res.json(ctx.storage.getCantieri());
  }));

  app.post("/api/cantieri", withProject((ctx, req, res) => {
    try {
      const availableModels = listUSModels(ctx.project);
      const requestedModelKey = typeof req.body?.usModelKey === "string" ? req.body.usModelKey.trim() : "";
      let modelKey = requestedModelKey || ctx.project.defaultUsModelKey || BASE_US_MODEL_KEY;
      if (!availableModels.some((m) => m.key === modelKey)) {
        modelKey = BASE_US_MODEL_KEY;
      }

      if (modelKey) {
        const modelExists = availableModels.some((m) => m.key === modelKey);
        if (!modelExists) {
          return res.status(400).json({ error: "Modello US non valido per il cantiere" });
        }
      }
      const cantiere = ctx.storage.createCantiere({
        ...req.body,
        usModelKey: modelKey,
      });
      res.json(cantiere);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }));

  app.get("/api/cantieri/:cid", withProject((ctx, req, res) => {
    const cantiere = ctx.storage.getCantiere(Number(req.params.cid));
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json(cantiere);
  }));

  app.get("/api/cantieri/:cid/map-snapshots", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const snapshots = ctx.storage.getMapSnapshots(cid).map((snapshot) => ({
      ...snapshot,
      url: `/uploads/${encodeUploadPath(snapshot.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
    }));
    res.json({ snapshots });
  }));

  app.post("/api/cantieri/:cid/map-snapshots", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const titolo = String(req.body?.titolo ?? "").trim();
    if (!titolo) return res.status(400).json({ error: "Titolo snapshot obbligatorio" });

    const parsed = parseSnapshotDataUrl(req.body?.imageData);
    if (!parsed) {
      return res.status(400).json({ error: "imageData non valido: usa un data URL base64 PNG/JPEG/WEBP" });
    }

    if (parsed.buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "Snapshot troppo grande (max 8MB)" });
    }

    const ext = MAP_SNAPSHOT_MIME_TO_EXT[parsed.mimeType];
    const safeName = sanitizeSnapshotName(titolo);
    const fileName = `${Date.now()}_${safeName}.${ext}`;
    const relativePath = path.posix.join("_map_snapshots", String(cid), fileName);
    const absolutePath = resolvePathInside(ctx.project.mediaDir, relativePath);
    if (!absolutePath) {
      return res.status(400).json({ error: "Percorso snapshot non valido" });
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, parsed.buffer);

    const created = ctx.storage.createMapSnapshot({
      cantiereId: cid,
      titolo,
      didascalia: typeof req.body?.didascalia === "string" ? req.body.didascalia.trim() : null,
      tags: typeof req.body?.tags === "string" ? req.body.tags.trim() : null,
      percorso: relativePath,
      mimeType: parsed.mimeType,
      width: Number.isFinite(Number(req.body?.width)) ? Number(req.body.width) : null,
      height: Number.isFinite(Number(req.body?.height)) ? Number(req.body.height) : null,
      bounds: typeof req.body?.bounds === "string" ? req.body.bounds : null,
      center: typeof req.body?.center === "string" ? req.body.center : null,
      zoom: Number.isFinite(Number(req.body?.zoom)) ? Number(req.body.zoom) : null,
      bearing: Number.isFinite(Number(req.body?.bearing)) ? Number(req.body.bearing) : null,
      pitch: Number.isFinite(Number(req.body?.pitch)) ? Number(req.body.pitch) : null,
    });

    res.json({
      snapshot: {
        ...created,
        url: `/uploads/${encodeUploadPath(created.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
      },
    });
  }));

  app.post("/api/cantieri/:cid/map-snapshots/:sid/insert-into-docx", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const snapshotId = Number(req.params.sid);
    const snapshot = ctx.storage.getMapSnapshot(snapshotId);
    if (!snapshot || snapshot.cantiereId !== cid) {
      return res.status(404).json({ error: "Snapshot non trovato" });
    }

    const allegatoId = Number(req.body?.allegatoId);
    if (!Number.isFinite(allegatoId)) {
      return res.status(400).json({ error: "allegatoId obbligatorio" });
    }

    const targetDocx = ctx.storage.getAllegato(allegatoId);
    if (!targetDocx || targetDocx.cantiereId !== cid) {
      return res.status(404).json({ error: "Documento allegato non trovato" });
    }
    if (!isDocxAttachment(targetDocx.mimeType, targetDocx.nomeFile || targetDocx.percorso)) {
      return res.status(400).json({ error: "L'allegato selezionato non e un file .docx" });
    }

    const snapshotPath = resolvePathInside(ctx.project.mediaDir, snapshot.percorso);
    const docxPath = resolvePathInside(ctx.project.mediaDir, targetDocx.percorso);
    if (!snapshotPath || !fs.existsSync(snapshotPath)) {
      return res.status(404).json({ error: "File snapshot non trovato su disco" });
    }
    if (!docxPath || !fs.existsSync(docxPath)) {
      return res.status(404).json({ error: "File DOCX non trovato su disco" });
    }

    const widthCmRaw = Number(req.body?.widthCm);
    const heightCmRaw = Number(req.body?.heightCm);
    const widthCm = Number.isFinite(widthCmRaw) && widthCmRaw > 0 ? widthCmRaw : 14;
    const heightCm = Number.isFinite(heightCmRaw) && heightCmRaw > 0 ? heightCmRaw : 8;
    const widthEmu = Math.round(widthCm * 360_000);
    const heightEmu = Math.round(heightCm * 360_000);
    const paragraphIndexRaw = Number(req.body?.afterParagraphIndex);
    const afterParagraphIndex = Number.isFinite(paragraphIndexRaw) ? Math.trunc(paragraphIndexRaw) : -1;

    const docxBuffer = fs.readFileSync(docxPath);
    const imageBuffer = fs.readFileSync(snapshotPath);

    const snapshotMime =
      snapshot.mimeType === "image/jpeg"
        ? "image/jpeg"
        : snapshot.mimeType === "image/png"
          ? "image/png"
          : null;
    if (!snapshotMime) {
      return res.status(400).json({ error: "Snapshot non supportato per DOCX: usa PNG o JPEG" });
    }

    let inserted;
    try {
      inserted = await insertImageIntoDocx({
        docxBuffer,
        imageBuffer,
        imageMimeType: snapshotMime,
        title: snapshot.titolo,
        caption: snapshot.didascalia,
        widthEmu,
        heightEmu,
        afterParagraphIndex,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Inserimento immagine nel DOCX fallito" });
    }

    const relativeDocx = String(targetDocx.percorso || "").replace(/\\/g, "/");
    const baseDir = path.posix.dirname(relativeDocx);
    const outputName = buildSnapshotDocxName(targetDocx.nomeFile || "relazione.docx");
    const outputRelativePath = baseDir && baseDir !== "." ? path.posix.join(baseDir, outputName) : outputName;
    const outputAbsolutePath = resolvePathInside(ctx.project.mediaDir, outputRelativePath);
    if (!outputAbsolutePath) {
      return res.status(400).json({ error: "Percorso output DOCX non valido" });
    }

    fs.mkdirSync(path.dirname(outputAbsolutePath), { recursive: true });
    fs.writeFileSync(outputAbsolutePath, inserted.buffer);

    const createdAttachment = ctx.storage.createAllegato({
      cantiereId: cid,
      giornataId: targetDocx.giornataId ?? null,
      usId: targetDocx.usId ?? null,
      tipo: "documento",
      nomeFile: outputName,
      percorso: outputRelativePath,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dimensione: inserted.buffer.length,
      dataRilievo: targetDocx.dataRilievo ?? null,
      operatore: targetDocx.operatore ?? null,
      descrizione: `DOCX con snapshot mappa: ${snapshot.titolo}`,
      coordX: targetDocx.coordX ?? null,
      coordY: targetDocx.coordY ?? null,
      quota: targetDocx.quota ?? null,
      descrizionAi: null,
    });

    res.json({
      ok: true,
      warnings: inserted.warnings,
      allegato: {
        ...createdAttachment,
        url: `/uploads/${encodeUploadPath(createdAttachment.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
      },
    });
  }));

  app.post("/api/cantieri/:cid/webmap/sketches/export-geopackage", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const titolo = String(req.body?.titolo ?? "").trim() || `webmap_sketches_${new Date().toISOString()}`;
    const featureCollection = parseFeatureCollection(req.body?.featureCollection);
    if (!featureCollection) {
      return res.status(400).json({ error: "featureCollection non valido" });
    }

    try {
      const exported = exportSketchesToGeoPackage({
        outputDir: ctx.project.mediaDir,
        cantiereId: cid,
        title: titolo,
        featureCollection,
      });

      return res.json({
        ok: true,
        file: {
          nomeFile: exported.fileName,
          percorso: exported.relativePath,
          featureCount: exported.featureCount,
          tableName: exported.tableName,
          url: `/uploads/${encodeUploadPath(exported.relativePath)}?projectId=${encodeURIComponent(ctx.project.id)}`,
        },
      });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Export GeoPackage fallito" });
    }
  }));

  app.patch("/api/map-snapshots/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getMapSnapshot(id);
    if (!existing) return res.status(404).json({ error: "Snapshot non trovato" });

    const patch = {
      titolo: typeof req.body?.titolo === "string" ? req.body.titolo.trim() : undefined,
      didascalia: typeof req.body?.didascalia === "string" ? req.body.didascalia.trim() : undefined,
      tags: typeof req.body?.tags === "string" ? req.body.tags.trim() : undefined,
    };
    if (patch.titolo !== undefined && !patch.titolo) {
      return res.status(400).json({ error: "Titolo snapshot obbligatorio" });
    }

    const updated = ctx.storage.updateMapSnapshot(id, patch);
    if (!updated) return res.status(404).json({ error: "Snapshot non trovato" });
    res.json({
      snapshot: {
        ...updated,
        url: `/uploads/${encodeUploadPath(updated.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
      },
    });
  }));

  app.delete("/api/map-snapshots/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getMapSnapshot(id);
    if (!existing) return res.status(404).json({ error: "Snapshot non trovato" });

    const absolutePath = resolvePathInside(ctx.project.mediaDir, existing.percorso);
    if (absolutePath && fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch {
        // ignore file cleanup errors
      }
    }

    const deleted = ctx.storage.deleteMapSnapshot(id);
    if (!deleted) return res.status(404).json({ error: "Snapshot non trovato" });
    res.json({ ok: true });
  }));

  app.get("/api/cantieri/:cid/us-model", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const assignedKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
    const model = getUSModel(ctx.project, assignedKey);
    res.json({
      cantiereId: cid,
      modelKey: assignedKey,
      model,
      availableModels: listUSModels(ctx.project),
    });
  }));

  app.post("/api/cantieri/:cid/us-model", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const modelKey = typeof req.body?.modelKey === "string" ? req.body.modelKey.trim() : "";
    if (!modelKey) {
      return res.status(400).json({ error: "modelKey obbligatorio" });
    }

    const model = listUSModels(ctx.project).find((m) => m.key === modelKey);
    if (!model) {
      return res.status(404).json({ error: "Modello US non trovato" });
    }

    const updated = ctx.storage.updateCantiere(cid, { usModelKey: model.key });
    if (!updated) return res.status(404).json({ error: "Cantiere non trovato" });

    res.json({
      cantiereId: cid,
      modelKey: model.key,
      model,
    });
  }));

  // ─── Template DOCX scheda US ─────────────────────────────────────────────────

  const usTemplatePath = _usTemplatePathUtil;

  // ── Endpoint template GENERICO (retrocompatibilità) ──────────────────────────

  // GET — verifica se esiste un template caricato (generico o per-modello)
  app.get("/api/cantieri/:cid/us-template", withProject((ctx, _req, res) => {
    const templatePath = usTemplatePath(ctx.project);
    const exists = fs.existsSync(templatePath);
    if (!exists) return res.json({ exists: false });
    const stat = fs.statSync(templatePath);
    res.json({ exists: true, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }));

  // POST — carica un template DOCX generico
  app.post("/api/cantieri/:cid/us-template", upload.single("template"), withProject((ctx, req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Il file deve essere un .docx" });
    }
    const dest = usTemplatePath(ctx.project);
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    const stat = fs.statSync(dest);
    res.json({ ok: true, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }));

  // DELETE — rimuove il template generico
  app.delete("/api/cantieri/:cid/us-template", withProject((ctx, _req, res) => {
    const templatePath = usTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });
    fs.unlinkSync(templatePath);
    res.json({ ok: true });
  }));

  // GET — diagnostica placeholder template generico
  app.get("/api/cantieri/:cid/us-template/placeholders", withProject(async (ctx, _req, res) => {
    const templatePath = usTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });
    try {
      const tags = await detectTemplatePlaceholders(templatePath);
      res.json({ ok: true, tags });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore diagnostica", detail: String(e) });
    }
  }));

  // ── Endpoint template PER-MODELLO ─────────────────────────────────────────────

  // GET — verifica se esiste un template per un modello specifico
  app.get("/api/cantieri/:cid/us-template/:modelKey", withProject((ctx, req, res) => {
    const modelKey = String(req.params.modelKey);
    const templatePath = usTemplatePath(ctx.project, modelKey);
    const exists = fs.existsSync(templatePath);
    if (!exists) return res.json({ exists: false, modelKey });
    const stat = fs.statSync(templatePath);
    res.json({ exists: true, modelKey, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }));

  // POST — carica un template DOCX per un modello specifico
  // POST — crea modello custom dai placeholder del template DOCX caricato
  // DEVE stare prima di /:modelKey per non essere intercettato come modelKey="create-model"
  app.post("/api/cantieri/:cid/us-template/create-model", withProject(async (ctx, req, res) => {
    const templatePath = usTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: "Nessun template DOCX caricato per questo cantiere" });
    }

    const modelName = String(req.body?.name || "").trim();
    if (!modelName) {
      return res.status(400).json({ error: "Nome modello obbligatorio" });
    }

    try {
      // Un campo per ogni placeholder del template (i chk… diventano checkbox): la scheda deve
      // mostrare le stesse voci del documento. Fuori restano solo i blocchi fissi della scheda.
      const { fields: extraFields, placeholders } = await buildModelFieldsFromTemplate(templatePath);

      const model = createCustomUSModel(ctx.project, {
        name: modelName,
        description: `Modello creato da template DOCX il ${new Date().toLocaleDateString("it-IT")}`,
        fields: extraFields,
      });

      // Copia il template generico come template specifico del nuovo modello
      const modelTemplateDest = usTemplatePath(ctx.project, model.key);
      if (!fs.existsSync(modelTemplateDest)) {
        fs.copyFileSync(templatePath, modelTemplateDest);
      }

      res.json({ ok: true, model, detectedPlaceholders: placeholders, extraFields });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore analisi template", detail: String(e) });
    }
  }));

  // POST — riallinea le voci di un modello personalizzato al suo template DOCX
  // (aggiunge le voci mancanti, trasforma i chk… in checkbox, toglie quelle che il template non ha più)
  app.post("/api/cantieri/:cid/us-template/:modelKey/sync-model", withProject(async (ctx, req, res) => {
    const modelKey = String(req.params.modelKey);
    try {
      const result = await syncModelFieldsWithTemplate(ctx.project, modelKey);
      if (!result) return res.status(404).json({ error: "Modello personalizzato o template non trovato" });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore sincronizzazione modello", detail: String(e) });
    }
  }));

  // POST — carica un template DOCX per un modello specifico
  app.post("/api/cantieri/:cid/us-template/:modelKey", upload.single("template"), withProject(async (ctx, req, res) => {
    const modelKey = String(req.params.modelKey);
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Il file deve essere un .docx" });
    }
    const dest = usTemplatePath(ctx.project, modelKey);
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    const stat = fs.statSync(dest);

    // Nuovo template per un modello personalizzato ⇒ la scheda deve mostrare le stesse voci del template.
    let sync: { added: string[]; removed: string[]; total: number } | null = null;
    let syncError: string | undefined;
    if (modelKey !== "generic") {
      try {
        const result = await syncModelFieldsWithTemplate(ctx.project, modelKey);
        if (result) sync = { added: result.added, removed: result.removed, total: result.total };
      } catch (e: any) {
        syncError = e?.message || "Errore sincronizzazione voci del modello";
      }
    }
    res.json({ ok: true, modelKey, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString(), sync, syncError });
  }));

  // DELETE — rimuove il template di un modello specifico
  app.delete("/api/cantieri/:cid/us-template/:modelKey", withProject((ctx, req, res) => {
    const modelKey = String(req.params.modelKey);
    const templatePath = usTemplatePath(ctx.project, modelKey);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });
    fs.unlinkSync(templatePath);
    res.json({ ok: true, modelKey });
  }));

  // GET — diagnostica placeholder template per modello specifico
  app.get("/api/cantieri/:cid/us-template/:modelKey/placeholders", withProject(async (ctx, req, res) => {
    const modelKey = String(req.params.modelKey);
    const templatePath = usTemplatePath(ctx.project, modelKey);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato per questo modello" });
    try {
      const tags = await detectTemplatePlaceholders(templatePath);
      res.json({ ok: true, modelKey, tags });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore diagnostica", detail: String(e) });
    }
  }));

  // ── Endpoint template ELENCO US (tabella) ─────────────────────────────────────

  // GET — verifica se esiste un template elenco caricato
  app.get("/api/cantieri/:cid/elenco-template", withProject((ctx, _req, res) => {
    const templatePath = elencoUsTemplatePath(ctx.project);
    const exists = fs.existsSync(templatePath);
    if (!exists) return res.json({ exists: false });
    const stat = fs.statSync(templatePath);
    res.json({ exists: true, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }));

  // POST — carica/sostituisce il template elenco US
  app.post("/api/cantieri/:cid/elenco-template", upload.single("template"), withProject((ctx, req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Il file deve essere un .docx" });
    }
    const dest = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    // Nuovo template ⇒ decade backup e scelta sulle colonne extra.
    clearElencoTemplateChoice(ctx.project);
    const stat = fs.statSync(dest);
    res.json({ ok: true, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }));

  // DELETE — rimuove il template elenco US
  app.delete("/api/cantieri/:cid/elenco-template", withProject((ctx, _req, res) => {
    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });
    fs.unlinkSync(templatePath);
    clearElencoTemplateChoice(ctx.project);
    res.json({ ok: true });
  }));

  // ── Riparazione template Elenco US (loop incompleto / placeholder non validi) ─────────────

  // GET — analisi del template: righe fuori dal ciclo, placeholder sconosciuti, scelta salvata
  app.get("/api/cantieri/:cid/elenco-template/repair", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });
    if (!fs.existsSync(elencoUsTemplatePath(ctx.project))) {
      return res.json({ plan: null, summary: [], choice: null, canRestore: false });
    }
    const plan = await analyzeElencoTemplate(ctx.project, cantiere);
    res.json({
      plan: plan ? { orphanRows: plan.orphanRows, unknownPlaceholders: plan.unknownPlaceholders, needsRepair: plan.needsRepair } : null,
      summary: plan?.needsRepair ? describeRepairs(plan) : [],
      choice: readElencoTemplateChoice(ctx.project),
      canRestore: fs.existsSync(elencoUsTemplateOriginalPath(ctx.project)),
    });
  }));

  // POST — applica la scelta: "repair" corregge il template (con backup), "as-is" lo lascia com'è
  app.post("/api/cantieri/:cid/elenco-template/repair", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });

    const mode = req.body?.mode === "repair" ? "repair" : req.body?.mode === "as-is" ? "as-is" : null;
    if (!mode) return res.status(400).json({ error: "mode deve essere 'repair' o 'as-is'" });

    try {
      if (mode === "repair") {
        const { applied } = await repairElencoTemplate(ctx.project, cantiere);
        res.json({ ok: true, applied, choice: readElencoTemplateChoice(ctx.project) });
      } else {
        writeElencoTemplateChoice(ctx.project, { mode: "as-is", repairs: [], decidedAt: new Date().toISOString() });
        res.json({ ok: true, applied: [], choice: readElencoTemplateChoice(ctx.project) });
      }
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore riparazione template" });
    }
  }));

  // POST — ripristina il template originale (annulla la riparazione e la scelta)
  app.post("/api/cantieri/:cid/elenco-template/restore-original", withProject((ctx, _req, res) => {
    const templatePath = elencoUsTemplatePath(ctx.project);
    const originalPath = elencoUsTemplateOriginalPath(ctx.project);
    if (!fs.existsSync(originalPath)) return res.status(404).json({ error: "Nessun template originale da ripristinare" });
    fs.copyFileSync(originalPath, templatePath);
    clearElencoTemplateChoice(ctx.project);
    res.json({ ok: true });
  }));

  // GET — diagnostica placeholder template elenco US
  app.get("/api/cantieri/:cid/elenco-template/placeholders", withProject(async (ctx, _req, res) => {
    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });
    try {
      const tags = await detectTemplatePlaceholders(templatePath);
      res.json({ ok: true, tags });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Errore diagnostica", detail: String(e) });
    }
  }));

  // GET — colonne dinamiche dell'elenco US (dal template caricato, o le 3 colonne base se assente)
  app.get("/api/cantieri/:cid/elenco-us/table", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornataIdRaw = req.query.giornataId;
    const giornataId = typeof giornataIdRaw === "string" && giornataIdRaw.trim() ? Number(giornataIdRaw) : undefined;
    const usList = ctx.storage.getUSList(cid, giornataId);

    const columns = await resolveElencoColumns(ctx.project, cantiere, usList);
    const rows = usList.map((us) => ({
      id: us.id,
      daRivedere: !!us.daRivedere,
      values: buildElencoRowValues(columns, us, cantiere),
    }));

    res.json({ columns, rows });
  }));

  // GET — suggerimenti campi mancanti/simili per i placeholder del template elenco US (check deterministico)
  app.get("/api/cantieri/:cid/elenco-template/field-suggestions", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });

    const loopColumns = await extractTemplateLoopColumns(templatePath);
    if (!loopColumns) {
      return res.status(400).json({
        error: "Il template elenco US non contiene un blocco di tabella con i tag {#tag}...{/tag}",
      });
    }

    const flatKeys = Array.from(new Set(loopColumns.columnKeys.flat().filter((k): k is string => !!k)));
    const knownFields = knownFieldsForCantiere(ctx.project, cantiere);
    const knownKeySet = new Set(knownFields.map((f) => f.key));

    const suggestions = flatKeys
      .filter((key) => !knownKeySet.has(key))
      .map((placeholder) => {
        const match = findSimilarField(placeholder, knownFields);
        const status: "new" | "possible" | "certain" = !match ? "new" : match.score >= 0.95 ? "certain" : "possible";
        return { placeholder, status, match };
      });

    res.json({ suggestions });
  }));

  // POST — verifica con AI (in aggiunta al check deterministico) i placeholder rimasti "new"
  app.post("/api/cantieri/:cid/elenco-template/field-suggestions/ai-check", withProject(async (ctx, req, res) => {
    if (!AI_AVAILABLE) {
      return res.status(400).json({ error: "Nessun provider AI configurato" });
    }
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const placeholders: string[] = Array.isArray(req.body?.placeholders)
      ? req.body.placeholders.filter((p: unknown) => typeof p === "string")
      : [];
    if (placeholders.length === 0) return res.json({ suggestions: [] });

    const knownFields = knownFieldsForCantiere(ctx.project, cantiere);

    try {
      const matches = await matchFieldsWithAI(placeholders, knownFields);
      const suggestions = placeholders.map((placeholder) => ({ placeholder, match: matches[placeholder] ?? null }));
      res.json({ suggestions });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Errore verifica AI" });
    }
  }));

  // POST — applica le decisioni prese sui placeholder (usa campo esistente / crea nuovo campo)
  app.post("/api/cantieri/:cid/elenco-template/apply-field-decisions", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "Template non trovato" });

    type FieldDecision = {
      placeholder: string;
      action: "use-existing" | "create-new";
      existingKey?: string;
      label?: string;
    };
    const decisions: FieldDecision[] = Array.isArray(req.body?.decisions) ? req.body.decisions : [];

    const rewritten: string[] = [];
    const errors: { placeholder: string; error: string }[] = [];
    const newFields: { placeholder: string; key: string; label: string }[] = [];

    for (const decision of decisions) {
      if (!decision?.placeholder) continue;
      try {
        if (decision.action === "use-existing") {
          if (!decision.existingKey) throw new Error("Campo esistente non specificato");
          await rewriteTemplatePlaceholder(templatePath, decision.placeholder, decision.existingKey);
          rewritten.push(decision.placeholder);
        } else if (decision.action === "create-new") {
          const label = decision.label?.trim() || humanizeFieldKey(decision.placeholder);
          newFields.push({ placeholder: decision.placeholder, key: decision.placeholder, label });
        }
      } catch (e: any) {
        errors.push({ placeholder: decision.placeholder, error: e?.message || "Errore sconosciuto" });
      }
    }

    let modelUpdated: ReturnType<typeof getUSModel> | undefined;
    if (newFields.length > 0) {
      const activeModelKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
      const activeModel = getUSModel(ctx.project, activeModelKey);

      if (activeModel.source !== "custom") {
        for (const f of newFields) {
          errors.push({
            placeholder: f.placeholder,
            error: `Il modello attivo "${activeModel.name}" non è personalizzabile: crea prima un modello personalizzato (dal dialog Modello US) prima di aggiungere campi dall'elenco.`,
          });
        }
      } else {
        const existingKeys = new Set(activeModel.fields.map((f) => f.key));
        const fieldsToAdd = newFields.filter((f) => !existingKeys.has(normalizeFieldKey(f.key)));
        try {
          modelUpdated = updateCustomUSModel(ctx.project, activeModel.key, {
            fields: [
              ...activeModel.fields,
              ...fieldsToAdd.map((f) => ({ key: f.key, label: f.label, type: "text" as const })),
            ],
          });
        } catch (e: any) {
          for (const f of newFields) {
            errors.push({ placeholder: f.placeholder, error: e?.message || "Errore creazione campo" });
          }
        }

        // La chiave campo effettiva può differire dal placeholder originale (normalizzazione
        // interna al modello, es. camelCase collassato): se cambia, riallinea il template.
        if (modelUpdated) {
          for (const f of fieldsToAdd) {
            const finalKey = normalizeFieldKey(f.key);
            if (finalKey === f.placeholder) continue;
            try {
              await rewriteTemplatePlaceholder(templatePath, f.placeholder, finalKey);
              rewritten.push(f.placeholder);
            } catch (e: any) {
              errors.push({ placeholder: f.placeholder, error: e?.message || "Errore riallineamento placeholder" });
            }
          }
        }
      }
    }

    res.json({ ok: errors.length === 0, rewritten, modelUpdated, errors });
  }));

  app.patch("/api/cantieri/:cid", withProject((ctx, req, res) => {
    try {
      const requestedModelKey = typeof req.body?.usModelKey === "string" ? req.body.usModelKey.trim() : "";
      if (requestedModelKey) {
        const modelExists = listUSModels(ctx.project).some((m) => m.key === requestedModelKey);
        if (!modelExists) {
          return res.status(400).json({ error: "Modello US non valido per il cantiere" });
        }
      }
      const updated = ctx.storage.updateCantiere(Number(req.params.cid), req.body);
      if (!updated) return res.status(404).json({ error: "Cantiere non trovato" });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }));

  app.delete("/api/cantieri/:cid", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const allAllegati = ctx.storage.getAllegati(cid);
    allAllegati.forEach((a) => removeAttachmentIfExists(ctx.project, a.percorso));
    const allSnapshots = ctx.storage.getMapSnapshots(cid);
    allSnapshots.forEach((snapshot) => {
      const snapshotPath = resolvePathInside(ctx.project.mediaDir, snapshot.percorso);
      if (!snapshotPath || !fs.existsSync(snapshotPath)) return;
      try {
        fs.unlinkSync(snapshotPath);
      } catch {
        // ignore cleanup errors
      }
    });

    const deleted = ctx.storage.deleteCantiere(cid);
    if (!deleted) return res.status(404).json({ error: "Cantiere non trovato" });

    const cantiereMediaDir = resolvePathInside(ctx.project.mediaDir, String(cid));
    if (cantiereMediaDir && fs.existsSync(cantiereMediaDir)) {
      try {
        fs.rmSync(cantiereMediaDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    const snapshotsMediaDir = resolvePathInside(ctx.project.mediaDir, path.posix.join("_map_snapshots", String(cid)));
    if (snapshotsMediaDir && fs.existsSync(snapshotsMediaDir)) {
      try {
        fs.rmSync(snapshotsMediaDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    res.json({ ok: true });
  }));

  app.get("/api/cantieri/:cid/delete-impact", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    res.json({
      cantiereId: cid,
      giornateCount: ctx.storage.getGiornate(cid).length,
      usCount: ctx.storage.getUSList(cid).length,
      allegatiCount: ctx.storage.getAllegati(cid).length,
      qcLogsCount: ctx.storage.getQcLogs(cid).length,
    });
  }));

  app.post("/api/cantieri/:cid/transfer", withProject((ctx, req, res) => {
    const sourceCantiereId = Number(req.params.cid);
    if (!Number.isInteger(sourceCantiereId) || sourceCantiereId <= 0) {
      return res.status(400).json({ error: "ID cantiere non valido" });
    }

    const targetProjectId =
      typeof req.body?.targetProjectId === "string" ? req.body.targetProjectId.trim() : "";
    if (!targetProjectId) {
      return res.status(400).json({ error: "targetProjectId obbligatorio" });
    }

    if (targetProjectId === ctx.project.id) {
      return res.status(400).json({ error: "Il progetto destinazione deve essere diverso da quello corrente" });
    }

    const modeRaw = typeof req.body?.mode === "string" ? req.body.mode.toLowerCase().trim() : "copy";
    if (modeRaw !== "copy" && modeRaw !== "move") {
      return res.status(400).json({ error: "Modalita non valida: usa 'copy' o 'move'" });
    }
    const mode = modeRaw as TransferMode;

    const targetProject = getProjectById(targetProjectId);
    if (!targetProject) {
      return res.status(404).json({ error: "Progetto destinazione non trovato" });
    }

    try {
      const targetStorage = getStorageForProject(targetProject.id);
      const result = transferCantiere(
        ctx.project,
        targetProject,
        ctx.storage,
        targetStorage,
        sourceCantiereId,
        mode,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore durante il trasferimento del cantiere" });
    }
  }));

  app.post("/api/cantieri/:cid/import-geopackage/preview", geopackageUpload.single("file"), withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "File GeoPackage mancante" });

    try {
      const preview = previewGeoPackage({
        fileBuffer: file.buffer,
        originalName: file.originalname,
      });
      res.json(preview);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Preview GeoPackage fallita" });
    }
  }));

  app.post("/api/cantieri/:cid/geopackage/webmap-preview", geopackageUpload.single("file"), withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "File GeoPackage mancante" });

    const tableName = typeof req.body?.tableName === "string" && req.body.tableName.trim()
      ? req.body.tableName.trim()
      : null;
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;

    try {
      const preview = await previewGeoPackageWebMap({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        tableName,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json(preview);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Anteprima webmap GeoPackage fallita" });
    }
  }));

  app.post("/api/cantieri/:cid/import-geopackage", geopackageUpload.single("file"), withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "File GeoPackage mancante" });

    const giornataId = req.body?.giornataId ? Number(req.body.giornataId) : null;
    if (giornataId !== null) {
      const giornata = ctx.storage.getGiornata(giornataId);
      if (!giornata || giornata.cantiereId !== cid) {
        return res.status(400).json({ error: "giornataId non valida per questo cantiere" });
      }
    }

    try {
      const usThesaurus = getUsTopLevelThesaurusFromSchema(getProjectSchemaDefinition(ctx.project.id));
      const tableName = typeof req.body?.tableName === "string" && req.body.tableName.trim()
        ? req.body.tableName.trim()
        : null;
      const fieldMap = parseGeoPackageFieldMap(req.body?.fieldMap);
      const importUnknownColumns = parseBooleanLike(req.body?.importUnknownColumns);

      const result = importUSFromGeoPackage({
        storage: ctx.storage,
        cantiereId: cid,
        giornataId,
        fileBuffer: file.buffer,
        originalName: file.originalname,
        usThesaurus,
        tableName,
        fieldMap,
        importUnknownColumns,
      });

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Import GeoPackage fallito" });
    }
  }));

  // ── Meteo da Open-Meteo ────────────────────────────────────────────────────
  app.get("/api/cantieri/:cid/meteo", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const data = String(req.query.data || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ error: "Parametro data mancante o non valido (YYYY-MM-DD)" });
    }
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    // Geocodifica localita con Nominatim (OpenStreetMap)
    // Accetta localita override da query param (inserita manualmente dall'utente)
    const localitaOverride = String(req.query.localita || "").trim();
    const localita = localitaOverride || (cantiere.localita || "").replace(/\([A-Z]{2}\)\s*$/, "").trim();
    if (!localita) return res.status(400).json({ error: "Inserisci manualmente la località", needsLocalita: true });

    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(localita)}&format=json&limit=1`;
      const geoResp = await fetch(geoUrl, { headers: { "User-Agent": "ArcheoDoc/1.0 (archeodoc)" } });
      const geoData = await geoResp.json() as Array<{ lat: string; lon: string; display_name: string }>;
      if (!geoData.length) return res.status(404).json({ error: `Nessun risultato geografico per: ${localita}`, needsLocalita: true });
      const { lat, lon, display_name } = geoData[0];

      // Recupera dati meteo storici/forecast da Open-Meteo
      // L'archive API ha dati fino a 2 giorni fa; per date recenti/future usiamo forecast
      const todayItaly = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
      const todayStr = todayItaly.toISOString().slice(0, 10);
      const twoDaysAgo = new Date(todayItaly); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoStr = twoDaysAgo.toISOString().slice(0, 10);
      const isHistorical = data <= twoDaysAgoStr;
      const baseUrl = isHistorical
        ? "https://archive-api.open-meteo.com/v1/archive"
        : "https://api.open-meteo.com/v1/forecast";
      const meteoUrl = `${baseUrl}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,windspeed_10m_max,weather_code&start_date=${data}&end_date=${data}&timezone=Europe%2FRome`;
      const meteoResp = await fetch(meteoUrl);
      const meteoData = await meteoResp.json() as {
        daily?: { weather_code?: number[]; precipitation_sum?: number[]; windspeed_10m_max?: number[] };
        error?: boolean; reason?: string;
      };
      if (meteoData.error) return res.status(502).json({ error: meteoData.reason || "Errore Open-Meteo" });

      const wcode = meteoData.daily?.weather_code?.[0] ?? -1;
      const prec  = meteoData.daily?.precipitation_sum?.[0] ?? 0;
      const wind  = meteoData.daily?.windspeed_10m_max?.[0] ?? 0;

      // WMO weather code → condMeteo value
      // https://open-meteo.com/en/docs#weathervariables
      let condMeteo: string;
      if (wcode === 0) condMeteo = "soleggiato";                          // Clear sky
      else if (wcode <= 2) condMeteo = "variabile";                       // Mainly/partly cloudy
      else if (wcode === 3) condMeteo = "nuvoloso";                       // Overcast
      else if (wcode <= 48) condMeteo = "nuvoloso";                       // Fog/rime
      else if (wcode <= 57) condMeteo = "pioggia";                        // Drizzle
      else if (wcode <= 67) condMeteo = "pioggia";                        // Rain
      else if (wcode <= 77) condMeteo = "nuvoloso";                       // Snow/ice
      else if (wcode <= 82) condMeteo = "pioggia";                        // Rain showers
      else if (wcode <= 86) condMeteo = "nuvoloso";                       // Snow showers
      else condMeteo = "pioggia";                                         // Thunderstorm

      if (wind > 40) condMeteo = "ventoso";

      return res.json({ condMeteo, wcode, precipitazioni: prec, vento: wind, luogo: display_name });
    } catch (e: any) {
      return res.status(502).json({ error: `Errore recupero meteo: ${e.message}` });
    }
  }));

  // Giornate
  app.get("/api/cantieri/:cid/giornate", withProject((ctx, req, res) => {
    res.json(ctx.storage.getGiornate(Number(req.params.cid)));
  }));

  app.get("/api/cantieri/:cid/giornate/autocomplete", withProject((ctx, req, res) => {
    const giornate = ctx.storage.getGiornate(Number(req.params.cid));
    const collect = (vals: (string | null | undefined)[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of vals) {
        if (!v) continue;
        const trimmed = v.trim();
        if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); out.push(trimmed); }
      }
      return out.sort();
    };
    const collectTokens = (vals: (string | null | undefined)[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of vals) {
        if (!v) continue;
        let items: string[] = [];
        try { items = JSON.parse(v); } catch { items = v.split(/[,;]+/); }
        for (const item of items) {
          const t = typeof item === "string" ? item.trim() : String(item).trim();
          if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        }
      }
      return out.sort();
    };
    res.json({
      settore: collect(giornate.map((g) => g.settore)),
      archeologoCoordinatore: collect(giornate.map((g) => g.archeologoCoordinatore)),
      topografo: collect(giornate.map((g) => g.topografo)),
      direttoreScavo: collect(giornate.map((g: any) => g.direttoreScavo)),
      antropologo: collect(giornate.map((g: any) => g.antropologo)),
      respMateriali: collect(giornate.map((g: any) => g.respMateriali)),
      funzionarioSabap: collect(giornate.map((g: any) => g.funzionarioSabap)),
      archeologoSorveglianza: collect(giornate.map((g: any) => g.archeologoSorveglianza)),
      archeologi: collectTokens(giornate.map((g) => g.archeologi)),
      scavatori: collectTokens(giornate.map((g) => g.scavatori)),
      escavatore: collect(giornate.map((g) => g.escavatore)),
      obiettivo: collect(giornate.map((g) => g.obiettivo)),
    });
  }));

  app.post("/api/cantieri/:cid/giornate", withProject((ctx, req, res) => {
    try {
      const giornata = ctx.storage.createGiornata({ ...req.body, cantiereId: Number(req.params.cid) });
      res.json(giornata);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }));

  app.patch("/api/giornate/:id", withProject((ctx, req, res) => {
    const updated = ctx.storage.updateGiornata(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Giornata non trovata" });
    res.json(updated);
  }));

  app.delete("/api/giornate/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const allegati = ctx.storage.getAllegati(giornata.cantiereId, id);
    allegati.forEach((a) => removeAttachmentIfExists(ctx.project, a.percorso));

    const deleted = ctx.storage.deleteGiornata(id);
    if (!deleted) return res.status(404).json({ error: "Giornata non trovata" });

    res.json({ ok: true });
  }));

  app.get("/api/giornate/:id/delete-impact", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    res.json({
      giornataId: id,
      usCollegateCount: ctx.storage.getUSList(giornata.cantiereId, id).length,
      allegatiCount: ctx.storage.getAllegati(giornata.cantiereId, id).length,
      qcLogsCount: ctx.storage.getQcLogs(giornata.cantiereId, id).length,
    });
  }));

  app.get("/api/giornate/:id", withProject((ctx, req, res) => {
    const giornata = ctx.storage.getGiornata(Number(req.params.id));
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });
    res.json(giornata);
  }));

  // US
  app.get("/api/cantieri/:cid/us", withProject((ctx, req, res) => {
    const giornataId = req.query.giornataId ? Number(req.query.giornataId) : undefined;
    res.json(ctx.storage.getUSList(Number(req.params.cid), giornataId));
  }));

  app.post("/api/cantieri/:cid/us", withProject((ctx, req, res) => {
    try {
      const cid = Number(req.params.cid);
      const cantiere = ctx.storage.getCantiere(cid);
      if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

      const payload =
        req.body && typeof req.body === "object"
          ? { ...(req.body as Record<string, unknown>) }
          : ({} as Record<string, unknown>);
      const saveMode = parseUSSaveMode(payload.saveMode);
      delete payload.saveMode;

      const requestedModelKey =
        typeof payload?.schedaModelKey === "string" ? payload.schedaModelKey.trim() : "";
      const fallbackKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
      const modelKey = requestedModelKey || fallbackKey;
      const modelExists = listUSModels(ctx.project).some((m) => m.key === modelKey);
      if (!modelExists) {
        return res.status(400).json({ error: "Modello US non valido" });
      }

      const projectSchema = getProjectSchemaDefinition(ctx.project.id);
      const usThesaurus = getUsTopLevelThesaurusFromSchema(projectSchema);
      const schedaDataRecord = parseDataRecord(payload?.schedaData);
      const usBaseInput = pickUSBaseFromPayload(payload, {});
      usBaseInput.tipo = normalizeUsTipoWithVocabulary(usBaseInput.tipo, usThesaurus.tipo);
      usBaseInput.definizione = normalizeUsDefinizioneWithVocabulary(
        usBaseInput.definizione,
        usBaseInput.tipo,
        usThesaurus.definizione,
      );
      let schemaWarnings: Record<string, string[]> | undefined;
      if (saveMode === "final") {
        const usValidationInput = toUSValidationInput(usBaseInput, schedaDataRecord);
        // Usa passthrough per consentire i campi extra del modello US (es. ICCD)
        const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: true });
        // Campi richiesti dallo schema/modello: non bloccano il salvataggio, vengono segnalati come avvisi.
        const parsed = usValidator.safeParse(usValidationInput);
        if (!parsed.success) schemaWarnings = validationErrors(parsed.error);
      } else if (!isNonEmptyText(usBaseInput.codiceUS)) {
        return res.status(422).json({
          error: "Validazione schema US fallita",
          fieldErrors: {
            codiceUS: ["Codice US obbligatorio per il salvataggio in bozza"],
          },
        });
      }

      const filteredSchedaData = stripTopLevelKeysFromSchedaData(schedaDataRecord);
      const normalizedTopLevel = { ...usBaseInput };
      const codiceUS = String(normalizedTopLevel.codiceUS ?? "").trim();
      if (!codiceUS) {
        return res.status(422).json({
          error: "Validazione schema US fallita",
          fieldErrors: {
            codiceUS: ["Codice US obbligatorio"],
          },
        });
      }

      const normalizedCodeKey = usCodeKey(codiceUS);
      if (normalizedCodeKey) {
        const duplicates = ctx.storage
          .getUSList(cid)
          .filter((item) => usCodeKey(item.codiceUS) === normalizedCodeKey)
          .map((item) => ({
            id: item.id,
            codiceUS: item.codiceUS,
          }));

        const force = parseBooleanLike(req.query.force);
        if (duplicates.length > 0 && !force) {
          return res.status(409).json({
            warning: "duplicate_suspected",
            message: `Il codice "${codiceUS}" potrebbe coincidere con US gia esistenti.`,
            normalizedCode: normalizeUSCode(codiceUS),
            duplicates,
          });
        }
      }

      const us = ctx.storage.createUS({
        ...(payload as Record<string, unknown>),
        ...normalizedTopLevel,
        codiceUS,
        cantiereId: cid,
        schedaModelKey: modelKey,
        schedaData: serializeDataRecord(filteredSchedaData),
      } as any);
      syncInverseRelations(ctx.storage, us.id);
      res.json(schemaWarnings ? { ...us, schemaWarnings } : us);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }));

  app.get("/api/us/:id/pending-inverses", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getUS(id);
    if (!existing) return res.status(404).json({ error: "US non trovata" });
    const pending = computePendingInverses(ctx.storage, id);
    res.json(pending);
  }));

  app.post("/api/us/:id/apply-inverses", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getUS(id);
    if (!existing) return res.status(404).json({ error: "US non trovata" });
    const inverses = req.body?.inverses;
    if (!Array.isArray(inverses)) return res.status(400).json({ error: "Campo 'inverses' mancante o non array" });
    applyPendingInverses(ctx.storage, inverses);
    res.json({ ok: true, applied: inverses.length });
  }));

  app.patch("/api/us/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getUS(id);
    if (!existing) return res.status(404).json({ error: "US non trovata" });

    const payload: Record<string, unknown> = { ...req.body };
    const saveMode = parseUSSaveMode(payload.saveMode);
    delete payload.saveMode;
    if (typeof payload.schedaModelKey === "string" && payload.schedaModelKey.trim()) {
      const modelExists = listUSModels(ctx.project).some((m) => m.key === payload.schedaModelKey);
      if (!modelExists) {
        // Model was removed (e.g. archeosistemi-us no longer exists): silently reset to project default
        payload.schedaModelKey = ctx.project.defaultUsModelKey || BASE_US_MODEL_KEY;
      }
    }

    const existingSchedaData = parseDataRecord(existing.schedaData);
    let nextSchedaData = existingSchedaData;
    if (Object.prototype.hasOwnProperty.call(payload, "schedaData")) {
      nextSchedaData = parseDataRecord(payload.schedaData);
    }

    const existingUSBase = pickUSBaseFromPayload(existing as unknown as Record<string, unknown>, {});
    const nextUSBase = pickUSBaseFromPayload(payload, existingUSBase);
    const projectSchema = getProjectSchemaDefinition(ctx.project.id);
    const usThesaurus = getUsTopLevelThesaurusFromSchema(projectSchema);
    nextUSBase.tipo = normalizeUsTipoWithVocabulary(nextUSBase.tipo, usThesaurus.tipo);
    nextUSBase.definizione = normalizeUsDefinizioneWithVocabulary(
      nextUSBase.definizione,
      nextUSBase.tipo,
      usThesaurus.definizione,
    );

    let schemaWarnings: Record<string, string[]> | undefined;
    if (saveMode === "final") {
      // Usa passthrough (allowUnknown: true) per le US: i campi extra del modello
      // (es. ICCD) vengono già separati da stripTopLevelKeysFromSchedaData e salvati
      // in schedaData. La validazione strict bloccherebbe i campi ICCD non presenti
      // nello schema base del progetto.
      const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: true });
      const parsed = usValidator.safeParse(toUSValidationInput(nextUSBase, nextSchedaData));
      if (!parsed.success) schemaWarnings = validationErrors(parsed.error);
    } else if (!isNonEmptyText(nextUSBase.codiceUS)) {
      return res.status(422).json({
        error: "Validazione schema US fallita",
        fieldErrors: {
          codiceUS: ["Codice US obbligatorio per il salvataggio in bozza"],
        },
      });
    }

    // Un salvataggio "completo" (non bozza) risolve la segnalazione "da rivedere" impostata dall'import.
    if (saveMode === "final") {
      payload.daRivedere = false;
    }

    payload.schedaData = serializeDataRecord(stripTopLevelKeysFromSchedaData(nextSchedaData));
    const normalizedPayloadTopLevel = pickUSBaseFromPayload(payload, {});
    normalizedPayloadTopLevel.tipo = normalizeUsTipoWithVocabulary(normalizedPayloadTopLevel.tipo, usThesaurus.tipo);
    normalizedPayloadTopLevel.definizione = normalizeUsDefinizioneWithVocabulary(
      normalizedPayloadTopLevel.definizione,
      normalizedPayloadTopLevel.tipo,
      usThesaurus.definizione,
    );
    Object.assign(payload, normalizedPayloadTopLevel);

    const updated = ctx.storage.updateUS(id, payload);
    if (!updated) return res.status(404).json({ error: "US non trovata" });

    // Auto-populate inverse stratigraphic relations on other US records
    syncInverseRelations(ctx.storage, id);

    // Re-fetch after sync (other US may have been updated, but return the saved one)
    const final = ctx.storage.getUS(id) ?? updated;
    res.json(schemaWarnings ? { ...final, schemaWarnings } : final);
  }));

  // PATCH — modifica di una singola cella dell'elenco US (edit inline nella tabella).
  // Decide automaticamente se la chiave è una colonna nota di primo livello o un campo
  // custom del modello attivo (in tal caso va in schedaData, coerentemente con il resto
  // dell'app: vedi buildUSFlatFields, che fa sempre prevalere schedaData sulla colonna).
  app.patch("/api/us/:id/field", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getUS(id);
    if (!existing) return res.status(404).json({ error: "US non trovata" });

    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) return res.status(400).json({ error: "key obbligatoria" });
    const value = req.body?.value != null ? String(req.body.value) : "";

    const updated = applyUsInlineFieldEdit(ctx.storage, ctx.project, id, key, value);
    if (!updated) return res.status(404).json({ error: "US non trovata" });
    res.json(updated);
  }));

  // POST — segna come riviste (rimuove il flag "da rivedere") le US indicate, o tutte quelle del cantiere.
  app.post("/api/cantieri/:cid/us/segna-riviste", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    if (!ctx.storage.getCantiere(cid)) return res.status(404).json({ error: "Cantiere non trovato" });
    const ids: number[] | null = Array.isArray(req.body?.ids)
      ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : null;
    let count = 0;
    for (const us of ctx.storage.getUSList(cid)) {
      if (!us.daRivedere) continue;
      if (ids && !ids.includes(us.id)) continue;
      ctx.storage.updateUS(us.id, { daRivedere: false });
      count++;
    }
    res.json({ ok: true, count });
  }));

  app.delete("/api/us/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const allegati = ctx.storage.getAllegati(us.cantiereId, undefined, id);
    allegati.forEach((a) => removeAttachmentIfExists(ctx.project, a.percorso));

    const deleted = ctx.storage.deleteUS(id);
    if (!deleted) return res.status(404).json({ error: "US non trovata" });

    res.json({ ok: true });
  }));

  app.get("/api/us/:id/delete-impact", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    res.json({
      usId: id,
      allegatiCount: ctx.storage.getAllegati(us.cantiereId, undefined, id).length,
    });
  }));

  // SAS (schema-driven)
  app.get("/api/cantieri/:cid/sas", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json(ctx.storage.getSasRecords(cid));
  }));

  app.post("/api/cantieri/:cid/sas", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const codice = typeof req.body?.codice === "string" ? req.body.codice.trim() : "";
    if (!codice) return res.status(400).json({ error: "codice obbligatorio" });

    const dataRecord = parseDataRecord(req.body?.data);
    const validationInput = {
      ...dataRecord,
      codice,
      nome: req.body?.nome ?? null,
      descrizione: req.body?.descrizione ?? null,
    };
    const projectSchema = getProjectSchemaDefinition(ctx.project.id);
    const validator = buildEntityZodSchema(projectSchema, "sas", { allowUnknown: false });
    const parsed = validator.safeParse(validationInput);
    if (!parsed.success) {
      return res.status(422).json({
        error: "Validazione schema SAS fallita",
        fieldErrors: validationErrors(parsed.error),
      });
    }

    try {
      const created = ctx.storage.createSasRecord({
        cantiereId: cid,
        codice,
        nome: typeof req.body?.nome === "string" ? req.body.nome.trim() : null,
        descrizione: typeof req.body?.descrizione === "string" ? req.body.descrizione.trim() : null,
        data: serializeDataRecord(dataRecord),
      });
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione SAS" });
    }
  }));

  app.patch("/api/sas/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getSasRecord(id);
    if (!existing) return res.status(404).json({ error: "SAS non trovato" });

    const dataRecord = Object.prototype.hasOwnProperty.call(req.body || {}, "data")
      ? parseDataRecord(req.body?.data)
      : parseDataRecord(existing.data);
    const codice =
      typeof req.body?.codice === "string" && req.body.codice.trim()
        ? req.body.codice.trim()
        : existing.codice;
    const nome =
      typeof req.body?.nome === "string"
        ? req.body.nome.trim()
        : existing.nome;
    const descrizione =
      typeof req.body?.descrizione === "string"
        ? req.body.descrizione.trim()
        : existing.descrizione;

    const projectSchema = getProjectSchemaDefinition(ctx.project.id);
    const validator = buildEntityZodSchema(projectSchema, "sas", { allowUnknown: false });
    const parsed = validator.safeParse({
      ...dataRecord,
      codice,
      nome,
      descrizione,
    });
    if (!parsed.success) {
      return res.status(422).json({
        error: "Validazione schema SAS fallita",
        fieldErrors: validationErrors(parsed.error),
      });
    }

    const updated = ctx.storage.updateSasRecord(id, {
      ...req.body,
      codice,
      nome,
      descrizione,
      data: serializeDataRecord(dataRecord),
    });
    if (!updated) return res.status(404).json({ error: "SAS non trovato" });
    res.json(updated);
  }));

  app.delete("/api/sas/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getSasRecord(id);
    if (!existing) return res.status(404).json({ error: "SAS non trovato" });
    const deleted = ctx.storage.deleteSasRecord(id);
    if (!deleted) return res.status(404).json({ error: "SAS non trovato" });
    res.json({ ok: true });
  }));

  // RA (schema-driven)
  app.get("/api/cantieri/:cid/ra", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });
    const usId = req.query.usId ? Number(req.query.usId) : undefined;
    res.json(ctx.storage.getRaRecords(cid, usId));
  }));

  app.post("/api/cantieri/:cid/ra", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const codice = typeof req.body?.codice === "string" ? req.body.codice.trim() : "";
    if (!codice) return res.status(400).json({ error: "codice obbligatorio" });

    const usId = req.body?.usId ? Number(req.body.usId) : null;
    if (usId) {
      const us = ctx.storage.getUS(usId);
      if (!us || us.cantiereId !== cid) {
        return res.status(400).json({ error: "US associata non valida per il cantiere" });
      }
    }

    const dataRecord = parseDataRecord(req.body?.data);
    const projectSchema = getProjectSchemaDefinition(ctx.project.id);
    const validator = buildEntityZodSchema(projectSchema, "ra", { allowUnknown: false });
    const parsed = validator.safeParse({
      ...dataRecord,
      codice,
      tipo: req.body?.tipo ?? null,
      descrizione: req.body?.descrizione ?? null,
    });
    if (!parsed.success) {
      return res.status(422).json({
        error: "Validazione schema RA fallita",
        fieldErrors: validationErrors(parsed.error),
      });
    }

    try {
      const created = ctx.storage.createRaRecord({
        cantiereId: cid,
        usId,
        codice,
        tipo: typeof req.body?.tipo === "string" ? req.body.tipo.trim() : null,
        descrizione: typeof req.body?.descrizione === "string" ? req.body.descrizione.trim() : null,
        data: serializeDataRecord(dataRecord),
      });
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione RA" });
    }
  }));

  app.patch("/api/ra/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getRaRecord(id);
    if (!existing) return res.status(404).json({ error: "RA non trovato" });

    let usId = Object.prototype.hasOwnProperty.call(req.body || {}, "usId")
      ? (req.body?.usId ? Number(req.body.usId) : null)
      : existing.usId;
    if (usId) {
      const us = ctx.storage.getUS(usId);
      if (!us || us.cantiereId !== existing.cantiereId) {
        return res.status(400).json({ error: "US associata non valida per il cantiere" });
      }
    }

    const dataRecord = Object.prototype.hasOwnProperty.call(req.body || {}, "data")
      ? parseDataRecord(req.body?.data)
      : parseDataRecord(existing.data);
    const codice =
      typeof req.body?.codice === "string" && req.body.codice.trim()
        ? req.body.codice.trim()
        : existing.codice;
    const tipo =
      typeof req.body?.tipo === "string"
        ? req.body.tipo.trim()
        : existing.tipo;
    const descrizione =
      typeof req.body?.descrizione === "string"
        ? req.body.descrizione.trim()
        : existing.descrizione;

    const projectSchema = getProjectSchemaDefinition(ctx.project.id);
    const validator = buildEntityZodSchema(projectSchema, "ra", { allowUnknown: false });
    const parsed = validator.safeParse({
      ...dataRecord,
      codice,
      tipo,
      descrizione,
    });
    if (!parsed.success) {
      return res.status(422).json({
        error: "Validazione schema RA fallita",
        fieldErrors: validationErrors(parsed.error),
      });
    }

    const updated = ctx.storage.updateRaRecord(id, {
      ...req.body,
      usId,
      codice,
      tipo,
      descrizione,
      data: serializeDataRecord(dataRecord),
    });
    if (!updated) return res.status(404).json({ error: "RA non trovato" });
    res.json(updated);
  }));

  app.delete("/api/ra/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const existing = ctx.storage.getRaRecord(id);
    if (!existing) return res.status(404).json({ error: "RA non trovato" });
    const deleted = ctx.storage.deleteRaRecord(id);
    if (!deleted) return res.status(404).json({ error: "RA non trovato" });
    res.json({ ok: true });
  }));

  // Upload allegati
  app.post("/api/allegati/upload", upload.array("files", 20), withProject((ctx, req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nessun file ricevuto" });
    }

    const cantiereId = Number(req.body.cantiereId);
    if (!Number.isInteger(cantiereId) || cantiereId <= 0) {
      cleanupUploadedTempFiles(files);
      return res.status(400).json({ error: "cantiereId non valido" });
    }

    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) {
      cleanupUploadedTempFiles(files);
      return res.status(404).json({ error: "Cantiere non trovato" });
    }

    const giornataId = req.body.giornataId ? Number(req.body.giornataId) : undefined;
    let giornataDate: string | undefined;
    if (giornataId !== undefined) {
      const giornata = ctx.storage.getGiornata(giornataId);
      if (!giornata || giornata.cantiereId !== cantiereId) {
        cleanupUploadedTempFiles(files);
        return res.status(400).json({ error: "giornataId non valida per il cantiere selezionato" });
      }
      giornataDate = giornata.data || undefined;
    }

    const usId = req.body.usId ? Number(req.body.usId) : undefined;
    if (usId !== undefined) {
      const us = ctx.storage.getUS(usId);
      if (!us || us.cantiereId !== cantiereId) {
        cleanupUploadedTempFiles(files);
        return res.status(400).json({ error: "usId non valido per il cantiere selezionato" });
      }
    }

    const sasId = req.body.sasId ? Number(req.body.sasId) : undefined;

    const movedRelativePaths: string[] = [];
    try {
      const created: any[] = [];
      for (const file of files) {
        const tipo = fileToTipo(file.mimetype, file.originalname);
        const relativePath = giornataDate
          ? moveUploadedFileToCantiereDateDir(ctx.project, cantiereId, giornataDate, file)
          : moveUploadedFileToCantiereDir(ctx.project, cantiereId, file);
        movedRelativePaths.push(relativePath);

        const allegato = ctx.storage.createAllegato({
          cantiereId,
          giornataId,
          usId,
          sasId,
          tipo,
          nomeFile: file.originalname,
          percorso: relativePath,
          mimeType: file.mimetype,
          dimensione: file.size,
          dataRilievo: req.body.dataRilievo || null,
          operatore: req.body.operatore || null,
          descrizione: req.body.descrizione || null,
          coordX: req.body.coordX ? Number(req.body.coordX) : null,
          coordY: req.body.coordY ? Number(req.body.coordY) : null,
          quota: req.body.quota ? Number(req.body.quota) : null,
          descrizionAi: null,
        });

        if (usId) {
          const allegatiUS = ctx.storage.getAllegati(cantiereId, undefined, usId);
          const haFoto = allegatiUS.some((a) => a.tipo === "foto") ? 1 : 0;
          const haDisegno = allegatiUS.some((a) => a.tipo === "planimetria" || a.tipo === "disegno") ? 1 : 0;
          ctx.storage.updateUS(usId, { haFoto, haDisegno });
        }

        created.push(allegato);
      }

      res.json(created);
    } catch (error: any) {
      for (const relativePath of movedRelativePaths) {
        removeAttachmentIfExists(ctx.project, relativePath);
      }
      cleanupUploadedTempFiles(files);
      res.status(500).json({ error: error.message || "Errore upload" });
    }
  }));

  app.get("/api/cantieri/:cid/allegati", withProject((ctx, req, res) => {
    const giornataId = req.query.giornataId ? Number(req.query.giornataId) : undefined;
    const usId = req.query.usId ? Number(req.query.usId) : undefined;
    const sasId = req.query.sasId ? Number(req.query.sasId) : undefined;
    res.json(ctx.storage.getAllegati(Number(req.params.cid), giornataId, usId, sasId));
  }));

  // Delete allegato
  app.delete("/api/allegati/:id", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const allegato = ctx.storage.getALlegatoById(id);
    if (!allegato) return res.status(404).json({ error: "Allegato non trovato" });
    removeAttachmentIfExists(ctx.project, allegato.percorso);
    ctx.storage.deleteAllegato(id);
    if (allegato.usId) {
      const allegatiUS = ctx.storage.getAllegati(allegato.cantiereId, undefined, allegato.usId);
      const haFoto = allegatiUS.some((a) => a.tipo === "foto") ? 1 : 0;
      const haDisegno = allegatiUS.some((a) => a.tipo === "planimetria" || a.tipo === "disegno") ? 1 : 0;
      ctx.storage.updateUS(allegato.usId, { haFoto, haDisegno });
    }
    res.json({ ok: true });
  }));

  // Batch rename allegati: assegna nomi US+data a foto selezionate
  app.post("/api/allegati/batch-rename", withProject((ctx, req, res) => {
    const { allegatiIds, usCode, data: dateStr, cantiereId: rawCid } = req.body;

    if (!Array.isArray(allegatiIds) || allegatiIds.length === 0) {
      return res.status(400).json({ error: "Nessun allegato selezionato" });
    }
    const cantiereId = Number(rawCid);
    if (!Number.isInteger(cantiereId) || cantiereId <= 0) {
      return res.status(400).json({ error: "cantiereId non valido" });
    }
    const safeUsCode = String(usCode ?? "").trim().replace(/[^\w.-]/g, "");
    if (!safeUsCode) return res.status(400).json({ error: "Codice US richiesto" });
    const safeDate = String(dateStr ?? "").replace(/[^0-9-]/g, "").slice(0, 10);
    if (!safeDate) return res.status(400).json({ error: "Data richiesta" });

    const renamed: { id: number; nomeFile: string }[] = [];
    let seq = 1;

    for (const rawId of allegatiIds) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const allegato = ctx.storage.getALlegatoById(id);
      if (!allegato || allegato.cantiereId !== cantiereId) continue;

      const oldPercorso = String(allegato.percorso || "").replace(/\\/g, "/");
      const ext = path.posix.extname(allegato.nomeFile || "").toLowerCase() || ".jpg";
      const newName = `US${safeUsCode}_${safeDate}_${String(seq).padStart(3, "0")}${ext}`;
      seq++;

      const dir = path.posix.dirname(oldPercorso);
      const newPercorso = dir && dir !== "." ? `${dir}/${newName}` : newName;

      const oldAbsolute = resolvePathInside(ctx.project.mediaDir, oldPercorso);
      if (oldAbsolute && fs.existsSync(oldAbsolute)) {
        const newAbsolute = resolvePathInside(ctx.project.mediaDir, newPercorso);
        if (newAbsolute && oldAbsolute !== newAbsolute) {
          try {
            fs.renameSync(oldAbsolute, newAbsolute);
          } catch {
            continue;
          }
        }
      }

      ctx.storage.updateAllegato(id, { nomeFile: newName, percorso: newPercorso });
      renamed.push({ id, nomeFile: newName });
    }

    res.json({ renamed });
  }));
}
