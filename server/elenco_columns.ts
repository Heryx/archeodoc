import fs from "fs";
import type { ProjectDefinition } from "./projects";
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
import { getUSModel } from "./us_models";
import { getUSTemplateFieldKeys, buildUSFlatFields } from "./docx_export";
import { humanizeFieldKey } from "./docx_template_utils";
import { extractTemplateLoopColumns } from "./docx_table_read";
import { elencoUsTemplatePath, readElencoTemplateChoice } from "./elenco_us_template_path";
import type { FieldCandidate } from "./field_similarity";

export type ElencoColumn = { key: string; label: string };

/** Colonne di riserva quando non è ancora stato caricato nessun template Elenco US. */
export const DEFAULT_ELENCO_COLUMNS: ElencoColumn[] = [
  { key: "codiceUS", label: "Codice US" },
  { key: "definizione", label: "Definizione" },
  { key: "descrizione", label: "Descrizione" },
];

/** Chiavi di flag booleani derivati (checkbox "☑/☐" nei template DOCX, es. chkVetro, chkBuono):
 * non sono campi di testo autonomi ma il riflesso di un altro campo (es. componenti, stato di
 * conservazione), quindi non hanno senso come bersaglio di un abbinamento colonna→campo. */
function isDerivedCheckboxKey(key: string): boolean {
  return /^chk[A-Z]/.test(key);
}

/** Colonne generiche sempre utili da proporre, anche se non ancora compilate né presenti nel template
 * (campi liberi salvati in schedaData, non colonne fisse della US). */
const ALWAYS_SUGGESTED_COLUMNS = ["note"];

/** Campi noti (colonne fisse + campi del modello US attivo + campi generici sempre suggeriti)
 * per etichettare/abbinare le colonne dell'elenco. */
export function knownFieldsForCantiere(
  project: ProjectDefinition,
  cantiere: { usModelKey?: string | null },
): FieldCandidate[] {
  const activeModel = getUSModel(project, cantiere.usModelKey);
  const fromFixedColumns = getUSTemplateFieldKeys()
    .filter((key) => !isDerivedCheckboxKey(key))
    .map((key) => ({ key, label: humanizeFieldKey(key) }));
  const fromModel = activeModel.fields.map((f) => ({ key: f.key, label: f.label }));
  const fromAlwaysSuggested = ALWAYS_SUGGESTED_COLUMNS.map((key) => ({ key, label: humanizeFieldKey(key) }));
  const seen = new Set<string>();
  const merged: FieldCandidate[] = [];
  for (const f of [...fromFixedColumns, ...fromModel, ...fromAlwaysSuggested]) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    merged.push(f);
  }
  return merged.sort((a, b) => a.label.localeCompare(b.label, "it"));
}

function withCodiceUSFirst(keys: string[]): string[] {
  return keys.includes("codiceUS") ? ["codiceUS", ...keys.filter((k) => k !== "codiceUS")] : keys;
}

/** Relazioni stratigrafiche "dirette": quando è presente la colonna diretta, si aggiunge
 * automaticamente anche la reciproca, anche se non ancora compilata (come nella scheda US). */
const RELATION_INVERSE_PAIRS: Record<string, string> = {
  copre: "coperto_da",
  taglia: "tagliatoDa",
  riempie: "riempitoDa",
};

function computePopulatedKeys(usList: UnitaStratigrafica[]): Set<string> {
  const populatedKeys = new Set<string>();
  for (const us of usList) {
    const flat = buildUSFlatFields(us, undefined);
    for (const [key, value] of Object.entries(flat)) {
      if (value != null && String(value).trim() !== "") populatedKeys.add(key);
    }
  }
  populatedKeys.delete("dataExport");
  return populatedKeys;
}

function withRelationPairsAndExtras(keys: Iterable<string>): string[] {
  const extended = new Set(keys);
  for (const key of Array.from(extended)) {
    const inverse = RELATION_INVERSE_PAIRS[key];
    if (inverse) extended.add(inverse);
  }
  for (const key of ALWAYS_SUGGESTED_COLUMNS) extended.add(key);
  return Array.from(extended);
}

/**
 * Determina l'elenco ordinato di colonne da mostrare/esportare per un cantiere.
 * - Se è stato caricato un template Elenco US con un blocco di loop {#tag}...{/tag}, le colonne
 *   di base sono quelle rilevate nel template (nello stesso ordine), così import ed export usano
 *   sempre lo stesso set di campi.
 * - Altrimenti le colonne si aggiornano automaticamente in base ai dati già presenti: unione dei
 *   campi (fissi o custom) che hanno almeno un valore non vuoto tra le US del cantiere.
 * - In entrambi i casi si aggiunge sempre la relazione reciproca di ogni relazione diretta presente
 *   (es. "copre" → anche "coperto_da"), e alcune colonne generiche sempre utili (es. "note"),
 *   anche se ancora vuote — così restano disponibili per la compilazione, come nella scheda US.
 *   Eccezione: se l'utente ha scelto di usare il template "as-is" (senza riparazione), con un
 *   template caricato si usano esclusivamente le colonne fisicamente presenti nel template
 *   (schermo = export).
 */
export async function resolveElencoColumns(
  project: ProjectDefinition,
  cantiere: { usModelKey?: string | null },
  usList: (UnitaStratigrafica & { cantiereId?: number })[] = [],
): Promise<ElencoColumn[]> {
  const knownFields = knownFieldsForCantiere(project, cantiere);
  const labelByKey = new Map(knownFields.map((f) => [f.key, f.label]));
  const populatedKeys = computePopulatedKeys(usList);

  const templatePath = elencoUsTemplatePath(project);
  if (fs.existsSync(templatePath)) {
    const loopColumns = await extractTemplateLoopColumns(templatePath).catch(() => null);
    const flatKeys = loopColumns
      ? Array.from(new Set(loopColumns.columnKeys.flat().filter((k): k is string => !!k)))
      : [];
    if (flatKeys.length > 0) {
      const asIs = readElencoTemplateChoice(project)?.mode === "as-is";
      const combined = asIs ? flatKeys : withRelationPairsAndExtras(flatKeys);
      return withCodiceUSFirst(combined).map((key) => ({ key, label: labelByKey.get(key) || humanizeFieldKey(key) }));
    }
  }

  if (populatedKeys.size === 0) return DEFAULT_ELENCO_COLUMNS;

  const ordered = withCodiceUSFirst(withRelationPairsAndExtras(populatedKeys));
  return ordered.map((key) => ({ key, label: labelByKey.get(key) || humanizeFieldKey(key) }));
}

/** Calcola i valori (già in stringa) delle colonne richieste per una singola US. */
export function buildElencoRowValues(
  columns: ElencoColumn[],
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): Record<string, string> {
  const flat = buildUSFlatFields(us, cantiere);
  const values: Record<string, string> = {};
  for (const col of columns) {
    const raw = flat[col.key];
    values[col.key] = raw != null ? String(raw) : "";
  }
  return values;
}
