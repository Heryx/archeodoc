/**
 * Importazione di un `.em.json` (EMStudio) in un cantiere ArcheoDoc.
 *
 * Due passi, entrambi senza stato sul server:
 *  - planEmImport: confronta il file con le US del cantiere e propone
 *    cosa creare/aggiungere; non scrive nulla.
 *  - applyEmImport: rilegge il file, ricalcola il piano e applica solo le
 *    voci scelte dall'utente (chiavi `unit|...`, `rel|...`, `per|...`).
 *
 * Si aggiunge soltanto: nessuna US o relazione viene rimossa. I rapporti che
 * contraddicono quelli gia' presenti in ArcheoDoc sono segnalati come conflitti
 * e non si applicano.
 */
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import type { IStorage } from "./storage";
import { buildMatrixEdges } from "./matrix_export";
import { applyPendingInverses, INVERSE_MAP, type RelField } from "./relations_sync";

/** Tipi di nodo EM che corrispondono a US reali di scavo. */
const STRATIGRAPHIC_TYPES = new Set(["US", "USM", "USD", "SF", "USN", "USNt", "USNs", "USR"]);

type MatrixType = "copre" | "taglia" | "riempie" | "appoggia" | "posteriore" | "equivalenza";

type EdgeSpec = { type: MatrixType; field: RelField; label: string; reverse?: boolean };

/** Tipi di arco EM riconosciuti; `reverse` = la direzione EM e' opposta a quella canonica. */
const EDGE_SPECS: Record<string, EdgeSpec> = {
  is_after: { type: "posteriore", field: "posterioreA", label: "posteriore a" },
  is_before: { type: "posteriore", field: "posterioreA", label: "posteriore a", reverse: true },
  overlies: { type: "copre", field: "copre", label: "copre" },
  is_overlain_by: { type: "copre", field: "copre", label: "copre", reverse: true },
  cuts: { type: "taglia", field: "taglia", label: "taglia" },
  is_cut_by: { type: "taglia", field: "taglia", label: "taglia", reverse: true },
  fills: { type: "riempie", field: "riempie", label: "riempie" },
  is_filled_by: { type: "riempie", field: "riempie", label: "riempie", reverse: true },
  abuts: { type: "appoggia", field: "siAppoggiaA", label: "si appoggia a" },
  is_abutted_by: { type: "appoggia", field: "siAppoggiaA", label: "si appoggia a", reverse: true },
  equals: { type: "equivalenza", field: "uguale_a", label: "uguale a" },
  is_physically_equal_to: { type: "equivalenza", field: "uguale_a", label: "uguale a" },
  bonded_to: { type: "equivalenza", field: "si_lega_a", label: "si lega a" },
  is_bonded_to: { type: "equivalenza", field: "si_lega_a", label: "si lega a" },
};

export type EmImportUnit = {
  key: string;
  code: string;
  nodeType: string;
  description: string | null;
};

export type EmImportRelation = {
  key: string;
  source: string;
  target: string;
  emEdgeType: string;
  label: string;
  /** true se una delle due US non esiste ancora e verra' creata con le nuove unita'. */
  needsNewUnit: boolean;
};

export type EmImportConflict = { source: string; target: string; emEdgeType: string; reason: string };

export type EmImportPeriod = {
  key: string;
  code: string;
  from: string | null;
  to: string;
};

export type EmImportPlan = {
  graphName: string;
  formatVersion: string;
  generator: string;
  stats: { nodes: number; edges: number; unchanged: number };
  newUnits: EmImportUnit[];
  newRelations: EmImportRelation[];
  periods: EmImportPeriod[];
  conflicts: EmImportConflict[];
  /** Tipi di nodo/arco del file che ArcheoDoc non gestisce ancora (ignorati). */
  ignored: { nodeTypes: Record<string, number>; edgeTypes: Record<string, number> };
};

type EmDoc = {
  header?: { format?: string; version?: string; generator?: { tool?: string; version?: string } };
  graph?: {
    name?: string;
    nodes?: Array<{ id: string; node_type: string; name?: string; description?: string }>;
    edges?: Array<{ id?: string; edge_type: string; source: string; target: string }>;
  };
};

