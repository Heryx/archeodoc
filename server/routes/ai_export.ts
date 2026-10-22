import type { Express } from "express";
import multer from "multer";
import type { WithProject } from "./types";
import { analizzaTestoUS, analizzaTestoGiornata, generateReportSettimanaleCustom, estraiCampiGiornataFromText } from "../ai";
import { logger } from "../logger";
import { applyAiFieldsToUS, buildUSAiFillSuggestions } from "../ai_fill";
import { extractTextFromDocxBuffer } from "../docx_extract";
import {
  exportSchedaUSDocx,
  exportSchedaUSDocxFromTemplate,
  exportElencoUSDocxFromTemplate,
  exportReportGiornalieroDocx,
  exportReportSettimanaleDocx,
  exportReportSettimanaleCustomDocx,
} from "../docx_export";
import {
  exportSchedaUSMarkdown,
  exportSchedaUSPdf,
  exportSchedaUSOdt,
} from "../export_formats";
import fs from "fs";
import path from "path";
import { resolveUSTemplatePath } from "../us_template_path";
import { elencoUsTemplatePath, readElencoTemplateChoice } from "../elenco_us_template_path";
import { analyzeElencoTemplate, describeRepairs } from "../elenco_template_repair";
import { resolveElencoColumns, buildElencoRowValues } from "../elenco_columns";
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
  exportHarrisMatrixSvg,
  matrixExportFileBase,
  parseMatrixPdfPage,
  type HarrisMatrixMode,
} from "../matrix_export";
import { calcolaSettimaneProgetto } from "@shared/weekUtils";

const AVAILABLE_PLACEHOLDER_KEYS = [
  "nome_commessa", "codice_cantiere", "luogo", "provincia", "committente",
  "responsabile", "direttore_scavo", "responsabile_sabap", "responsabile_scavo",
  "data_inizio_wk", "data_fine_wk", "data_relazione", "settimana",
  "archeologo_coordinatore", "archeologi", "scavatori", "topografo", "escavatore",
  "obiettivo", "dettaglio_attivita",
  "nome_archeologo_coord", "nome_archeologi", "nome_topografo",
  "nome_ditta", "nome_scavatori", "nome_direttore",
];

function parseMatrixMode(raw: unknown): HarrisMatrixMode {
  if (raw === "fisica" || raw === "stratigrafica" || raw === "all") return raw;
  return "all";
}

function parseZipExportScope(raw: unknown): "all" | "us" {
  if (raw === "us") return "us";
  return "all";
}

async function buildElencoUSSheet(project: any, cantiere: any, usList: any[]) {
  const columns = await resolveElencoColumns(project, cantiere, usList);
  const aoa: string[][] = [
    columns.map((c) => c.label),
    ...usList.map((us) => {
      const values = buildElencoRowValues(columns, us, cantiere);
      return columns.map((c) => values[c.key] ?? "");
    }),
  ];
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  return { ws, columns, aoa, XLSX };
}

function writeElencoUSXlsx(
  XLSX: typeof import("xlsx"),
  ws: import("xlsx").WorkSheet,
  columns: { label: string }[],
  aoa: string[][],
): Buffer {
  ws["!cols"] = columns.map((c, i) => ({
    wch: Math.min(60, Math.max(c.label.length, ...aoa.slice(1).map((r) => (r[i] || "").length), 8)),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Elenco US");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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

function parseIsoDateOnly(value: unknown): Date | null {
  const text = parseOptionalText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseTipoRelazione(value: unknown): "template" | "narrativo" | "strutturato" {
  if (value === "narrativo" || value === "strutturato") return value;
  return "template";
}

function parsePositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function parsePositiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => parsePositiveInteger(item))
        .filter((item): item is number => item != null),
    ),
  );
}

function toIsoDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeekMonday(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(start.getDate() - day);
  return start;
}

function endOfWeekSunday(date: Date): Date {
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  return end;
}

function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const dateIso = toIsoDateOnly(date);
  const startIso = toIsoDateOnly(start);
  const endIso = toIsoDateOnly(end);
  return dateIso >= startIso && dateIso <= endIso;
}

function parseIsoWeek(value: unknown): { year: number; week: number } | null {
  const text = parseOptionalText(value);
  const match = text.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return null;
  return { year, week };
}

function startOfIsoWeekMonday(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  if (dow <= 4) {
    monday.setUTCDate(simple.getUTCDate() - dow + 1);
  } else {
    monday.setUTCDate(simple.getUTCDate() + (8 - dow));
  }
  return monday;
}

