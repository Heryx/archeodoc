import type { Express } from "express";
import type { WithProject } from "./types";
import fs from "fs";
import { AI_AVAILABLE, AI_PROVIDER } from "../ai";
import { aiConversationLogPath, appendAiConversationLog } from "../ai_conversation_log";
import {
  assistantFieldDictionary,
  runUsAssistant,
  type AssistantChatMessage,
} from "../ai_assistant";
import { applyUsInlineFieldEdit } from "../us_field_edit";
import { logger } from "../logger";

function parseHistory(raw: unknown): AssistantChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
    const content = typeof rec.content === "string" ? rec.content : "";
    if (!role || !content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

export function registerAIAssistantRoutes(app: Express, withProject: WithProject) {
  // Assistente IA conversazionale sul dataset US del cantiere.
  app.post("/api/cantieri/:cid/ai-assistant", withProject(async (ctx, req, res) => {
    if (!AI_AVAILABLE) {
      return res.status(503).json({ error: "Nessun provider AI configurato" });
    }

    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "Prompt mancante" });

    const giornataIdRaw = req.body?.giornataId;
    const giornataId =
      giornataIdRaw != null && String(giornataIdRaw).trim() ? Number(giornataIdRaw) : undefined;
    const pageContext = typeof req.body?.pageContext === "string" ? req.body.pageContext.trim() : "";

    const usList = ctx.storage.getUSList(cid, giornataId);
    const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId.slice(0, 64) : null;
    const history = parseHistory(req.body?.history);

    try {
      const result = await runUsAssistant({
        project: ctx.project,
        cantiere,
        usList,
        prompt,
        history: parseHistory(req.body?.history),
        pageContext: pageContext || undefined,
        usRange: typeof req.body?.usRange === "string" ? req.body.usRange : undefined,
      });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("ai-assistant fallito", { cid, err: msg });
      res.status(502).json({ error: msg || "Errore assistente IA" });
    }
  }));

  // Applica in batch le modifiche ai campi proposte dall'assistente (previa conferma UI).
  app.post("/api/cantieri/:cid/ai-assistant/apply-edits", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const edits = Array.isArray(req.body?.edits) ? req.body.edits : null;
    if (!edits) return res.status(400).json({ error: "Campo 'edits' mancante o non array" });

    const { byKey } = assistantFieldDictionary(ctx.project, cantiere, ctx.storage.getUSList(cid));

    const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId.slice(0, 64) : null;
    const snapshots: Array<{ id: number; field: string; newValue: string; before: unknown }> = [];
    const applied: Array<{ id: number; field: string; codiceUS: string }> = [];
    const failed: Array<{ id: number; field: string; error: string }> = [];

    for (const raw of edits) {
      const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = Number(rec.id);
      const field = typeof rec.field === "string" ? rec.field.trim() : "";
      const value = rec.value != null ? String(rec.value) : "";

      if (!Number.isFinite(id) || !field) {
        failed.push({ id, field, error: "id o field non validi" });
        continue;
      }
      if (!byKey.has(field)) {
        failed.push({ id, field, error: `Campo '${field}' non riconosciuto` });
        continue;
      }
      const us = ctx.storage.getUS(id);
      if (!us || us.cantiereId !== cid) {
        failed.push({ id, field, error: "US non trovata in questo cantiere" });
        continue;
      }

      // Stato precedente della scheda, per poter ripristinare/ricostruire la modifica.
      snapshots.push({ id, field, newValue: value, before: us });
      try {
        const updated = applyUsInlineFieldEdit(ctx.storage, ctx.project, id, field, value);
        if (!updated) {
          failed.push({ id, field, error: "Aggiornamento non riuscito" });
          continue;
        }
        applied.push({ id, field, codiceUS: updated.codiceUS || `US ${id}` });
      } catch (error) {
        failed.push({ id, field, error: error instanceof Error ? error.message : String(error) });
      }
    }

    appendAiConversationLog(ctx.project, {
      type: "apply_edits", conversationId, cid, provider: AI_PROVIDER, applied, failed, snapshots,
    });
    res.json({ applied, failed });
  }));

  // Scarica il backup delle conversazioni con l'assistente (JSON Lines).
  app.get("/api/ai-assistant/log", withProject((ctx, _req, res) => {
    const file = aiConversationLogPath(ctx.project);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Nessuna conversazione registrata" });
    res.download(file, "assistente_ia_conversazioni.jsonl");
  }));
}
