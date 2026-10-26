/**
 * Analisi AI dell'intera scheda US: proposte di modifica (grammatica, miglioramento del testo,
 * coerenza fra i campi, rapporti stratigrafici) che l'utente accetta, corregge a mano o rilancia.
 * Qui c'è la parte che non dipende dall'AI (controlli sui rapporti, validazione e applicazione
 * delle modifiche) e la costruzione/lettura delle risposte dell'AI.
 */
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
import { isCheckboxPlaceholder, isCheckedValue } from "@shared/us_models";
import { usCodeKey } from "@shared/normalize_us_code";
import type { IStorage } from "./storage";
import type { ProjectDefinition } from "./projects";
import { callAI } from "./ai";
import { getSetting } from "./ai_settings";
import { readProjectAiGuidelines } from "./ai_config_files";
import { aiFieldChoice } from "./ai_fill";
import { assistantFieldDictionary } from "./ai_assistant";
import { getEntityFields } from "@shared/documentation_schema";
import { getProjectSchemaDefinition } from "./projects";
import { buildUSFlatFields } from "./docx_export";
import { humanizeFieldKey } from "./docx_template_utils";
import { checkCicliStratigrafici } from "./qc";
import { INVERSE_MAP, type RelField } from "./relations_sync";
import { applyUsInlineFieldEdit } from "./us_field_edit";
import { logger } from "./logger";
import {
  buildUsProposalRevisePrompt,
  buildUsReviewPrompt,
  type ReviewFieldSpec,
} from "./prompts/us_review_prompt";

export type ReviewCategory = "grammatica" | "miglioramento" | "coerenza" | "rapporti" | "completezza";
export type ReviewSeverity = "alta" | "media" | "bassa";

export type ReviewProposal = {
  /** `${usId}:${campo}`: una sola proposta per campo di una US. */
  id: string;
  usId: number;
  codiceUS: string;
  field: string;
  label: string;
  type: string;
  /** Opzioni ammesse per i campi select/multiselect. */
  options?: string[];
  currentValue: string;
  newValue: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  reason: string;
  /** "controllo" = calcolata senza AI (rapporti); "ai" = proposta dall'AI. */
  origin: "controllo" | "ai";
  warning?: string;
};

export type ReviewFinding = {
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  message: string;
  field?: string;
};

export type ReviewResult = {
  summary: string;
  proposals: ReviewProposal[];
  findings: ReviewFinding[];
  checkedFields: number;
};

const REL_FIELDS: Array<{ key: RelField; label: string }> = [
  { key: "copre", label: "Copre" },
  { key: "coperto_da", label: "Coperto da" },
  { key: "taglia", label: "Taglia" },
  { key: "tagliatoDa", label: "Tagliato da" },
  { key: "riempie", label: "Riempie" },
  { key: "riempitoDa", label: "Riempito da" },
  { key: "siAppoggiaA", label: "Si appoggia a" },
  { key: "gliSiAppoggia", label: "Gli si appoggia" },
  { key: "si_lega_a", label: "Si lega a" },
  { key: "uguale_a", label: "Uguale a" },
  { key: "posterioreA", label: "Posteriore a" },
  { key: "anterioreA", label: "Anteriore a" },
];
const REL_LABEL = new Map<string, string>(REL_FIELDS.map((f) => [f.key, f.label]));
const REL_KEYS = new Set<string>(REL_FIELDS.map((f) => f.key));

/** Campi sempre presenti nella scheda, qualunque sia il modello. */
const CORE_FIELDS: Array<{ key: string; label: string; type: string }> = [
  { key: "tipo", label: "Tipo", type: "text" },
  { key: "definizione", label: "Definizione", type: "text" },
  { key: "descrizione", label: "Descrizione", type: "textarea" },
  { key: "interpretazione", label: "Interpretazione", type: "textarea" },
  { key: "quota", label: "Quota s.l.m. (m)", type: "text" },
  { key: "quotaPianoCampagna", label: "Quota da piano campagna (m)", type: "text" },
  { key: "settore", label: "Settore", type: "text" },
  { key: "periodoIniziale", label: "Periodo iniziale", type: "text" },
  { key: "periodoFinale", label: "Periodo finale", type: "text" },
  { key: "materialiRinvenuti", label: "Materiali rinvenuti", type: "text" },
  { key: "campioni", label: "Campioni", type: "text" },
];

