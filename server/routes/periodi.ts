/**
 * Registro periodi / epoche del cantiere.
 * GET    /api/cantieri/:id/periodi                  → registro + nomi usati dalle US ma non registrati
 * POST   /api/cantieri/:id/periodi                  → nuovo periodo
 * POST   /api/cantieri/:id/periodi/from-us          → registra i nomi gia' scritti nelle US
 * POST   /api/cantieri/:id/periodi/assign           → { nome, codes: "100-118, 125" } assegna il periodo alle US
 * POST   /api/cantieri/:id/periodi/reorder          → { ids } ordine antico → recente, oppure { auto: true } dalla stratigrafia
 * PATCH  /api/periodi/:id                           → modifica (il nome si propaga alle US)
 * DELETE /api/periodi/:id                           → elimina dal registro (le US restano invariate)
 */
import type { Express } from "express";
import type { WithProject } from "./types";
import {
  assignPeriod,
  collectUnregistered,
  parseCodeList,
  registerPeriodsFromUs,
  renamePeriod,
  reorderByStratigraphy,
} from "../periodi";

const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function optInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function registerPeriodiRoutes(app: Express, withProject: WithProject) {
  app.get("/api/cantieri/:id/periodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    const usList = ctx.storage.getUSList(id);
    const registered = ctx.storage.getPeriodi(id);
    const periodi = registered.map((p) => ({
      ...p,
      usCount: usList.filter((u) => u.periodoIniziale && norm(u.periodoIniziale) === norm(p.nome)).length,
    }));
    res.json({ periodi, unregistered: collectUnregistered(usList, registered) });
  }));

  app.post("/api/cantieri/:id/periodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    const nome = String(req.body?.nome ?? "").trim().replace(/\s+/g, " ");
    if (!nome) return res.status(400).json({ error: "Il nome del periodo e' obbligatorio" });
    const existing = ctx.storage.getPeriodi(id);
    if (existing.some((p) => norm(p.nome) === norm(nome))) {
      return res.status(409).json({ error: `Il periodo "${nome}" esiste gia'` });
    }
    const created = ctx.storage.createPeriodo({
      cantiereId: id,
      nome,
      descrizione: String(req.body?.descrizione ?? "").trim() || null,
      ordine: existing.reduce((m, p) => Math.max(m, p.ordine), 0) + 1,
      startTime: optInt(req.body?.startTime) ?? null,
      endTime: optInt(req.body?.endTime) ?? null,
    });
    res.json(created);
  }));

  app.post("/api/cantieri/:id/periodi/from-us", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json({ created: registerPeriodsFromUs(ctx.storage, id) });
  }));

  app.post("/api/cantieri/:id/periodi/assign", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    const nome = String(req.body?.nome ?? "").trim().replace(/\s+/g, " ");
    if (!nome) return res.status(400).json({ error: "Indica il periodo" });
    const codes = parseCodeList(String(req.body?.codes ?? ""));
    if (!codes.length) return res.status(400).json({ error: "Indica almeno una US (es. 100-118, 125)" });
    res.json(assignPeriod(ctx.storage, id, nome, codes));
  }));

  app.post("/api/cantieri/:id/periodi/reorder", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    if (req.body?.auto) return res.json({ periodi: reorderByStratigraphy(ctx.storage, id) });
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const own = new Set(ctx.storage.getPeriodi(id).map((p) => p.id));
    ids.filter((pid) => own.has(pid)).forEach((pid, index) => ctx.storage.updatePeriodo(pid, { ordine: index + 1 }));
    res.json({ periodi: ctx.storage.getPeriodi(id) });
  }));

  app.patch("/api/periodi/:id", withProject((ctx, req, res) => {
    const periodo = ctx.storage.getPeriodo(Number(req.params.id));
    if (!periodo) return res.status(404).json({ error: "Periodo non trovato" });

    const patch: Record<string, unknown> = {};
    if (req.body?.descrizione !== undefined) patch.descrizione = String(req.body.descrizione ?? "").trim() || null;
    const start = optInt(req.body?.startTime);
    const end = optInt(req.body?.endTime);
    if (start !== undefined) patch.startTime = start;
    if (end !== undefined) patch.endTime = end;
    if (Object.keys(patch).length) ctx.storage.updatePeriodo(periodo.id, patch);

    let renamed = 0;
    if (typeof req.body?.nome === "string") {
      const nome = req.body.nome.trim().replace(/\s+/g, " ");
      if (!nome) return res.status(400).json({ error: "Il nome del periodo e' obbligatorio" });
      if (nome !== periodo.nome) {
        const clash = ctx.storage
          .getPeriodi(periodo.cantiereId)
          .some((p) => p.id !== periodo.id && norm(p.nome) === norm(nome));
        if (clash) return res.status(409).json({ error: `Il periodo "${nome}" esiste gia'` });
        renamed = renamePeriod(ctx.storage, periodo, nome);
      }
    }
    res.json({ periodo: ctx.storage.getPeriodo(periodo.id), usAggiornate: renamed });
  }));

  app.delete("/api/periodi/:id", withProject((ctx, req, res) => {
    const ok = ctx.storage.deletePeriodo(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Periodo non trovato" });
    res.json({ ok: true });
  }));
}
