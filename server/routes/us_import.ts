/**
 * Endpoint per import batch US da documento (docx/odt/txt).
 * POST /api/cantieri/:cid/us/import/preview  → AI estrae US dal testo, confronta con esistenti
 * POST /api/cantieri/:cid/us/import/apply    → applica le decisioni (crea/aggiorna/salta)
 */
import type { Express, Request, Response } from "express";
import type multer from "multer";
import type { WithProject, ProjectContext } from "./types";
import { extractTextFromDocxBuffer } from "../docx_extract";
import { buildUSBatchExtractPrompt } from "../prompts/us_batch_extract_prompt";
import { getAnthropicModel } from "../anthropic_model";
import { usCodeKey } from "@shared/normalize_us_code";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import type { UnitaStratigrafica } from "@shared/schema";
import { elencoUsTemplatePath } from "../elenco_us_template_path";
import { extractTemplateLoopColumns, extractTableDataRows } from "../docx_table_read";
import { knownFieldsForCantiere } from "../elenco_columns";
import { findSimilarField, type FieldCandidate } from "../field_similarity";
import { normalizeFieldKey, updateCustomUSModel, getUSModel } from "../us_models";
import { humanizeFieldKey } from "../docx_template_utils";
import { BASE_US_FIELD_KEYS } from "@shared/us_models";

// ── Tipi condivisi con il client ─────────────────────────────────────────────

export type USImportConflictField = {
  campo: string;
  vecchioValore: string | null;
  nuovoValore: string | null;
};

export type USImportDecision = "create" | "update" | "skip";

export type USImportItem = {
  /** Codice US estratto dall'AI */
  codiceUS: string;
  /** Campi estratti dall'AI (valore semplice, già normalizzato) */
  campiEstratti: Record<string, unknown>;
  /** Confidence media dei campi estratti */
  confidenceMedia: "alta" | "media" | "bassa";
  /** US esistente nel DB (se presente) */
  esistente: null | {
    id: number;
    codiceUS: string;
    definizione: string | null;
    descrizione: string | null;
    interpretazione: string | null;
  };
  /** Campi che differiscono tra estratto e esistente */
  conflitti: USImportConflictField[];
  /** Decisione suggerita */
  decisioneSuggerita: USImportDecision;
};

export type USImportPreview = {
  items: USImportItem[];
  testoLunghezza: number;
  avvisi: string[];
};

export type USImportApplyItem = {
  codiceUS: string;
  decisione: USImportDecision;
  /** ID US esistente (richiesto se decisione === "update") */
  esistenteId?: number;
  campiEstratti: Record<string, unknown>;
};

export type USImportApplyResult = {
  creati: number;
  aggiornati: number;
  saltati: number;
  errori: Array<{ codiceUS: string; errore: string }>;
  report: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callAIBatch(prompt: string): Promise<string> {
  const resolveProvider = (): "gemini" | "claude" | "openai" | "none" => {
    const envProvider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
    const hasGemini  = !!process.env.GEMINI_API_KEY?.trim();
    const hasClaude  = !!process.env.ANTHROPIC_API_KEY?.trim();
    const hasOpenAI  = !!process.env.OPENAI_API_KEY?.trim();
    if (envProvider === "claude")  return hasClaude  ? "claude"  : "none";
    if (envProvider === "gemini")  return hasGemini  ? "gemini"  : "none";
    if (envProvider === "openai")  return hasOpenAI  ? "openai"  : "none";
    if (hasGemini) return "gemini";
    if (hasOpenAI) return "openai";
    if (hasClaude) return "claude";
    return "none";
  };

  const provider = resolveProvider();
  const systemPrompt = "Sei un assistente archeologico esperto nella compilazione di schede US.";

  if (provider === "gemini") {
    const { generateWithGemini } = await import("../gemini");
    return generateWithGemini(prompt, systemPrompt);
  }

  if (provider === "openai") {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
    const response = await client.chat.completions.create({
      model,
      max_tokens: 8000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });
    return response.choices[0]?.message?.content || "";
  }

  if (provider === "claude") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  throw new Error("Nessun provider AI configurato");
}

function parseJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  // Cerca l'oggetto JSON principale
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objMatch) return [];
  try {
    const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
    if (Array.isArray(parsed.us)) return parsed.us as unknown[];
    return [];
  } catch {
    return [];
  }
}

