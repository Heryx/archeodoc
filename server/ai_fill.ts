import type { Cantiere, Giornata, InsertUS, UnitaStratigrafica } from "@shared/schema";

import { getSetting } from "./ai_settings";
import { generateWithGemini } from "./gemini";
import { logger } from "./logger";
import { buildUsFillPrompt } from "./prompts/us_fill_prompt";

export type AiFieldConfidence = "alta" | "media" | "bassa";

export type AiFieldSuggestion = {
  value: string | number | boolean | string[];
  confidence: AiFieldConfidence;
  source: string;
};

export type AiFillResult = Record<string, AiFieldSuggestion>;

type AllowedSuggestionValue = AiFieldSuggestion["value"];
type AIFillSource = "descrizione" | "diario" | "entrambi";

const BOOLEAN_FIELD_KEYS = new Set<string>([
  "compMaterialeCostruzione",
  "compCeramica",
  "compMetalli",
  "compVetro",
  "compCiottoli",
  "compGhiaia",
  "compFauna",
  "compOsso",
  "compCorno",
  "compSemi",
  "compFrutti",
  "compCarboni",
  "compLegno",
  "compTessuti",
  "scavataIntegralmente",
  "scavataParzialmente",
  "asportataConAltriStrati",
]);

const NUMBER_FIELD_KEYS = new Set<string>([
  "quota",
  "quotaPianoCampagna",
]);

const MULTISELECT_FIELD_OPTIONS: Record<string, string[]> = {
  componentiInorganici: [
    "Materiale da costruzione",
    "Ceramica",
    "Metalli",
    "Vetro",
    "Ciottoli",
    "Ghiaia",
    "Altro",
  ],
  componentiOrganici: [
    "Reperti faunistici",
    "Osso",
    "Corno",
    "Semi",
    "Frutti",
    "Carboni",
    "Legno",
    "Tessuti",
    "Altro",
  ],
  metodoScavo: [
    "Unita scavata integralmente",
    "Unita scavata parzialmente",
    "Corrisponde ad altra unita in altro punto",
    "Asportata insieme ad altri strati",
  ],
  elementiDatantiFonte: ["Sequenza stratigrafica", "Reperti diagnostici"],
};

const SELECT_FIELD_OPTIONS: Record<string, string[]> = {
  densitaInorganici: ["Fitta", "Media", "Rada"],
  densitaOrganici: ["Fitta", "Media", "Rada"],
  statoConservazione: ["Intatto", "Buono", "Discreto", "Mediocre", "Pessimo"],
  elementiDatanti: ["Sequenza stratigrafica", "Reperti diagnostici"],
  flottazioneTipo: ["Non effettuata", "Di tutta l'unita", "Parziale"],
  setacciaturaTipo: ["Non effettuata", "Di tutta l'unita", "Parziale"],
  affidabilitaStratigrafica: ["Nessuna", "Modesta", "Buona"],
};

const TEXT_FIELD_KEYS = new Set<string>([
  "definizione",
  "descrizione",
  "interpretazione",
  "criteriDistinzione",
  "modoFormazione",
  "consistenza",
  "colore",
  "misure",
  "danneggiatoDa",
  "datazione",
  "epoca",
  "periodoFase",
  "datiQuantitativiReperti",
  "campionatureN",
  "responsabileSabap",
  "responsabileArcheosistemi",
  "localita",
  "anno",
  "area",
  "piante",
  "sezioni",
  "prospetti",
  "nCatalogoGenerale",
  "nCatalogoInternazionale",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "gliSiAppoggia",
  "siAppoggia",
  "tagliatoDa",
  "taglia",
  "riempitoDa",
  "riempie",
  "sequenzaFisica",
  "componentiInorganiciAltro",
  "componentiOrganiciAltro",
  "metodoScavoAltro",
  "dataCompilazione",
]);

const SUGGESTION_ALIASES: Record<string, string> = {
  siAppoggiaA: "siAppoggia",
  definizionePosizione: "definizione",
  ugualeAStratigrafico: "sequenzaFisica",
};

const ALL_ALLOWED_KEYS = new Set<string>([
  ...Array.from(TEXT_FIELD_KEYS),
  ...Array.from(BOOLEAN_FIELD_KEYS),
  ...Array.from(NUMBER_FIELD_KEYS),
  ...Object.keys(MULTISELECT_FIELD_OPTIONS),
  ...Object.keys(SELECT_FIELD_OPTIONS),
]);

