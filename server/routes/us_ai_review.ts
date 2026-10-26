import type { Express } from "express";
import type { WithProject } from "./types";
import { AI_AVAILABLE, AI_PROVIDER } from "../ai";
import { appendAiConversationLog } from "../ai_conversation_log";
import { applyReviewEdits, reviewUsCard, reviseReviewProposal } from "../us_ai_review";
import { logger } from "../logger";

function text(value: unknown, max = 8000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * «Analizza AI» della scheda US: analisi dell'intera scheda con proposte di modifica, rilancio di una
 * singola proposta con un'indicazione dell'utente, applicazione delle proposte accettate.
 */
export function registerUSAiReviewRoutes(app: Express, withProject: WithProject) {
  // Analisi completa della scheda → proposte e segnalazioni (non modifica nulla).
  app.post("/api/us/:id/analizza-ai/proposte", withProject(async (ctx, req, res) => {
    if (!AI_AVAILABLE) return res.status(503).json({ error: "Nessun provider AI configurato" });
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    try {
      const result = await reviewUsCard({
        project: ctx.project,
        cantiere,
        us,
        usList: ctx.storage.getUSList(cantiere.id),
        istruzioni: text(req.body?.istruzioni, 4000),
      });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("analizza-ai/proposte fallito", { usId: id, err: msg });
      res.status(502).json({ error: msg });
    }
  }));

  // Rifà una singola proposta secondo l'indicazione dell'utente.
  app.post("/api/us/:id/analizza-ai/riformula", withProject(async (ctx, req, res) => {
    if (!AI_AVAILABLE) return res.status(503).json({ error: "Nessun provider AI configurato" });
    const baseId = Number(req.params.id);
    const base = ctx.storage.getUS(baseId);
    if (!base) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(base.cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    // La proposta può riguardare un'altra US del cantiere (rapporto inverso mancante).
    const targetId = req.body?.usId != null ? Number(req.body.usId) : baseId;
    const us = ctx.storage.getUS(targetId);
    if (!us || us.cantiereId !== cantiere.id) return res.status(404).json({ error: "US della proposta non trovata" });

    const field = text(req.body?.field, 200).trim();
    const userPrompt = text(req.body?.prompt, 4000).trim();
    if (!field) return res.status(400).json({ error: "Campo mancante" });
    if (!userPrompt) return res.status(400).json({ error: "Scrivi l'indicazione per l'AI" });

    try {
      const result = await reviseReviewProposal({
        project: ctx.project,
        cantiere,
        us,
        usList: ctx.storage.getUSList(cantiere.id),
        field,
        currentValue: text(req.body?.currentValue),
        proposedValue: text(req.body?.proposedValue),
        reason: text(req.body?.reason, 1000) || undefined,
        userPrompt,
      });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("analizza-ai/riformula fallito", { usId: targetId, field, err: msg });
      res.status(502).json({ error: msg });
    }
  }));

  // Applica le proposte accettate (anche dopo modifica manuale); registra lo stato precedente nel log AI.
  app.post("/api/us/:id/analizza-ai/applica", withProject((ctx, req, res) => {
    const baseId = Number(req.params.id);
    const base = ctx.storage.getUS(baseId);
    if (!base) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(base.cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const raw = Array.isArray(req.body?.edits) ? req.body.edits : null;
    if (!raw || raw.length === 0) return res.status(400).json({ error: "Nessuna modifica da applicare" });

    const edits = raw.map((item: unknown) => {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        usId: Number(rec.usId),
        field: typeof rec.field === "string" ? rec.field : "",
        value: rec.value != null ? String(rec.value) : "",
      };
    });

    const result = applyReviewEdits({ storage: ctx.storage, project: ctx.project, cantiere, edits });
    appendAiConversationLog(ctx.project, {
      type: "us_review_apply",
      cid: cantiere.id,
      usId: baseId,
      provider: AI_PROVIDER,
      applied: result.applied,
      failed: result.failed,
      snapshots: result.snapshots,
    });
    res.json({ applied: result.applied, failed: result.failed });
  }));
}