function flattenCampi(campi: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(campi)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(rec, "value")) {
        if (rec.value != null && rec.value !== "") out[key] = rec.value;
        continue;
      }
    }
    if (entry != null && entry !== "") out[key] = entry;
  }
  return out;
}

function getConfidenceMediana(campi: Record<string, unknown>): "alta" | "media" | "bassa" {
  const scores: number[] = [];
  for (const entry of Object.values(campi)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      const c = String(rec.confidence || "media").toLowerCase();
      scores.push(c === "alta" ? 2 : c === "bassa" ? 0 : 1);
    }
  }
  if (!scores.length) return "media";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 1.5) return "alta";
  if (avg <= 0.5) return "bassa";
  return "media";
}

// Valori ammessi per campi a selezione vincolata
const ALLOWED_VALUES: Record<string, string[]> = {
  densitaInorganici: ["Fitta", "Media", "Rada"],
  densitaOrganici: ["Fitta", "Media", "Rada"],
  statoConservazione: ["Intatto", "Buono", "Discreto", "Mediocre", "Pessimo"],
  flottazioneTipo: ["Non effettuata", "Di tutta l'unita", "Parziale"],
  setacciaturaTipo: ["Non effettuata", "Di tutta l'unita", "Parziale"],
  affidabilitaStratigrafica: ["Nessuna", "Modesta", "Buona"],
};

const NUMERIC_FIELDS = ["quota", "quotaPianoCampagna"];
const TEXT_MIN_LENGTH = 3;

function validateAndSanitizeCampi(
  campi: Record<string, unknown>,
  codiceUS: string,
): { campi: Record<string, unknown>; avvisi: string[] } {
  const out: Record<string, unknown> = {};
  const avvisi: string[] = [];

  for (const [key, value] of Object.entries(campi)) {
    // Campi numerici
    if (NUMERIC_FIELDS.includes(key)) {
      const n = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(n)) {
        avvisi.push(`${codiceUS}: campo "${key}" non numerico ignorato (valore: ${value})`);
        continue;
      }
      out[key] = n;
      continue;
    }

    // Campi a valori vincolati
    if (ALLOWED_VALUES[key]) {
      const allowed = ALLOWED_VALUES[key];
      const strVal = String(value).trim();
      if (!allowed.includes(strVal)) {
        avvisi.push(`${codiceUS}: valore "${strVal}" non valido per "${key}" (ammessi: ${allowed.join(", ")})`);
        continue;
      }
      out[key] = strVal;
      continue;
    }

    // Checkbox booleani
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }

    // Array (multiselect)
    if (Array.isArray(value)) {
      const filtered = value.filter((v) => typeof v === "string" && v.trim().length > 0);
      if (filtered.length > 0) out[key] = filtered;
      continue;
    }

    // Stringhe testo
    const strVal = String(value ?? "").trim();
    if (strVal.length >= TEXT_MIN_LENGTH) {
      out[key] = strVal;
    }
  }

  return { campi: out, avvisi };
}

const COMPARE_FIELDS = [
  "definizione", "descrizione", "interpretazione", "colore", "consistenza",
  "quota", "quotaPianoCampagna", "settore", "area", "datazione", "epoca",
  "periodoFase", "copre", "coperto_da", "taglia", "tagliatoDa",
] as const;

export function buildConflitti(
  estratto: Record<string, unknown>,
  esistente: UnitaStratigrafica,
): USImportConflictField[] {
  const conflitti: USImportConflictField[] = [];
  for (const campo of COMPARE_FIELDS) {
    const nuovoValore = estratto[campo] != null ? String(estratto[campo]) : null;
    const vecchioValore = esistente[campo as keyof UnitaStratigrafica] != null
      ? String(esistente[campo as keyof UnitaStratigrafica])
      : null;
    if (!nuovoValore) continue;
    if (vecchioValore !== nuovoValore) {
      conflitti.push({ campo, vecchioValore, nuovoValore });
    }
  }
  return conflitti;
}

