import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
import type { ProjectDefinition } from "./projects";
import { BASE_US_FIELD_KEYS, type USModelDefinition } from "@shared/us_models";
import { getEntityFields } from "@shared/documentation_schema";
import { getProjectSchemaDefinition } from "./projects";
import { humanizeFieldKey } from "./docx_template_utils";
import { callAI } from "./ai";
import { getSetting } from "./ai_settings";
import { buildUSFlatFields } from "./docx_export";
import { getUSModel } from "./us_models";
import { knownFieldsForCantiere } from "./elenco_columns";
import { logger } from "./logger";

export type AssistantChatMessage = { role: "user" | "assistant"; content: string };

export type AssistantSelectionItem = { id: number; codiceUS: string; reason?: string };

export type AssistantProposedEdit = {
  id: number;
  codiceUS: string;
  field: string;
  label: string;
  currentValue: string;
  newValue: string;
  reason?: string;
};

export type AssistantResult = {
  answer: string;
  selection: AssistantSelectionItem[];
  proposedEdits: AssistantProposedEdit[];
  truncated: boolean;
  /** Quante US il modello ha effettivamente visto, rispetto a quelle disponibili. */
  contextInfo: { total: number; included: number; filtered: boolean; first?: string; last?: string };
};

const MAX_US_IN_CONTEXT = 120;
const MAX_FIELD_CHARS = 240;

/** Dizionario dei campi validi (chiave → label/tipo/obbligatorietà) per il cantiere attivo. */
export function assistantFieldDictionary(
  project: ProjectDefinition,
  cantiere: Pick<Cantiere, "usModelKey">,
  usList: UnitaStratigrafica[] = [],
): { model: USModelDefinition; byKey: Map<string, { label: string; type: string; required: boolean }> } {
  const model = getUSModel(project, cantiere.usModelKey);
  const byKey = new Map<string, { label: string; type: string; required: boolean }>();

  for (const f of knownFieldsForCantiere(project, cantiere)) {
    byKey.set(f.key, { label: f.label, type: "text", required: false });
  }
  // Colonne fisse della scheda non presenti nel template di export (es. tipo, periodi, materiali).
  for (const key of Array.from(BASE_US_FIELD_KEYS)) {
    if (!byKey.has(key)) byKey.set(key, { label: humanizeFieldKey(key), type: "text", required: false });
  }
  // Campi dello schema progetto (inclusi quelli aggiunti/personalizzati dall'utente).
  try {
    for (const f of getEntityFields(getProjectSchemaDefinition(project.id), "us")) {
      byKey.set(f.key, { label: f.label || humanizeFieldKey(f.key), type: String(f.type), required: !!f.required });
    }
  } catch (error) {
    logger.warn("assistantFieldDictionary: schema progetto non leggibile", {
      err: error instanceof Error ? error.message : String(error),
    });
  }
  for (const f of model.fields) {
    byKey.set(f.key, { label: f.label, type: f.type, required: !!f.required });
  }
  // Campi aggiunti a posteriori: qualunque chiave già salvata nelle schede (schedaData).
  for (const us of usList) {
    if (!us.schedaData) continue;
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(us.schedaData);
    } catch {
      continue;
    }
    for (const key of Object.keys(extra)) {
      if (!byKey.has(key)) byKey.set(key, { label: humanizeFieldKey(key), type: "text", required: false });
    }
  }
  return { model, byKey };
}

/** Interpreta "177-188, 200" come intervalli/numeri sulla parte numerica del codice US. null = nessun filtro. */
export function parseUsRange(raw: string | undefined): Array<[number, number]> | null {
  if (!raw || !raw.trim()) return null;
  const ranges: Array<[number, number]> = [];
  for (const part of raw.split(/[,;]/)) {
    const m = part.trim().match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    ranges.push([Math.min(a, b), Math.max(a, b)]);
  }
  return ranges.length > 0 ? ranges : null;
}