/** Mai modificabili dall'analisi: identità della scheda, collegamenti e metadati di export. */
const NEVER_EDIT = new Set([
  "codiceUS", "giornataId", "dataExport", "cantiereCodice", "cantiereNome",
  "quoteSlm", "quotaSlm", "quotaSml", "quoteSml",
]);

const MAX_FIELD_CHARS = 2500;
const MAX_AI_PROPOSALS = 25;
const MAX_NEIGHBORS = 40;

// ── Lettura dei valori ───────────────────────────────────────────────────────

export type FlatCache = Map<number, Record<string, unknown>>;

function flatOf(us: UnitaStratigrafica, cantiere: Cantiere, cache: FlatCache): Record<string, unknown> {
  let flat = cache.get(us.id);
  if (!flat) {
    flat = buildUSFlatFields(us, cantiere);
    cache.set(us.id, flat);
  }
  return flat;
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function parseCodes(raw: unknown): string[] {
  const text = asText(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((c) => String(c).trim()).filter(Boolean);
  } catch {
    /* testo semplice */
  }
  return text.split(/[,;|\n\r]+/).map((c) => c.trim()).filter(Boolean);
}

function relValue(us: UnitaStratigrafica, cantiere: Cantiere, cache: FlatCache, key: string): string {
  const flat = flatOf(us, cantiere, cache);
  if (key === "siAppoggiaA") return asText(flat.siAppoggiaA) || asText(flat.siAppoggia);
  return asText(flat[key]);
}

function isCheckboxField(key: string, type: string): boolean {
  return type === "checkbox" || isCheckboxPlaceholder(key);
}

/** Valore del campo nella forma in cui lo si modifica ("true"/"false" per le caselle di spunta). */
function editValueOf(us: UnitaStratigrafica, cantiere: Cantiere, cache: FlatCache, spec: ReviewFieldSpec): string {
  if (REL_KEYS.has(spec.key)) return relValue(us, cantiere, cache, spec.key);
  const raw = flatOf(us, cantiere, cache)[spec.key];
  if (isCheckboxField(spec.key, spec.type)) return raw === "☑" || isCheckedValue(raw) ? "true" : "false";
  if (spec.type === "multiselect") {
    const list = parseList(raw);
    return list.length ? JSON.stringify(list) : "";
  }
  return asText(raw);
}

/** Elenco di voci memorizzato come array JSON (o testo con separatori) → voci distinte. */
function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  const text = asText(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    /* testo con separatori */
  }
  return text.split(/[|,;\n]+/).map((v) => v.trim()).filter(Boolean);
}