async function extractTextFromFile(file: Express.Multer.File): Promise<string> {
  const name = file.originalname.toLowerCase();
  const fs = await import("fs");
  const buf = fs.readFileSync(file.path);

  if (name.endsWith(".docx")) {
    return extractTextFromDocxBuffer(buf);
  }

  if (name.endsWith(".odt")) {
    // ODT è un ZIP — estraiamo content.xml con una regex semplice
    const PizZip = (await import("pizzip")).default;
    const zip = new PizZip(buf);
    const contentXml = zip.file("content.xml")?.asText() || "";
    // Rimuovi tag XML, lascia solo testo
    return contentXml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  if (name.endsWith(".txt")) {
    return buf.toString("utf-8").replace(/\r\n/g, "\n").trim();
  }

  throw new Error("Formato non supportato. Usa .docx, .odt o .txt");
}

/** Costruisce gli item di preview import a partire da colonne (chiavi campo per indice) e righe di celle testuali. */
function buildElencoImportItems(
  flatKeys: (string | null)[],
  records: string[][],
  esistenti: UnitaStratigrafica[],
): { items: USImportItem[]; avvisi: string[] } {
  const avvisi: string[] = [];
  const items: USImportItem[] = [];
  const visteCodici = new Set<string>();

  for (const cells of records) {
    const campiEstratti: Record<string, unknown> = {};
    flatKeys.forEach((key, i) => {
      if (!key) return;
      const value = cells[i]?.trim();
      if (value) campiEstratti[key] = value;
    });

    const codiceUS = String(campiEstratti.codiceUS || "").trim();
    if (!codiceUS) continue;
    delete campiEstratti.codiceUS;

    const codeKey = usCodeKey(codiceUS);
    if (codeKey && visteCodici.has(codeKey)) {
      avvisi.push(`Codice US "${codiceUS}" ripetuto in più righe: solo la prima occorrenza è stata considerata.`);
      continue;
    }
    if (codeKey) visteCodici.add(codeKey);

    const esistente = codeKey
      ? esistenti.find((u: UnitaStratigrafica) => usCodeKey(u.codiceUS) === codeKey) ?? null
      : null;
    const conflitti = esistente ? buildConflitti(campiEstratti, esistente) : [];
    const decisioneSuggerita: USImportDecision =
      !esistente ? "create" : conflitti.length > 0 ? "update" : "skip";

    items.push({
      codiceUS,
      campiEstratti,
      confidenceMedia: "alta",
      esistente: esistente
        ? {
            id: esistente.id,
            codiceUS: esistente.codiceUS,
            definizione: esistente.definizione ?? null,
            descrizione: esistente.descrizione ?? null,
            interpretazione: esistente.interpretazione ?? null,
          }
        : null,
      conflitti,
      decisioneSuggerita,
    });
  }

  if (items.length === 0) {
    avvisi.push("Nessuna riga con codice US valida è stata trovata nel file.");
  }

  return { items, avvisi };
}

/**
 * Legge un file .xlsx/.xls/.csv e restituisce le colonne (chiave campo abbinata per similarità
 * all'intestazione, o null se non riconosciuta) e le righe dati (celle in stringa).
 */
async function readSpreadsheetColumns(
  filePath: string,
  knownFields: { key: string; label: string }[],
): Promise<{ flatKeys: (string | null)[]; records: string[][]; avvisi: string[] }> {
  const XLSX = await import("xlsx");
  const fs = await import("fs");
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

  if (rows.length === 0) return { flatKeys: [], records: [], avvisi: [] };

  const headerRow = rows[0].map((h) => String(h ?? "").trim());
  const avvisi: string[] = [];
  const flatKeys: (string | null)[] = headerRow.map((header) => {
    if (!header) return null;
    const normalized = header.toLowerCase();
    if (normalized === "codiceus" || normalized === "codice us" || normalized === "codice") return "codiceUS";
    const match = findSimilarField(header, knownFields);
    if (!match) {
      avvisi.push(`Colonna "${header}" non riconosciuta: ignorata.`);
      return null;
    }
    return match.key;
  });

  const records = rows.slice(1).map((r) => headerRow.map((_, i) => String(r[i] ?? "").trim()));
  return { flatKeys, records, avvisi };
}

/** Legge un file .xlsx/.xls/.csv e restituisce tutte le righe grezze (celle in stringa), senza
 * assumere quale sia la riga di intestazione: molti elenchi hanno righe di metadata (titolo del
 * modulo, nome cantiere, numero commessa...) prima della vera riga con i nomi delle colonne. */
async function readSpreadsheetRaw(filePath: string): Promise<{ rows: string[][] }> {
  const XLSX = await import("xlsx");
  const fs = await import("fs");
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

  const width = rawRows.reduce((max, r) => Math.max(max, r.length), 0);
  const rows = rawRows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? "").trim()));
  return { rows };
}