const TOP_LEVEL_KEYS = new Set<string>([
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "quotaPianoCampagna",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
]);

const DB_TEXT_MIRROR_KEYS = new Set<string>([
  "nCatalogoGenerale",
  "nCatalogoInternazionale",
  "localita",
  "anno",
  "area",
  "piante",
  "sezioni",
  "prospetti",
  "criteriDistinzione",
  "modoFormazione",
  "densitaInorganici",
  "densitaOrganici",
  "consistenza",
  "colore",
  "misure",
  "statoConservazione",
  "danneggiatoDa",
  "gliSiAppoggia",
  "siAppoggia",
  "tagliatoDa",
  "taglia",
  "riempitoDa",
  "riempie",
  "sequenzaFisica",
  "elementiDatanti",
  "elementiDatantiFonte",
  "epoca",
  "datazione",
  "periodoFase",
  "datiQuantitativiReperti",
  "campionatureN",
  "flottazioneTipo",
  "setacciaturaTipo",
  "affidabilitaStratigrafica",
  "responsabileSabap",
  "responsabileArcheosistemi",
]);

const SCHEDE_MIRROR_KEYS = new Set<string>([
  ...Array.from(DB_TEXT_MIRROR_KEYS),
  "componentiInorganiciAltro",
  "componentiOrganiciAltro",
  "metodoScavoAltro",
  "dataCompilazione",
  "componentiInorganici",
  "componentiOrganici",
  "metodoScavo",
]);

const INORGANIC_BY_BOOLEAN_KEY: Record<string, string> = {
  compMaterialeCostruzione: "Materiale da costruzione",
  compCeramica: "Ceramica",
  compMetalli: "Metalli",
  compVetro: "Vetro",
  compCiottoli: "Ciottoli",
  compGhiaia: "Ghiaia",
};

const ORGANIC_BY_BOOLEAN_KEY: Record<string, string> = {
  compFauna: "Reperti faunistici",
  compOsso: "Osso",
  compCorno: "Corno",
  compSemi: "Semi",
  compFrutti: "Frutti",
  compCarboni: "Carboni",
  compLegno: "Legno",
  compTessuti: "Tessuti",
};

function resolveProvider(): "gemini" | "claude" | "openai" | "none" {
  const envProvider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  const hasGemini  = !!process.env.GEMINI_API_KEY?.trim();
  const hasClaude  = !!process.env.ANTHROPIC_API_KEY?.trim();
  const hasOpenAI  = !!process.env.OPENAI_API_KEY?.trim();

  if (envProvider === "claude")  return hasClaude  ? "claude"  : "none";
  if (envProvider === "gemini")  return hasGemini  ? "gemini"  : "none";
  if (envProvider === "openai")  return hasOpenAI  ? "openai"  : "none";
  // Auto-detect priority: Gemini → OpenAI → Claude
  if (hasGemini) return "gemini";
  if (hasOpenAI) return "openai";
  if (hasClaude) return "claude";
  return "none";
}

async function callAI(prompt: string, maxTokens = 2200, systemPrompt?: string): Promise<string> {
  const provider = resolveProvider();
  if (provider === "gemini") {
    return generateWithGemini(prompt, systemPrompt);
  }

  if (provider === "openai") {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
    });
    return response.choices[0]?.message?.content || "";
  }

  if (provider === "claude") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  throw new Error("Nessun provider AI configurato");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const direct = raw.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) {
    return JSON.parse(direct) as Record<string, unknown>;
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return {};
  }
  return JSON.parse(match[0]) as Record<string, unknown>;
}

function normalizeConfidence(value: unknown): AiFieldConfidence {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "alta" || normalized === "high" || normalized === "alto") return "alta";
  if (normalized === "bassa" || normalized === "low" || normalized === "basso") return "bassa";
  return "media";
}

function normalizeTextValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
    return joined || null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "si", "s", "yes", "y", "vero"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "falso"].includes(normalized)) return false;
  return null;
}