function describeValue(spec: ReviewFieldSpec, value: string): string {
  if (isCheckboxField(spec.key, spec.type)) return value === "true" ? "sì" : "no";
  if (spec.type === "multiselect") {
    const list = parseList(value);
    return list.length ? list.join(", ") : "(vuoto)";
  }
  const text = value.trim();
  if (!text) return "(vuoto)";
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}…` : text;
}

// ── Campi che la scheda mostra e che l'analisi può proporre di cambiare ────────────

export function reviewableFields(
  project: ProjectDefinition,
  cantiere: Cantiere,
  us: UnitaStratigrafica,
  usList: UnitaStratigrafica[],
  cache: FlatCache = new Map(),
): ReviewFieldSpec[] {
  const { model, byKey } = assistantFieldDictionary(project, cantiere, usList);
  const out = new Map<string, ReviewFieldSpec>();

  // Vocabolari ammessi: quelli del modello di scheda e quelli dello schema del progetto.
  const optionsByKey = new Map<string, string[]>();
  try {
    for (const f of getEntityFields(getProjectSchemaDefinition(project.id), "us")) {
      if (f.vocabulary?.length) optionsByKey.set(f.key, f.vocabulary);
    }
  } catch {
    /* schema non leggibile: nessun vocabolario */
  }
  for (const f of model.fields) if (f.options?.length) optionsByKey.set(f.key, f.options);

  const add = (spec: ReviewFieldSpec) => {
    if (NEVER_EDIT.has(spec.key) || out.has(spec.key)) return;
    const options = optionsByKey.get(spec.key);
    if (options && (spec.type === "select" || spec.type === "multiselect")) {
      out.set(spec.key, { ...spec, options });
      return;
    }
    // Campi a scelta dell'app (es. componentiInorganici) anche se il progetto li dichiara come testo libero.
    const known = aiFieldChoice(spec.key);
    out.set(spec.key, known ? { ...spec, type: known.kind, options: known.options } : spec);
  };

  for (const f of CORE_FIELDS) add(f);
  for (const f of REL_FIELDS) add({ key: f.key, label: f.label, type: "text" });
  for (const f of model.fields) add({ key: f.key, label: f.label, type: f.type });

  // Altri campi già compilati e noti al progetto; le caselle di spunta derivate non si toccano.
  const flat = flatOf(us, cantiere, cache);
  byKey.forEach((meta, key) => {
    if (out.has(key) || NEVER_EDIT.has(key) || isCheckboxPlaceholder(key)) return;
    if (!asText(flat[key]).trim()) return;
    add({ key, label: meta.label || humanizeFieldKey(key), type: meta.type });
  });

  return Array.from(out.values());
}

// ── Controlli sui rapporti stratigrafici (senza AI) ────────────────────────────

type RelationEdit = {
  target: UnitaStratigrafica;
  field: RelField;
  add: Map<string, string>;
  remove: Set<string>;
  reasons: string[];
  severity: ReviewSeverity;
};

export function analyzeUsRelations(
  us: UnitaStratigrafica,
  usList: UnitaStratigrafica[],
  cantiere: Cantiere,
  cache: FlatCache,
): { proposals: ReviewProposal[]; findings: ReviewFinding[]; summaryLines: string[] } {
  const selfKey = usCodeKey(us.codiceUS);
  const selfCode = us.codiceUS || `US ${us.id}`;
  const byCode = new Map<string, UnitaStratigrafica>();
  for (const other of usList) {
    const key = usCodeKey(other.codiceUS);
    if (key && !byCode.has(key)) byCode.set(key, other);
  }

  const edits = new Map<string, RelationEdit>();
  const findings: ReviewFinding[] = [];
  const summaryLines: string[] = [];
  let findingSeq = 0;

  const editFor = (target: UnitaStratigrafica, field: RelField): RelationEdit => {
    const id = `${target.id}:${field}`;
    let edit = edits.get(id);
    if (!edit) {
      edit = { target, field, add: new Map(), remove: new Set(), reasons: [], severity: "media" };
      edits.set(id, edit);
    }
    return edit;
  };
  const addFinding = (f: Omit<ReviewFinding, "id">) => {
    findings.push({ id: `rel-${++findingSeq}`, ...f });
    summaryLines.push(`- ${f.message}`);
  };

  // 1) Rapporti scritti in questa scheda.
  for (const { key: field } of REL_FIELDS) {
    const inverse = INVERSE_MAP[field];
    for (const raw of parseCodes(relValue(us, cantiere, cache, field))) {
      const key = usCodeKey(raw);
      if (!key) continue;

      if (key === selfKey) {
        const edit = editFor(us, field);
        edit.remove.add(key);
        edit.severity = "alta";
        edit.reasons.push(`"${raw}" è la stessa US: un rapporto con sé stessa non ha senso.`);
        continue;
      }

      const target = byCode.get(key);
      if (!target) {
        addFinding({
          category: "rapporti",
          severity: "alta",
          field,
          message: `${REL_LABEL.get(field)}: "${raw}" non esiste tra le US del cantiere.`,
        });
        continue;
      }

      // Rapporto inverso mancante sull'altra US.
      const inverseCodes = parseCodes(relValue(target, cantiere, cache, inverse));
      if (!inverseCodes.some((c) => usCodeKey(c) === selfKey)) {
        const edit = editFor(target, inverse);
        edit.add.set(selfKey, selfCode);
        edit.reasons.push(
          `${selfCode} ha "${REL_LABEL.get(field)}" ${target.codiceUS}, ma ${target.codiceUS} non riporta il rapporto inverso "${REL_LABEL.get(inverse)}" ${selfCode}.`,
        );
      }

      // Stesso codice nel rapporto e nel suo inverso (es. copre e coperto_da): contraddizione.
      if (inverse !== field && field < inverse) {
        const inverseHere = parseCodes(relValue(us, cantiere, cache, inverse));
        if (inverseHere.some((c) => usCodeKey(c) === key)) {
          addFinding({
            category: "rapporti",
            severity: "alta",
            field,
            message: `${target.codiceUS} compare sia in "${REL_LABEL.get(field)}" sia in "${REL_LABEL.get(inverse)}": i due rapporti si contraddicono.`,
          });
        }
      }
    }
  }

  // 2) Rapporti scritti dalle altre US verso questa e non riportati qui.
  for (const other of usList) {
    if (other.id === us.id || !usCodeKey(other.codiceUS)) continue;
    for (const { key: field } of REL_FIELDS) {
      if (!parseCodes(relValue(other, cantiere, cache, field)).some((c) => usCodeKey(c) === selfKey)) continue;
      const inverse = INVERSE_MAP[field];
      const mine = parseCodes(relValue(us, cantiere, cache, inverse));
      if (mine.some((c) => usCodeKey(c) === usCodeKey(other.codiceUS))) continue;
      const edit = editFor(us, inverse);
      edit.add.set(usCodeKey(other.codiceUS), other.codiceUS || `US ${other.id}`);
      edit.reasons.push(
        `${other.codiceUS} dichiara "${REL_LABEL.get(field)}" ${selfCode}, ma qui manca "${REL_LABEL.get(inverse)}" ${other.codiceUS}.`,
      );
    }
  }

  // 3) Cicli stratigrafici che coinvolgono questa US.
  try {
    for (const issue of checkCicliStratigrafici(usList)) {
      if (issue.usId !== us.id) continue;
      addFinding({ category: "rapporti", severity: "alta", message: issue.messaggio });
    }
  } catch (error) {
    logger.warn("analisi cicli stratigrafici non riuscita", {
      err: error instanceof Error ? error.message : String(error),
    });
  }

  const proposals: ReviewProposal[] = [];
  edits.forEach((edit) => {
    const spec: ReviewFieldSpec = { key: edit.field, label: REL_LABEL.get(edit.field) || edit.field, type: "text" };
    const current = relValue(edit.target, cantiere, cache, edit.field);
    const codes = parseCodes(current).filter((c) => !edit.remove.has(usCodeKey(c)));
    const present = new Set(codes.map(usCodeKey));
    edit.add.forEach((code, key) => {
      if (!present.has(key)) codes.push(code);
    });
    const next = codes.join(", ");
    if (next === parseCodes(current).join(", ")) return;
    proposals.push({
      id: `${edit.target.id}:${edit.field}`,
      usId: edit.target.id,
      codiceUS: edit.target.codiceUS || `US ${edit.target.id}`,
      field: edit.field,
      label: spec.label,
      type: spec.type,
      currentValue: current,
      newValue: next,
      category: "rapporti",
      severity: edit.severity,
      reason: edit.reasons.join(" "),
      origin: "controllo",
    });
    summaryLines.push(`- ${edit.reasons.join(" ")}`);
  });

  return { proposals, findings, summaryLines };
}

/** US collegate (in uscita e in entrata) con tipo e definizione, perché l'AI valuti i rapporti. */
function describeNeighbors(
  us: UnitaStratigrafica,
  usList: UnitaStratigrafica[],
  cantiere: Cantiere,
  cache: FlatCache,
): string {
  const byCode = new Map<string, UnitaStratigrafica>();
  for (const other of usList) {
    const key = usCodeKey(other.codiceUS);
    if (key && !byCode.has(key)) byCode.set(key, other);
  }
  const selfKey = usCodeKey(us.codiceUS);
  const lines = new Map<string, string>();
  const line = (other: UnitaStratigrafica) =>
    `${other.codiceUS} | ${other.tipo || "tipo n.d."} | ${(other.definizione || "definizione n.d.").slice(0, 90)}`;

  for (const { key } of REL_FIELDS) {
    for (const raw of parseCodes(relValue(us, cantiere, cache, key))) {
      const k = usCodeKey(raw);
      if (!k || k === selfKey || lines.has(k)) continue;
      const other = byCode.get(k);
      lines.set(k, other ? line(other) : `${raw} | NON PRESENTE NEL CANTIERE`);
    }
  }
  for (const other of usList) {
    if (other.id === us.id || lines.size >= MAX_NEIGHBORS) continue;
    const k = usCodeKey(other.codiceUS);
    if (!k || lines.has(k)) continue;
    const refersToUs = REL_FIELDS.some(({ key }) =>
      parseCodes(relValue(other, cantiere, cache, key)).some((c) => usCodeKey(c) === selfKey),
    );
    if (refersToUs) lines.set(k, line(other));
  }
  return Array.from(lines.values()).slice(0, MAX_NEIGHBORS).join("\n");
}

// ── Risposte dell'AI ─────────────────────────────────────────────────────────

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Risposta AI non in formato JSON");
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Risposta AI non valida (JSON incompleto): riprova o riduci le indicazioni aggiuntive");
  }
}

const CATEGORIES: ReviewCategory[] = ["grammatica", "miglioramento", "coerenza", "rapporti", "completezza"];
const SEVERITIES: ReviewSeverity[] = ["alta", "media", "bassa"];
const SEVERITY_ORDER: Record<ReviewSeverity, number> = { alta: 0, media: 1, bassa: 2 };

function pickCategory(value: unknown, fallback: ReviewCategory): ReviewCategory {
  const text = asText(value).trim().toLowerCase();
  return (CATEGORIES.find((c) => c === text) as ReviewCategory | undefined) ?? fallback;
}

function pickSeverity(value: unknown): ReviewSeverity {
  const text = asText(value).trim().toLowerCase();
  return (SEVERITIES.find((s) => s === text) as ReviewSeverity | undefined) ?? "media";
}

/** Porta il valore proposto nella forma che la scheda salva (caselle di spunta, elenco di codici). */
function normalizeProposedValue(spec: ReviewFieldSpec, raw: unknown): string {
  if (isCheckboxField(spec.key, spec.type)) return isCheckedValue(raw) ? "true" : "false";
  if (spec.type === "select") {
    const text = asText(raw).trim();
    if (!spec.options?.length) return text;
    return spec.options.find((o) => o.toLowerCase() === text.toLowerCase()) ?? "";
  }
  if (spec.type === "multiselect") {
    const wanted = parseList(raw);
    const chosen = spec.options?.length
      ? wanted
          .map((w) => spec.options!.find((o) => o.toLowerCase() === w.toLowerCase()))
          .filter((o): o is string => !!o)
      : wanted;
    return chosen.length ? JSON.stringify(Array.from(new Set(chosen))) : "";
  }
  if (REL_KEYS.has(spec.key)) {
    const seen = new Set<string>();
    return parseCodes(Array.isArray(raw) ? raw.join(", ") : raw)
      .filter((code) => {
        const key = usCodeKey(code);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(", ");
  }
  return asText(raw).trim();
}

function unknownCodesWarning(
  spec: ReviewFieldSpec,
  value: string,
  usList: UnitaStratigrafica[],
): string | undefined {
  if (!REL_KEYS.has(spec.key)) return undefined;
  const known = new Set(usList.map((u) => usCodeKey(u.codiceUS)));
  const unknown = parseCodes(value).filter((c) => !known.has(usCodeKey(c)));
  return unknown.length ? `Codici non presenti nel cantiere: ${unknown.join(", ")}` : undefined;
}

function presets(project: ProjectDefinition): { systemPrompt: string; schedaTemplate: string; guidelines: string } {
  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  let schedaTemplate = "";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
    schedaTemplate = getSetting("scheda_us_template") || "";
  } catch (error) {
    logger.warn("impostazioni AI non leggibili, uso i valori di default", {
      err: error instanceof Error ? error.message : String(error),
    });
  }
  return { systemPrompt, schedaTemplate, guidelines: readProjectAiGuidelines(project) };
}

// ── Analisi dell'intera scheda ───────────────────────────────────────────────

export async function reviewUsCard(input: {
  project: ProjectDefinition;
  cantiere: Cantiere;
  us: UnitaStratigrafica;
  usList: UnitaStratigrafica[];
  istruzioni?: string;
}): Promise<ReviewResult> {
  const { project, cantiere, us, usList } = input;
  const cache: FlatCache = new Map();

  const fields = reviewableFields(project, cantiere, us, usList, cache);
  const specByKey = new Map(fields.map((f) => [f.key, f]));
  const relations = analyzeUsRelations(us, usList, cantiere, cache);

  const scheda = fields
    .map((spec) => `- ${spec.key} — ${spec.label}: ${describeValue(spec, editValueOf(us, cantiere, cache, spec))}`)
    .join("\n");
  const { systemPrompt, schedaTemplate, guidelines } = presets(project);

  const prompt = buildUsReviewPrompt({
    scheda: `Codice US: ${us.codiceUS}\n${scheda}`,
    vicini: describeNeighbors(us, usList, cantiere, cache),
    controlli: relations.summaryLines.join("\n"),
    fields,
    istruzioni: input.istruzioni,
    schedaTemplate,
    guidelines,
    maxProposals: MAX_AI_PROPOSALS,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(await callAI(prompt, 4500, systemPrompt));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("reviewUsCard fallita", { usId: us.id, err: msg });
    throw new Error(`Impossibile analizzare la scheda con l'AI: ${msg}`);
  }

  const proposals: ReviewProposal[] = [...relations.proposals];
  const taken = new Set(proposals.map((p) => p.id));

  if (Array.isArray(parsed.proposals)) {
    for (const item of parsed.proposals) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const field = asText(rec.field).trim();
      const spec = specByKey.get(field);
      const id = `${us.id}:${field}`;
      if (!spec || taken.has(id)) continue;

      const currentValue = editValueOf(us, cantiere, cache, spec);
      const newValue = normalizeProposedValue(spec, rec.newValue);
      if (newValue === currentValue.trim() || (!newValue && !isCheckboxField(spec.key, spec.type))) continue;

      taken.add(id);
      proposals.push({
        id,
        usId: us.id,
        codiceUS: us.codiceUS || `US ${us.id}`,
        field,
        label: spec.label,
        type: spec.type,
        options: spec.options,
        currentValue,
        newValue,
        category: pickCategory(rec.category, "miglioramento"),
        severity: pickSeverity(rec.severity),
        reason: asText(rec.reason).trim() || "Modifica proposta dall'analisi AI.",
        origin: "ai",
        warning: unknownCodesWarning(spec, newValue, usList),
      });
      if (proposals.length >= MAX_AI_PROPOSALS + relations.proposals.length) break;
    }
  }
  proposals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const findings: ReviewFinding[] = [...relations.findings];
  if (Array.isArray(parsed.findings)) {
    for (const item of parsed.findings) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const message = asText(rec.message).trim();
      if (!message) continue;
      findings.push({
        id: `ai-${findings.length + 1}`,
        category: pickCategory(rec.category, "coerenza"),
        severity: pickSeverity(rec.severity),
        message,
        field: asText(rec.field).trim() || undefined,
      });
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    summary: asText(parsed.summary).trim() || "Analisi completata.",
    proposals,
    findings,
    checkedFields: fields.length,
  };
}