/** Un'intestazione "US"/"Codice US"/"Codice" identifica la colonna del codice US: le celle non
 * hanno bisogno del confronto per similarità con i campi noti, il match è diretto. */
function isCodiceUSHeaderCell(cell: string): boolean {
  const normalized = cell.trim().toLowerCase();
  return normalized === "us" || normalized === "codiceus" || normalized === "codice us" || normalized === "codice";
}

const HEADER_SCAN_MAX_ROWS = 25;

/** Individua, tra le prime righe del foglio, quella che più probabilmente contiene le intestazioni
 * delle colonne (invece di assumere sempre che sia la prima riga): scarta righe di metadata come
 * "CANTIERE: ..." o "N. COMMESSA: ..." che spesso precedono la vera riga di intestazione, cercando
 * la riga con più celle riconoscibili come nomi di campo (codice US compreso). */
function detectHeaderRowIndex(rows: string[][], knownFields: FieldCandidate[]): number {
  let bestIndex = 0;
  let bestScore = -1;
  let bestHasCodice = false;

  const scanLimit = Math.min(rows.length, HEADER_SCAN_MAX_ROWS);
  for (let i = 0; i < scanLimit; i += 1) {
    const cells = rows[i].map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const hasCodice = cells.some((c) => isCodiceUSHeaderCell(c));
    const matches = cells.filter((c) => isCodiceUSHeaderCell(c) || findSimilarField(c, knownFields)).length;

    // Preferisce righe con la colonna codice US esplicita; a parità, quelle con più campi riconosciuti.
    const better = hasCodice && !bestHasCodice
      ? true
      : hasCodice === bestHasCodice && matches > bestScore;

    if (better && matches >= 2) {
      bestIndex = i;
      bestScore = matches;
      bestHasCodice = hasCodice;
    }
  }

  return bestScore >= 0 ? bestIndex : 0;
}

export type USImportColumnSuggestion = {
  header: string;
  match: { key: string; label: string; score: number } | null;
};

export type USImportColumnsResult = {
  headers: string[];
  rows: string[][];
  suggestions: USImportColumnSuggestion[];
  knownFields: FieldCandidate[];
  headerRowIndex: number;
  skippedRows: number;
};

export type USImportColumnDecision = {
  header: string;
  action: "use-existing" | "create-new" | "ignore";
  existingKey?: string;
  label?: string;
};

// ── Registrazione route ───────────────────────────────────────────────────────