function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = normalizeTextValue(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChoice(value: unknown, options: string[]): string | null {
  const text = normalizeTextValue(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  const direct = options.find((option) => option.toLowerCase() === normalized);
  if (direct) return direct;

  if (options.includes("Fitta")) {
    if (normalized.includes("fitt")) return "Fitta";
    if (normalized.includes("med")) return "Media";
    if (normalized.includes("rad")) return "Rada";
  }

  if (options.includes("Non effettuata")) {
    if (normalized.includes("non")) return "Non effettuata";
    if (normalized.includes("integr") || normalized.includes("tutta")) return "Di tutta l'unita";
    if (normalized.includes("parz")) return "Parziale";
  }

  if (options.includes("Nessuna")) {
    if (normalized.includes("nessun") || normalized.includes("null")) return "Nessuna";
    if (normalized.includes("modest") || normalized.includes("media")) return "Modesta";
    if (normalized.includes("buon") || normalized.includes("ottim")) return "Buona";
  }

  if (options.includes("Intatto")) {
    if (normalized.includes("intatt")) return "Intatto";
    if (normalized.includes("buon")) return "Buono";
    if (normalized.includes("discret")) return "Discreto";
    if (normalized.includes("mediocr")) return "Mediocre";
    if (normalized.includes("pessim") || normalized.includes("cattiv")) return "Pessimo";
  }

  return null;
}

function normalizeMultiSelect(value: unknown, options: string[]): string[] | null {
  const values: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = normalizeTextValue(item);
      if (text) values.push(text);
    }
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const text = normalizeTextValue(item);
          if (text) values.push(text);
        }
      } else {
        values.push(...raw.split(/[|,;\n]+/g).map((item) => item.trim()).filter(Boolean));
      }
    } catch {
      values.push(...raw.split(/[|,;\n]+/g).map((item) => item.trim()).filter(Boolean));
    }
  } else {
    const text = normalizeTextValue(value);
    if (text) values.push(text);
  }

  const normalized = values
    .map((item) => normalizeChoice(item, options))
    .filter((item): item is string => !!item);
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : null;
}

function normalizeSuggestionValue(key: string, value: unknown): AllowedSuggestionValue | null {
  if (NUMBER_FIELD_KEYS.has(key)) {
    return normalizeNumberValue(value);
  }

  if (BOOLEAN_FIELD_KEYS.has(key)) {
    return normalizeBooleanValue(value);
  }

  if (Object.prototype.hasOwnProperty.call(SELECT_FIELD_OPTIONS, key)) {
    return normalizeChoice(value, SELECT_FIELD_OPTIONS[key]);
  }

  if (Object.prototype.hasOwnProperty.call(MULTISELECT_FIELD_OPTIONS, key)) {
    return normalizeMultiSelect(value, MULTISELECT_FIELD_OPTIONS[key]);
  }

  if (TEXT_FIELD_KEYS.has(key)) {
    return normalizeTextValue(value);
  }

  return null;
}

function normalizeSuggestionEntry(key: string, raw: unknown): AiFieldSuggestion | null {
  let valueCandidate: unknown = raw;
  let confidenceCandidate: unknown = "media";
  let sourceCandidate: unknown = "";

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "value")) {
      valueCandidate = record.value;
      confidenceCandidate = record.confidence;
      sourceCandidate = record.source;
    }
  }

  const normalizedValue = normalizeSuggestionValue(key, valueCandidate);
  if (normalizedValue == null) return null;

  const source = normalizeTextValue(sourceCandidate) || "Deduzione automatica";
  return {
    value: normalizedValue,
    confidence: normalizeConfidence(confidenceCandidate),
    source,
  };
}

function stringifyMultiSelect(values: string[]): string {
  const cleaned = Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
  return cleaned.length > 0 ? JSON.stringify(cleaned) : "";
}

function parseMultiSelect(raw: unknown): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // fallback
  }
  return text.split(/[|,;\n]+/g).map((item) => item.trim()).filter(Boolean);
}

function parseSchedaData(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, fieldValue]) => {
      if (fieldValue == null) return acc;
      acc[key] = String(fieldValue);
      return acc;
    }, {});
  }
  if (typeof value !== "string") return {};

  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, fieldValue]) => {
      if (fieldValue == null) return acc;
      acc[key] = Array.isArray(fieldValue) ? JSON.stringify(fieldValue) : String(fieldValue);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function serializeSchedaData(data: Record<string, string>): string | null {
  const cleaned = Object.entries(data).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalized = String(value || "").trim();
    if (!normalized) return acc;
    acc[key] = normalized;
    return acc;
  }, {});
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

function setMultiSelectOption(
  schedaData: Record<string, string>,
  fieldKey: string,
  option: string,
  enabled: boolean,
) {
  const current = parseMultiSelect(schedaData[fieldKey]);
  const set = new Set(current);
  if (enabled) set.add(option);
  else set.delete(option);
  const next = Array.from(set);
  schedaData[fieldKey] = stringifyMultiSelect(next);
}