// ── Rilancio di una singola proposta ─────────────────────────────────────────

export async function reviseReviewProposal(input: {
  project: ProjectDefinition;
  cantiere: Cantiere;
  us: UnitaStratigrafica;
  usList: UnitaStratigrafica[];
  field: string;
  currentValue: string;
  proposedValue: string;
  reason?: string;
  userPrompt: string;
}): Promise<{ newValue: string; reason: string; warning?: string }> {
  const { project, cantiere, us, usList } = input;
  const cache: FlatCache = new Map();
  const spec = reviewableFields(project, cantiere, us, usList, cache).find((f) => f.key === input.field);
  if (!spec) throw new Error(`Campo '${input.field}' non modificabile`);

  const contesto = [
    `Codice US: ${us.codiceUS}`,
    ...CORE_FIELDS.filter((f) => f.key !== spec.key).map(
      (f) => `- ${f.label}: ${describeValue(f, editValueOf(us, cantiere, cache, f))}`,
    ),
    "Rapporti:",
    ...REL_FIELDS.filter((f) => f.key !== spec.key).map(
      (f) => `- ${f.label}: ${describeValue({ key: f.key, label: f.label, type: "text" }, relValue(us, cantiere, cache, f.key))}`,
    ),
  ].join("\n");

  const { systemPrompt, schedaTemplate, guidelines } = presets(project);
  const prompt = buildUsProposalRevisePrompt({
    codiceUS: us.codiceUS || `US ${us.id}`,
    field: spec,
    currentValue: input.currentValue,
    proposedValue: input.proposedValue,
    reason: input.reason,
    userPrompt: input.userPrompt,
    contesto,
    schedaTemplate,
    guidelines,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(await callAI(prompt, 2500, systemPrompt));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("reviseReviewProposal fallita", { usId: us.id, field: input.field, err: msg });
    throw new Error(`Impossibile rifare la proposta con l'AI: ${msg}`);
  }

  const newValue = normalizeProposedValue(spec, parsed.newValue);
  return {
    newValue,
    reason: asText(parsed.reason).trim() || "Proposta rifatta secondo l'indicazione dell'utente.",
    warning: unknownCodesWarning(spec, newValue, usList),
  };
}

// ── Applicazione delle modifiche scelte dall'utente ──────────────────────────────

export type ReviewEdit = { usId: number; field: string; value: string };

export function applyReviewEdits(input: {
  storage: IStorage;
  project: ProjectDefinition;
  cantiere: Cantiere;
  edits: ReviewEdit[];
}): {
  applied: Array<{ usId: number; codiceUS: string; field: string }>;
  failed: Array<{ usId: number; field: string; error: string }>;
  snapshots: Array<{ usId: number; field: string; before: string; after: string }>;
} {
  const { storage, project, cantiere } = input;
  const usList = storage.getUSList(cantiere.id);
  const cache: FlatCache = new Map();
  const applied: Array<{ usId: number; codiceUS: string; field: string }> = [];
  const failed: Array<{ usId: number; field: string; error: string }> = [];
  const snapshots: Array<{ usId: number; field: string; before: string; after: string }> = [];

  for (const edit of input.edits) {
    const usId = Number(edit.usId);
    const field = String(edit.field || "").trim();
    const us = Number.isFinite(usId) ? storage.getUS(usId) : undefined;
    if (!us || us.cantiereId !== cantiere.id) {
      failed.push({ usId, field, error: "US non trovata in questo cantiere" });
      continue;
    }
    const spec = reviewableFields(project, cantiere, us, usList, new Map()).find((f) => f.key === field);
    if (!spec) {
      failed.push({ usId, field, error: `Campo '${field}' non modificabile` });
      continue;
    }

    const value = normalizeProposedValue(spec, edit.value);
    const before = editValueOf(us, cantiere, cache, spec);
    try {
      const updated = applyUsInlineFieldEdit(storage, project, usId, field, value);
      if (!updated) {
        failed.push({ usId, field, error: "Aggiornamento non riuscito" });
        continue;
      }
      cache.delete(usId);
      applied.push({ usId, codiceUS: updated.codiceUS || `US ${usId}`, field });
      snapshots.push({ usId, field, before, after: value });
    } catch (error) {
      failed.push({ usId, field, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { applied, failed, snapshots };
}
