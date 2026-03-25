import type { Express } from "express";
import type multer from "multer";
import fs from "fs";
import type { WithProject } from "./types";
import type { IStorage } from "../storage";
import {
  getProjectById,
  getProjectSchemaDefinition,
  getStorageForProject,
  type ProjectDefinition,
} from "../projects";
import { getUSModel, listUSModels } from "../us_models";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import { buildEntityZodSchema } from "@shared/validation/buildZodSchema";
import { getUsTopLevelThesaurusFromSchema } from "@shared/us_schema_thesaurus";
import { normalizeUsDefinizioneWithVocabulary, normalizeUsTipoWithVocabulary } from "@shared/us_thesaurus";
import {
  importUSFromGeoPackage,
  previewGeoPackage,
  previewGeoPackageWebMap,
  type GeoPackageFieldMap,
} from "../geopackage_import";

type TransferMode = "copy" | "move";
type USSaveMode = "draft" | "final";

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

  app.get("/api/cantieri/:cid/us-model", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const assignedKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
    const model = getUSModel(ctx.project, assignedKey);
    res.json({
      cantiereId: cid,
      modelKey: model.key,
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

  // Giornate
  app.get("/api/cantieri/:cid/giornate", withProject((ctx, req, res) => {
    res.json(ctx.storage.getGiornate(Number(req.params.cid)));
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
      if (saveMode === "final") {
        const usValidationInput = toUSValidationInput(usBaseInput, schedaDataRecord);
        // Usa passthrough per consentire i campi extra del modello US (es. ICCD)
        const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: true });
        const parsed = usValidator.safeParse(usValidationInput);
        if (!parsed.success) {
          return res.status(422).json({
            error: "Validazione schema US fallita",
            fieldErrors: validationErrors(parsed.error),
          });
        }
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

      const us = ctx.storage.createUS({
        ...(payload as Record<string, unknown>),
        ...normalizedTopLevel,
        codiceUS,
        cantiereId: cid,
        schedaModelKey: modelKey,
        schedaData: serializeDataRecord(filteredSchedaData),
      } as any);
      res.json(us);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
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
        return res.status(400).json({ error: "Modello US non valido" });
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

    if (saveMode === "final") {
      // Usa passthrough (allowUnknown: true) per le US: i campi extra del modello
      // (es. ICCD) vengono già separati da stripTopLevelKeysFromSchedaData e salvati
      // in schedaData. La validazione strict bloccherebbe i campi ICCD non presenti
      // nello schema base del progetto.
      const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: true });
      const parsed = usValidator.safeParse(toUSValidationInput(nextUSBase, nextSchedaData));
      if (!parsed.success) {
        return res.status(422).json({
          error: "Validazione schema US fallita",
          fieldErrors: validationErrors(parsed.error),
        });
      }
    } else if (!isNonEmptyText(nextUSBase.codiceUS)) {
      return res.status(422).json({
        error: "Validazione schema US fallita",
        fieldErrors: {
          codiceUS: ["Codice US obbligatorio per il salvataggio in bozza"],
        },
      });
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
    res.json(updated);
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
    if (giornataId !== undefined) {
      const giornata = ctx.storage.getGiornata(giornataId);
      if (!giornata || giornata.cantiereId !== cantiereId) {
        cleanupUploadedTempFiles(files);
        return res.status(400).json({ error: "giornataId non valida per il cantiere selezionato" });
      }
    }

    const usId = req.body.usId ? Number(req.body.usId) : undefined;
    if (usId !== undefined) {
      const us = ctx.storage.getUS(usId);
      if (!us || us.cantiereId !== cantiereId) {
        cleanupUploadedTempFiles(files);
        return res.status(400).json({ error: "usId non valido per il cantiere selezionato" });
      }
    }

    const movedRelativePaths: string[] = [];
    try {
      const created: any[] = [];
      for (const file of files) {
        const tipo = fileToTipo(file.mimetype, file.originalname);
        const relativePath = moveUploadedFileToCantiereDir(ctx.project, cantiereId, file);
        movedRelativePaths.push(relativePath);

        const allegato = ctx.storage.createAllegato({
          cantiereId,
          giornataId,
          usId,
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
    res.json(ctx.storage.getAllegati(Number(req.params.cid), giornataId));
  }));
}