function normalizeIncomingKey(rawKey: string): string {
  return SUGGESTION_ALIASES[rawKey] || rawKey;
}

function deriveStructuredColumnsFromSchedaData(schedaData: Record<string, string>): Partial<InsertUS> {
  const patch: Record<string, unknown> = {};

  DB_TEXT_MIRROR_KEYS.forEach((key) => {
    if (!schedaData[key]) return;
    patch[key] = schedaData[key];
  });

  const inorganici = parseMultiSelect(schedaData.componentiInorganici);
  for (const [boolKey, option] of Object.entries(INORGANIC_BY_BOOLEAN_KEY)) {
    patch[boolKey] = inorganici.includes(option);
  }
  if (schedaData.componentiInorganiciAltro) {
    patch.compAltroInorganico = schedaData.componentiInorganiciAltro;
  }

  const organici = parseMultiSelect(schedaData.componentiOrganici);
  for (const [boolKey, option] of Object.entries(ORGANIC_BY_BOOLEAN_KEY)) {
    patch[boolKey] = organici.includes(option);
  }
  if (schedaData.componentiOrganiciAltro) {
    patch.compAltroOrganico = schedaData.componentiOrganiciAltro;
  }

  const metodoScavo = parseMultiSelect(schedaData.metodoScavo);
  patch.scavataIntegralmente = metodoScavo.includes("Unita scavata integralmente");
  patch.scavataParzialmente = metodoScavo.includes("Unita scavata parzialmente");
  patch.corrispondeAltraUnita = metodoScavo.includes("Corrisponde ad altra unita in altro punto") ? "si" : null;
  patch.asportataConAltriStrati = metodoScavo.includes("Asportata insieme ad altri strati");
  patch.altroScavo = schedaData.metodoScavoAltro || null;

  const elementiFonte = parseMultiSelect(schedaData.elementiDatantiFonte);
  patch.elementiDatantiFonte = elementiFonte.length > 0 ? elementiFonte.join(", ") : null;

  if (schedaData.siAppoggiaA && !patch.siAppoggia) {
    patch.siAppoggia = schedaData.siAppoggiaA;
  }
  if (schedaData.ugualeAStratigrafico && !patch.sequenzaFisica) {
    patch.sequenzaFisica = schedaData.ugualeAStratigrafico;
  }

  return patch as Partial<InsertUS>;
}

function buildSourceText(us: UnitaStratigrafica, giornata: Giornata | undefined, source: AIFillSource): string {
  const sections: string[] = [];

  const descrizione = String(us.descrizione || "").trim();
  if ((source === "descrizione" || source === "entrambi") && descrizione) {
    sections.push(`DESCRIZIONE US (${us.codiceUS}):\n${descrizione}`);
  }

  const noteGiornata = String(giornata?.note || "").trim();
  if ((source === "diario" || source === "entrambi") && noteGiornata) {
    sections.push(`DIARIO GIORNATA (${giornata?.data || "senza data"}):\n${noteGiornata}`);
  }

  if (sections.length === 0) {
    sections.push(
      `US ${us.codiceUS}\n` +
      `Definizione: ${us.definizione || ""}\n` +
      `Descrizione: ${us.descrizione || ""}\n` +
      `Interpretazione: ${us.interpretazione || ""}`,
    );
  }

  return sections.join("\n\n");
}

function mergeAutomaticSuggestions(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
  giornata: Giornata | undefined,
  existing: AiFillResult,
): AiFillResult {
  const merged: AiFillResult = { ...existing };
  const schedaData = parseSchedaData(us.schedaData);

  const autoSet = (key: string, value: string, source: string) => {
    if (merged[key] || String(schedaData[key] || "").trim()) return;
    merged[key] = {
      value,
      confidence: "alta",
      source,
    };
  };

  if (giornata?.data && giornata.data.trim()) {
    autoSet("dataCompilazione", giornata.data.trim(), "Data eredita dalla giornata associata");
  }

  const year = String(cantiere?.dataInizio || "").trim().slice(0, 4);
  if (!us.anno && /^\d{4}$/.test(year)) {
    autoSet("anno", year, "Anno dedotto dalla data inizio cantiere");
  }
  if (!us.localita && cantiere?.localita) {
    autoSet("localita", cantiere.localita, "Localita dedotta dal cantiere");
  }
  if (!us.responsabileArcheosistemi && cantiere?.responsabile) {
    autoSet("responsabileArcheosistemi", cantiere.responsabile, "Responsabile dedotto dal cantiere");
  }

  return merged;
}

