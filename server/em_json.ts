/**
 * Esportazione della Harris Matrix in `.em.json` v1 (formato Extended Matrix).
 *
 * Formato: header + grafo piatto nodes[]/edges[] (+ layout opzionale, qui omesso:
 * viene ricalcolato da chi apre il file, con le corsie delle epoche).
 * Convenzione di direzione: `A is_after B` = A piu'
 * recente di B, cioe' A sta sopra B (stessa direzione degli archi "from -> to"
 * della matrix di ArcheoDoc).
 */
import type { Cantiere, Periodo, UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import type { EmGraphParts } from "./em_native";
import {
  buildMatrixGraph,
  type HarrisMatrixMode,
  type MatrixEdge,
  type MatrixNode,
} from "./matrix_export";

export const EM_JSON_FORMAT_VERSION = "1.0";
const EM_DATAMODEL_VERSION = "1.6.0";

/**
 * sequenza: ogni rapporto diretto diventa `is_after` (la matrix EM classica).
 * fisici: copre/taglia/riempie/si appoggia diventano overlies/cuts/fills/abuts.
 */
export type EmJsonEdgeMode = "sequence" | "physical";

export type EmJsonOptions = {
  mode?: HarrisMatrixMode;
  edgeMode?: EmJsonEdgeMode;
  /** Epoche per ogni periodo del registro e per ogni periodoIniziale scritto nelle US. */
  includeEpochs?: boolean;
  /** Registro periodi del cantiere (nome, ordine, date). */
  periodi?: Periodo[];
  /** Unita' virtuali e paradati del cantiere. */
  emGraph?: EmGraphParts;
};

export type EmJsonNode = {
  id: string;
  node_type: string;
  name: string;
  description?: string;
  data: Record<string, unknown>;
};

export type EmJsonEdge = { id: string; edge_type: string; source: string; target: string };

export type EmJsonDocument = {
  header: {
    format: "em.json";
    version: string;
    generator: { tool: string; version: string };
    datamodel_versions: Record<string, string>;
  };
  graph: {
    graph_id: string;
    name: string;
    description?: string;
    data: Record<string, unknown>;
    nodes: EmJsonNode[];
    edges: EmJsonEdge[];
  };
};

const PHYSICAL_EDGE: Record<string, string> = {
  copre: "overlies",
  taglia: "cuts",
  riempie: "fills",
  appoggia: "abuts",
};

export function emNodeType(tipo: string | null | undefined): string {
  const t = String(tipo ?? "").trim().toUpperCase();
  if (/^USM/.test(t)) return "USM";
  if (t === "USD") return "USD";
  if (t === "SF") return "SF";
  return "US";
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

export function buildEmJson(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  options: EmJsonOptions = {},
): EmJsonDocument {
  const mode = options.mode ?? "all";
  const edgeMode = options.edgeMode ?? "sequence";
  const { nodes: matrixNodes, edges: matrixEdges } = buildMatrixGraph(usList, mode);

  const usByKey = new Map<string, UnitaStratigrafica>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (code) usByKey.set(code.replace(/\s+/g, "").toUpperCase(), us);
  }

  const nodes: EmJsonNode[] = matrixNodes.map((node: MatrixNode) => {
    const us = usByKey.get(node.key);
    const data: Record<string, unknown> = {};
    if (us) {
      data.archeodoc_id = us.id;
      if (us.tipo) data.tipo = us.tipo;
      if (us.periodoIniziale) data.periodo_iniziale = us.periodoIniziale;
      if (us.periodoFinale) data.periodo_finale = us.periodoFinale;
    } else {
      data.missing = true;
    }
    const out: EmJsonNode = {
      id: node.key,
      node_type: emNodeType(us?.tipo),
      name: node.label,
      data,
    };
    const definizione = us?.definizione?.trim();
    if (definizione) out.description = definizione;
    return out;
  });

  const edges: EmJsonEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (edge_type: string, source: string, target: string) => {
    const key = `${edge_type}|${source}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `e${edges.length + 1}`, edge_type, source, target });
  };

  for (const edge of matrixEdges as MatrixEdge[]) {
    if (edge.type === "equivalenza") {
      // Simmetrica: "uguale a" e "si lega a" non si distinguono nella matrix.
      pushEdge("equals", edge.from, edge.to);
    } else if (edgeMode === "physical" && PHYSICAL_EDGE[edge.type]) {
      pushEdge(PHYSICAL_EDGE[edge.type], edge.from, edge.to);
    } else {
      pushEdge("is_after", edge.from, edge.to);
    }
  }

  // Unita' virtuali e paradati nativi: nodi e archi; le US si richiamano per codice.
  if (options.emGraph) {
    const idByUsKey = new Map<string, string>();
    for (const node of matrixNodes) idByUsKey.set(normalizeUSCode(node.label), node.key);
    const emIds = new Set(options.emGraph.nodes.map((n) => n.uid));
    for (const em of options.emGraph.nodes) {
      let dati: Record<string, unknown> = {};
      try {
        const parsed = em.dati ? JSON.parse(em.dati) : {};
        if (parsed && typeof parsed === "object") dati = parsed;
      } catch {
        // dati non leggibili: nodo esportato senza
      }
      if (em.nodeType === "property" && dati.property_type === undefined) dati.property_type = em.nome ?? em.uid;
      const node: EmJsonNode = {
        id: em.uid,
        node_type: em.nodeType,
        name: em.nome?.trim() || em.uid,
        data: dati,
      };
      if (em.descrizione?.trim()) node.description = em.descrizione.trim();
      nodes.push(node);
    }
    const endpoint = (e: { kind: "us" | "em"; ref: string }) =>
      e.kind === "em" ? (emIds.has(e.ref) ? e.ref : undefined) : idByUsKey.get(e.ref);
    for (const edge of options.emGraph.edges) {
      const source = endpoint(edge.source);
      const target = endpoint(edge.target);
      if (source && target) pushEdge(edge.edgeType, source, target);
    }
  }

  // Epoche: prima quelle del registro periodi (dalla piu' recente, con le date
  // se presenti), poi i nomi scritti solo nelle US, dal piu' recente per livello
  // medio. Senza start_time vale l'ordine di dichiarazione.
  if (options.includeEpochs !== false) {
    const normName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const levelsByPeriod = new Map<string, number[]>();
    const unitsByPeriod = new Map<string, string[]>();
    const displayName = new Map<string, string>();
    for (const node of matrixNodes) {
      const periodo = usByKey.get(node.key)?.periodoIniziale?.trim();
      if (!periodo) continue;
      const k = normName(periodo);
      displayName.set(k, displayName.get(k) ?? periodo);
      levelsByPeriod.set(k, [...(levelsByPeriod.get(k) ?? []), node.level]);
      unitsByPeriod.set(k, [...(unitsByPeriod.get(k) ?? []), node.key]);
    }

    const registry = [...(options.periodi ?? [])].sort((a, b) => b.ordine - a.ordine || b.id - a.id);
    const declared = new Set<string>();
    const epochs: Array<{ name: string; description?: string; data: Record<string, unknown>; key: string }> = [];
    for (const p of registry) {
      const key = normName(p.nome);
      declared.add(key);
      const data: Record<string, unknown> = {};
      if (p.startTime !== null && p.startTime !== undefined) data.start_time = p.startTime;
      if (p.endTime !== null && p.endTime !== undefined) data.end_time = p.endTime;
      epochs.push({ name: p.nome, description: p.descrizione?.trim() || undefined, data, key });
    }
    const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    const extra = Array.from(levelsByPeriod.keys())
      .filter((key) => !declared.has(key))
      .sort((a, b) => mean(levelsByPeriod.get(a)!) - mean(levelsByPeriod.get(b)!) || a.localeCompare(b, "it"));
    for (const key of extra) epochs.push({ name: displayName.get(key)!, data: {}, key });

    for (const epoch of epochs) {
      const units = unitsByPeriod.get(epoch.key) ?? [];
      // Un periodo registrato ma senza US resta dichiarato: e' una corsia vuota ma valida.
      let epochId = `EP_${slug(epoch.name)}`;
      for (let n = 2; nodes.some((existing) => existing.id === epochId); n += 1) {
        epochId = `EP_${slug(epoch.name)}_${n}`;
      }
      const node: EmJsonNode = { id: epochId, node_type: "EpochNode", name: epoch.name, data: epoch.data };
      if (epoch.description) node.description = epoch.description;
      nodes.push(node);
      for (const unit of units) pushEdge("has_first_epoch", unit, epochId);
    }
  }

  const code = cantiere?.codice?.trim() || "cantiere";
  return {
    header: {
      format: "em.json",
      version: EM_JSON_FORMAT_VERSION,
      generator: { tool: "ArcheoDoc", version: "1" },
      datamodel_versions: { nodes: EM_DATAMODEL_VERSION, connections: EM_DATAMODEL_VERSION },
    },
    graph: {
      graph_id: `archeodoc_${slug(code)}`,
      name: cantiere?.nome?.trim() || code,
      data: { source: "ArcheoDoc", cantiere_codice: code },
      nodes,
      edges,
    },
  };
}

export function exportEmJson(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  options: EmJsonOptions = {},
): string {
  return JSON.stringify(buildEmJson(cantiere, usList, options), null, 2);
}
