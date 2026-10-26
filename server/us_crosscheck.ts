/**
 * Controllo incrociato: documentazione esterna (schede materiali, ecc.) ↔ schede US.
 * Questo modulo contiene: archivio temporaneo dei documenti caricati, suddivisione in "pagine",
 * consigli sulla dimensione dei blocchi di analisi e confronto deterministico tra quanto trovato
 * dall'AI e quanto già presente nella scheda US.
 */
import crypto from "crypto";
import type { UnitaStratigrafica } from "@shared/schema";
import {
  crosscheckFieldKind,
  readUSFieldForCompare,
  type AiFieldConfidence,
} from "./ai_fill";
import type { CrosscheckFieldSpec } from "./prompts/us_crosscheck_prompt";

// ── Archivio temporaneo dei documenti ────────────────────────────────────────

export type CrosscheckDocument = {
  id: string;
  name: string;
  pages: string[];
  pageKind: "reali" | "stimate";
  createdAt: number;
  warnings: string[];
};

const DOC_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_DOCS = 12;
const docs = new Map<string, CrosscheckDocument>();

function pruneDocs() {
  const now = Date.now();
  docs.forEach((doc, id) => {
    if (now - doc.createdAt > DOC_TTL_MS) docs.delete(id);
  });
  while (docs.size > MAX_DOCS) {
    const oldest = Array.from(docs.values()).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    docs.delete(oldest.id);
  }
}

export function storeCrosscheckDocument(input: Omit<CrosscheckDocument, "id" | "createdAt">): CrosscheckDocument {
  pruneDocs();
  const doc: CrosscheckDocument = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  docs.set(doc.id, doc);
  return doc;
}

export function getCrosscheckDocument(id: string): CrosscheckDocument | undefined {
  pruneDocs();
  return docs.get(id);
}

// ── Estrazione testo e paginazione ───────────────────────────────────────────

const VIRTUAL_PAGE_CHARS = 3000;

/** Divide un testo (riga per riga) in "pagine" virtuali di ~3000 caratteri. */
export function paginateText(text: string, pageChars = VIRTUAL_PAGE_CHARS): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of text.split("\n")) {
    if (size > 0 && size + line.length > pageChars) {
      pages.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) pages.push(current.join("\n"));
  return pages.filter((p) => p.trim().length > 0);
}

async function extractPdfPages(buf: Buffer): Promise<string[]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let out = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        out += (item.str ?? "") + (item.hasEOL ? "\n" : " ");
      }
      pages.push(out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

async function extractSpreadsheetText(buf: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const lines = rows
      .map((r) => r.map((c) => String(c ?? "").trim()).join(" | ").replace(/(\s\|\s)+$/g, "").trim())
      .filter((line) => line.length > 0);
    if (lines.length) parts.push(`## Foglio: ${sheetName}\n${lines.join("\n")}`);
  }
  return parts.join("\n");
}

