import type { InsertUS, UnitaStratigrafica } from "@shared/schema";
import type { IStorage } from "./storage";
import { generateWithGemini } from "./gemini";
import { logger } from "./logger";
import { buildUsExtractPrompt } from "./prompts/us_extract_prompt";

type AiProvider = "gemini" | "openai" | "claude" | "none";
type AiConfidence = "alta" | "media" | "bassa";

type RawExtractedUS = {
  codiceUS?: unknown;
  numeroUS?: unknown;
  tipo?: unknown;
  definizione?: unknown;
  descrizione?: unknown;
  interpretazione?: unknown;
  quota?: unknown;
  quotaPianoCampagna?: unknown;
  settore?: unknown;
  coperto_da?: unknown;
  copre?: unknown;
  si_lega_a?: unknown;
  uguale_a?: unknown;
  periodoIniziale?: unknown;
  periodoFinale?: unknown;
  materialiRinvenuti?: unknown;
  campioni?: unknown;
  schedaData?: unknown;
  confidence?: unknown;
  source?: unknown;
};

type NormalizedExtractedUS = {
  codiceUS: string;
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: number | null;
  quotaPianoCampagna: number | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
  schedaData: Record<string, string>;
  confidence: AiConfidence;
  source: string;
};

export type USImportPreviewItem = {
  tempId: string;
  codiceUS: string;
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: number | null;
  quotaPianoCampagna: number | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
  schedaData: Record<string, string>;
  confidence: AiConfidence;
  source: string;
  status: "ready" | "duplicate_existing";
  reason?: string;
};

export type USImportPreview = {
  source: "text" | "docx" | "google-doc";
  textLength: number;
  extractedCount: number;
  items: USImportPreviewItem[];
  warnings: string[];
};

export type USImportApplyInputItem = {
  tempId?: unknown;
  codiceUS?: unknown;
  tipo?: unknown;
  definizione?: unknown;
  descrizione?: unknown;
  interpretazione?: unknown;
  quota?: unknown;
  quotaPianoCampagna?: unknown;
  settore?: unknown;
  coperto_da?: unknown;
  copre?: unknown;
  si_lega_a?: unknown;
  uguale_a?: unknown;
  periodoIniziale?: unknown;
  periodoFinale?: unknown;
  materialiRinvenuti?: unknown;
  campioni?: unknown;
  schedaData?: unknown;
  include?: unknown;
};

export type USImportApplyResult = {
  created: number;
  skipped: number;
  errors: string[];
  createdCodes: string[];
};

function resolveProvider(): AiProvider {
  const envProvider = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const hasGemini = !!String(process.env.GEMINI_API_KEY || "").trim();
  const hasOpenAI = !!String(process.env.OPENAI_API_KEY || "").trim();
  const hasClaude = !!String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (envProvider === "gemini") return hasGemini ? "gemini" : "none";
  if (envProvider === "openai") return hasOpenAI ? "openai" : "none";
  if (envProvider === "claude") return hasClaude ? "claude" : "none";
  if (hasGemini) return "gemini";
  if (hasOpenAI) return "openai";
  if (hasClaude) return "claude";
  return "none";
}

