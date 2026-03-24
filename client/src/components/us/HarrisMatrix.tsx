import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";

export type HarrisMatrixMode = "all" | "fisica" | "stratigrafica";

type USRelationRecord = {
  codiceUS: string;
  qcStatus?: string | null;
  coperto_da?: string | null;
  copre?: string | null;
  si_lega_a?: string | null;
  uguale_a?: string | null;
  schedaData?: string | Record<string, unknown> | null;
};

type EdgeType =
  | "copre"
  | "riempie"
  | "taglia"
  | "appoggia"
  | "equivalenza"
  | "posteriore";

type GraphNode = {
  key: string;
  label: string;
  qcStatus?: string | null;
  missing: boolean;
};

type GraphEdge = {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  directed: boolean;
};

type PositionedNode = GraphNode & {
  x: number;
  y: number;
};

function normalizeCodeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseSchedaData(raw: USRelationRecord["schedaData"]): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (value == null) return acc;
          const text = String(value).trim();
          if (!text) return acc;
          acc[key] = text;
          return acc;
        },
        {},
      );
    } catch {
      return {};
    }
  }

  return Object.entries(raw).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value == null) return acc;
    const text = String(value).trim();
    if (!text) return acc;
    acc[key] = text;
    return acc;
  }, {});
}

function toRelationList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    // fallback split
  }

  return trimmed
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shortenLabel(value: string, max = 16): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function buildGraph(
  usList: USRelationRecord[],
  mode: HarrisMatrixMode,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const includeFisica = mode === "all" || mode === "fisica";
  const includeStratigrafica = mode === "all" || mode === "stratigrafica";

  const ensureNode = (code: string, meta?: Partial<GraphNode>) => {
    const key = normalizeCodeKey(code);
    if (!key) return;

    const existing = nodes.get(key);
    if (existing) {
      nodes.set(key, {
        ...existing,
        ...meta,
        key,
        label: meta?.label || existing.label,
      });
      return;
    }

    nodes.set(key, {
      key,
      label: meta?.label || code,
      qcStatus: meta?.qcStatus,
      missing: !!meta?.missing,
    });
  };

  const addEdge = (fromCode: string, toCode: string, type: EdgeType, directed: boolean) => {
    const from = normalizeCodeKey(fromCode);
    const to = normalizeCodeKey(toCode);
    if (!from || !to || from === to) return;

    ensureNode(fromCode, { label: fromCode, missing: false });
    ensureNode(toCode, { label: toCode, missing: false });

    let edgeKey: string;
    let edgeFrom = from;
    let edgeTo = to;
    if (directed) {
      edgeKey = `${type}:${from}->${to}`;
    } else {
      const [a, b] = from < to ? [from, to] : [to, from];
      edgeKey = `${type}:${a}<->${b}`;
      edgeFrom = a;
      edgeTo = b;
    }

    if (edges.has(edgeKey)) return;
    edges.set(edgeKey, { key: edgeKey, from: edgeFrom, to: edgeTo, type, directed });
  };

  for (const us of usList) {
    if (!us.codiceUS?.trim()) continue;
    ensureNode(us.codiceUS, {
      label: us.codiceUS,
      qcStatus: us.qcStatus,
      missing: false,
    });
  }

  for (const us of usList) {
    if (!us.codiceUS?.trim()) continue;
    const source = us.codiceUS;
    const scheda = parseSchedaData(us.schedaData);

    if (includeFisica) {
      for (const target of toRelationList(us.copre)) {
        addEdge(source, target, "copre", true);
      }

      for (const coveringUs of toRelationList(us.coperto_da)) {
        addEdge(coveringUs, source, "copre", true);
      }

      for (const target of toRelationList(scheda.riempie)) {
        addEdge(source, target, "riempie", true);
      }
      for (const filler of toRelationList(scheda.riempitoDa)) {
        addEdge(filler, source, "riempie", true);
      }

      for (const target of toRelationList(scheda.taglia)) {
        addEdge(source, target, "taglia", true);
      }
      for (const cutter of toRelationList(scheda.tagliatoDa)) {
        addEdge(cutter, source, "taglia", true);
      }

      for (const target of toRelationList(scheda.siAppoggiaA)) {
        addEdge(source, target, "appoggia", true);
      }
      for (const leaning of toRelationList(scheda.gliSiAppoggia)) {
        addEdge(leaning, source, "appoggia", true);
      }

      for (const linked of toRelationList(us.si_lega_a)) {
        addEdge(source, linked, "equivalenza", false);
      }
      for (const equal of toRelationList(us.uguale_a)) {
        addEdge(source, equal, "equivalenza", false);
      }
      for (const equal of toRelationList(scheda.ugualeAStratigrafico)) {
        addEdge(source, equal, "equivalenza", false);
      }
    }

    if (includeStratigrafica) {
      for (const olderUs of toRelationList(scheda.posterioreA)) {
        addEdge(source, olderUs, "posteriore", true);
      }

      for (const youngerUs of toRelationList(scheda.anterioreA)) {
        addEdge(youngerUs, source, "posteriore", true);
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()).sort((a, b) => a.label.localeCompare(b.label)),
    edges: Array.from(edges.values()),
  };
}

function computeLayers(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const layers = new Map<string, number>();
  for (const node of nodes) {
    layers.set(node.key, 0);
  }

  const directedEdges = edges.filter((edge) => edge.directed);
  const maxIterations = Math.max(nodes.length * 2, 1);

  for (let i = 0; i < maxIterations; i += 1) {
    let changed = false;

    for (const edge of directedEdges) {
      const fromLayer = layers.get(edge.from) ?? 0;
      const toLayer = layers.get(edge.to) ?? 0;
      if (fromLayer + 1 > toLayer) {
        layers.set(edge.to, fromLayer + 1);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return layers;
}

function statusFill(status?: string | null): string {
  if (status === "error") return "#fee2e2";
  if (status === "warning") return "#fef3c7";
  if (status === "ok") return "#dcfce7";
  return "#e2e8f0";
}

function edgeColor(type: EdgeType): string {
  if (type === "copre") return "#0f766e";
  if (type === "riempie") return "#0369a1";
  if (type === "taglia") return "#b45309";
  if (type === "appoggia") return "#334155";
  if (type === "equivalenza") return "#7c3aed";
  return "#dc2626";
}

function edgeLabel(type: EdgeType): string {
  if (type === "copre") return "copre";
  if (type === "riempie") return "riempie";
  if (type === "taglia") return "taglia";
  if (type === "appoggia") return "app.";
  if (type === "equivalenza") return "eq";
  return "post";
}

function legendForMode(mode: HarrisMatrixMode): string {
  if (mode === "fisica") {
    return "Verde: copre. Blu: riempie. Arancio: taglia. Grigio: si appoggia. Viola tratteggiato: equivalenza.";
  }
  if (mode === "stratigrafica") {
    return "Rosso: relazioni essenziali di sequenza stratigrafica (posteriore/anteriore).";
  }
  return "Fisica + stratigrafica: verde copre, blu riempie, arancio taglia, grigio appoggia, viola equivalenza, rosso posteriore/anteriore.";
}

export function HarrisMatrix({
  usList,
  mode = "all",
}: {
  usList: USRelationRecord[];
  mode?: HarrisMatrixMode;
}) {
  const graph = useMemo(() => buildGraph(usList, mode), [mode, usList]);

  const layout = useMemo(() => {
    const layers = computeLayers(graph.nodes, graph.edges);
    const byLayer = new Map<number, GraphNode[]>();

    for (const node of graph.nodes) {
      const layer = layers.get(node.key) ?? 0;
      const current = byLayer.get(layer) || [];
      current.push(node);
      byLayer.set(layer, current);
    }

    const sortedLayers = Array.from(byLayer.entries()).sort((a, b) => a[0] - b[0]);
    const nodeWidth = 140;
    const nodeHeight = 46;
    const xGap = 54;
    const yGap = 78;
    const margin = 48;

    let maxColumns = 1;
    const positionedNodes: PositionedNode[] = [];

    for (const [, layerNodes] of sortedLayers) {
      layerNodes.sort((a, b) => a.label.localeCompare(b.label));
      maxColumns = Math.max(maxColumns, layerNodes.length);
    }

    for (let layerIndex = 0; layerIndex < sortedLayers.length; layerIndex += 1) {
      const [, layerNodes] = sortedLayers[layerIndex];
      layerNodes.forEach((node: GraphNode, columnIndex: number) => {
        const totalRowWidth = layerNodes.length * nodeWidth + (layerNodes.length - 1) * xGap;
        const totalCanvasWidth = maxColumns * nodeWidth + (maxColumns - 1) * xGap;
        const offsetX = margin + (totalCanvasWidth - totalRowWidth) / 2;

        positionedNodes.push({
          ...node,
          x: offsetX + columnIndex * (nodeWidth + xGap),
          y: margin + layerIndex * (nodeHeight + yGap),
        });
      });
    }

    const width = margin * 2 + maxColumns * nodeWidth + (maxColumns - 1) * xGap;
    const height =
      margin * 2 +
      Math.max(sortedLayers.length, 1) * nodeHeight +
      Math.max(sortedLayers.length - 1, 0) * yGap;

    const positions = new Map<string, PositionedNode>();
    for (const node of positionedNodes) {
      positions.set(node.key, node);
    }

    return {
      nodes: positionedNodes,
      positions,
      width,
      height,
      nodeWidth,
      nodeHeight,
    };
  }, [graph.edges, graph.nodes]);

  if (usList.length === 0) {
    return null;
  }

  return (
    <Card className="mb-5">
      <CardContent className="p-4">
        <div className="mb-3">
          <h3 className="font-semibold">Harris Matrix</h3>
          <p className="text-xs text-muted-foreground mt-1">{legendForMode(mode)}</p>
        </div>

        {graph.edges.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            Nessuna relazione disponibile nella modalita selezionata.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-muted/10">
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="max-w-none"
            >
              <defs>
                <marker
                  id="harris-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
                </marker>
              </defs>

              {graph.edges.map((edge) => {
                const from = layout.positions.get(edge.from);
                const to = layout.positions.get(edge.to);
                if (!from || !to) return null;

                const startX = from.x + layout.nodeWidth / 2;
                const startY = from.y + layout.nodeHeight;
                const endX = to.x + layout.nodeWidth / 2;
                const endY = to.y;

                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;

                const color = edgeColor(edge.type);
                const label = edgeLabel(edge.type);

                return (
                  <g key={edge.key}>
                    <line
                      x1={startX}
                      y1={startY}
                      x2={endX}
                      y2={endY}
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={edge.directed ? undefined : "5 4"}
                      markerEnd={edge.directed ? "url(#harris-arrow)" : undefined}
                      opacity={0.9}
                    />
                    <rect x={midX - 20} y={midY - 8} width={40} height={16} rx={4} fill="white" opacity={0.9} />
                    <text
                      x={midX}
                      y={midY + 4}
                      textAnchor="middle"
                      fontSize="9"
                      fill={color}
                      style={{ fontWeight: 600 }}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {layout.nodes.map((node) => {
                const fill = node.missing ? "#f8fafc" : statusFill(node.qcStatus);
                const stroke = node.missing ? "#94a3b8" : "#334155";

                return (
                  <g key={node.key}>
                    <rect
                      x={node.x}
                      y={node.y}
                      rx={9}
                      width={layout.nodeWidth}
                      height={layout.nodeHeight}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={1.2}
                    />
                    <text
                      x={node.x + layout.nodeWidth / 2}
                      y={node.y + 29}
                      textAnchor="middle"
                      fontSize="13"
                      fill="#0f172a"
                      style={{ fontWeight: 600 }}
                    >
                      {shortenLabel(node.label)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