function rangeForIsoWeekKey(isoWeek: string): { start: Date; end: Date; startIso: string; endIso: string } | null {
  const parsed = parseIsoWeek(isoWeek);
  if (!parsed) return null;
  const start = startOfIsoWeekMonday(parsed.year, parsed.week);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start,
    end,
    startIso: toIsoDateOnly(start),
    endIso: toIsoDateOnly(end),
  };
}

function isoWeekKeyFromDate(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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
        projectId: ctx.project.id,
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
        projectId: ctx.project.id,
        modelKey: cantiere.usModelKey,
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
        projectId: ctx.project.id,
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
        projectId: ctx.project.id,
        modelKey: cantiere.usModelKey,
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
        projectId: ctx.project.id,
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
        projectId: ctx.project.id,
        modelKey: cantiere.usModelKey,
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
    const snapshotSummary = ctx.storage
      .getMapSnapshots(giornata.cantiereId)
      .slice(0, 20)
      .map((snapshot) => {
        const tags = snapshot.tags ? ` [tag: ${snapshot.tags}]` : "";
        const didascalia = snapshot.didascalia ? ` - ${snapshot.didascalia}` : "";
        return `- ${snapshot.titolo}${didascalia}${tags}`;
      })
      .join("\n");

    try {
      const result = await analizzaTestoGiornata(giornata, usList, qcLogs, snapshotSummary);
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

    const modelKey = cantiere?.usModelKey || us.schedaModelKey || "base-us";
    const templatePath = resolveUSTemplatePath(ctx.project, modelKey);

    try {
      const buf = templatePath
        ? await exportSchedaUSDocxFromTemplate(templatePath, us, cantiere)
        : await exportSchedaUSDocx(us, cantiere, schedaTesto, campiMancanti, "", modelKey);
      const filename = `Scheda_${us.codiceUS.replace(/[\s/]/g, "_")}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export Elenco US DOCX (tabella, tutte le US del cantiere o di una giornata)
  app.get("/api/cantieri/:cid/elenco-us/export-docx", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const templatePath = elencoUsTemplatePath(ctx.project);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: "Nessun template elenco US caricato per questo cantiere" });
    }

    const giornataIdRaw = req.query.giornataId;
    const giornataId = typeof giornataIdRaw === "string" && giornataIdRaw.trim() ? Number(giornataIdRaw) : undefined;
    const usList = ctx.storage.getUSList(cid, giornataId);

    // Se il template ha un ciclo incompleto o placeholder non validi e l'utente non ha ancora
    // deciso, non esportare: il client apre il prompt di riparazione del template.
    if (!readElencoTemplateChoice(ctx.project)) {
      const plan = await analyzeElencoTemplate(ctx.project, cantiere);
      if (plan?.needsRepair) {
        return res.status(409).json({
          needsTemplateRepair: true,
          summary: describeRepairs(plan),
          orphanRows: plan.orphanRows,
          unknownPlaceholders: plan.unknownPlaceholders,
        });
      }
    }

    try {
      const buf = await exportElencoUSDocxFromTemplate(templatePath, usList, cantiere);
      const filename = `Elenco_US_${cantiere.codice.replace(/[\s/]/g, "_")}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export Elenco US tabellare (xlsx / csv), stesse colonne mostrate nell'elenco
  app.get("/api/cantieri/:cid/elenco-us/export-table", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const giornataIdRaw = req.query.giornataId;
    const giornataId = typeof giornataIdRaw === "string" && giornataIdRaw.trim() ? Number(giornataIdRaw) : undefined;
    const usList = ctx.storage.getUSList(cid, giornataId);

    try {
      const base = `Elenco_US_${cantiere.codice.replace(/[\s/]/g, "_")}`;
      const { ws, columns, aoa, XLSX } = await buildElencoUSSheet(ctx.project, cantiere, usList);
      if (format === "csv") {
        // BOM + separatore ";" per l'apertura corretta in Excel (locale italiano)
        const csv = "﻿" + XLSX.utils.sheet_to_csv(ws, { FS: ";" });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
        return res.send(csv);
      }
      const buf = writeElencoUSXlsx(XLSX, ws, columns, aoa);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export US PDF
  app.get("/api/us/:id/export-pdf", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    try {
      const buf = await exportSchedaUSPdf(us, cantiere);
      const filename = `Scheda_${us.codiceUS.replace(/[\s/]/g, "_")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export US ODT
  app.get("/api/us/:id/export-odt", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    try {
      const buf = await exportSchedaUSOdt(us, cantiere);
      const filename = `Scheda_${us.codiceUS.replace(/[\s/]/g, "_")}.odt`;
      res.setHeader("Content-Type", "application/vnd.oasis.opendocument.text");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Export US Markdown
  app.get("/api/us/:id/export-md", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });
    const cantiere = ctx.storage.getCantiere(us.cantiereId);
    try {
      const md = exportSchedaUSMarkdown(us, cantiere);
      const filename = `Scheda_${us.codiceUS.replace(/[\s/]/g, "_")}.md`;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(md);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }));

  // â"€â"€â"€ Statistiche cantiere â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

  // â"€â"€â"€ Export ZIP cantiere completo â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
      const buf = await exportHarrisMatrixPdf(cantiere, usList, mode, {
        page: parseMatrixPdfPage(req.query.page),
      });
      const pageSuffix = req.query.page === "a4-portrait" ? "_A4v" : req.query.page === "a4-landscape" ? "_A4o" : "";
      const filename = `${matrixExportFileBase(cantiere, String(id))}_${mode}${pageSuffix}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore export matrix PDF" });
    }
  }));

  app.get("/api/cantieri/:id/matrix/export-svg", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const mode = parseMatrixMode(req.query.mode);
    const usList = ctx.storage.getUSList(id);

    try {
      const svg = exportHarrisMatrixSvg(cantiere, usList, mode);
      const filename = `${matrixExportFileBase(cantiere, String(id))}_${mode}.svg`;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(svg);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore export matrix SVG" });
    }
  }));

  app.get("/api/cantieri/:id/export-zip", withProject(async (ctx, req, res) => {
    const id = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(id);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });
    const scope = parseZipExportScope(req.query.scope);
    const includeDiari = scope === "all";

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const slug = cantiere.codice.replace(/[\s/\\:*?"<>|]/g, "_");
    const folder = zip.folder(slug)!;

    const giornate = ctx.storage.getGiornate(id);
    const usList = ctx.storage.getUSList(id);

    // Diario giornaliero DOCX (solo quelli con report AI generato)
    const diariFolderName = "diari";
    if (includeDiari) {
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
    }

    // Schede US DOCX (tutte le US; se manca la scheda AI si usano i dati strutturati)
    const schedeFolderName = "schede_us";
    for (const us of usList) {
      try {
        const campiRaw = us.qcProblemi ? JSON.parse(us.qcProblemi).filter((p: any) => p.livello === "error").map((p: any) => p.messaggio) : [];
        const zipModelKey = cantiere?.usModelKey || us.schedaModelKey || "base-us";
        const zipTemplatePath = resolveUSTemplatePath(ctx.project, zipModelKey);
        const schedaTesto = us.schedaAiGenerata || [
          `CODICE US: ${us.codiceUS}`,
          `TIPO: ${us.tipo || "-"}`,
          `DEFINIZIONE: ${us.definizione || "-"}`,
          `DESCRIZIONE: ${us.descrizione || "-"}`,
          `INTERPRETAZIONE: ${us.interpretazione || "-"}`,
        ].join("\n");
        const buf = zipTemplatePath
          ? await exportSchedaUSDocxFromTemplate(zipTemplatePath, us, cantiere)
          : await exportSchedaUSDocx(us, cantiere, schedaTesto, campiRaw, "", zipModelKey);
        const fname = `Scheda_${us.codiceUS.replace(/[\s/\\:*?"<>|]/g, "_")}.docx`;
        folder.folder(schedeFolderName)!.file(fname, buf);
      } catch {
        // skip
      }
    }

    // Elenco US: XLSX sempre, DOCX se esiste un template elenco caricato
    const elencoFolder = folder.folder("elenco_us")!;
    const elencoBase = `Elenco_US_${slug}`;
    let elencoEsportato = false;
    try {
      const { ws, columns, aoa, XLSX } = await buildElencoUSSheet(ctx.project, cantiere, usList);
      elencoFolder.file(`${elencoBase}.xlsx`, writeElencoUSXlsx(XLSX, ws, columns, aoa));
      elencoEsportato = true;
    } catch {
      // skip
    }
    try {
      const elencoTemplate = elencoUsTemplatePath(ctx.project);
      if (fs.existsSync(elencoTemplate)) {
        elencoFolder.file(`${elencoBase}.docx`, await exportElencoUSDocxFromTemplate(elencoTemplate, usList, cantiere));
        elencoEsportato = true;
      }
    } catch {
      // skip
    }

    // README.txt con info cantiere
    folder.file(
      "README.txt",
      `Archivio ArcheoDoc â€" ${cantiere.nome}\n` +
        `Tipo export: ${includeDiari ? "completo" : "solo schede US"}\n` +
        `Codice: ${cantiere.codice}\n` +
        `Localit\u00e0: ${cantiere.localita}\n` +
        `Esportato il: ${new Date().toLocaleString("it-IT")}\n\n` +
        `Diari generati: ${includeDiari ? `${giornate.filter((g) => !!g.aiReportText).length}/${giornate.length}` : "esclusi"}\n` +
        `Schede US esportate: ${usList.length} (con scheda AI: ${usList.filter((u) => !!u.schedaAiGenerata).length})\n` +
        `Elenco US: ${elencoEsportato ? "incluso (cartella elenco_us)" : "non disponibile"}\n`,
    );

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    const filename = includeDiari ? `${slug}_export.zip` : `${slug}_schede_us.zip`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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

  // ── Diagnostica template report settimanale ─────────────────────────────────
  app.get("/api/cantieri/:cid/giornale/template-diagnostics", withProject(async (ctx, _req, res) => {
    const templatesDir = ctx.project.templatesDir;
    if (!templatesDir || !fs.existsSync(templatesDir)) {
      return res.json({ found: false, reason: "templatesDir non esiste", templatesDir });
    }
    const indexPath = path.join(templatesDir, "_index.json");
    let idx: Record<string, { uso?: string }> = {};
    try { idx = JSON.parse(fs.readFileSync(indexPath, "utf-8")); } catch { /* no index */ }
    const files = fs.readdirSync(templatesDir).filter((f) => /\.(docx|md|txt)$/i.test(f));
    const templateFile = files.find((f) => idx[f]?.uso === "report_settimanale");
    if (!templateFile) {
      return res.json({ found: false, reason: "nessun template con uso=report_settimanale", files, idx });
    }
    const templatePath = path.join(templatesDir, templateFile);
    if (!/\.docx$/i.test(templateFile)) {
      return res.json({ found: true, templateFile, type: "md/txt", tags: null, note: "template testuale, non DOCX" });
    }
    try {
      const PizZip = require("pizzip") as typeof import("pizzip");
      const Docxtemplater = require("docxtemplater") as typeof import("docxtemplater");
      const InspectModule = require("docxtemplater/js/inspect-module.js") as any;
      const content = fs.readFileSync(templatePath, "binary");
      const zip = new PizZip(content);
      const iModule = new (InspectModule.default || InspectModule)();
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "", modules: [iModule] });
      doc.compile();
      const tags = iModule.getAllTags();
      return res.json({ found: true, templateFile, type: "docx", tags, availableVars: AVAILABLE_PLACEHOLDER_KEYS });
    } catch (e: any) {
      return res.status(500).json({ found: true, templateFile, type: "docx", error: e?.message, detail: String(e) });
    }
  }));

  // ── Download DOCX con tutti i placeholder elencati ──────────────────────────
  app.get("/api/cantieri/:cid/report/placeholder-template", withProject((_ctx, _req, res) => {
    try {
      const PizZip = require("pizzip") as typeof import("pizzip");
      const descriptions: Record<string, string> = {
        nome_commessa: "Nome del cantiere/commessa",
        codice_cantiere: "Codice identificativo cantiere",
        luogo: "Località del cantiere",
        provincia: "Provincia",
        committente: "Committente/cliente",
        responsabile: "Responsabile di progetto",
        direttore_scavo: "Direttore di scavo",
        responsabile_sabap: "Responsabile SABAP",
        responsabile_scavo: "Responsabile dello scavo",
        data_inizio_wk: "Data inizio settimana",
        data_fine_wk: "Data fine settimana",
        data_relazione: "Data della relazione",
        settimana: 'Periodo settimana (es. "05/05 – 11/05/2026")',
        archeologo_coordinatore: "Archeologo coordinatore",
        archeologi: "Lista archeologi",
        scavatori: "Lista scavatori",
        topografo: "Topografo",
        escavatore: "Escavatore meccanico",
        obiettivo: "Obiettivo della settimana",
        dettaglio_attivita: "Dettaglio attività giornaliero (sezione complessa)",
        nome_archeologo_coord: "Alias: Archeologo coordinatore",
        nome_archeologi: "Alias: Lista archeologi",
        nome_topografo: "Alias: Topografo",
        nome_ditta: "Alias: Committente/ditta",
        nome_scavatori: "Alias: Lista scavatori",
        nome_direttore: "Alias: Direttore di scavo",
      };

      // Build minimal OOXML DOCX in memory
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const rows = AVAILABLE_PLACEHOLDER_KEYS.map((key) => {
        const desc = descriptions[key] || "";
        return `<w:tr><w:tc><w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">{{${esc(key)}}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${esc(desc)}</w:t></w:r></w:p></w:tc></w:tr>`;
      }).join("");

      const header = `<w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Placeholder</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Descrizione</w:t></w:r></w:p></w:tc></w:tr>`;
      const intro = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Placeholder disponibili per i template ArcheoDoc</w:t></w:r></w:p><w:p><w:r><w:t>Inserisci questi tag nel tuo documento Word personalizzato. Verranno sostituiti con i dati reali all'export.</w:t></w:r></w:p>`;
      const tableXml = `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>${header}${rows}</w:tbl>`;
      const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${intro}${tableXml}<w:sectPr/></w:body></w:document>`;

      const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
      const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
      const appRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

      const zip = new PizZip();
      zip.file("[Content_Types].xml", contentTypes);
      zip.file("_rels/.rels", appRels);
      zip.file("word/document.xml", docXml);
      zip.file("word/styles.xml", stylesXml);
      zip.file("word/_rels/document.xml.rels", relsXml);
      const buf = zip.generate({ type: "nodebuffer", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", "attachment; filename=placeholder_template.docx");
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }));

  // ── Placeholder disponibili con valori reali del cantiere ────────────────────
  app.get("/api/cantieri/:cid/report/placeholders", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornate = ctx.storage.getGiornate(cid);
    const tuttiScavatori = new Set<string>();
    const tuttiArcheologi = new Set<string>();
    let archeologoCoordinatore = cantiere.responsabile || "";
    let topografo = "";
    let escavatore = "";
    let obiettivo = "";
    for (const g of giornate) {
      const parseCsvOrJson = (v: string | null | undefined) => {
        if (!v) return [];
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return v.split(",").map((s) => s.trim()).filter(Boolean); }
      };
      parseCsvOrJson(g.scavatori || g.operatori).forEach((o: string) => tuttiScavatori.add(o));
      parseCsvOrJson(g.archeologi).forEach((o: string) => tuttiArcheologi.add(o));
      if (g.archeologoCoordinatore) archeologoCoordinatore = g.archeologoCoordinatore;
      if (g.topografo) topografo = g.topografo;
      if (g.escavatore) escavatore = g.escavatore;
      if (g.obiettivo) obiettivo = g.obiettivo;
    }
    const scavatoriStr = Array.from(tuttiScavatori).join(", ") || "";
    const archeologiStr = Array.from(tuttiArcheologi).join(", ") || "";
    const provinciaMatch = (cantiere.localita || "").match(/\(([A-Z]{2})\)\s*$/);
    const provincia = provinciaMatch ? provinciaMatch[1] : (cantiere.localita || "");

    const values: Record<string, string> = {
      nome_commessa: cantiere.nome || "",
      codice_cantiere: cantiere.codice || "",
      luogo: cantiere.localita || "",
      provincia,
      committente: cantiere.committente || "",
      responsabile: cantiere.responsabile || "",
      direttore_scavo: archeologoCoordinatore,
      responsabile_sabap: "",
      responsabile_scavo: cantiere.responsabile || "",
      data_inizio_wk: "(data inizio settimana)",
      data_fine_wk: "(data fine settimana)",
      data_relazione: new Date().toLocaleDateString("it-IT"),
      settimana: "(W1, W2, ...)",
      archeologo_coordinatore: archeologoCoordinatore,
      archeologi: archeologiStr,
      scavatori: scavatoriStr,
      topografo,
      escavatore,
      obiettivo,
      dettaglio_attivita: "(testo narrativo AI della settimana)",
      nome_archeologo_coord: archeologoCoordinatore,
      nome_archeologi: archeologiStr,
      nome_topografo: topografo,
      nome_ditta: cantiere.committente || "",
      nome_scavatori: scavatoriStr,
      nome_direttore: archeologoCoordinatore,
    };

    return res.json({ placeholders: values, keys: AVAILABLE_PLACEHOLDER_KEYS });
  }));

  async function buildReportSettimanale(
    cantiere: import("@shared/schema").Cantiere | undefined,
    weekStart: string,
    weekEnd: string,
    entries: Array<{ giornata: import("@shared/schema").Giornata; reportFormattato: string; campiMancanti: string[]; usSchede?: import("@shared/schema").UnitaStratigrafica[] }>,
    weekNumber?: number,
    imgDir?: string,
    templatesDir?: string,
    tipoRelazione: "template" | "narrativo" | "strutturato" = "template",
  ): Promise<Buffer> {

    // Modalità "strutturato": tabelle per giornata, nessuna AI narrativa
    if (tipoRelazione === "strutturato") {
      return exportReportSettimanaleDocx({ cantiere, weekStart, weekEnd, entries });
    }

    // Modalità "narrativo": solo testo AI senza template
    if (tipoRelazione === "narrativo") {
      let testo_ai = "";
      try {
        testo_ai = await generateReportSettimanaleCustom({
          cantiere: cantiere!,
          weekStart,
          weekEnd,
          entries: entries.map(({ giornata, reportFormattato, usSchede }) => ({ giornata, reportFormattato, usSchede })),
        });
      } catch (aiErr: any) {
        logger.warn("AI non disponibile per report narrativo, procedo senza testo AI:", aiErr?.message || aiErr);
      }
      // Usa il layout custom ma senza cercare il template file (templatesDir=undefined)
      return exportReportSettimanaleCustomDocx({ cantiere, weekStart, weekEnd, weekNumber, testo_ai, entries, imgDir, templatesDir: undefined });
    }

    // Modalità "template" (default): usa template custom se disponibile, altrimenti layout strutturato
    let hasCustomTemplate = false;
    if (templatesDir) {
      const fs = await import("fs");
      const path = await import("path");
      const indexPath = path.join(templatesDir, "_index.json");
      if (fs.existsSync(indexPath)) {
        try {
          const idx: Record<string, { uso?: string }> = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
          hasCustomTemplate = Object.values(idx).some((v) => v.uso === "report_settimanale");
        } catch { /* ignore */ }
      }
    }

    if (hasCustomTemplate || cantiere?.usModelKey === "archeosistemi-us") {
      let testo_ai = "";
      try {
        testo_ai = await generateReportSettimanaleCustom({
          cantiere: cantiere!,
          weekStart,
          weekEnd,
          entries: entries.map(({ giornata, reportFormattato, usSchede }) => ({ giornata, reportFormattato, usSchede })),
        });
      } catch (aiErr: any) {
        logger.warn("AI non disponibile per report settimanale, procedo senza testo AI:", aiErr?.message || aiErr);
      }
      return exportReportSettimanaleCustomDocx({ cantiere, weekStart, weekEnd, weekNumber, testo_ai, entries, imgDir, templatesDir });
    }
    return exportReportSettimanaleDocx({ cantiere, weekStart, weekEnd, entries });
  }

  // Export giornale settimanale DOCX
  app.get("/api/cantieri/:cid/giornale/export-weekly-docx", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const weekRef = parseIsoDateOnly(req.query.date) || new Date();
    const weekStart = startOfWeekMonday(weekRef);
    const weekEnd = endOfWeekSunday(weekStart);
    const weekStartIso = toIsoDateOnly(weekStart);
    const weekEndIso = toIsoDateOnly(weekEnd);

    const giornateWithReport = ctx.storage
      .getGiornate(cid)
      .filter((giornata) => {
        if (!giornata.aiReportText) return false;
        const dayDate = parseIsoDateOnly(giornata.data);
        if (!dayDate) return false;
        return isDateInRange(dayDate, weekStart, weekEnd);
      })
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    if (giornateWithReport.length === 0) {
      return res.status(404).json({
        error: `Nessun report giornaliero disponibile nella settimana ${weekStartIso} - ${weekEndIso}`,
      });
    }

    try {
      const entries = giornateWithReport.map((giornata) => {
        const qcLogs = ctx.storage.getQcLogs(cid, giornata.id);
        const campiMancanti = qcLogs.filter((log) => log.livello === "error").map((log) => log.messaggio);
        const usSchede = ctx.storage.getUSList(cid, giornata.id);
        return {
          giornata,
          reportFormattato: giornata.aiReportText || "",
          campiMancanti,
          usSchede,
        };
      });

      const tipoRelazione = parseTipoRelazione(req.query.tipoRelazione);
      const buf = await buildReportSettimanale(cantiere, weekStartIso, weekEndIso, entries, undefined, ctx.project.imgDir, ctx.project.templatesDir, tipoRelazione);
      const filename = `Diario_settimanale_${weekStartIso}_${weekEndIso}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore export giornale settimanale DOCX" });
    }
  }));

  app.post("/api/cantieri/:cid/report/export-settimana", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const weekNumber = parsePositiveInteger(req.body?.weekNumber);
    if (!weekNumber) {
      return res.status(400).json({ error: "weekNumber non valido: usa un intero positivo (W1, W2, ...)" });
    }

    const giornateOrdinate = ctx.storage
      .getGiornate(cid)
      .filter((giornata) => !!parseIsoDateOnly(giornata.data))
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    const settimaneProgetto = calcolaSettimaneProgetto(
      giornateOrdinate.map((giornata) => ({
        id: Number(giornata.id),
        data: String(giornata.data || ""),
      })),
    );
    const settimanaTarget = settimaneProgetto.find((week) => week.weekNumber === weekNumber);
    if (!settimanaTarget) {
      return res.status(404).json({ error: `Settimana W${weekNumber} non trovata nel cantiere` });
    }

    const idsSettimana = new Set(settimanaTarget.giornateIds);

    const giornateWithReport = giornateOrdinate
      .filter((giornata) => {
        if (!giornata.aiReportText) return false;
        return idsSettimana.has(Number(giornata.id));
      })
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    if (giornateWithReport.length === 0) {
      return res.status(404).json({
        error: `Nessun report giornaliero disponibile nella settimana W${weekNumber}`,
      });
    }

    try {
      const entries = giornateWithReport.map((giornata) => {
        const qcLogs = ctx.storage.getQcLogs(cid, giornata.id);
        const campiMancanti = qcLogs.filter((log) => log.livello === "error").map((log) => log.messaggio);
        const usSchede = ctx.storage.getUSList(cid, giornata.id);
        return {
          giornata,
          reportFormattato: giornata.aiReportText || "",
          campiMancanti,
          usSchede,
        };
      });

      const tipoRelazione = parseTipoRelazione(req.body?.tipoRelazione);
      const buf = await buildReportSettimanale(cantiere, settimanaTarget.dataInizio, settimanaTarget.dataFine, entries, weekNumber, ctx.project.imgDir, ctx.project.templatesDir, tipoRelazione);
      const filename = `Diario_settimanale_W${weekNumber}_${settimanaTarget.dataInizio}_${settimanaTarget.dataFine}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore export settimanale DOCX" });
    }
  }));

  app.post("/api/cantieri/:cid/report/export-multi-settimane", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const weekNumbers = parsePositiveIntegerArray(req.body?.weekNumbers);

    if (weekNumbers.length === 0) {
      return res.status(400).json({ error: "weekNumbers non valido: seleziona almeno una settimana (W1, W2, ...)" });
    }

    const giornateOrdinate = ctx.storage
      .getGiornate(cid)
      .filter((giornata) => !!parseIsoDateOnly(giornata.data))
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    const settimaneProgetto = calcolaSettimaneProgetto(
      giornateOrdinate.map((giornata) => ({
        id: Number(giornata.id),
        data: String(giornata.data || ""),
      })),
    );
    const weekSet = new Set(weekNumbers);
    const settimaneSelezionate = settimaneProgetto
      .filter((week) => weekSet.has(week.weekNumber))
      .sort((a, b) => a.weekNumber - b.weekNumber);

    if (settimaneSelezionate.length === 0) {
      return res.status(404).json({ error: "Nessuna settimana valida trovata tra quelle selezionate" });
    }

    const giornataIds = new Set<number>(settimaneSelezionate.flatMap((week) => week.giornateIds));
    const giornateWithReport = giornateOrdinate
      .filter((giornata) => Boolean(giornata.aiReportText) && giornataIds.has(Number(giornata.id)))
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    if (giornateWithReport.length === 0) {
      return res.status(404).json({ error: "Nessun report giornaliero disponibile per le settimane selezionate" });
    }

    try {
      const entries = giornateWithReport.map((giornata) => {
        const qcLogs = ctx.storage.getQcLogs(cid, giornata.id);
        const campiMancanti = qcLogs.filter((log) => log.livello === "error").map((log) => log.messaggio);
        const usSchede = ctx.storage.getUSList(cid, giornata.id);
        return {
          giornata,
          reportFormattato: giornata.aiReportText || "",
          campiMancanti,
          usSchede,
        };
      });

      const startIso = settimaneSelezionate[0].dataInizio;
      const endIso = settimaneSelezionate[settimaneSelezionate.length - 1].dataFine;
      const tipoRelazione = parseTipoRelazione(req.body?.tipoRelazione);
      const buf = await buildReportSettimanale(cantiere, startIso, endIso, entries, undefined, ctx.project.imgDir, ctx.project.templatesDir, tipoRelazione);
      const filename = `Diario_multi_settimane_${startIso}_${endIso}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore export multi-settimane DOCX" });
    }
  }));

  app.post("/api/cantieri/:cid/report/export-diario-completo", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornateWithReport = ctx.storage
      .getGiornate(cid)
      .filter((giornata) => Boolean(giornata.aiReportText))
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

    if (giornateWithReport.length === 0) {
      return res.status(404).json({ error: "Nessun report giornaliero disponibile nel cantiere" });
    }

    try {
      const entries = giornateWithReport.map((giornata) => {
        const qcLogs = ctx.storage.getQcLogs(cid, giornata.id);
        const campiMancanti = qcLogs.filter((log) => log.livello === "error").map((log) => log.messaggio);
        const usSchede = ctx.storage.getUSList(cid, giornata.id);
        return {
          giornata,
          reportFormattato: giornata.aiReportText || "",
          campiMancanti,
          usSchede,
        };
      });

      const startIso = entries[0].giornata.data;
      const endIso = entries[entries.length - 1].giornata.data;
      const tipoRelazione = parseTipoRelazione(req.body?.tipoRelazione);
      const buf = await buildReportSettimanale(cantiere, startIso, endIso, entries, undefined, ctx.project.imgDir, ctx.project.templatesDir, tipoRelazione);
      const filename = `Diario_completo_${startIso}_${endIso}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Errore export diario completo DOCX" });
    }
  }));

  // ─── Import giornata da DOCX/DOC con AI ──────────────────────────────────────
  // POST /api/cantieri/:cid/import-giornata-from-docx
  // - senza confirm: restituisce preview con campi AI estratti
  // - con confirm + fields: crea la giornata e restituisce l'oggetto creato
  app.post("/api/cantieri/:cid/import-giornata-from-docx", aiFillDocxUpload.single("file"), withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const confirm = parseBooleanLike(req.body?.confirm);

    if (confirm) {
      // Modalità salvataggio: i campi vengono passati dal client come JSON
      let fields: Record<string, string>;
      try {
        const raw = req.body?.fields;
        fields = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
      } catch {
        return res.status(400).json({ error: "Formato fields non valido" });
      }

      const data = String(fields.data || "").trim();
      if (!data) return res.status(400).json({ error: "Campo data obbligatorio" });

      try {
        const giornata = ctx.storage.createGiornata({
          cantiereId: cid,
          data,
          oraInizio: fields.oraInizio || null,
          oraFine: fields.oraFine || null,
          settore: fields.settore || null,
          condMeteo: fields.condMeteo || null,
          archeologoCoordinatore: fields.archeologoCoordinatore || null,
          archeologi: fields.archeologi
            ? JSON.stringify(fields.archeologi.split(",").map((s: string) => s.trim()).filter(Boolean))
            : null,
          scavatori: fields.scavatori
            ? JSON.stringify(fields.scavatori.split(",").map((s: string) => s.trim()).filter(Boolean))
            : null,
          topografo: fields.topografo || null,
          escavatore: fields.escavatore || null,
          tipoScavo: fields.tipoScavo || null,
          obiettivo: fields.obiettivo || null,
          attivitaSvolta: fields.attivitaSvolta || null,
          note: fields.note || null,
        } as any);
        return res.json({ mode: "created", giornata });
      } catch (error: any) {
        return res.status(400).json({ error: error.message || "Errore creazione giornata" });
      }
    }

    // Modalità preview: estrae il testo dal DOCX e chiede all'AI di compilare i campi
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "File mancante" });
    if (!/\.(docx?)$/i.test(file.originalname || "")) {
      return res.status(400).json({ error: "Formato non valido: carica un file .doc o .docx" });
    }

    let testo: string;
    try {
      testo = await extractTextFromDocxBuffer(file.buffer);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Impossibile leggere il file DOCX" });
    }

    if (!testo.trim()) {
      return res.status(400).json({ error: "Il documento è vuoto o non contiene testo leggibile" });
    }

    try {
      const preview = await estraiCampiGiornataFromText(testo);
      return res.json({ mode: "preview", preview, filename: file.originalname });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Errore estrazione AI campi giornata" });
    }
  }));
}
