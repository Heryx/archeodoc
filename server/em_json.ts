/**
 * Esportazione della Harris Matrix in `.em.json` v1 (EMStudio / s3Dgraphy).
 *
 * Formato: header + grafo piatto nodes[]/edges[] (+ layout opzionale, qui omesso:
 * EMStudio lo rigenera in modo deterministico con le corsie delle epoche).
 * Specifica: https://github.com/ExtendedMatrix/EMStudio (docs/emjson-v1-draft.md,
 * schemas/em.v1.schema.json). Convenzione di direzione: `A is_after B` = A piu'
 * recente di B, cioe' A sta sopra B (stessa direzione degli archi "from -> to"
 * della matrix di ArcheoDoc).
 */
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
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
  /** Epoca per ogni periodoIniziale presente (senza date, in ordine stratigrafico). */
  includeEpochs?: boolean;
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

  // Epoche: una per ogni periodo dichiarato, dalla piu' recente (livello medio
  // piu' alto) alla piu' antica; senza start_time EMStudio ne rispetta l'ordine.
  if (options.includeEpochs !== false) {
    const levelsByPeriod = new Map<string, number[]>();
    const unitsByPeriod = new Map<string, string[]>();
    for (const node of matrixNodes) {
      const periodo = usByKey.get(node.key)?.periodoIniziale?.trim();
      if (!periodo) continue;
      levelsByPeriod.set(periodo, [...(levelsByPeriod.get(periodo) ?? []), node.level]);
      unitsByPeriod.set(periodo, [...(unitsByPeriod.get(periodo) ?? []), node.key]);
    }
    const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    const periods = Array.from(levelsByPeriod.keys()).sort(
      (a, b) => mean(levelsByPeriod.get(a)!) - mean(levelsByPeriod.get(b)!) || a.localeCompare(b, "it"),
    );
    for (const periodo of periods) {
      const epochId = `EP_${slug(periodo)}`;
      nodes.push({ id: epochId, node_type: "EpochNode", name: periodo, data: {} });
      for (const unit of unitsByPeriod.get(periodo)!) pushEdge("has_first_epoch", unit, epochId);
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
