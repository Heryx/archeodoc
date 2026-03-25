import type { Express, Request, Response } from "express";
import type { Server } from "http";
import multer from "multer";
import fs from "fs";
import type { IStorage } from "./storage";
import {
  getStorageForProject,
  resolveProject,
  type ProjectDefinition,
} from "./projects";
import { logger } from "./logger";
import { registerGoogleRoutes } from "./routes/google";
import { registerProjectRoutes } from "./routes/projects";
import { registerSettingsRoutes } from "./routes/settings";
import { registerAIExportRoutes } from "./routes/ai_export";
import { registerQCRoutes } from "./routes/qc";
import { registerFieldworkRoutes } from "./routes/fieldwork";
import type { ProjectContext, ProjectHandler } from "./routes/types";
import {
  buildTargetAttachmentRelativePath,
  cleanupUploadedTempFiles,
  copyAttachmentIfExists,
  ensureUniqueRelativePath,
  fileToTipo,
  moveUploadedFileToCantiereDir,
  removeAttachmentIfExists,
  resolvePathInside,
} from "./routes/file_helpers";
import { normalizeUsDefinizione, normalizeUsTipo } from "@shared/us_thesaurus";
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
    try {
      await handler(ctx, req, res);
    } catch (error) {
      logger.error("Errore handler API", {
        path: req.path,
        method: req.method,
        message: error instanceof Error ? error.message : String(error),
      });

      if (!res.headersSent) {
        res.status(500).json({ error: "Errore interno del server" });
      }
    }
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
  "quotaPianoCampagna",
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

  if (Object.prototype.hasOwnProperty.call(out, "tipo")) {
    out.tipo = normalizeUsTipo(out.tipo);
  }
  if (Object.prototype.hasOwnProperty.call(out, "definizione")) {
    out.definizione = normalizeUsDefinizione(out.definizione, out.tipo);
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
        quotaPianoCampagna: us.quotaPianoCampagna,
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
      targetStorage.createSasRecord({
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

const multerStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const request = req as unknown as Request;
      const project = resolveProject(getRequestedProjectId(request));
      if (!project) {
        cb(new Error("Nessun progetto selezionato"), "");
        return;
      }

      // L'upload salva inizialmente in una cartella temporanea del progetto.
      // Il file viene poi spostato nella cartella cantiere nel route handler,
      // evitando race condition su req.body durante il parsing multipart.
      const targetDir = resolvePathInside(project.mediaDir, "_incoming");
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

const geopackageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
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

  registerGoogleRoutes(app, withProject);
  registerProjectRoutes(app, withProject);
  registerFieldworkRoutes(app, {
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
  });
  registerQCRoutes(app, withProject);

  registerSettingsRoutes(app, withProject);

  registerAIExportRoutes(app, withProject);

}










