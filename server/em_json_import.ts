/**
 * Importazione di un file `.em.json` salvato da EM Studio in un cantiere ArcheoDoc.
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
import type { Cantiere, Periodo, UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import type { IStorage } from "./storage";
import { buildMatrixEdges } from "./matrix_export";
import { applyPendingInverses, INVERSE_MAP, type RelField } from "./relations_sync";
import { loadGraph, type GraphParts } from "./paradati";
import { INTERNAL_EDGE_OF, INTERNAL_TYPE_OF } from "./em_json_names";

/** Tipi di nodo che corrispondono a US reali di scavo. */
const STRATIGRAPHIC_TYPES = new Set(["US", "USM", "USD", "SF", "USN", "USNt", "USNs", "USR"]);

type MatrixType = "copre" | "taglia" | "riempie" | "appoggia" | "posteriore" | "equivalenza";

type EdgeSpec = { type: MatrixType; field: RelField; label: string; reverse?: boolean };

/** Tipi di arco riconosciuti; `reverse` = la direzione nel file e' opposta a quella canonica. */
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

export type EmImportEpoch = {
  key: string;
  nome: string;
  descrizione: string | null;
  startTime: number | null;
  endTime: number | null;
  /** new = periodo assente dal registro; dates = periodo noto a cui mancano le date. */
  kind: "new" | "dates";
};

export type EmImportNode = {
  key: string;
  uid: string;
  nodeType: string;
  nome: string | null;
  descrizione: string | null;
  dati: Record<string, unknown>;
};

export type EmImportLink = {
  key: string;
  edgeType: string;
  label: string;
  source: string;
  target: string;
  needsNewNode: boolean;
  /** Estremi come salvati in ArcheoDoc: US per codice normalizzato, nodi per nome. */
  ends: { sourceKind: "us" | "nodo"; sourceRef: string; targetKind: "us" | "nodo"; targetRef: string };
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
  epochs: EmImportEpoch[];
  /** Unita' virtuali e paradati del file non ancora nel cantiere. */
  emNodes: EmImportNode[];
  emLinks: EmImportLink[];
  conflicts: EmImportConflict[];
  /** Tipi di nodo/arco del file che ArcheoDoc non gestisce ancora (ignorati). */
  ignored: { nodeTypes: Record<string, number>; edgeTypes: Record<string, number> };
};