export async function extractUSFieldsFromText(
  testo: string,
): Promise<AiFillResult> {
  const currentProvider = resolveProvider();
  if (currentProvider === "none" || !testo.trim()) return {};

  let systemPrompt = "Sei un assistente archeologico esperto nella compilazione di schede US.";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
  } catch {
    // fallback
  }

  try {
    const prompt = buildUsFillPrompt(testo);
    const raw = await callAI(prompt, 2200, systemPrompt);
    const parsed = parseJsonObject(raw);
    const candidateRaw =
      parsed && typeof parsed.fields === "object" && parsed.fields !== null
        ? parsed.fields
        : parsed;

    const candidate =
      candidateRaw && typeof candidateRaw === "object" && !Array.isArray(candidateRaw)
        ? (candidateRaw as Record<string, unknown>)
        : {};

    const out: AiFillResult = {};
    for (const [rawKey, rawValue] of Object.entries(candidate)) {
      const key = normalizeIncomingKey(String(rawKey || "").trim());
      if (!key || !ALL_ALLOWED_KEYS.has(key)) continue;

      const normalized = normalizeSuggestionEntry(key, rawValue);
      if (!normalized) continue;
      out[key] = normalized;
    }
    return out;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("extractUSFieldsFromText fallita", { provider: currentProvider, message: msg });
    throw error; // propagate so the route returns a real error message
  }
}

export async function buildUSAiFillSuggestions(input: {
  us: UnitaStratigrafica;
  cantiere?: Cantiere;
  giornata?: Giornata;
  source?: AIFillSource;
  sourceTextOverride?: string;
}): Promise<AiFillResult> {
  const source = input.source || "entrambi";
  const sourceText =
    String(input.sourceTextOverride || "").trim() || buildSourceText(input.us, input.giornata, source);
  const aiSuggestions = await extractUSFieldsFromText(sourceText);
  return mergeAutomaticSuggestions(input.us, input.cantiere, input.giornata, aiSuggestions);
}

export function applyAiFieldsToUS(
  us: UnitaStratigrafica,
  rawFields: Record<string, unknown>,
): Partial<InsertUS> {
  const schedaData = parseSchedaData(us.schedaData);
  const patch: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(rawFields || {})) {
    const key = normalizeIncomingKey(String(rawKey || "").trim());
    if (!key || !ALL_ALLOWED_KEYS.has(key)) continue;

    const normalizedValue = normalizeSuggestionValue(key, rawValue);
    if (normalizedValue == null) continue;

    if (TOP_LEVEL_KEYS.has(key)) {
      patch[key] = normalizedValue;
    }

    if (SCHEDE_MIRROR_KEYS.has(key)) {
      if (Array.isArray(normalizedValue)) {
        schedaData[key] = stringifyMultiSelect(normalizedValue);
      } else {
        schedaData[key] = String(normalizedValue);
      }
    }

    if (DB_TEXT_MIRROR_KEYS.has(key)) {
      patch[key] = normalizedValue;
    }

    if (BOOLEAN_FIELD_KEYS.has(key) && typeof normalizedValue === "boolean") {
      patch[key] = normalizedValue;

      const inorganicoOption = INORGANIC_BY_BOOLEAN_KEY[key];
      if (inorganicoOption) {
        setMultiSelectOption(schedaData, "componentiInorganici", inorganicoOption, normalizedValue);
      }
      const organicoOption = ORGANIC_BY_BOOLEAN_KEY[key];
      if (organicoOption) {
        setMultiSelectOption(schedaData, "componentiOrganici", organicoOption, normalizedValue);
      }
      if (key === "scavataIntegralmente") {
        setMultiSelectOption(schedaData, "metodoScavo", "Unita scavata integralmente", normalizedValue);
      }
      if (key === "scavataParzialmente") {
        setMultiSelectOption(schedaData, "metodoScavo", "Unita scavata parzialmente", normalizedValue);
      }
      if (key === "asportataConAltriStrati") {
        setMultiSelectOption(schedaData, "metodoScavo", "Asportata insieme ad altri strati", normalizedValue);
      }
    }
  }

  const normalizedSchedaData: Record<string, string> = {};
  for (const [key, value] of Object.entries(schedaData)) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    normalizedSchedaData[key] = trimmed;
  }

  const derived = deriveStructuredColumnsFromSchedaData(normalizedSchedaData);
  Object.assign(patch, derived);
  patch.schedaData = serializeSchedaData(normalizedSchedaData);

  return patch as Partial<InsertUS>;
}
