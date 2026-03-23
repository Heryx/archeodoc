import type { Express, Request, Response } from "express";
import type { Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { IStorage } from "./storage";
import {
  createProject,
  getCurrentProjectId,
  getProjectById,
  getProjectSchemaDefinition,
  getStorageForProject,
  getWorkspaceRoot,
  listDocumentationSchemaPresets,
  listProjects,
  resolveProject,
  setProjectSchemaDefinition,
  setProjectSchemaPreset,
  setCurrentProject,
  type ProjectDefinition,
} from "./projects";
import {
  createCustomUSModel,
  deleteCustomUSModel,
  getUSModel,
  listUSModels,
  updateCustomUSModel,
} from "./us_models";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import { buildEntityZodSchema } from "@shared/validation/buildZodSchema";
import { normalizeDocumentationSchemaDefinition } from "@shared/documentation_schema";
import { checkGiornata } from "./qc";
import { analizzaTestoUS, analizzaTestoGiornata, AI_AVAILABLE, AI_PROVIDER } from "./ai";
import { exportSchedaUSDocx, exportReportGiornalieroDocx } from "./docx_export";

type ProjectContext = {
  project: ProjectDefinition;
  storage: IStorage;
};

type ProjectHandler = (ctx: ProjectContext, req: Request, res: Response) => unknown | Promise<unknown>;
type TransferMode = "copy" | "move";

type CantiereTransferResult = {
  mode: TransferMode;
  sourceProjectId: string;
  sourceCantiereId: number;
  targetProjectId: string;
  targetCantiereId: number;
  targetCodice: string;
  codiceRenamed: boolean;
  sourceDeleted: boolean;
  filesCopied: number;
  filesMissing: number;
  counts: {
    giornate: number;
    us: number;
    allegati: number;
    qcLogs: number;
  };
};

function getRequestedProjectId(req: Request): string | undefined {
  const fromHeader = req.header("x-project-id")?.trim();
  if (fromHeader) return fromHeader;

  const fromQuery = req.query.projectId;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();

  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.projectId;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();

  return undefined;
}

function resolveProjectContext(req: Request, res: Response): ProjectContext | null {
  const requestedId = getRequestedProjectId(req);
  const project = resolveProject(requestedId);
  if (!project) {
    res.status(400).json({ error: "Nessun progetto selezionato" });
    return null;
  }

  return {
    project,
    storage: getStorageForProject(project.id),
  };
}

function withProject(handler: ProjectHandler) {
  return async (req: Request, res: Response) => {
    const ctx = resolveProjectContext(req, res);
    if (!ctx) return;
    await handler(ctx, req, res);
  };
}

function parseDataRecord(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function serializeDataRecord(value: Record<string, unknown>): string | null {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

const US_TOP_LEVEL_KEYS = [
  "codiceUS",
  "tipo",
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "periodoIniziale",
  "periodoFinale",
  "materialiRinvenuti",
  "campioni",
  "giornataId",
] as const;

function toUSValidationInput(base: Record<string, unknown>, schedaData: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    ...schedaData,
  };
}

function pickUSBaseFromPayload(payload: Record<string, unknown>, fallback: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...fallback };
  for (const key of US_TOP_LEVEL_KEYS) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  return out;
}

function stripTopLevelKeysFromSchedaData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const topLevel = new Set<string>(US_TOP_LEVEL_KEYS);
  for (const [key, value] of Object.entries(data)) {
    if (topLevel.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function validationErrors(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}) {
  const out: Record<string, string[]> = {};
  const flat = error.flatten().fieldErrors;
  for (const [key, messages] of Object.entries(flat)) {
    if (Array.isArray(messages) && messages.length > 0) {
      out[key] = messages;
    }
  }
  return out;
}

function fileToTipo(mimeType: string, originalName: string): string {
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

function resolvePathInside(baseDir: string, relativePath: string): string | null {
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function resolveAttachmentAbsolutePath(project: ProjectDefinition, storedPath: string): string | null {
  if (!storedPath) return null;

  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }

  return resolvePathInside(project.mediaDir, storedPath);
}

function ensureUniqueCantiereCodice(targetStorage: IStorage, sourceCodice: string): string {
  const existing = new Set(targetStorage.getCantieri().map((c) => c.codice));
  if (!existing.has(sourceCodice)) return sourceCodice;

  let i = 1;
  let candidate = `${sourceCodice}-copy`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${sourceCodice}-copy-${i}`;
  }
  return candidate;
}

function buildTargetAttachmentRelativePath(targetCantiereId: number, sourcePath: string, sourceFileName: string): string {
  const normalized = normalizeRelativePath(sourcePath || "");
  const sourceParts = normalized.split("/").filter(Boolean);
  const tail = sourceParts.length > 0 && isNumericSegment(sourceParts[0]) ? sourceParts.slice(1) : sourceParts;
  const safeFileName = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalTail = tail.length > 0 ? tail : [safeFileName || `file-${Date.now()}`];
  return normalizeRelativePath(path.posix.join(String(targetCantiereId), ...finalTail));
}

function ensureUniqueRelativePath(baseDir: string, requestedRelativePath: string): string {
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

function copyAttachmentIfExists(
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

function transferCantiere(
  sourceProject: ProjectDefinition,
  targetProject: ProjectDefinition,
  sourceStorage: IStorage,
  targetStorage: IStorage,
  sourceCantiereId: number,
  mode: TransferMode,
): CantiereTransferResult {
  const sourceCantiere = sourceStorage.getCantiere(sourceCantiereId);
  if (!sourceCantiere) {
    throw new Error("Cantiere non trovato nel progetto sorgente");
  }

  const targetCodice = ensureUniqueCantiereCodice(targetStorage, sourceCantiere.codice);

  const createdCantiere = targetStorage.createCantiere({
    codice: targetCodice,
    nome: sourceCantiere.nome,
    committente: sourceCantiere.committente,
    localita: sourceCantiere.localita,
    dataInizio: sourceCantiere.dataInizio,
    dataFine: sourceCantiere.dataFine,
    responsabile: sourceCantiere.responsabile,
    note: sourceCantiere.note,
    usModelKey: sourceCantiere.usModelKey,
  });

  const giornate = sourceStorage.getGiornate(sourceCantiereId);
  const usList = sourceStorage.getUSList(sourceCantiereId);
  const sasList = sourceStorage.getSasRecords(sourceCantiereId);
  const raList = sourceStorage.getRaRecords(sourceCantiereId);
  const allegati = sourceStorage.getAllegati(sourceCantiereId);
  const qcLogs = sourceStorage.getQcLogs(sourceCantiereId);

  const giornataIdMap = new Map<number, number>();
  const usIdMap = new Map<number, number>();

  let filesCopied = 0;
  let filesMissing = 0;

  try {
    for (const giornata of giornate) {
      const created = targetStorage.createGiornata({
        cantiereId: createdCantiere.id,
        data: giornata.data,
        operatori: giornata.operatori,
        condMeteo: giornata.condMeteo,
        settore: giornata.settore,
        note: giornata.note,
        qcStatus: giornata.qcStatus,
        qcReport: giornata.qcReport,
        aiReportText: giornata.aiReportText,
      });
      giornataIdMap.set(giornata.id, created.id);
    }

    for (const us of usList) {
      const mappedGiornataId = us.giornataId != null ? (giornataIdMap.get(us.giornataId) ?? null) : null;
      const created = targetStorage.createUS({
        cantiereId: createdCantiere.id,
        giornataId: mappedGiornataId,
        codiceUS: us.codiceUS,
        tipo: us.tipo,
        definizione: us.definizione,
        descrizione: us.descrizione,
        interpretazione: us.interpretazione,
        quota: us.quota,
        settore: us.settore,
        coperto_da: us.coperto_da,
        copre: us.copre,
        si_lega_a: us.si_lega_a,
        uguale_a: us.uguale_a,
        periodoIniziale: us.periodoIniziale,
        periodoFinale: us.periodoFinale,
        materialiRinvenuti: us.materialiRinvenuti,
        campioni: us.campioni,
        haFoto: us.haFoto,
        haDisegno: us.haDisegno,
        haGps: us.haGps,
        geomCentroide: us.geomCentroide,
        geomPerimetro: us.geomPerimetro,
        srid: us.srid,
        qcStatus: us.qcStatus,
        qcProblemi: us.qcProblemi,
        schedaAiGenerata: us.schedaAiGenerata,
        schedaModelKey: us.schedaModelKey,
        schedaData: us.schedaData,
      });
      usIdMap.set(us.id, created.id);
    }

    for (const sas of sasList) {
      const created = targetStorage.createSasRecord({
        cantiereId: createdCantiere.id,
        codice: sas.codice,
        nome: sas.nome,
        descrizione: sas.descrizione,
        data: sas.data,
      });
    }

    for (const ra of raList) {
      const mappedUsId = ra.usId != null ? (usIdMap.get(ra.usId) ?? null) : null;
      targetStorage.createRaRecord({
        cantiereId: createdCantiere.id,
        usId: mappedUsId,
        codice: ra.codice,
        tipo: ra.tipo,
        descrizione: ra.descrizione,
        data: ra.data,
      });
    }

    for (const allegato of allegati) {
      const mappedGiornataId = allegato.giornataId != null ? (giornataIdMap.get(allegato.giornataId) ?? null) : null;
      const mappedUsId = allegato.usId != null ? (usIdMap.get(allegato.usId) ?? null) : null;

      const targetRelativeCandidate = buildTargetAttachmentRelativePath(
        createdCantiere.id,
        allegato.percorso,
        allegato.nomeFile,
      );
      const targetRelativePath = ensureUniqueRelativePath(targetProject.mediaDir, targetRelativeCandidate);

      const copied = copyAttachmentIfExists(sourceProject, targetProject, allegato.percorso, targetRelativePath);
      if (copied) {
        filesCopied += 1;
      } else {
        filesMissing += 1;
      }

      targetStorage.createAllegato({
        cantiereId: createdCantiere.id,
        giornataId: mappedGiornataId,
        usId: mappedUsId,
        tipo: allegato.tipo,
        nomeFile: allegato.nomeFile,
        percorso: targetRelativePath,
        mimeType: allegato.mimeType,
        dimensione: allegato.dimensione,
        dataRilievo: allegato.dataRilievo,
        operatore: allegato.operatore,
        descrizione: allegato.descrizione,
        coordX: allegato.coordX,
        coordY: allegato.coordY,
        quota: allegato.quota,
        descrizionAi: allegato.descrizionAi,
      });
    }

    for (const log of qcLogs) {
      const mappedGiornataId = log.giornataId != null ? (giornataIdMap.get(log.giornataId) ?? null) : null;
      const mappedUsId = log.usId != null ? (usIdMap.get(log.usId) ?? null) : null;
      targetStorage.createQcLog({
        cantiereId: createdCantiere.id,
        giornataId: mappedGiornataId,
        usId: mappedUsId,
        livello: log.livello,
        categoria: log.categoria,
        messaggio: log.messaggio,
        campoInteressato: log.campoInteressato,
      });
    }

    let sourceDeleted = false;
    if (mode === "move") {
      allegati.forEach((allegato) => removeAttachmentIfExists(sourceProject, allegato.percorso));

      const deleted = sourceStorage.deleteCantiere(sourceCantiereId);
      if (!deleted) {
        throw new Error("Impossibile completare lo spostamento: eliminazione sorgente fallita");
      }

      const sourceMediaDir = resolvePathInside(sourceProject.mediaDir, String(sourceCantiereId));
      if (sourceMediaDir && fs.existsSync(sourceMediaDir)) {
        fs.rmSync(sourceMediaDir, { recursive: true, force: true });
      }
      sourceDeleted = true;
    }

    return {
      mode,
      sourceProjectId: sourceProject.id,
      sourceCantiereId,
      targetProjectId: targetProject.id,
      targetCantiereId: createdCantiere.id,
      targetCodice,
      codiceRenamed: targetCodice !== sourceCantiere.codice,
      sourceDeleted,
      filesCopied,
      filesMissing,
      counts: {
        giornate: giornate.length,
        us: usList.length,
        allegati: allegati.length,
        qcLogs: qcLogs.length,
      },
    };
  } catch (error) {
    try {
      targetStorage.deleteCantiere(createdCantiere.id);
    } catch {
      // ignore cleanup errors
    }

    const targetMediaDir = resolvePathInside(targetProject.mediaDir, String(createdCantiere.id));
    if (targetMediaDir && fs.existsSync(targetMediaDir)) {
      try {
        fs.rmSync(targetMediaDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    throw error;
  }
}

function removeAttachmentIfExists(project: ProjectDefinition, storedPath: string): void {
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

const multerStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const request = req as unknown as Request;
      const project = resolveProject(getRequestedProjectId(request));
      if (!project) {
        cb(new Error("Nessun progetto selezionato"), "");
        return;
      }

      const cantiereDir = (req.body.cantiereId?.toString() || "0").trim();
      const targetDir = resolvePathInside(project.mediaDir, cantiereDir);
      if (!targetDir) {
        cb(new Error("Percorso upload non valido"), "");
        return;
      }

      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    } catch (error) {
      cb(error as Error, "");
    }
  },
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

export async function registerRoutes(_httpServer: Server, app: Express): Promise<void> {
  // Static media serve: /uploads/<relative-path>?projectId=<id>
  app.use("/uploads", (req, res, next) => {
    const project = resolveProject(typeof req.query.projectId === "string" ? req.query.projectId : undefined);
    if (!project) return next();

    const relativePath = req.path.replace(/^\/+/, "");
    const absolutePath = resolvePathInside(project.mediaDir, relativePath);
    if (!absolutePath) return next();

    if (fs.existsSync(absolutePath)) {
      res.sendFile(absolutePath);
      return;
    }

    next();
  });

  // Projects management
  app.get("/api/projects", (_req, res) => {
    res.json({
      workspaceRoot: getWorkspaceRoot(),
      currentProjectId: getCurrentProjectId(),
      projects: listProjects(),
      schemaPresets: listDocumentationSchemaPresets(),
    });
  });

  app.get("/api/projects/current", (_req, res) => {
    const current = resolveProject(getCurrentProjectId());
    if (!current) return res.status(404).json({ error: "Nessun progetto disponibile" });
    res.json({ project: current });
  });

  app.post("/api/projects", (req, res) => {
    try {
      const project = createProject({
        name: req.body?.name,
        projectId: req.body?.projectId,
        basePath: req.body?.basePath,
        documentationPresetKey: req.body?.documentationPresetKey,
        documentationMode: req.body?.documentationMode,
      });
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione progetto" });
    }
  });

  app.post("/api/projects/:id/select", (req, res) => {
    try {
      const project = setCurrentProject(req.params.id);
      res.json(project);
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Progetto non trovato" });
    }
  });

  app.get("/api/projects/:id/schema", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    try {
      const schema = getProjectSchemaDefinition(project.id);
      res.json({
        project,
        schema,
        presets: listDocumentationSchemaPresets(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore caricamento schema progetto" });
    }
  });

  app.post("/api/projects/:id/schema-preset", (req, res) => {
    const presetKey = typeof req.body?.presetKey === "string" ? req.body.presetKey.trim() : "";
    if (!presetKey) {
      return res.status(400).json({ error: "presetKey obbligatorio" });
    }

    try {
      const project = setProjectSchemaPreset(req.params.id, presetKey);
      res.json(project);
    } catch (error: any) {
      const message = error.message || "Errore aggiornamento preset schema";
      if (message.toLowerCase().includes("non trovato")) {
        return res.status(404).json({ error: message });
      }
      res.status(400).json({ error: message });
    }
  });

  app.patch("/api/projects/:id/schema", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const rawSchema =
      req.body && typeof req.body === "object" && "schema" in req.body
        ? (req.body.schema as Record<string, unknown>)
        : (req.body as Record<string, unknown>);

    if (!rawSchema || typeof rawSchema !== "object") {
      return res.status(400).json({ error: "Schema non valido" });
    }

    try {
      const normalized = normalizeDocumentationSchemaDefinition({
        ...(rawSchema as any),
        key: project.schemaKey,
        mode: project.documentationMode,
        exportMode: project.exportMode,
        usModelKey: project.defaultUsModelKey,
      });
      const schema = setProjectSchemaDefinition(project.id, normalized);
      res.json({
        project: getProjectById(project.id),
        schema,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore aggiornamento schema progetto" });
    }
  });

  // Modelli US (base, ministeriali, personalizzati)
  app.get("/api/us-models", withProject((ctx, _req, res) => {
    res.json({
      models: listUSModels(ctx.project),
    });
  }));

  app.post("/api/us-models/custom", withProject((ctx, req, res) => {
    try {
      const model = createCustomUSModel(ctx.project, {
        key: req.body?.key,
        name: req.body?.name,
        description: req.body?.description,
        fields: req.body?.fields,
      });
      res.json(model);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione modello personalizzato" });
    }
  }));

  app.patch("/api/us-models/custom/:modelKey", withProject((ctx, req, res) => {
    try {
      const modelKey = String(req.params.modelKey || "").trim();
      const model = updateCustomUSModel(ctx.project, modelKey, {
        name: req.body?.name,
        description: req.body?.description,
        fields: req.body?.fields,
      });
      res.json(model);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore aggiornamento modello personalizzato" });
    }
  }));

  app.delete("/api/us-models/custom/:modelKey", withProject((ctx, req, res) => {
    const modelKey = String(req.params.modelKey || "").trim();
    const cantieri = ctx.storage.getCantieri();
    const modelInCantieri = cantieri.some((c) => (c.usModelKey || BASE_US_MODEL_KEY) === modelKey);
    if (modelInCantieri) {
      return res.status(409).json({ error: "Modello in uso in almeno un cantiere" });
    }

    const modelInUS = cantieri.some((c) =>
      ctx.storage
        .getUSList(c.id)
        .some((us) => (us.schedaModelKey || c.usModelKey || BASE_US_MODEL_KEY) === modelKey),
    );
    if (modelInUS) {
      return res.status(409).json({ error: "Modello in uso in almeno una scheda US" });
    }

    try {
      deleteCustomUSModel(ctx.project, modelKey);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore eliminazione modello personalizzato" });
    }
  }));

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

      const requestedModelKey =
        typeof req.body?.schedaModelKey === "string" ? req.body.schedaModelKey.trim() : "";
      const fallbackKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
      const modelKey = requestedModelKey || fallbackKey;
      const modelExists = listUSModels(ctx.project).some((m) => m.key === modelKey);
      if (!modelExists) {
        return res.status(400).json({ error: "Modello US non valido" });
      }

      const projectSchema = getProjectSchemaDefinition(ctx.project.id);
      const schedaDataRecord = parseDataRecord(req.body?.schedaData);
      const usBaseInput = pickUSBaseFromPayload(req.body || {}, {});
      const usValidationInput = toUSValidationInput(usBaseInput, schedaDataRecord);
      const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: false });
      const parsed = usValidator.safeParse(usValidationInput);
      if (!parsed.success) {
        return res.status(422).json({
          error: "Validazione schema US fallita",
          fieldErrors: validationErrors(parsed.error),
        });
      }

      const filteredSchedaData = stripTopLevelKeysFromSchedaData(schedaDataRecord);
      const us = ctx.storage.createUS({
        ...req.body,
        cantiereId: cid,
        schedaModelKey: modelKey,
        schedaData: serializeDataRecord(filteredSchedaData),
      });
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
    const usValidator = buildEntityZodSchema(projectSchema, "us", { allowUnknown: false });
    const parsed = usValidator.safeParse(toUSValidationInput(nextUSBase, nextSchedaData));
    if (!parsed.success) {
      return res.status(422).json({
        error: "Validazione schema US fallita",
        fieldErrors: validationErrors(parsed.error),
      });
    }

    payload.schedaData = serializeDataRecord(stripTopLevelKeysFromSchedaData(nextSchedaData));

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
    try {
      const cantiereId = Number(req.body.cantiereId);
      const giornataId = req.body.giornataId ? Number(req.body.giornataId) : undefined;
      const usId = req.body.usId ? Number(req.body.usId) : undefined;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "Nessun file ricevuto" });
      }

      const created: any[] = [];
      for (const file of files) {
        const tipo = fileToTipo(file.mimetype, file.originalname);
        const relativePath = normalizeRelativePath(path.relative(ctx.project.mediaDir, file.path));

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
      res.status(500).json({ error: error.message || "Errore upload" });
    }
  }));

  app.get("/api/cantieri/:cid/allegati", withProject((ctx, req, res) => {
    const giornataId = req.query.giornataId ? Number(req.query.giornataId) : undefined;
    res.json(ctx.storage.getAllegati(Number(req.params.cid), giornataId));
  }));

  // QC
  app.post("/api/giornate/:id/qc", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const usList = ctx.storage.getUSList(giornata.cantiereId, id);
    const allegatiGiornata = ctx.storage.getAllegati(giornata.cantiereId, id);
    const tutteLeUS = ctx.storage.getUSList(giornata.cantiereId);
    const result = checkGiornata(giornata, usList, allegatiGiornata, tutteLeUS);

    ctx.storage.updateGiornata(id, { qcStatus: result.status, qcReport: JSON.stringify(result.issues) });
    ctx.storage.deleteQcLogsByGiornata(id);

    for (const issue of result.issues) {
      ctx.storage.createQcLog({
        cantiereId: giornata.cantiereId,
        giornataId: id,
        usId: issue.usId || null,
        livello: issue.livello,
        categoria: issue.categoria,
        messaggio: issue.messaggio,
        campoInteressato: issue.campoInteressato || null,
      });
    }

    for (const us of usList) {
      const usIssues = result.issues.filter((i) => i.usId === us.id);
      ctx.storage.updateUS(us.id, {
        qcStatus: usIssues.some((i) => i.livello === "error")
          ? "error"
          : usIssues.some((i) => i.livello === "warning")
            ? "warning"
            : "ok",
        qcProblemi: JSON.stringify(usIssues),
      });
    }

    res.json(result);
  }));

  app.get("/api/giornate/:id/qc-logs", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });
    res.json(ctx.storage.getQcLogs(giornata.cantiereId, id));
  }));

  // ─── Impostazioni AI: lettura chiavi dal .env ─────────────────────────────
  app.get("/api/settings/ai", (_req, res) => {
    // Restituisce le chiavi mascherate (mostra solo se presenti, non il valore)
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
    const aiProvider = process.env.AI_PROVIDER?.trim() || "";
    res.json({
      geminiKeySet: geminiKey.length > 0,
      anthropicKeySet: anthropicKey.length > 0,
      geminiKeyPreview: geminiKey.length > 6 ? geminiKey.slice(0, 4) + "..." + geminiKey.slice(-4) : (geminiKey.length > 0 ? "***" : ""),
      anthropicKeyPreview: anthropicKey.length > 6 ? anthropicKey.slice(0, 8) + "..." + anthropicKey.slice(-4) : (anthropicKey.length > 0 ? "***" : ""),
      aiProvider: aiProvider || "auto",
      currentProvider: AI_PROVIDER,
      available: AI_AVAILABLE,
    });
  });

  // ─── Impostazioni AI: salvataggio chiavi nel .env ──────────────────────────
  app.post("/api/settings/ai", (req, res) => {
    const { geminiKey, anthropicKey, aiProvider } = req.body as {
      geminiKey?: string;
      anthropicKey?: string;
      aiProvider?: string;
    };

    // Percorso del file .env nella root del progetto (accanto a package.json)
    const envPath = path.join(process.cwd(), ".env");

    // Leggi il .env esistente (se presente)
    let envContent = "";
    try { envContent = fs.readFileSync(envPath, "utf-8"); } catch { envContent = ""; }

    // Helper: aggiorna o inserisce una variabile nel contenuto .env
    function setEnvVar(content: string, key: string, value: string | undefined): string {
      if (value === undefined || value === null) return content; // non toccare se non passato
      const trimmed = value.trim();
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (trimmed === "") {
        // Rimuovi la riga se il valore è vuoto
        return content.replace(regex, "").replace(/\n{3,}/g, "\n\n").trim();
      }
      if (regex.test(content)) {
        return content.replace(regex, `${key}=${trimmed}`);
      }
      return content ? content.trimEnd() + `\n${key}=${trimmed}\n` : `${key}=${trimmed}\n`;
    }

    let updated = envContent;
    if (geminiKey !== undefined)    updated = setEnvVar(updated, "GEMINI_API_KEY", geminiKey);
    if (anthropicKey !== undefined) updated = setEnvVar(updated, "ANTHROPIC_API_KEY", anthropicKey);
    if (aiProvider !== undefined)   updated = setEnvVar(updated, "AI_PROVIDER", aiProvider === "auto" ? "" : aiProvider);

    try {
      fs.writeFileSync(envPath, updated.trimEnd() + "\n", "utf-8");
    } catch (e: any) {
      return res.status(500).json({ error: "Impossibile scrivere il file .env: " + e.message });
    }

    // Ricarica le variabili in process.env immediatamente
    if (geminiKey !== undefined)    process.env.GEMINI_API_KEY    = geminiKey.trim() || undefined!;
    if (anthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = anthropicKey.trim() || undefined!;
    if (aiProvider !== undefined && aiProvider !== "auto") process.env.AI_PROVIDER = aiProvider.trim();
    else if (aiProvider === "auto") delete process.env.AI_PROVIDER;

    res.json({ ok: true, message: "Impostazioni salvate. Riavvia il server per applicare il nuovo provider AI." });
  });

  // AI status — verifica quale provider AI è configurato
  app.get("/api/ai/status", (_req, res) => {
    res.json({ available: AI_AVAILABLE, provider: AI_PROVIDER });
  });

  // AI US
  app.post("/api/us/:id/analizza-ai", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    try {
      const result = await analizzaTestoUS(us);
      ctx.storage.updateUS(id, {
        schedaAiGenerata: result.schedaFormattata,
        qcProblemi: JSON.stringify([
          ...(JSON.parse(us.qcProblemi || "[]")),
          ...result.campiMancanti.map((c) => ({ livello: "warning", categoria: "completezza", messaggio: `Campo mancante (AI): ${c}` })),
        ]),
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // AI giornata
  app.post("/api/giornate/:id/analizza-ai", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const usList = ctx.storage.getUSList(giornata.cantiereId, id);
    const qcLogs = ctx.storage.getQcLogs(giornata.cantiereId, id);

    try {
      const result = await analizzaTestoGiornata(giornata, usList, qcLogs);
      ctx.storage.updateGiornata(id, { aiReportText: result.reportFormattato });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export US DOCX
  app.get("/api/us/:id/export-docx", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const cantiere = ctx.storage.getCantiere(us.cantiereId);

    const schedaTesto = us.schedaAiGenerata || [
      `CODICE US: ${us.codiceUS}`,
      `TIPO: ${us.tipo || "-"}`,
      `DEFINIZIONE: ${us.definizione || "-"}`,
      `DESCRIZIONE: ${us.descrizione || "-"}`,
      `INTERPRETAZIONE: ${us.interpretazione || "-"}`,
    ].join("\n");

    let campiMancanti: string[] = [];
    try {
      campiMancanti = JSON.parse(us.qcProblemi || "[]")
        .filter((issue: any) => issue.categoria === "completezza")
        .map((issue: any) => issue.messaggio);
    } catch {
      campiMancanti = [];
    }

    try {
      const buf = await exportSchedaUSDocx(us, cantiere, schedaTesto, campiMancanti, "");
      const filename = `Scheda_${us.codiceUS.replace(/[\s/]/g, "_")}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export giornata DOCX
  app.get("/api/giornate/:id/export-docx", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    if (!giornata.aiReportText) {
      return res.status(404).json({ error: "Report non ancora generato - usa prima l'analisi AI" });
    }

    const cantiere = ctx.storage.getCantiere(giornata.cantiereId);
    const qcLogs = ctx.storage.getQcLogs(giornata.cantiereId, id);
    const campiMancanti = qcLogs.filter((log) => log.livello === "error").map((log) => log.messaggio);

    try {
      const buf = await exportReportGiornalieroDocx(giornata, cantiere, giornata.aiReportText, campiMancanti, "");
      const filename = `Diario_${giornata.data}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));
}