export function registerUSImportRoutes(
  app: Express,
  upload: multer.Multer,
  withProject: WithProject,
): void {

  // POST /api/cantieri/:cid/us/import/preview
  app.post(
    "/api/cantieri/:cid/us/import/preview",
    upload.single("documento"),
    withProject(async (ctx: ProjectContext, req: Request, res: Response) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      const fs = await import("fs");

      try {
        if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });

        const cid = Number(req.params.cid);

        // Estrai testo
        let testo: string;
        try {
          testo = await extractTextFromFile(file);
        } finally {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        if (!testo.trim()) {
          return res.status(400).json({ error: "Il documento non contiene testo leggibile" });
        }

        const avvisi: string[] = [];

        // Tronca se troppo lungo (limite ~40k chars per non eccedere context AI)
        let testoAI = testo;
        const MAX_CHARS = 40000;
        if (testo.length > MAX_CHARS) {
          testoAI = testo.slice(0, MAX_CHARS);
          avvisi.push(`Il documento è stato troncato a ${MAX_CHARS} caratteri per l'elaborazione AI.`);
        }

        // Chiama AI
        const prompt = buildUSBatchExtractPrompt(testoAI);
        let rawResponse: string;
        try {
          rawResponse = await callAIBatch(prompt);
        } catch (e: any) {
          return res.status(502).json({ error: `Errore AI: ${e?.message || "sconosciuto"}` });
        }

        const rawItems = parseJsonArray(rawResponse);
        if (!rawItems.length) {
          return res.status(200).json({
            items: [],
            testoLunghezza: testo.length,
            avvisi: [...avvisi, "L'AI non ha identificato nessuna US nel documento."],
          } satisfies USImportPreview);
        }

        // US esistenti nel cantiere
        const esistenti = ctx.storage.getUSList(cid);

        const items: USImportItem[] = [];
        const visteCodici = new Set<string>();

        for (const raw of rawItems) {
          if (!raw || typeof raw !== "object") continue;
          const rec = raw as Record<string, unknown>;
          const codiceUS = String(rec.codiceUS || "").trim();
          if (!codiceUS) continue;

          const codeKey = usCodeKey(codiceUS);
          if (codeKey && visteCodici.has(codeKey)) continue;
          if (codeKey) visteCodici.add(codeKey);

          const campiRaw = (rec.campi && typeof rec.campi === "object" && !Array.isArray(rec.campi))
            ? rec.campi as Record<string, unknown>
            : {};
          const campiEstratti = flattenCampi(campiRaw);
          const confidenceMedia = getConfidenceMediana(campiRaw);

          // Cerca US esistente per codice
          const esistente = codeKey
            ? esistenti.find((u: UnitaStratigrafica) => usCodeKey(u.codiceUS) === codeKey) ?? null
            : null;

          const conflitti = esistente ? buildConflitti(campiEstratti, esistente) : [];

          const decisioneSuggerita: USImportDecision =
            !esistente ? "create"
            : conflitti.length > 0 ? "update"
            : "skip";

          items.push({
            codiceUS,
            campiEstratti,
            confidenceMedia,
            esistente: esistente
              ? {
                  id: esistente.id,
                  codiceUS: esistente.codiceUS,
                  definizione: esistente.definizione ?? null,
                  descrizione: esistente.descrizione ?? null,
                  interpretazione: esistente.interpretazione ?? null,
                }
              : null,
            conflitti,
            decisioneSuggerita,
          });
        }

        if (items.length === 0) {
          avvisi.push("Nessuna US con codice identificabile è stata trovata nel documento.");
        }

        const result: USImportPreview = { items, testoLunghezza: testo.length, avvisi };
        return res.json(result);

      } catch (e: any) {
        try { if (file?.path) { const fs2 = await import("fs"); fs2.unlinkSync(file.path); } } catch { /* ignore */ }
        return res.status(500).json({ error: e?.message || "Errore interno" });
      }
    }),
  );

  // POST /api/cantieri/:cid/elenco-us/import/preview
  // Import strutturato (non-AI): legge le righe di una tabella DOCX "elenco US" compilata,
  // usando come guida di colonne il template elenco caricato per il cantiere.
  app.post(
    "/api/cantieri/:cid/elenco-us/import/preview",
    upload.single("documento"),
    withProject(async (ctx: ProjectContext, req: Request, res: Response) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      const fs = await import("fs");

      try {
        if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
        const name = file.originalname.toLowerCase();
        const isSpreadsheet = name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
        const isDocx = name.endsWith(".docx");
        if (!isSpreadsheet && !isDocx) {
          fs.unlinkSync(file.path);
          return res.status(400).json({ error: "Il file deve essere .docx, .xlsx, .xls o .csv" });
        }

        const cid = Number(req.params.cid);
        const cantiere = ctx.storage.getCantiere(cid);
        if (!cantiere) {
          fs.unlinkSync(file.path);
          return res.status(404).json({ error: "Cantiere non trovato" });
        }

        let flatKeys: (string | null)[];
        let records: string[][];
        let avvisi: string[] = [];

        if (isSpreadsheet) {
          const knownFields = knownFieldsForCantiere(ctx.project, cantiere);
          try {
            const parsed = await readSpreadsheetColumns(file.path, knownFields);
            flatKeys = parsed.flatKeys;
            records = parsed.records;
            avvisi = parsed.avvisi;
          } finally {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
          }
        } else {
          const templatePath = elencoUsTemplatePath(ctx.project);
          if (!fs.existsSync(templatePath)) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: "Nessun template elenco US configurato per questo cantiere" });
          }

          const loopColumns = await extractTemplateLoopColumns(templatePath);
          if (!loopColumns) {
            fs.unlinkSync(file.path);
            return res.status(400).json({
              error: "Il template elenco US non contiene un blocco di tabella con i tag {#tag}...{/tag}",
            });
          }

          flatKeys = loopColumns.columnKeys.flat();
          try {
            const grouped = await extractTableDataRows(
              file.path,
              loopColumns.headerRowCount,
              loopColumns.rowsPerRecord,
              loopColumns.columnKeys[0].length,
            );
            records = grouped.map((record) => record.flat());
          } finally {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
          }
        }

        if (!flatKeys.includes("codiceUS")) {
          return res.status(400).json({
            error: isSpreadsheet
              ? "Nessuna colonna del file corrisponde al codice US: rinomina l'intestazione (es. \"Codice US\")"
              : "Il template elenco US non ha una colonna {codiceUS}: impossibile abbinare le righe alle US",
          });
        }

        const esistenti = ctx.storage.getUSList(cid);
        const { items, avvisi: itemAvvisi } = buildElencoImportItems(flatKeys, records, esistenti);

        const result: USImportPreview = { items, testoLunghezza: 0, avvisi: [...avvisi, ...itemAvvisi] };
        return res.json(result);
      } catch (e: any) {
        try { if (file?.path) { const fs2 = await import("fs"); fs2.unlinkSync(file.path); } } catch { /* ignore */ }
        return res.status(500).json({ error: e?.message || "Errore interno" });
      }
    }),
  );

  // POST /api/cantieri/:cid/elenco-us/import/columns
  // Legge le intestazioni e le righe di un file .xlsx/.xls/.csv e propone un abbinamento colonna→campo
  // (senza applicarlo): l'utente conferma/corregge il mapping nel passo successivo del client.
  app.post(
    "/api/cantieri/:cid/elenco-us/import/columns",
    upload.single("documento"),
    withProject(async (ctx: ProjectContext, req: Request, res: Response) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      const fs = await import("fs");

      try {
        if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
        const name = file.originalname.toLowerCase();
        const isSpreadsheet = name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
        if (!isSpreadsheet) {
          fs.unlinkSync(file.path);
          return res.status(400).json({ error: "Il file deve essere .xlsx, .xls o .csv" });
        }

        const cid = Number(req.params.cid);
        const cantiere = ctx.storage.getCantiere(cid);
        if (!cantiere) {
          fs.unlinkSync(file.path);
          return res.status(404).json({ error: "Cantiere non trovato" });
        }

        let allRows: string[][];
        try {
          const parsed = await readSpreadsheetRaw(file.path);
          allRows = parsed.rows;
        } finally {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        const knownFields = knownFieldsForCantiere(ctx.project, cantiere);
        const headerRowIndex = detectHeaderRowIndex(allRows, knownFields);
        const headers = (allRows[headerRowIndex] || []).map((h) => h.trim());
        const records = allRows.slice(headerRowIndex + 1).filter((r) => r.some((c) => c.trim()));

        const suggestions: USImportColumnSuggestion[] = headers.map((header) => {
          if (!header) return { header, match: null };
          if (isCodiceUSHeaderCell(header)) {
            return { header, match: { key: "codiceUS", label: "Codice US", score: 1 } };
          }
          const match = findSimilarField(header, knownFields);
          return { header, match };
        });

        const result: USImportColumnsResult = {
          headers,
          rows: records,
          suggestions,
          knownFields,
          headerRowIndex,
          skippedRows: headerRowIndex,
        };
        return res.json(result);
      } catch (e: any) {
        try { if (file?.path) { const fs2 = await import("fs"); fs2.unlinkSync(file.path); } } catch { /* ignore */ }
        return res.status(500).json({ error: e?.message || "Errore interno" });
      }
    }),
  );

  // POST /api/cantieri/:cid/elenco-us/import/apply-columns
  // Applica il mapping colonna→campo confermato dall'utente (con eventuale creazione di nuovi campi
  // sul modello US personalizzato) e produce l'anteprima import, come /elenco-us/import/preview.
  app.post(
    "/api/cantieri/:cid/elenco-us/import/apply-columns",
    withProject((ctx: ProjectContext, req: Request, res: Response) => {
      const cid = Number(req.params.cid);
      const cantiere = ctx.storage.getCantiere(cid);
      if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

      const body = req.body as {
        headers?: string[];
        rows?: string[][];
        decisions?: USImportColumnDecision[];
      };
      const headers: string[] = Array.isArray(body?.headers) ? body.headers : [];
      const records: string[][] = Array.isArray(body?.rows) ? body.rows : [];
      const decisions: USImportColumnDecision[] = Array.isArray(body?.decisions) ? body.decisions : [];
      const decisionByHeader = new Map(decisions.map((d) => [d.header, d]));

      const avvisi: string[] = [];

      // Nuovi campi richiesti (deduplicati per chiave normalizzata). `updateCustomUSModel` rinormalizza
      // internamente la chiave (via toFieldList): per campi già in camelCase la seconda passata di
      // normalizeFieldKey non è idempotente (es. "coloreNuovo" → "colorenuovo"), quindi calcoliamo qui
      // la chiave "finale" con la stessa doppia normalizzazione, per restare allineati a ciò che viene
      // davvero salvato nel modello.
      const newFieldsMap = new Map<string, string>(); // finalKey -> label
      for (const d of decisions) {
        if (d.action !== "create-new") continue;
        const label = d.label?.trim() || humanizeFieldKey(d.header);
        const finalKey = normalizeFieldKey(normalizeFieldKey(label));
        if (!BASE_US_FIELD_KEYS.has(finalKey) && !newFieldsMap.has(finalKey)) newFieldsMap.set(finalKey, label);
      }

      if (newFieldsMap.size > 0) {
        const activeModelKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
        const activeModel = getUSModel(ctx.project, activeModelKey);

        if (activeModel.source !== "custom") {
          avvisi.push(
            `Il modello attivo "${activeModel.name}" non è personalizzabile: i nuovi campi (${Array.from(newFieldsMap.values()).join(", ")}) verranno comunque salvati nelle schede, ma non aggiunti formalmente al modello. Per aggiungerli in modo definitivo, crea prima un modello personalizzato.`,
          );
        } else {
          const existingKeys = new Set(activeModel.fields.map((f) => f.key));
          const fieldsToAdd = Array.from(newFieldsMap.entries())
            .filter(([key]) => !existingKeys.has(key))
            .map(([key, label]) => ({ key, label, type: "text" as const }));
          if (fieldsToAdd.length > 0) {
            try {
              updateCustomUSModel(ctx.project, activeModel.key, {
                fields: [...activeModel.fields, ...fieldsToAdd],
              });
            } catch (e: any) {
              avvisi.push(`Errore creando i nuovi campi sul modello: ${e?.message || "sconosciuto"}`);
            }
          }
        }
      }

      const flatKeys: (string | null)[] = headers.map((header) => {
        const decision = decisionByHeader.get(header);
        if (!decision || decision.action === "ignore") return null;
        if (decision.action === "use-existing") return decision.existingKey || null;
        const label = decision.label?.trim() || humanizeFieldKey(header);
        return normalizeFieldKey(normalizeFieldKey(label));
      });

      if (!flatKeys.includes("codiceUS")) {
        return res.status(400).json({
          error: "Nessuna colonna è stata abbinata al codice US: seleziona la colonna corrispondente prima di continuare",
        });
      }

      const esistenti = ctx.storage.getUSList(cid);
      const { items, avvisi: itemAvvisi } = buildElencoImportItems(flatKeys, records, esistenti);

      const result: USImportPreview = { items, testoLunghezza: 0, avvisi: [...avvisi, ...itemAvvisi] };
      return res.json(result);
    }),
  );

  // POST /api/cantieri/:cid/us/import/apply
  app.post(
    "/api/cantieri/:cid/us/import/apply",
    withProject((ctx: ProjectContext, req: Request, res: Response) => {
      const cid = Number(req.params.cid);
      const cantiere = ctx.storage.getCantiere(cid);
      if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

      const body = req.body as { items?: USImportApplyItem[]; source?: string };
      const items: USImportApplyItem[] = Array.isArray(body?.items) ? body.items : [];
      // Le US importate dall'elenco strutturato (docx/xlsx/csv) vengono marcate "da rivedere":
      // i campi sono letti/abbinati automaticamente e vanno verificati manualmente.
      const daRivedere = body?.source === "elenco";

      console.log(`[us-import/apply] cid=${cid} items=${items.length} decisioni=${items.map(i => `${i.codiceUS}:${i.decisione}`).join(", ")}`);

      let creati = 0;
      let aggiornati = 0;
      let saltati = 0;
      const errori: Array<{ codiceUS: string; errore: string }> = [];
      const reportLines: string[] = [`# Report Import US — ${new Date().toLocaleDateString("it-IT")}\n`];

      const modelKey = cantiere.usModelKey || BASE_US_MODEL_KEY;

      for (const item of items) {
        const { codiceUS, decisione, esistenteId, campiEstratti } = item;

        if (decisione === "skip") {
          saltati++;
          reportLines.push(`- **${codiceUS}** → Saltata`);
          continue;
        }

        try {
          // Valida e sanifica i campi estratti dall'AI
          const { campi: campiValidati, avvisi: avvisiValidazione } = validateAndSanitizeCampi(campiEstratti, codiceUS);
          for (const avviso of avvisiValidazione) {
            reportLines.push(`  ⚠ ${avviso}`);
          }

          const topLevelFields = [
            "definizione", "descrizione", "interpretazione", "quota", "quotaPianoCampagna",
            "settore", "area", "localita", "anno", "datazione", "epoca", "periodoFase",
            "copre", "coperto_da", "si_lega_a", "uguale_a", "taglia", "tagliatoDa",
            "riempie", "riempitoDa", "gliSiAppoggia", "siAppoggia", "sequenzaFisica",
            "colore", "consistenza", "misure", "statoConservazione", "danneggiatoDa",
            "responsabileScavo", "affidabilitaStratigrafica",
          ];

          const basePayload: Record<string, unknown> = { codiceUS, cantiereId: cid, schedaModelKey: modelKey };
          if (daRivedere) basePayload.daRivedere = true;
          const schedaData: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(campiValidati)) {
            if (topLevelFields.includes(key)) {
              basePayload[key] = value;
            } else {
              schedaData[key] = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
            }
          }
          basePayload.schedaData = Object.keys(schedaData).length > 0 ? JSON.stringify(schedaData) : null;

          if (decisione === "create") {
            const created = ctx.storage.createUS(basePayload as any);
            console.log(`[us-import/apply] Creata US ${codiceUS} → id=${created?.id}`);
            creati++;
            reportLines.push(`- **${codiceUS}** → Creata (ID ${created?.id})`);
          } else if (decisione === "update" && esistenteId) {
            ctx.storage.updateUS(esistenteId, basePayload);
            aggiornati++;
            reportLines.push(`- **${codiceUS}** → Aggiornata (ID ${esistenteId})`);
          } else {
            saltati++;
            reportLines.push(`- **${codiceUS}** → Saltata (decisione non valida)`);
          }
        } catch (e: any) {
          console.error(`[us-import/apply] ERRORE US ${codiceUS}:`, e);
          errori.push({ codiceUS, errore: e?.message || "Errore sconosciuto" });
          reportLines.push(`- **${codiceUS}** → **ERRORE**: ${e?.message || "sconosciuto"}`);
        }
      }

      reportLines.push(`\n**Riepilogo**: ${creati} create, ${aggiornati} aggiornate, ${saltati} saltate, ${errori.length} errori.`);

      const result: USImportApplyResult = {
        creati,
        aggiornati,
        saltati,
        errori,
        report: reportLines.join("\n"),
      };

      return res.json(result);
    }),
  );
}