type EmDoc = {
  header?: { format?: string; version?: string; generator?: { tool?: string; version?: string } };
  graph?: {
    name?: string;
    nodes?: Array<{ id: string; node_type: string; name?: string; description?: string; data?: Record<string, unknown> }>;
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
    throw new EmImportError("Non e' un file .em.json valido (intestazione mancante).");
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
const periodKeyOf = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

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

/** Archi che coinvolgono unita' virtuali e paradati (unita' virtuali e paradati). */
const EM_EDGE_LABEL: Record<string, string> = {
  is_after: "sta sopra a",
  extracted_from: "estratto da",
  combines: "combina",
  has_property: "ha la proprietà",
  has_data_provenance: "ha provenienza",
};

export function planEmImport(
  text: string,
  usList: UnitaStratigrafica[],
  periodi: Periodo[] = [],
  paradatiGraph: GraphParts = { nodes: [], edges: [] },
): EmImportPlan {
  const doc = parseDoc(text);
  const graph = doc.graph!;
  const byKey = new Map<string, UnitaStratigrafica>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (code) byKey.set(unitKey(code), us);
  }

  const ignoredNodes: Record<string, number> = {};
  const ignoredEdges: Record<string, number> = {};
  const emUnits = new Map<string, EmImportUnit>(); // id nel file -> unita'
  const epochs = new Map<string, string>(); // id nel file -> nome
  const epochNodes: EmImportEpoch[] = [];
  const periodKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const registry = new Map(periodi.map((p) => [periodKey(p.nome), p]));
  const asYear = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
  for (const node of graph.nodes!) {
    const name = (node.name ?? node.id).trim();
    if (STRATIGRAPHIC_TYPES.has(node.node_type)) {
      emUnits.set(node.id, {
        key: unitKey(name),
        code: name,
        nodeType: node.node_type,
        description: node.description?.trim() || null,
      });
    } else if (INTERNAL_TYPE_OF[node.node_type] !== undefined) {
      // unita' virtuali e paradati: trattati dopo, con i loro archi
    } else if (node.node_type === "EpochNode" || node.node_type === "epoch") {
      epochs.set(node.id, name);
      const known = registry.get(periodKey(name));
      const startTime = asYear(node.data?.start_time);
      const endTime = asYear(node.data?.end_time);
      if (!known) {
        epochNodes.push({
          key: `epoch|${periodKey(name)}`,
          nome: name,
          descrizione: node.description?.trim() || null,
          startTime,
          endTime,
          kind: "new",
        });
      } else if (
        (known.startTime === null && startTime !== null) ||
        (known.endTime === null && endTime !== null)
      ) {
        epochNodes.push({
          key: `epoch|${periodKey(name)}`,
          nome: name,
          descrizione: known.descrizione,
          startTime: known.startTime ?? startTime,
          endTime: known.endTime ?? endTime,
          kind: "dates",
        });
      }
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

  // Unita' virtuali e paradati: nodi nuovi e collegamenti.
  const emTypeIds = new Set<string>();
  const emNodeById = new Map<string, { uid: string; isNew: boolean }>();
  const emNodes: EmImportNode[] = [];
  const dbEmByUid = new Map(paradatiGraph.nodes.map((n) => [n.uid, n]));
  const usedUids = new Set<string>();
  const conflictsEm: EmImportConflict[] = [];
  for (const node of graph.nodes!) {
    const internalType = INTERNAL_TYPE_OF[node.node_type];
    if (internalType === undefined) continue;
    emTypeIds.add(node.id);
    const label = (node.name ?? "").trim();
    let uid = node.node_type === "property" || !label ? node.id : label;
    if (usedUids.has(uid) || byKey.has(unitKey(uid)) || newKeys.has(unitKey(uid))) uid = node.id;
    usedUids.add(uid);
    const known = dbEmByUid.get(uid);
    if (known) {
      if (known.nodeType === internalType) emNodeById.set(node.id, { uid, isNew: false });
      else {
        conflictsEm.push({
          source: uid,
          target: "",
          emEdgeType: node.node_type,
          reason: `Esiste già un nodo "${uid}" di tipo ${known.nodeType}`,
        });
      }
      continue;
    }
    emNodeById.set(node.id, { uid, isNew: true });
    const { start_time: _s, end_time: _e, property_type: propertyType, ...dati } = (node.data ?? {}) as Record<string, unknown>;
    if (typeof propertyType === "string" && propertyType) dati.tipo_proprieta = propertyType;
    emNodes.push({
      key: `emn|${uid}`,
      uid,
      nodeType: internalType,
      nome: label && label !== uid ? label : null,
      descrizione: node.description?.trim() || null,
      dati,
    });
  }
  const emLinks: EmImportLink[] = [];
  const seenEmLink = new Set<string>();
  const dbEmLinks = new Set(
    paradatiGraph.edges.map((e) => `${e.edgeType}|${e.source.kind}:${e.source.ref}|${e.target.kind}:${e.target.ref}`),
  );
  const endpointOf = (id: string) => {
    const em = emNodeById.get(id);
    if (em) return { kind: "nodo" as const, ref: em.uid, label: em.uid, isNew: em.isNew };
    const unit = emUnits.get(id);
    if (unit && unit.key) return { kind: "us" as const, ref: unit.key, label: unit.code, isNew: newKeys.has(unit.key) };
    return undefined;
  };

  for (const edge of graph.edges!) {
    if (EM_EDGE_LABEL[edge.edge_type] && (emTypeIds.has(edge.source) || emTypeIds.has(edge.target))) {
      const a = endpointOf(edge.source);
      const b = endpointOf(edge.target);
      if (!a || !b) continue;
      const internalEdge = INTERNAL_EDGE_OF[edge.edge_type];
      const linkKey = `${internalEdge}|${a.kind}:${a.ref}|${b.kind}:${b.ref}`;
      if (dbEmLinks.has(linkKey)) {
        unchanged += 1;
      } else if (!seenEmLink.has(linkKey)) {
        seenEmLink.add(linkKey);
        emLinks.push({
          key: `eml|${linkKey}`,
          edgeType: internalEdge,
          label: EM_EDGE_LABEL[edge.edge_type],
          source: a.label,
          target: b.label,
          needsNewNode: a.isNew || b.isNew,
          ends: { sourceKind: a.kind, sourceRef: a.ref, targetKind: b.kind, targetRef: b.ref },
        });
      }
      continue;
    }

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
    epochs: epochNodes,
    emNodes,
    emLinks,
    conflicts: [...conflicts, ...conflictsEm],
    ignored: { nodeTypes: ignoredNodes, edgeTypes: ignoredEdges },
  };
}

export type EmImportResult = {
  createdEmNodes: number;
  addedEmLinks: number;
  createdPeriods: number;
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
  const plan = planEmImport(text, usList, storage.getPeriodi(cantiere.id), loadGraph(storage, cantiere.id));
  const wanted = new Set(selected);
  const result: EmImportResult = { createdEmNodes: 0, addedEmLinks: 0, createdPeriods: 0, createdUnits: 0, addedRelations: 0, updatedPeriods: 0, skipped: [] };

  // Registro periodi: prima i piu' antichi (start_time crescente), i senza data in coda.
  const chosenEpochs = plan.epochs
    .filter((e) => wanted.has(e.key))
    .sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity));
  let ordine = storage.getPeriodi(cantiere.id).reduce((m, p) => Math.max(m, p.ordine), 0);
  for (const epoch of chosenEpochs) {
    const known = storage.getPeriodi(cantiere.id).find((p) => periodKeyOf(p.nome) === periodKeyOf(epoch.nome));
    if (epoch.kind === "dates" && known) {
      storage.updatePeriodo(known.id, { startTime: epoch.startTime, endTime: epoch.endTime });
    } else if (!known) {
      storage.createPeriodo({
        cantiereId: cantiere.id,
        nome: epoch.nome,
        descrizione: epoch.descrizione,
        ordine: ++ordine,
        startTime: epoch.startTime,
        endTime: epoch.endTime,
      });
      result.createdPeriods += 1;
    }
  }

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

  // Unita' virtuali e paradati (dopo le US, che possono esserne un estremo)
  for (const node of plan.emNodes) {
    if (!wanted.has(node.key)) continue;
    storage.createNodoParadati({
      cantiereId: cantiere.id,
      uid: node.uid,
      nodeType: node.nodeType,
      nome: node.nome,
      descrizione: node.descrizione,
      dati: Object.keys(node.dati).length ? JSON.stringify(node.dati) : null,
    });
    result.createdEmNodes += 1;
  }
  const emUids = new Set(storage.getNodiParadati(cantiere.id).map((n) => n.uid));
  const haveEnd = (kind: "us" | "nodo", ref: string) => (kind === "nodo" ? emUids.has(ref) : byKey.has(ref));
  for (const link of plan.emLinks) {
    if (!wanted.has(link.key)) continue;
    const { sourceKind, sourceRef, targetKind, targetRef } = link.ends;
    if (!haveEnd(sourceKind, sourceRef) || !haveEnd(targetKind, targetRef)) {
      result.skipped.push(`${link.source} ${link.label} ${link.target}: nodo o US mancante`);
      continue;
    }
    const already = storage
      .getArchiParadati(cantiere.id)
      .some((e) => e.edgeType === link.edgeType && e.sourceKind === sourceKind && e.sourceRef === sourceRef && e.targetKind === targetKind && e.targetRef === targetRef);
    if (already) continue;
    storage.createArcoParadati({ cantiereId: cantiere.id, edgeType: link.edgeType, sourceKind, sourceRef, targetKind, targetRef });
    result.addedEmLinks += 1;
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
