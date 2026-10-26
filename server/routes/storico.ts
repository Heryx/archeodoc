/**
 * Cronologia delle modifiche e ripristino.
 * GET  /api/storico?entityType=us&entityId=12&cantiereId=3&action=delete&limit=100  → elenco versioni (le piu' recenti prima)
 * GET  /api/storico/:id                                                           → dettaglio: campo per campo prima / dopo / adesso
 * POST /api/storico/:id/restore   { fields?: string[] }                           → annulla la modifica (o solo alcuni campi) / ricrea la scheda eliminata
 */
import type { Express } from "express";
import type { WithProject } from "./types";
import type { HistoryEntityType } from "../history";
import { restoreTrashedAttachment } from "./file_helpers";
import { syncInverseRelations } from "../relations_sync";

const ENTITY_TYPES = new Set<string>([
  "us", "giornata", "sas", "ra", "documentazione", "periodo", "persona", "nodo", "allegato", "cantiere",
]);

function optNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function registerStoricoRoutes(app: Express, withProject: WithProject) {
  app.get("/api/storico", withProject((ctx, req, res) => {
    const entityType = typeof req.query.entityType === "string" && ENTITY_TYPES.has(req.query.entityType)
      ? (req.query.entityType as HistoryEntityType)
      : undefined;
    const action = req.query.action === "delete" || req.query.action === "update" ? req.query.action : undefined;
    res.json({
      versions: ctx.storage.history.list({
        entityType,
        entityId: optNumber(req.query.entityId),
        cantiereId: optNumber(req.query.cantiereId),
        action,
        limit: optNumber(req.query.limit),
      }),
    });
  }));

  app.get("/api/storico/:id", withProject((ctx, req, res) => {
    const detail = ctx.storage.history.get(String(req.params.id));
    if (!detail) return res.status(404).json({ error: "Versione non trovata" });
    res.json(detail);
  }));

  app.post("/api/storico/:id/restore", withProject((ctx, req, res) => {
    const fields = Array.isArray(req.body?.fields)
      ? req.body.fields.filter((f: unknown): f is string => typeof f === "string")
      : undefined;
    try {
      const result = ctx.storage.history.restore(String(req.params.id), fields);

      let filesRecovered = 0;
      for (const percorso of result.attachmentPaths) {
        if (restoreTrashedAttachment(ctx.project, percorso)) filesRecovered++;
      }
      // Le relazioni stratigrafiche vanno riallineate sulle altre US.
      if (result.entityType === "us") syncInverseRelations(ctx.storage, result.entityId);

      res.json({ ok: true, ...result, filesRecovered });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Ripristino non riuscito" });
    }
  }));
}
