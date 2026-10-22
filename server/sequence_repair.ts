/**
 * Riparazione dei campi "posteriore a" / "anteriore a".
 *
 * Quando questi due campi contraddicono i rapporti fisici (copre, taglia,
 * riempie, si appoggia a) si formano cicli. I rapporti fisici sono la fonte
 * piu' diretta, quindi si propone di togliere dai campi di sequenza le sole
 * voci che li contraddicono; quelle senza un rapporto fisico corrispondente
 * restano. Nulla viene tolto senza conferma.
 */
import type { UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import type { IStorage } from "./storage";
import { buildMatrixEdges } from "./matrix_export";
import { checkCicliStratigrafici } from "./qc";

type SeqField = "posterioreA" | "anterioreA";

export type SequenceRepairItem = {
  key: string;
  usId: number;
  code: string;
  field: SeqField;
  /** Codice dell'altra US da togliere dal campo. */
  value: string;
  reason: string;
};

export type SequenceRepairPlan = {
  items: SequenceRepairItem[];
  cyclesBefore: number;
  cyclesAfter: number;
};

const FIELD_LABEL: Record<SeqField, string> = { posterioreA: "posteriore a", anterioreA: "anteriore a" };
const k = (code: string) => normalizeUSCode(code);

function parseList(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    // testo semplice
  }
  return text.split(/[;,|\n\r]+/).map((v) => v.trim()).filter(Boolean);
}

function parseScheda(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Voci da togliere dai campi di sequenza di una singola US. */
function contradictions(
  us: UnitaStratigrafica,
  physical: Set<string>,
): Array<{ field: SeqField; value: string; reason: string }> {
  const self = k(us.codiceUS);
  const scheda = parseScheda(us.schedaData);
  const out: Array<{ field: SeqField; value: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const field of ["posterioreA", "anterioreA"] as SeqField[]) {
    for (const raw of [...parseList((us as any)[field]), ...parseList(scheda[field])]) {
      const other = k(raw);
      if (!other || seen.has(`${field}|${other}`)) continue;
      seen.add(`${field}|${other}`);
      // posteriore a X: io sono piu' recente. Contraddizione se i rapporti fisici dicono che X sta sopra di me.
      // anteriore a X: io sono piu' antica. Contraddizione se i rapporti fisici dicono che io sto sopra X.
      const contradicted = field === "posterioreA" ? physical.has(`${other}>${self}`) : physical.has(`${self}>${other}`);
      if (!contradicted) continue;
      out.push({
        field,
        value: raw,
        reason:
          field === "posterioreA"
            ? `i rapporti fisici dicono che ${raw} sta sopra ${us.codiceUS}`
            : `i rapporti fisici dicono che ${us.codiceUS} sta sopra ${raw}`,
      });
    }
  }
  return out;
}

function physicalEdges(usList: UnitaStratigrafica[]): Set<string> {
  const set = new Set<string>();
  for (const e of buildMatrixEdges(usList, "fisica")) {
    if (e.directed) set.add(`${k(e.from)}>${k(e.to)}`);
  }
  return set;
}

function removeValues(us: UnitaStratigrafica, removals: Map<SeqField, Set<string>>): Partial<UnitaStratigrafica> {
  const patch: Record<string, unknown> = {};
  const scheda = parseScheda(us.schedaData);
  let schedaChanged = false;
  for (const [field, values] of Array.from(removals.entries())) {
    const drop = (list: string[]) => list.filter((v) => !values.has(k(v)));
    const top = parseList((us as any)[field]);
    if (top.length && drop(top).length !== top.length) patch[field] = drop(top).join(", ") || null;
    const inScheda = parseList(scheda[field]);
    if (inScheda.length && drop(inScheda).length !== inScheda.length) {
      scheda[field] = drop(inScheda).join(", ");
      schedaChanged = true;
    }
  }
  if (schedaChanged) patch.schedaData = Object.keys(scheda).length ? JSON.stringify(scheda) : null;
  return patch as Partial<UnitaStratigrafica>;
}

function applyToList(usList: UnitaStratigrafica[], items: SequenceRepairItem[]): UnitaStratigrafica[] {
  const byId = new Map<number, Map<SeqField, Set<string>>>();
  for (const item of items) {
    const perField = byId.get(item.usId) ?? new Map<SeqField, Set<string>>();
    const set = perField.get(item.field) ?? new Set<string>();
    set.add(k(item.value));
    perField.set(item.field, set);
    byId.set(item.usId, perField);
  }
  return usList.map((us) => {
    const removals = byId.get(us.id);
    return removals ? ({ ...us, ...removeValues(us, removals) } as UnitaStratigrafica) : us;
  });
}

export function planSequenceRepair(usList: UnitaStratigrafica[]): SequenceRepairPlan {
  const physical = physicalEdges(usList);
  const items: SequenceRepairItem[] = [];
  for (const us of usList) {
    if (!us.codiceUS?.trim()) continue;
    for (const c of contradictions(us, physical)) {
      items.push({
        key: `${us.id}|${c.field}|${k(c.value)}`,
        usId: us.id,
        code: us.codiceUS,
        field: c.field,
        value: c.value,
        reason: c.reason,
      });
    }
  }
  const after = applyToList(usList, items);
  return {
    items,
    cyclesBefore: checkCicliStratigrafici(usList).length,
    cyclesAfter: checkCicliStratigrafici(after).length,
  };
}

export function sequenceFieldLabel(field: SeqField): string {
  return FIELD_LABEL[field];
}

/** Applica solo le voci scelte (ricalcolate sul cantiere attuale, mai fidandosi del client). */
export function applySequenceRepair(
  storage: IStorage,
  cantiereId: number,
  selectedKeys: string[],
): { removed: number; usUpdated: number } {
  const plan = planSequenceRepair(storage.getUSList(cantiereId));
  const wanted = new Set(selectedKeys);
  const chosen = plan.items.filter((item) => wanted.has(item.key));
  const byUs = new Map<number, SequenceRepairItem[]>();
  for (const item of chosen) byUs.set(item.usId, [...(byUs.get(item.usId) ?? []), item]);

  let usUpdated = 0;
  for (const [usId, items] of Array.from(byUs.entries())) {
    const us = storage.getUS(usId);
    if (!us) continue;
    const removals = new Map<SeqField, Set<string>>();
    for (const item of items) {
      const set = removals.get(item.field) ?? new Set<string>();
      set.add(k(item.value));
      removals.set(item.field, set);
    }
    const patch = removeValues(us, removals);
    if (Object.keys(patch).length) {
      storage.updateUS(usId, patch as any);
      usUpdated += 1;
    }
  }
  return { removed: chosen.length, usUpdated };
}
