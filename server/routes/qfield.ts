import type { Express } from "express";
import multer from "multer";
import type { WithProject } from "./types";
import {
  applyQFieldPreview,
  createQFieldPreviewFromZip,
  getQFieldPreview,
  resolveQFieldMediaPath,
  type SyncApplyOptions,
} from "../qfield_sync";

const qfieldUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 350 * 1024 * 1024 },
});

function parseApplyOptions(raw: unknown): SyncApplyOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const body = raw as Record<string, unknown>;
  const includeNonConflicts = body.includeNonConflicts === undefined
    ? undefined
    : body.includeNonConflicts === true || body.includeNonConflicts === "true";
  const attachPhotos = body.attachPhotos === undefined
    ? undefined
    : body.attachPhotos === true || body.attachPhotos === "true";
  const approvals = Array.isArray(body.approvals)
    ? body.approvals
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const rec = item as Record<string, unknown>;
          const field = typeof rec.field === "string" ? rec.field.trim() : "";
          if (!field) return null;
          const codiceUS = typeof rec.codiceUS === "string" ? rec.codiceUS : "";
          const usId = rec.usId == null ? null : Number(rec.usId);
          return {
            usId: Number.isFinite(usId) ? usId : null,
            codiceUS,
            field: field as any,
            value: (rec.value as any) ?? null,
          };
        })
        .filter(Boolean) as NonNullable<SyncApplyOptions["approvals"]>
    : undefined;
  return {
    includeNonConflicts,
    attachPhotos,
    approvals,
  };
}

export function registerQFieldRoutes(app: Express, withProject: WithProject) {
  /**
   * QField project synchronization
   * Formato di import compatibile con QFieldSync (LGPL-3.0)
   * https://github.com/opengisch/qfieldsync
   *
   * La struttura ZIP attesa riflette l'output di "Package for QField".
   */
  app.post("/api/cantieri/:cid/qfield/upload-project", qfieldUpload.single("file"), withProject(async (ctx, req, res) => {
    const cantiereId = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "ZIP progetto mancante" });
    if (!/\.zip$/i.test(file.originalname || "")) {
      return res.status(400).json({ error: "Formato non valido: carica un file .zip" });
    }

    try {
      const preview = await createQFieldPreviewFromZip({
        storage: ctx.storage,
        cantiereId,
        projectId: ctx.project.id,
        zipBuffer: file.buffer,
        sourceZipName: file.originalname,
      });
      res.json(preview);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Import QField non riuscito" });
    }
  }));

  app.get("/api/cantieri/:cid/qfield/sync-preview/:id", withProject((ctx, req, res) => {
    const cantiereId = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const uploadId = String(req.params.id || "");
    const preview = getQFieldPreview(uploadId, ctx.project.id, cantiereId);
    if (!preview) return res.status(404).json({ error: "Anteprima sincronizzazione non trovata o scaduta" });
    res.json(preview);
  }));

  app.post("/api/cantieri/:cid/qfield/sync-apply/:id", withProject((ctx, req, res) => {
    const cantiereId = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const options = parseApplyOptions(req.body);
    try {
      const result = applyQFieldPreview({
        storage: ctx.storage,
        project: ctx.project,
        uploadId: String(req.params.id || ""),
        projectId: ctx.project.id,
        cantiereId,
        options,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Applicazione sincronizzazione non riuscita" });
    }
  }));

  app.get("/api/cantieri/:cid/qfield/media/:id/*mediaPath", withProject((ctx, req, res) => {
    const cantiereId = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const mediaPathRaw = (req.params as any).mediaPath;
    const relative = Array.isArray(mediaPathRaw)
      ? mediaPathRaw.join("/").trim()
      : String(mediaPathRaw || "").trim();
    if (!relative) return res.status(400).json({ error: "Percorso media mancante" });

    const uploadId = String(req.params.id || "");
    const absolute = resolveQFieldMediaPath(uploadId, ctx.project.id, cantiereId, relative);
    if (!absolute) return res.status(404).json({ error: "Media non trovato" });
    res.sendFile(absolute);
  }));
}