export class EmImportError extends Error {}

function parseDoc(text: string): EmDoc {
  let doc: EmDoc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new EmImportError("Il file non e' un JSON valido.");
  }
  if (doc?.header?.format !== "em.json") {
    throw new EmImportError("Non e' un file .em.json (header.format mancante).");
  }
  const version = String(doc.header.version ?? "");
  if (!/^1\./.test(version)) {
    throw new EmImportError(`Versione del formato non supportata: ${version || "sconosciuta"}.`);
  }
  if (!doc.graph || !Array.isArray(doc.graph.nodes) || !Array.isArray(doc.graph.edges)) {
    throw new EmImportError("Il file non contiene un grafo (graph.nodes / graph.edges).");
  }
  return doc;
}

const unitKey = (code: string) => normalizeUSCode(code);

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Relazioni gia' presenti in ArcheoDoc, con le stesse chiavi usate per il confronto. */
function indexExistingRelations(usList: UnitaStratigrafica[]) {
  const typed = new Set<string>();
  const directed = new Set<string>();
  for (const edge of buildMatrixEdges(usList, "all")) {
    const from = unitKey(edge.from);
    const to = unitKey(edge.to);
    if (edge.type === "equivalenza") {
      typed.add(`equivalenza|${pairKey(from, to)}`);
    } else {
      typed.add(`${edge.type}|${from}|${to}`);
      directed.add(`${from}|${to}`);
    }
  }
  return { typed, directed };
}

export function planEmImport(text: string, usList: UnitaStratigrafica[]): EmImportPlan {
  const doc = parseDoc(text);
  const graph = doc.graph!;
  const byKey = new Map<string, UnitaStratigrafica>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (code) byKey.set(unitKey(code), us);
  }

  const ignoredNodes: Record<string, number> = {};
  const ignoredEdges: Record<string, number> = {};
  const emUnits = new Map<string, EmImportUnit>(); // id EM -> unita'
  const epochs = new Map<string, string>(); // id EM -> nome
  for (const node of graph.nodes!) {
    const name = (node.name ?? node.id).trim();
    if (STRATIGRAPHIC_TYPES.has(node.node_type)) {
      emUnits.set(node.id, {
        key: unitKey(name),
        code: name,
        nodeType: node.node_type,
        description: node.description?.trim() || null,
      });
    } else if (node.node_type === "EpochNode" || node.node_type === "epoch") {
      epochs.set(node.id, name);
    } else {
      ignoredNodes[node.node_type] = (ignoredNodes[node.node_type] ?? 0) + 1;
    }
  }

  const newUnits: EmImportUnit[] = [];
  const newKeys = new Set<string>();
  for (const unit of Array.from(emUnits.values())) {
    if (!unit.key || byKey.has(unit.key) || newKeys.has(unit.key)) continue;
    newKeys.add(unit.key);
    newUnits.push(unit);
  }

  const existing = indexExistingRelations(usList);
  const newRelations: EmImportRelation[] = [];
  const conflicts: EmImportConflict[] = [];
  const periods: EmImportPeriod[] = [];
  const seenRel = new Set<string>();
  let unchanged = 0;

  for (const edge of graph.edges!) {
    if (edge.edge_type === "has_first_epoch") {
      const unit = emUnits.get(edge.source);
      const epochName = epochs.get(edge.target);
      if (!unit || !epochName) continue;
      const current = byKey.get(unit.key)?.periodoIniziale?.trim() || null;
      if (current === epochName) {
        unchanged += 1;
      } else if (!periods.some((p) => p.key === `per|${unit.key}`)) {
        periods.push({ key: `per|${unit.key}`, code: unit.code, from: current, to: epochName });
      }
      continue;
    }

    const spec = EDGE_SPECS[edge.edge_type];
    const a = emUnits.get(edge.source);
    const b = emUnits.get(edge.target);
    if (!spec) {
      // Archi di appartenenza/paradata verso nodi non importati non fanno rumore.
      if (a || b) ignoredEdges[edge.edge_type] = (ignoredEdges[edge.edge_type] ?? 0) + 1;
      continue;
    }
    if (!a || !b || !a.key || !b.key || a.key === b.key) continue;

    const [from, to] = spec.reverse ? [b, a] : [a, b];
    const symmetric = spec.type === "equivalenza";
    const typedKey = symmetric
      ? `equivalenza|${pairKey(from.key, to.key)}`
      : `${spec.type}|${from.key}|${to.key}`;

    // is_after e' soddisfatto da qualunque rapporto diretto nello stesso verso.
    const present =
      existing.typed.has(typedKey) ||
      (spec.type === "posteriore" && existing.directed.has(`${from.key}|${to.key}`));
    if (present) {
      unchanged += 1;
      continue;
    }
    if (!symmetric && existing.directed.has(`${to.key}|${from.key}`)) {
      conflicts.push({
        source: from.code,
        target: to.code,
        emEdgeType: edge.edge_type,
        reason: "In ArcheoDoc il rapporto va nel verso opposto",
      });
      continue;
    }

    const key = `rel|${spec.field}|${from.key}|${to.key}`;
    if (seenRel.has(key)) continue;
    seenRel.add(key);
    newRelations.push({
      key,
      source: from.code,
      target: to.code,
      emEdgeType: edge.edge_type,
      label: spec.label,
      needsNewUnit: newKeys.has(from.key) || newKeys.has(to.key),
    });
  }

  return {
    graphName: graph.name ?? "",
    formatVersion: String(doc.header!.version),
    generator: [doc.header!.generator?.tool, doc.header!.generator?.version].filter(Boolean).join(" "),
    stats: { nodes: graph.nodes!.length, edges: graph.edges!.length, unchanged },
    newUnits,
    newRelations,
    periods,
    conflicts,
    ignored: { nodeTypes: ignoredNodes, edgeTypes: ignoredEdges },
  };
}

