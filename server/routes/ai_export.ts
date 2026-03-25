import type { Express } from "express";
import type { WithProject } from "./types";
import { analizzaTestoUS, analizzaTestoGiornata } from "../ai";
import { logger } from "../logger";
import { applyAiFieldsToUS, buildUSAiFillSuggestions } from "../ai_fill";
import { exportSchedaUSDocx, exportReportGiornalieroDocx } from "../docx_export";
import {
  exportHarrisMatrixDocx,
  exportHarrisMatrixPdf,
  matrixExportFileBase,
  type HarrisMatrixMode,
} from "../matrix_export";

function parseMatrixMode(raw: unknown): HarrisMatrixMode {
  if (raw === "fisica" || raw === "stratigrafica" || raw === "all") return raw;
  return "all";
}

function parseAiFillSource(raw: unknown): "descrizione" | "diario" | "entrambi" {
  if (raw === "descrizione" || raw === "diario" || raw === "entrambi") return raw;
  return "entrambi";
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function registerAIExportRoutes(app: Express, withProject: WithProject) {
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

  // AI fill singola US (suggerimenti)
  app.post("/api/us/:id/ai-fill", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const giornata = us.giornataId ? ctx.storage.getGiornata(us.giornataId) : undefined;
    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    const source = parseAiFillSource(req.body?.source);

    try {
      const suggestions = await buildUSAiFillSuggestions({
        us,
        cantiere,
        giornata,
        source,
      });
      res.json({ suggestions, sourceUsed: source });
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("ai-fill US fallito", { usId: id, err: msg });
      res.status(500).json({ error: msg || "Errore generazione suggerimenti AI" });
    }
  }));

  // Applica i campi approvati ai dati US
  app.post("/api/us/:id/ai-fill-apply", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const fields = parseRecord(req.body?.fields);
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "Nessun campo da applicare" });
    }

    try {
      const patch = applyAiFieldsToUS(us, fields);
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nessun campo valido da applicare" });
      }
      const updated = ctx.storage.updateUS(id, patch);
      if (!updated) return res.status(404).json({ error: "US non trovata" });
      res.json({ us: updated });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore applicazione campi AI" });
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

  // AI fill batch su tutte le US della giornata
  app.post("/api/giornate/:id/ai-fill-us", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const source = parseAiFillSource(req.body?.source);
    const usList = ctx.storage.getUSList(giornata.cantiereId, id);
    const cantiere = ctx.storage.getCantiere(giornata.cantiereId);

    try {
      const results: Array<{ usId: number; codiceUS: string; suggestions: Record<string, unknown> }> = [];
      for (const us of usList) {
        const suggestions = await buildUSAiFillSuggestions({
          us,
          cantiere,
          giornata,
          source,
        });
        results.push({
          usId: us.id,
          codiceUS: us.codiceUS,
          suggestions,
        });
      }
      res.json({ results, sourceUsed: source, total: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore analisi batch AI delle US" });
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

  // ─── Statistiche cantiere ──────────────────────────────────────────
  app.get("/api/cantieri/:id/statistiche", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornate = ctx.storage.getGiornate(id);
    const usList = ctx.storage.getUSList(id);
    const allegati = ctx.storage.getAllegati(id);
    const qcLogs = ctx.storage.getQcLogs(id);

    // US per tipo
    const usPerTipo: Record<string, number> = {};
    for (const us of usList) {
      const t = us.tipo || "non specificato";
      usPerTipo[t] = (usPerTipo[t] || 0) + 1;
    }

    // QC giornate
    const qcGiornate = { ok: 0, warning: 0, error: 0, pending: 0 };
    for (const g of giornate) {
      const s = (g.qcStatus || "pending") as keyof typeof qcGiornate;
      qcGiornate[s] = (qcGiornate[s] || 0) + 1;
    }

    // AI reports generati
    const reportGenerati = giornate.filter((g) => !!g.aiReportText).length;
    const schedeGenerate = usList.filter((u) => !!u.schedaAiGenerata).length;

    // Allegati per tipo
    const allegatiPerTipo: Record<string, number> = {};
    for (const a of allegati) {
      allegatiPerTipo[a.tipo] = (allegatiPerTipo[a.tipo] || 0) + 1;
    }

    // Errori QC aperti
    const erroriAperti = qcLogs.filter((l) => l.livello === "error").length;
    const warningAperti = qcLogs.filter((l) => l.livello === "warning").length;

    res.json({
      cantiere: { nome: cantiere.nome, codice: cantiere.codice, localita: cantiere.localita },
      giornate: { totale: giornate.length, qcStatus: qcGiornate, reportGenerati },
      us: { totale: usList.length, perTipo: usPerTipo, schedeGenerate },
      allegati: { totale: allegati.length, perTipo: allegatiPerTipo },
      qc: { erroriAperti, warningAperti },
    });
  }));

  // ─── Export ZIP cantiere completo ──────────────────────────────────
  app.get("/api/cantieri/:id/matrix/export-docx", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const mode = parseMatrixMode(req.query.mode);
    const usList = ctx.storage.getUSList(id);

    try {
      const buf = await exportHarrisMatrixDocx(cantiere, usList, mode);
      const filename = `${matrixExportFileBase(cantiere, String(id))}_${mode}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore export matrix DOCX" });
    }
  }));

  app.get("/api/cantieri/:id/matrix/export-pdf", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const mode = parseMatrixMode(req.query.mode);
    const usList = ctx.storage.getUSList(id);

    try {
      const buf = await exportHarrisMatrixPdf(cantiere, usList, mode);
      const filename = `${matrixExportFileBase(cantiere, String(id))}_${mode}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore export matrix PDF" });
    }
  }));

  app.get("/api/cantieri/:id/export-zip", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const slug = cantiere.codice.replace(/[\s/\\:*?"<>|]/g, "_");
    const folder = zip.folder(slug)!;

    const giornate = ctx.storage.getGiornate(id);
    const usList = ctx.storage.getUSList(id);

    // Diario giornaliero DOCX (solo quelli con report AI generato)
    const diariFolderName = "diari";
    for (const g of giornate) {
      if (!g.aiReportText) continue;
      try {
        const qcLogs = ctx.storage.getQcLogs(id, g.id);
        const campi = qcLogs.filter((l) => l.livello === "error").map((l) => l.messaggio);
        const buf = await exportReportGiornalieroDocx(g, cantiere, g.aiReportText, campi, "");
        folder.folder(diariFolderName)!.file(`Diario_${g.data}.docx`, buf);
      } catch {
        // skip
      }
    }

    // Schede US DOCX (solo quelle con scheda AI generata)
    const schedeFolderName = "schede_us";
    for (const us of usList) {
      if (!us.schedaAiGenerata) continue;
      try {
        const campiRaw = us.qcProblemi ? JSON.parse(us.qcProblemi).filter((p: any) => p.livello === "error").map((p: any) => p.messaggio) : [];
        const buf = await exportSchedaUSDocx(us, cantiere, us.schedaAiGenerata, campiRaw, "");
        const fname = `Scheda_${us.codiceUS.replace(/[\s/\\:*?"<>|]/g, "_")}.docx`;
        folder.folder(schedeFolderName)!.file(fname, buf);
      } catch {
        // skip
      }
    }

    // README.txt con info cantiere
    folder.file(
      "README.txt",
      `Archivio ArcheoDoc — ${cantiere.nome}\n` +
        `Codice: ${cantiere.codice}\n` +
        `Localit\u00e0: ${cantiere.localita}\n` +
        `Esportato il: ${new Date().toLocaleString("it-IT")}\n\n` +
        `Diari generati: ${giornate.filter((g) => !!g.aiReportText).length}/${giornate.length}\n` +
        `Schede US generate: ${usList.filter((u) => !!u.schedaAiGenerata).length}/${usList.length}\n`,
    );

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}_export.zip"`);
    res.send(zipBuffer);
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
