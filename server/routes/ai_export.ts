import type { Express } from "express";
import multer from "multer";
import type { WithProject } from "./types";
import { analizzaTestoUS, analizzaTestoGiornata } from "../ai";
import { logger } from "../logger";
import { applyAiFieldsToUS, buildUSAiFillSuggestions } from "../ai_fill";
import { extractTextFromDocxBuffer } from "../docx_extract";
import { exportSchedaUSDocx, exportReportGiornalieroDocx } from "../docx_export";
import { getDocumentText } from "../google_docs";
import { applyUSImportPreview, buildUSImportPreview } from "../us_extractor";
import {
  assertTokenHasRequiredScopes,
  GOOGLE_REQUIRED_SCOPES,
  normalizeGoogleError,
} from "../google_auth";
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

function parseAiFillSource(raw: unknown): "descrizione" | "diario" | "entrambi" | "text" {
  if (raw === "descrizione" || raw === "diario" || raw === "entrambi" || raw === "text") return raw;
  return "entrambi";
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const aiFillDocxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export function registerAIExportRoutes(app: Express, withProject: WithProject) {
  // Import US automatico da testo giornata
  app.post("/api/cantieri/:cid/giornate/:gid/import-us-from-text", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const gid = Number(req.params.gid);

    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornata = ctx.storage.getGiornata(gid);
    if (!giornata || giornata.cantiereId !== cid) {
      return res.status(404).json({ error: "Giornata non trovata per questo cantiere" });
    }

    const confirm = parseBooleanLike(req.body?.confirm);
    if (confirm) {
      const items = parseArray(req.body?.items);
      if (items.length === 0) {
        return res.status(400).json({ error: "Nessuna US selezionata da importare" });
      }
      const applied = applyUSImportPreview({
        storage: ctx.storage,
        cantiereId: cid,
        giornataId: gid,
        items,
        modelKey: cantiere.usModelKey,
      });
      return res.json({ mode: "applied", ...applied });
    }

    try {
      const sourceText = parseOptionalText(req.body?.text) || parseOptionalText(giornata.note);
      const preview = await buildUSImportPreview({
        source: "text",
        text: sourceText,
        existingUs: ctx.storage.getUSList(cid),
      });
      return res.json({ mode: "preview", preview });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Errore anteprima import da testo giornata" });
    }
  }));

  // Import US automatico da DOCX
  app.post("/api/cantieri/:cid/giornate/:gid/import-us-from-docx", aiFillDocxUpload.single("file"), withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const gid = Number(req.params.gid);

    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornata = ctx.storage.getGiornata(gid);
    if (!giornata || giornata.cantiereId !== cid) {
      return res.status(404).json({ error: "Giornata non trovata per questo cantiere" });
    }

    const confirm = parseBooleanLike(req.body?.confirm);
    if (confirm) {
      const items = parseArray(req.body?.items);
      if (items.length === 0) {
        return res.status(400).json({ error: "Nessuna US selezionata da importare" });
      }
      const applied = applyUSImportPreview({
        storage: ctx.storage,
        cantiereId: cid,
        giornataId: gid,
        items,
        modelKey: cantiere.usModelKey,
      });
      return res.json({ mode: "applied", ...applied });
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "File DOCX mancante" });
    if (!/\.docx$/i.test(file.originalname || "")) {
      return res.status(400).json({ error: "Formato non valido: carica un file .docx" });
    }

    try {
      const text = await extractTextFromDocxBuffer(file.buffer);
      const preview = await buildUSImportPreview({
        source: "docx",
        text,
        existingUs: ctx.storage.getUSList(cid),
      });
      return res.json({ mode: "preview", preview, filename: file.originalname });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Errore anteprima import da DOCX" });
    }
  }));

  // Import US automatico da Google Docs
  app.post("/api/cantieri/:cid/giornate/:gid/import-us-from-google-doc", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const gid = Number(req.params.gid);

    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornata = ctx.storage.getGiornata(gid);
    if (!giornata || giornata.cantiereId !== cid) {
      return res.status(404).json({ error: "Giornata non trovata per questo cantiere" });
    }

    const confirm = parseBooleanLike(req.body?.confirm);
    if (confirm) {
      const items = parseArray(req.body?.items);
      if (items.length === 0) {
        return res.status(400).json({ error: "Nessuna US selezionata da importare" });
      }
      const applied = applyUSImportPreview({
        storage: ctx.storage,
        cantiereId: cid,
        giornataId: gid,
        items,
        modelKey: cantiere.usModelKey,
      });
      return res.json({ mode: "applied", ...applied });
    }

    const requestedUrl = parseOptionalText(req.body?.url);
    const docRef = requestedUrl || parseOptionalText(cantiere.googleDocId);
    if (!docRef) {
      return res.status(400).json({
        error: "Inserisci un URL Google Docs oppure collega un documento al cantiere",
      });
    }

    try {
      assertTokenHasRequiredScopes();
      const doc = await getDocumentText(docRef);
      const preview = await buildUSImportPreview({
        source: "google-doc",
        text: doc.text || "",
        existingUs: ctx.storage.getUSList(cid),
      });
      return res.json({
        mode: "preview",
        preview,
        googleDocTitle: doc.title,
        googleDocRef: docRef,
      });
    } catch (error) {
      const normalized = normalizeGoogleError(error, "Errore lettura Google Docs");
      return res.status(normalized.status).json({
        error: normalized.message,
        code: normalized.code,
        missingScopes: normalized.missingScopes,
        requiredScopes: GOOGLE_REQUIRED_SCOPES,
      });
    }
  }));

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
    const directText = parseOptionalText(req.body?.text);
    if (source === "text" && !directText) {
      return res.status(400).json({ error: "Testo sorgente mancante" });
    }

    try {
      const suggestions = await buildUSAiFillSuggestions({
        us,
        cantiere,
        giornata,
        source: source === "text" ? "entrambi" : source,
        sourceTextOverride: source === "text" ? directText : "",
      });
      res.json({ suggestions, sourceUsed: source, textLength: source === "text" ? directText.length : undefined });
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("ai-fill US fallito", { usId: id, err: msg });
      res.status(500).json({ error: msg || "Errore generazione suggerimenti AI" });
    }
  }));

  // AI fill da file DOCX (upload diretto)
  app.post("/api/us/:id/ai-fill-docx", aiFillDocxUpload.single("file"), withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "File DOCX mancante" });
    }
    if (!/\.docx$/i.test(file.originalname || "")) {
      return res.status(400).json({ error: "Formato non valido: carica un file .docx" });
    }

    const giornata = us.giornataId ? ctx.storage.getGiornata(us.giornataId) : undefined;
    const cantiere = ctx.storage.getCantiere(us.cantiereId);

    try {
      const text = await extractTextFromDocxBuffer(file.buffer);
      if (!text) {
        return res.status(422).json({ error: "Il file DOCX non contiene testo utile" });
      }

      const suggestions = await buildUSAiFillSuggestions({
        us,
        cantiere,
        giornata,
        source: "entrambi",
        sourceTextOverride: text,
      });

      res.json({
        suggestions,
        sourceUsed: "text",
        filename: file.originalname,
        textLength: text.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore estrazione testo da DOCX" });
    }
  }));

  // AI fill da Google Docs (url o doc del cantiere gia collegato)
  app.post("/api/us/:id/ai-fill-google-doc", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    const giornata = us.giornataId ? ctx.storage.getGiornata(us.giornataId) : undefined;
    const requestedUrl = parseOptionalText(req.body?.url);
    const fallbackDocId = parseOptionalText(cantiere?.googleDocId);
    const docRef = requestedUrl || fallbackDocId;

    if (!docRef) {
      return res.status(400).json({
        error: "Inserisci un URL Google Docs oppure collega un documento al cantiere",
      });
    }

    try {
      assertTokenHasRequiredScopes();
      const doc = await getDocumentText(docRef);
      const text = parseOptionalText(doc.text);
      if (!text) {
        return res.status(422).json({ error: "Il documento Google Docs non contiene testo utile" });
      }

      const suggestions = await buildUSAiFillSuggestions({
        us,
        cantiere,
        giornata,
        source: "entrambi",
        sourceTextOverride: text,
      });

      res.json({
        suggestions,
        sourceUsed: "text",
        googleDocTitle: doc.title,
        googleDocRef: requestedUrl || fallbackDocId,
        textLength: text.length,
      });
    } catch (error) {
      const normalized = normalizeGoogleError(error, "Errore lettura Google Docs");
      res.status(normalized.status).json({
        error: normalized.message,
        code: normalized.code,
        missingScopes: normalized.missingScopes,
        requiredScopes: GOOGLE_REQUIRED_SCOPES,
      });
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
    const normalizedSource = source === "text" ? "entrambi" : source;
    const usList = ctx.storage.getUSList(giornata.cantiereId, id);
    const cantiere = ctx.storage.getCantiere(giornata.cantiereId);

    try {
      const results: Array<{ usId: number; codiceUS: string; suggestions: Record<string, unknown> }> = [];
      for (const us of usList) {
        const suggestions = await buildUSAiFillSuggestions({
          us,
          cantiere,
          giornata,
          source: normalizedSource,
        });
        results.push({
          usId: us.id,
          codiceUS: us.codiceUS,
          suggestions,
        });
      }
      res.json({ results, sourceUsed: normalizedSource, total: results.length });
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