export type EmImportResult = {
  createdUnits: number;
  addedRelations: number;
  updatedPeriods: number;
  skipped: string[];
};

export function applyEmImport(
  storage: IStorage,
  cantiere: Cantiere,
  text: string,
  selected: string[],
): EmImportResult {
  const usList = storage.getUSList(cantiere.id);
  const plan = planEmImport(text, usList);
  const wanted = new Set(selected);
  const result: EmImportResult = { createdUnits: 0, addedRelations: 0, updatedPeriods: 0, skipped: [] };

  const modelKey = cantiere.usModelKey || BASE_US_MODEL_KEY;
  for (const unit of plan.newUnits) {
    if (!wanted.has(`unit|${unit.key}`)) continue;
    storage.createUS({
      cantiereId: cantiere.id,
      codiceUS: unit.code,
      definizione: unit.description,
      schedaModelKey: modelKey,
    } as any);
    result.createdUnits += 1;
  }

  const current = storage.getUSList(cantiere.id);
  const byKey = new Map<string, UnitaStratigrafica>();
  for (const us of current) {
    const code = us.codiceUS?.trim();
    if (code) byKey.set(unitKey(code), us);
  }

  for (const rel of plan.newRelations) {
    if (!wanted.has(rel.key)) continue;
    const [, field, fromKey, toKey] = rel.key.split("|");
    const from = byKey.get(fromKey);
    const to = byKey.get(toKey);
    if (!from || !to) {
      result.skipped.push(`${rel.source} ${rel.label} ${rel.target}: US mancante`);
      continue;
    }
    // Relazione diretta e relativa inversa; nient'altro viene toccato.
    applyPendingInverses(storage, [
      { targetId: from.id, targetCode: from.codiceUS, field: field as RelField, valueToAdd: to.codiceUS },
      { targetId: to.id, targetCode: to.codiceUS, field: INVERSE_MAP[field as RelField], valueToAdd: from.codiceUS },
    ]);
    result.addedRelations += 1;
  }

  for (const period of plan.periods) {
    if (!wanted.has(period.key)) continue;
    const us = byKey.get(period.key.slice("per|".length));
    if (!us) continue;
    storage.updateUS(us.id, { periodoIniziale: period.to });
    result.updatedPeriods += 1;
  }

  return result;
}