async function callAI(prompt: string, maxTokens = 2600): Promise<string> {
  const provider = resolveProvider();

  if (provider === "gemini") {
    return generateWithGemini(prompt);
  }

  if (provider === "openai") {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = String(process.env.OPENAI_MODEL || "").trim() || "gpt-4o-mini";
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content || "";
  }

  if (provider === "claude") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  throw new Error("Nessun provider AI configurato");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const text = String(raw || "").trim();
  if (!text) return {};

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = toNullableString(value);
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConfidence(value: unknown): AiConfidence {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "alta" || normalized === "high") return "alta";
  if (normalized === "bassa" || normalized === "low") return "bassa";
  return "media";
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function extractUsNumberFromCode(code: string): number | null {
  const match = code.match(/\b(?:US|T|SB|SF)\.?\s*([0-9]{1,5})\b/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function formatUsCodeFromNumber(num: number): string {
  return `US ${String(num).padStart(3, "0")}`;
}

function normalizeCodiceCandidate(raw: RawExtractedUS): string | null {
  const fromCode = toNullableString(raw.codiceUS);
  if (fromCode) {
    const parsedNum = extractUsNumberFromCode(fromCode);
    if (parsedNum != null) {
      return formatUsCodeFromNumber(parsedNum);
    }
    const normalized = normalizeCode(fromCode);
    if (normalized) return normalized;
  }

  const fromNumber = toNullableNumber(raw.numeroUS);
  if (fromNumber != null && Number.isInteger(fromNumber) && fromNumber > 0) {
    return formatUsCodeFromNumber(fromNumber);
  }

  return null;
}

function sanitizeSchedaData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(value as Record<string, unknown>)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;
    const cleanVal = toNullableString(rawVal);
    if (!cleanVal) continue;
    out[cleanKey] = cleanVal;
  }
  return out;
}

function parseRawCandidates(raw: Record<string, unknown>): RawExtractedUS[] {
  const direct = raw.us;
  if (Array.isArray(direct)) {
    return direct.filter((item) => item && typeof item === "object") as RawExtractedUS[];
  }

  if (Array.isArray(raw.items)) {
    return raw.items.filter((item) => item && typeof item === "object") as RawExtractedUS[];
  }

  if (Array.isArray(raw)) {
    return raw.filter((item) => item && typeof item === "object") as RawExtractedUS[];
  }

  return [];
}

function highestConfidence(a: AiConfidence, b: AiConfidence): AiConfidence {
  const rank: Record<AiConfidence, number> = { alta: 0, media: 1, bassa: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function chooseLonger(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function mergeCandidates(a: NormalizedExtractedUS, b: NormalizedExtractedUS): NormalizedExtractedUS {
  return {
    ...a,
    tipo: a.tipo || b.tipo,
    definizione: chooseLonger(a.definizione, b.definizione),
    descrizione: chooseLonger(a.descrizione, b.descrizione),
    interpretazione: chooseLonger(a.interpretazione, b.interpretazione),
    quota: a.quota ?? b.quota,
    quotaPianoCampagna: a.quotaPianoCampagna ?? b.quotaPianoCampagna,
    settore: a.settore || b.settore,
    coperto_da: chooseLonger(a.coperto_da, b.coperto_da),
    copre: chooseLonger(a.copre, b.copre),
    si_lega_a: chooseLonger(a.si_lega_a, b.si_lega_a),
    uguale_a: chooseLonger(a.uguale_a, b.uguale_a),
    periodoIniziale: chooseLonger(a.periodoIniziale, b.periodoIniziale),
    periodoFinale: chooseLonger(a.periodoFinale, b.periodoFinale),
    materialiRinvenuti: chooseLonger(a.materialiRinvenuti, b.materialiRinvenuti),
    campioni: chooseLonger(a.campioni, b.campioni),
    schedaData: { ...a.schedaData, ...b.schedaData },
    confidence: highestConfidence(a.confidence, b.confidence),
    source: chooseLonger(a.source, b.source) || "Deduzione automatica",
  };
}

function normalizeSingleCandidate(raw: RawExtractedUS, codiceUS: string): NormalizedExtractedUS {
  return {
    codiceUS,
    tipo: toNullableString(raw.tipo),
    definizione: toNullableString(raw.definizione),
    descrizione: toNullableString(raw.descrizione),
    interpretazione: toNullableString(raw.interpretazione),
    quota: toNullableNumber(raw.quota),
    quotaPianoCampagna: toNullableNumber(raw.quotaPianoCampagna),
    settore: toNullableString(raw.settore),
    coperto_da: toNullableString(raw.coperto_da),
    copre: toNullableString(raw.copre),
    si_lega_a: toNullableString(raw.si_lega_a),
    uguale_a: toNullableString(raw.uguale_a),
    periodoIniziale: toNullableString(raw.periodoIniziale),
    periodoFinale: toNullableString(raw.periodoFinale),
    materialiRinvenuti: toNullableString(raw.materialiRinvenuti),
    campioni: toNullableString(raw.campioni),
    schedaData: sanitizeSchedaData(raw.schedaData),
    confidence: normalizeConfidence(raw.confidence),
    source: toNullableString(raw.source) || "Deduzione automatica",
  };
}

function parseCodesFromTextFallback(text: string): RawExtractedUS[] {
  const matches = Array.from(text.matchAll(/\bUS\s*([0-9]{1,5})\b/gi));
  const out: RawExtractedUS[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    const num = Number(match[1]);
    if (!Number.isInteger(num) || num <= 0 || seen.has(num)) continue;
    seen.add(num);
    out.push({
      numeroUS: num,
      confidence: "bassa",
      source: `Riferimento testuale: ${match[0]}`,
    });
  }
  return out;
}

function nextUsNumber(existingUs: UnitaStratigrafica[], candidates: RawExtractedUS[]): number {
  let maxFound = 0;

  for (const us of existingUs) {
    const num = extractUsNumberFromCode(us.codiceUS || "");
    if (num != null && num > maxFound) maxFound = num;
  }

  for (const candidate of candidates) {
    const fromCode = toNullableString(candidate.codiceUS);
    if (fromCode) {
      const num = extractUsNumberFromCode(fromCode);
      if (num != null && num > maxFound) maxFound = num;
    }
    const fromNumber = toNullableNumber(candidate.numeroUS);
    if (fromNumber != null && Number.isInteger(fromNumber) && fromNumber > maxFound) {
      maxFound = fromNumber;
    }
  }

  return maxFound + 1;
}

function sortByCode(a: NormalizedExtractedUS, b: NormalizedExtractedUS): number {
  const aNum = extractUsNumberFromCode(a.codiceUS);
  const bNum = extractUsNumberFromCode(b.codiceUS);
  if (aNum != null && bNum != null) return aNum - bNum;
  return a.codiceUS.localeCompare(b.codiceUS);
}

async function extractRawCandidatesWithAi(text: string): Promise<RawExtractedUS[]> {
  const prompt = buildUsExtractPrompt(text);
  const raw = await callAI(prompt, 3200);
  const parsed = parseJsonObject(raw);
  return parseRawCandidates(parsed);
}

function toPreviewItem(item: NormalizedExtractedUS, existingCodes: Set<string>, index: number): USImportPreviewItem {
  const codeKey = normalizeCode(item.codiceUS);
  const duplicateExisting = existingCodes.has(codeKey);
  return {
    tempId: `us-import-${index + 1}-${codeKey.replace(/\s+/g, "-")}`,
    codiceUS: item.codiceUS,
    tipo: item.tipo,
    definizione: item.definizione,
    descrizione: item.descrizione,
    interpretazione: item.interpretazione,
    quota: item.quota,
    quotaPianoCampagna: item.quotaPianoCampagna,
    settore: item.settore,
    coperto_da: item.coperto_da,
    copre: item.copre,
    si_lega_a: item.si_lega_a,
    uguale_a: item.uguale_a,
    periodoIniziale: item.periodoIniziale,
    periodoFinale: item.periodoFinale,
    materialiRinvenuti: item.materialiRinvenuti,
    campioni: item.campioni,
    schedaData: item.schedaData,
    confidence: item.confidence,
    source: item.source,
    status: duplicateExisting ? "duplicate_existing" : "ready",
    reason: duplicateExisting ? "Codice US già presente nel cantiere" : undefined,
  };
}

export async function buildUSImportPreview(input: {
  source: "text" | "docx" | "google-doc";
  text: string;
  existingUs: UnitaStratigrafica[];
}): Promise<USImportPreview> {
  const text = String(input.text || "").trim();
  if (!text) {
    return {
      source: input.source,
      textLength: 0,
      extractedCount: 0,
      items: [],
      warnings: ["Testo sorgente vuoto: impossibile estrarre US."],
    };
  }

  let rawCandidates: RawExtractedUS[] = [];
  const warnings: string[] = [];

  try {
    rawCandidates = await extractRawCandidatesWithAi(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Estrazione multipla US fallita, fallback regex", { message: msg });
    warnings.push("Estrazione AI non disponibile: usato fallback da riferimenti testuali.");
    rawCandidates = parseCodesFromTextFallback(text);
  }

  if (rawCandidates.length === 0) {
    return {
      source: input.source,
      textLength: text.length,
      extractedCount: 0,
      items: [],
      warnings: [...warnings, "Nessuna US riconosciuta nel testo."],
    };
  }

  const existingCodes = new Set(input.existingUs.map((us) => normalizeCode(us.codiceUS || "")));
  const usedCodes = new Set<string>();
  const byCode = new Map<string, NormalizedExtractedUS>();
  let nextNumber = nextUsNumber(input.existingUs, rawCandidates);

  for (const candidate of rawCandidates) {
    let code = normalizeCodiceCandidate(candidate);
    if (!code) {
      while (usedCodes.has(normalizeCode(formatUsCodeFromNumber(nextNumber))) || existingCodes.has(normalizeCode(formatUsCodeFromNumber(nextNumber)))) {
        nextNumber += 1;
      }
      code = formatUsCodeFromNumber(nextNumber);
      nextNumber += 1;
    }

    const normalizedCode = normalizeCode(code);
    usedCodes.add(normalizedCode);

    const normalized = normalizeSingleCandidate(candidate, code);
    const existing = byCode.get(normalizedCode);
    if (existing) {
      byCode.set(normalizedCode, mergeCandidates(existing, normalized));
    } else {
      byCode.set(normalizedCode, normalized);
    }
  }

  if (byCode.size < rawCandidates.length) {
    warnings.push(`Rimosse ${rawCandidates.length - byCode.size} duplicazioni interne della stessa US.`);
  }

  const normalizedItems = Array.from(byCode.values()).sort(sortByCode);
  const items = normalizedItems.map((item, index) => toPreviewItem(item, existingCodes, index));

  return {
    source: input.source,
    textLength: text.length,
    extractedCount: rawCandidates.length,
    items,
    warnings,
  };
}

function sanitizeApplyItem(raw: USImportApplyInputItem): USImportPreviewItem | null {
  if (!raw || typeof raw !== "object") return null;
  const code = toNullableString(raw.codiceUS);
  if (!code) return null;

  const normalizedCode = normalizeCodiceCandidate({ codiceUS: code });
  if (!normalizedCode) return null;

  return {
    tempId: toNullableString(raw.tempId) || normalizedCode,
    codiceUS: normalizedCode,
    tipo: toNullableString(raw.tipo),
    definizione: toNullableString(raw.definizione),
    descrizione: toNullableString(raw.descrizione),
    interpretazione: toNullableString(raw.interpretazione),
    quota: toNullableNumber(raw.quota),
    quotaPianoCampagna: toNullableNumber(raw.quotaPianoCampagna),
    settore: toNullableString(raw.settore),
    coperto_da: toNullableString(raw.coperto_da),
    copre: toNullableString(raw.copre),
    si_lega_a: toNullableString(raw.si_lega_a),
    uguale_a: toNullableString(raw.uguale_a),
    periodoIniziale: toNullableString(raw.periodoIniziale),
    periodoFinale: toNullableString(raw.periodoFinale),
    materialiRinvenuti: toNullableString(raw.materialiRinvenuti),
    campioni: toNullableString(raw.campioni),
    schedaData: sanitizeSchedaData(raw.schedaData),
    confidence: "media",
    source: "Conferma operatore",
    status: "ready",
    reason: undefined,
  };
}

function buildCreatePayload(
  item: USImportPreviewItem,
  cantiereId: number,
  giornataId: number,
  modelKey: string | null | undefined,
): InsertUS {
  const hasSchedaData = Object.keys(item.schedaData).length > 0;
  return {
    cantiereId,
    giornataId,
    codiceUS: item.codiceUS,
    tipo: item.tipo,
    definizione: item.definizione,
    descrizione: item.descrizione,
    interpretazione: item.interpretazione,
    quota: item.quota,
    quotaPianoCampagna: item.quotaPianoCampagna,
    settore: item.settore,
    coperto_da: item.coperto_da,
    copre: item.copre,
    si_lega_a: item.si_lega_a,
    uguale_a: item.uguale_a,
    periodoIniziale: item.periodoIniziale,
    periodoFinale: item.periodoFinale,
    materialiRinvenuti: item.materialiRinvenuti,
    campioni: item.campioni,
    schedaModelKey: modelKey || "base-us",
    schedaData: hasSchedaData ? JSON.stringify(item.schedaData) : null,
  };
}

export function applyUSImportPreview(
  input: {
    storage: IStorage;
    cantiereId: number;
    giornataId: number;
    items: unknown[];
    modelKey?: string | null;
  },
): USImportApplyResult {
  const existingCodes = new Set(
    input.storage.getUSList(input.cantiereId).map((us) => normalizeCode(us.codiceUS || "")),
  );

  const result: USImportApplyResult = {
    created: 0,
    skipped: 0,
    errors: [],
    createdCodes: [],
  };

  for (const rawItem of input.items) {
    const parsed = sanitizeApplyItem(rawItem as USImportApplyInputItem);
    if (!parsed) {
      result.skipped += 1;
      continue;
    }

    const codeKey = normalizeCode(parsed.codiceUS);
    if (existingCodes.has(codeKey)) {
      result.skipped += 1;
      continue;
    }

    try {
      input.storage.createUS(
        buildCreatePayload(parsed, input.cantiereId, input.giornataId, input.modelKey),
      );
      existingCodes.add(codeKey);
      result.created += 1;
      result.createdCodes.push(parsed.codiceUS);
    } catch (error) {
      result.errors.push(
        `${parsed.codiceUS}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