export async function extractCrosscheckPages(
  fileName: string,
  buf: Buffer,
): Promise<{ pages: string[]; pageKind: "reali" | "stimate"; warnings: string[] }> {
  const name = fileName.toLowerCase();
  const warnings: string[] = [];

  if (name.endsWith(".pdf")) {
    const pages = await extractPdfPages(buf);
    const withText = pages.filter((p) => p.trim().length > 20).length;
    if (withText === 0) {
      throw new Error("Il PDF non contiene testo selezionabile (probabile scansione): serve un PDF con testo o un OCR preliminare.");
    }
    if (withText < pages.length) {
      warnings.push(`${pages.length - withText} pagine del PDF non contengono testo leggibile (immagini/scansioni) e saranno ignorate.`);
    }
    return { pages, pageKind: "reali", warnings };
  }

  let text: string;
  if (name.endsWith(".docx")) {
    const { extractTextFromDocxBuffer } = await import("./docx_extract");
    text = await extractTextFromDocxBuffer(buf);
  } else if (name.endsWith(".odt")) {
    const PizZip = (await import("pizzip")).default;
    const xml = new PizZip(buf).file("content.xml")?.asText() || "";
    text = xml
      .replace(/<text:(p|h)[^>]*>/g, "\n")
      .replace(/<text:tab\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    text = await extractSpreadsheetText(buf);
  } else if (name.endsWith(".txt") || name.endsWith(".md")) {
    text = buf.toString("utf-8").replace(/\r\n/g, "\n").trim();
  } else {
    throw new Error("Formato non supportato. Usa PDF, DOCX, ODT, XLSX/CSV o TXT.");
  }

  if (!text.trim()) throw new Error("Il documento non contiene testo leggibile");
  warnings.push("Il formato non ha pagine fisse: il documento è stato suddiviso in \"pagine\" stimate (~3000 caratteri l'una).");
  return { pages: paginateText(text), pageKind: "stimate", warnings };
}

// ── Consiglio sulla dimensione dei blocchi ───────────────────────────────────

/** Caratteri di testo per singola chiamata AI, in base al provider attivo (limite sull'output strutturato). */
const TARGET_CHARS_PER_PASS: Record<string, number> = {
  gemini: 24000,
  claude: 18000,
  openai: 14000,
};
export const MAX_CHARS_PER_PASS = 45000;

export function recommendPagesPerPass(pages: string[], provider: string): {
  pagesPerPass: number;
  passes: number;
  reason: string;
} {
  const total = pages.length;
  const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
  const avg = Math.max(1, totalChars / Math.max(1, total));
  const target = TARGET_CHARS_PER_PASS[provider] ?? 12000;
  const pagesPerPass = Math.min(total, Math.max(1, Math.floor(target / avg)));
  const passes = Math.ceil(total / pagesPerPass);
  const providerLabel = provider === "none" ? "nessun modello AI configurato" : `modello AI attivo: ${provider}`;
  return {
    pagesPerPass,
    passes,
    reason:
      `~${Math.round(avg)} caratteri a pagina (${providerLabel}): ` +
      `${pagesPerPass} pagine per volta tengono le risposte complete e verificabili.`,
  };
}

// ── Campi analizzati ─────────────────────────────────────────────────────────

export type CrosscheckPreset = "materiali" | "tutti";

const MATERIALI_FIELDS: CrosscheckFieldSpec[] = [
  { key: "compMaterialeCostruzione", label: "Materiale da costruzione", hint: "boolean: laterizi, pietre, malta, ecc." },
  { key: "compCeramica", label: "Ceramica", hint: "boolean" },
  { key: "compMetalli", label: "Metalli", hint: "boolean" },
  { key: "compVetro", label: "Vetro", hint: "boolean" },
  { key: "compCiottoli", label: "Ciottoli", hint: "boolean" },
  { key: "compGhiaia", label: "Ghiaia", hint: "boolean" },
  { key: "compFauna", label: "Reperti faunistici", hint: "boolean: ossa/denti animali, malacofauna" },
  { key: "compOsso", label: "Osso", hint: "boolean: manufatti o resti in osso" },
  { key: "compCorno", label: "Corno", hint: "boolean" },
  { key: "compSemi", label: "Semi", hint: "boolean" },
  { key: "compFrutti", label: "Frutti", hint: "boolean" },
  { key: "compCarboni", label: "Carboni", hint: "boolean" },
  { key: "compLegno", label: "Legno", hint: "boolean" },
  { key: "compTessuti", label: "Tessuti", hint: "boolean" },
  { key: "componentiInorganiciAltro", label: "Altri componenti inorganici", hint: "testo breve (es. industria litica, intonaco dipinto)" },
  { key: "componentiOrganiciAltro", label: "Altri componenti organici", hint: "testo breve (es. resti umani, conchiglie)" },
  { key: "datiQuantitativiReperti", label: "Dati quantitativi reperti", hint: "testo: sintesi per classe con le quantità scritte nel documento" },
  { key: "campionatureN", label: "Campionature", hint: "testo: campioni prelevati (sigla/numero/tipo)" },
  { key: "datazione", label: "Datazione", hint: "testo: solo se il documento data la US o i suoi materiali" },
  { key: "periodoFase", label: "Periodo/Fase", hint: "testo" },
  { key: "flottazioneTipo", label: "Flottazione", hint: "'Non effettuata' | 'Di tutta l'unita' | 'Parziale'" },
  { key: "setacciaturaTipo", label: "Setacciatura", hint: "'Non effettuata' | 'Di tutta l'unita' | 'Parziale'" },
];

const TUTTI_EXTRA_FIELDS: CrosscheckFieldSpec[] = [
  { key: "definizione", label: "Definizione", hint: "testo" },
  { key: "descrizione", label: "Descrizione", hint: "testo" },
  { key: "interpretazione", label: "Interpretazione", hint: "testo" },
  { key: "colore", label: "Colore", hint: "testo" },
  { key: "consistenza", label: "Consistenza", hint: "testo" },
  { key: "misure", label: "Misure", hint: "testo" },
  { key: "statoConservazione", label: "Stato di conservazione", hint: "'Intatto' | 'Buono' | 'Discreto' | 'Mediocre' | 'Pessimo'" },
  { key: "epoca", label: "Epoca", hint: "testo" },
  { key: "quota", label: "Quota", hint: "numero" },
  { key: "settore", label: "Settore", hint: "testo" },
  { key: "area", label: "Area", hint: "testo" },
];

export function getCrosscheckFields(preset: CrosscheckPreset): CrosscheckFieldSpec[] {
  return preset === "tutti" ? [...MATERIALI_FIELDS, ...TUTTI_EXTRA_FIELDS] : MATERIALI_FIELDS;
}

export function crosscheckFieldLabel(key: string): string {
  return [...MATERIALI_FIELDS, ...TUTTI_EXTRA_FIELDS].find((f) => f.key === key)?.label ?? key;
}

// ── Confronto con la scheda US ───────────────────────────────────────────────

export type CrosscheckProposalKind = "mancante" | "integrazione" | "diverso";

export type CrosscheckProposal = {
  campo: string;
  label: string;
  tipo: CrosscheckProposalKind;
  valoreAttuale: string;
  valoreProposto: string;
  /** Valore da scrivere nella scheda se la proposta viene accettata */
  valoreDaApplicare: string | boolean | number | string[];
  confidenza: AiFieldConfidence;
  fonte: string;
  pagina: number | null;
  selezionataDefault: boolean;
};

export type CrosscheckUSResult = {
  usId: number;
  codiceUS: string;
  definizione: string | null;
  proposte: CrosscheckProposal[];
  /** Etichette dei campi trovati nel documento e già presenti nella scheda */
  giaPresenti: string[];
};

const APPEND_KEYS = new Set([
  "datiQuantitativiReperti",
  "descrizione",
  "interpretazione",
  "componentiOrganiciAltro",
  "componentiInorganiciAltro",
  "campionatureN",
]);

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function display(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export type CrosscheckFound = {
  key: string;
  value: string | number | boolean | string[];
  confidence: AiFieldConfidence;
  source: string;
  pagina: number | null;
};

export function compareWithUS(us: UnitaStratigrafica, found: CrosscheckFound[]): CrosscheckUSResult {
  const proposte: CrosscheckProposal[] = [];
  const giaPresenti: string[] = [];

  for (const f of found) {
    const kind = crosscheckFieldKind(f.key);
    if (!kind) continue;
    const label = crosscheckFieldLabel(f.key);
    const current = readUSFieldForCompare(us, f.key);
    const base = { campo: f.key, label, confidenza: f.confidence, fonte: f.source, pagina: f.pagina };
    const autoSelect = f.confidence !== "bassa";

    if (kind === "boolean") {
      if (f.value !== true) continue;
      if (current === true) giaPresenti.push(label);
      else proposte.push({ ...base, tipo: "mancante", valoreAttuale: "No", valoreProposto: "Sì", valoreDaApplicare: true, selezionataDefault: autoSelect });
      continue;
    }

    if (kind === "multiselect") {
      const proposed = Array.isArray(f.value) ? f.value : [String(f.value)];
      const cur = Array.isArray(current) ? current : [];
      const missing = proposed.filter((p) => !cur.includes(p));
      if (!missing.length) giaPresenti.push(label);
      else proposte.push({ ...base, tipo: "mancante", valoreAttuale: display(cur), valoreProposto: display(missing), valoreDaApplicare: [...cur, ...missing], selezionataDefault: autoSelect });
      continue;
    }

    const proposedText = display(f.value).trim();
    const currentText = display(current).trim();
    if (!proposedText) continue;

    if (!currentText) {
      proposte.push({ ...base, tipo: "mancante", valoreAttuale: "", valoreProposto: proposedText, valoreDaApplicare: f.value, selezionataDefault: autoSelect });
      continue;
    }
    if (norm(currentText).includes(norm(proposedText))) {
      giaPresenti.push(label);
      continue;
    }
    if (kind === "text" && APPEND_KEYS.has(f.key)) {
      proposte.push({ ...base, tipo: "integrazione", valoreAttuale: currentText, valoreProposto: proposedText, valoreDaApplicare: `${currentText}\n${proposedText}`, selezionataDefault: autoSelect });
    } else {
      proposte.push({ ...base, tipo: "diverso", valoreAttuale: currentText, valoreProposto: proposedText, valoreDaApplicare: f.value, selezionataDefault: false });
    }
  }

  return { usId: us.id, codiceUS: us.codiceUS, definizione: us.definizione ?? null, proposte, giaPresenti };
}