function usNumber(us: UnitaStratigrafica): number | null {
  const m = String(us.codiceUS ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function truncate(value: string, max = MAX_FIELD_CHARS): string {
  const s = value.trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function compactUsRecord(us: UnitaStratigrafica, cantiere: Cantiere | undefined): Record<string, unknown> {
  const flat = buildUSFlatFields(us, cantiere);
  const out: Record<string, unknown> = { id: us.id, codiceUS: us.codiceUS || `US ${us.id}` };
  if (us.qcStatus) out.qcStatus = us.qcStatus;
  for (const [key, raw] of Object.entries(flat)) {
    if (key === "codiceUS" || raw == null) continue;
    const text = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!text.trim()) continue;
    out[key] = truncate(text);
  }
  return out;
}

const SYSTEM_PROMPT_BASE =
  "Sei l'assistente di ArcheoDoc, software di documentazione di scavo archeologico. " +
  "Rispondi in italiano, con terminologia archeologica corretta. " +
  "Lavori su un dataset di Unità Stratigrafiche (US) fornito nel contesto. " +
  "Rispondi SEMPRE E SOLO con un oggetto JSON valido, senza testo prima o dopo, con questa forma:\n" +
  `{
  "answer": "risposta discorsiva per l'utente (testo semplice, niente markdown complesso)",
  "selection": [{ "id": <id US>, "codiceUS": "<codice>", "reason": "<perché rientra>" }],
  "proposedEdits": [{ "id": <id US>, "codiceUS": "<codice>", "field": "<chiave campo>", "newValue": "<nuovo valore>", "reason": "<motivazione>" }]
}\n` +
  "Regole: \n" +
  "- Popola \"selection\" quando l'utente chiede di individuare/elencare/selezionare US che soddisfano un criterio; altrimenti usa [].\n" +
  "- Popola \"proposedEdits\" SOLO se l'utente chiede esplicitamente di modificare/compilare/impostare dei campi. Non inventare dati non deducibili. Usa esclusivamente le chiavi campo elencate in CAMPI DISPONIBILI.\n" +
  "- Rapporti stratigrafici: i campi copre, coperto_da, taglia, tagliatoDa, riempie, riempitoDa, siAppoggiaA, gliSiAppoggia, si_lega_a, uguale_a descrivono i rapporti fisici di ciascuna US. Per compilare anterioreA/posterioreA DEDUCILI da questi: una US che copre/taglia/riempie/si appoggia a X è posteriore a X; una US coperta/tagliata/riempita da X è anteriore a X. Se i campi dei rapporti fisici sono presenti, usali senza chiedere conferma all'utente; chiedi dati solo se sono davvero vuoti. Se una US richiesta non è nel contesto, dì che non è stata analizzata.\n" +
  "- Non eseguire nulla: le modifiche saranno confermate manualmente dall'utente.\n" +
  "- \"id\" deve corrispondere sempre a una US presente nel contesto.";

function coerceString(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

function parseAssistantJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return JSON.parse(trimmed) as Record<string, unknown>;
    }
  } catch {
    /* fall through to regex */
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runUsAssistant(input: {
  project: ProjectDefinition;
  cantiere: Cantiere;
  usList: UnitaStratigrafica[];
  prompt: string;
  history?: AssistantChatMessage[];
  pageContext?: string;
  /** Filtro esplicito dell'utente sui codici US, es. "177-188, 200". */
  usRange?: string;
}): Promise<AssistantResult> {
  const { project, cantiere, prompt } = input;
  const ranges = parseUsRange(input.usRange);
  const scoped = ranges
    ? input.usList.filter((us) => {
        const n = usNumber(us);
        return n != null && ranges.some(([a, b]) => n >= a && n <= b);
      })
    : input.usList;
  const truncated = scoped.length > MAX_US_IN_CONTEXT;
  const usList = truncated ? scoped.slice(0, MAX_US_IN_CONTEXT) : scoped;

  const { byKey } = assistantFieldDictionary(project, cantiere, input.usList);
  const usById = new Map(usList.map((us) => [us.id, us]));

  const fieldsList = Array.from(byKey.entries())
    .map(([key, meta]) => `- ${key} — ${meta.label}${meta.required ? " (obbligatorio)" : ""} [${meta.type}]`)
    .join("\n");

  const usContext = usList.map((us) => compactUsRecord(us, cantiere));

  const history = (input.history || [])
    .slice(-6)
    .map((m) => `${m.role === "user" ? "UTENTE" : "ASSISTENTE"}: ${m.content}`)
    .join("\n");

  let systemPrompt = SYSTEM_PROMPT_BASE;
  try {
    const custom = getSetting("system_prompt");
    if (custom) systemPrompt = `${custom}\n\n${SYSTEM_PROMPT_BASE}`;
  } catch {
    /* keep base */
  }

  const userPrompt = [
    `CANTIERE: ${cantiere.nome || cantiere.codice || cantiere.id} (${cantiere.localita || "località n.d."})`,
    input.pageContext ? `SEZIONE CORRENTE: ${input.pageContext}` : "",
    ranges ? `NOTA: l'utente ha limitato il contesto alle US ${input.usRange!.trim()} (${scoped.length} su ${input.usList.length}).` : "",
    truncated ? `NOTA: dataset troncato alle prime ${MAX_US_IN_CONTEXT} US su ${scoped.length}. Le US non presenti NON sono state analizzate: dillo esplicitamente all'utente invece di dire che mancano i dati.` : "",
    "",
    "CAMPI DISPONIBILI (chiave — etichetta [tipo]):",
    fieldsList || "(nessun campo)",
    "",
    `US DEL CANTIERE (JSON, ${usContext.length} record):`,
    JSON.stringify(usContext),
    "",
    history ? `CONVERSAZIONE PRECEDENTE:\n${history}\n` : "",
    `RICHIESTA UTENTE:\n${prompt}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  let raw = "";
  try {
    raw = await callAI(userPrompt, 2600, systemPrompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("runUsAssistant callAI fallita", { err: msg });
    throw new Error(`Assistente IA non disponibile: ${msg}`);
  }

  const parsed = parseAssistantJson(raw);
  const answer = coerceString(parsed.answer).trim() || "Non sono riuscito a produrre una risposta utile.";

  const selection: AssistantSelectionItem[] = [];
  if (Array.isArray(parsed.selection)) {
    for (const item of parsed.selection) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      const us = usById.get(id);
      if (!us) continue;
      selection.push({
        id,
        codiceUS: us.codiceUS || coerceString(rec.codiceUS) || `US ${id}`,
        reason: coerceString(rec.reason).trim() || undefined,
      });
    }
  }

  const proposedEdits: AssistantProposedEdit[] = [];
  if (Array.isArray(parsed.proposedEdits)) {
    for (const item of parsed.proposedEdits) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      const us = usById.get(id);
      const field = coerceString(rec.field).trim();
      const meta = byKey.get(field);
      if (!us || !field || !meta) continue;
      const newValue = coerceString(rec.newValue);
      const currentValue = coerceString(buildUSFlatFields(us, cantiere)[field] ?? "");
      if (newValue.trim() === currentValue.trim()) continue;
      proposedEdits.push({
        id,
        codiceUS: us.codiceUS || `US ${id}`,
        field,
        label: meta.label,
        currentValue,
        newValue,
        reason: coerceString(rec.reason).trim() || undefined,
      });
    }
  }

  const codes = usList.map((u) => u.codiceUS).filter(Boolean) as string[];
  return {
    answer,
    selection,
    proposedEdits,
    truncated,
    contextInfo: {
      total: input.usList.length,
      included: usList.length,
      filtered: !!ranges,
      first: codes[0],
      last: codes[codes.length - 1],
    },
  };
}
