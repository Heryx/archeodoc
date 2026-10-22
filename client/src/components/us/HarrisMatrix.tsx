import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Crosshair,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatUsCode, type TombaCodeStyle } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import { layoutHarrisMatrix } from "@shared/matrix_layout";

export type HarrisMatrixMode = "all" | "fisica" | "stratigrafica";

type USRelationRecord = {
  id?: number | string | null;
  codiceUS: string;
  tipo?: string | null;
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

/** Nodo paradati/unita' virtuali (come restituito da /em/nodi); qui contano solo le unita' virtuali. */
export type MatrixEmNode = {
  uid: string;
  nodeType: string;
  links: { sopraA?: string[]; sottoA?: string[] };
};

const VIRTUAL_NODE_TYPES = new Set(["USVs", "USVn", "VSF"]);

type GraphNode = {
  key: string;
  label: string;
  /** Unita' virtuale (nodo virtuale), non una US dell'elenco. */
  virtual?: boolean;
  qcStatus?: string | null;
  missing: boolean;
  usId?: number | string | null;
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
  // "US 102", "US102" e "102" sono lo stesso nodo
  return value.trim().replace(/\s+/g, " ").toUpperCase().replace(/^US\.?\s*(?=\d)/, "");
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

function shortenLabel(value: string, max = 14): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Ordinamento naturale: US 2 prima di US 10. */
function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function buildGraph(
  usList: USRelationRecord[],
  mode: HarrisMatrixMode,
  tombaStyle: TombaCodeStyle,
  emNodes: MatrixEmNode[] = [],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const virtualNodes = emNodes.filter((n) => VIRTUAL_NODE_TYPES.has(n.nodeType));
  const virtualKeys = new Set(virtualNodes.map((n) => normalizeCodeKey(n.uid)));

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
        missing: existing.missing && (meta?.missing ?? existing.missing),
        usId: existing.usId ?? meta?.usId ?? null,
      });
      return;
    }

    nodes.set(key, {
      key,
      label: meta?.label || code,
      qcStatus: meta?.qcStatus,
      missing: !!meta?.missing,
      usId: meta?.usId ?? null,
    });
  };

  const addEdge = (fromCode: string, toCode: string, type: EdgeType, directed: boolean) => {
    const from = normalizeCodeKey(fromCode);
    const to = normalizeCodeKey(toCode);
    if (!from || !to || from === to) return;

    // Le unita' virtuali hanno gia' il loro nodo: non si ricalcola l'etichetta come per una US.
    if (!virtualKeys.has(from)) ensureNode(fromCode, { label: formatUsCode(fromCode, null, tombaStyle), missing: true });
    if (!virtualKeys.has(to)) ensureNode(toCode, { label: formatUsCode(toCode, null, tombaStyle), missing: true });

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
      label: formatUsCode(us.codiceUS, us.tipo, tombaStyle),
      qcStatus: us.qcStatus,
      missing: false,
      usId: us.id ?? null,
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

  // Unita' virtuali: sequenza (is_after) con US e con altre unita' virtuali.
  if (includeStratigrafica) {
    for (const v of virtualNodes) {
      ensureNode(v.uid, { label: v.uid, missing: false, virtual: true });
    }
    for (const v of virtualNodes) {
      for (const lower of v.links.sopraA ?? []) addEdge(v.uid, lower, "posteriore", true);
      for (const upper of v.links.sottoA ?? []) addEdge(upper, v.uid, "posteriore", true);
    }
  }

  return {
    nodes: Array.from(nodes.values()).sort((a, b) => compareLabels(a.label, b.label)),
    edges: Array.from(edges.values()),
  };
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

const EDGE_TYPE_LABEL: Record<EdgeType, string> = {
  copre: "Copre",
  riempie: "Riempie",
  taglia: "Taglia",
  appoggia: "Si appoggia",
  equivalenza: "Equivalenza",
  posteriore: "Posteriore / anteriore",
};

function legendForMode(mode: HarrisMatrixMode): string {
  if (mode === "fisica") {
    return "Verde: copre. Blu: riempie. Arancio: taglia. Grigio: si appoggia. Viola tratteggiato: equivalenza.";
  }
  if (mode === "stratigrafica") {
    return "Rosso: relazioni essenziali di sequenza stratigrafica (posteriore/anteriore).";
  }
  return "Fisica + stratigrafica: verde copre, blu riempie, arancio taglia, grigio appoggia, viola equivalenza, rosso posteriore/anteriore.";
}

const NODE_WIDTH = 96;
const NODE_HEIGHT = 44;
const X_GAP = 40;
const Y_GAP = 90;
const MARGIN = 40;

const VIEWPORT_HEIGHT = 560;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function HarrisMatrix({
  usList,
  mode = "all",
  cantiereId,
  emNodes,
}: {
  usList: USRelationRecord[];
  mode?: HarrisMatrixMode;
  cantiereId?: string;
  emNodes?: MatrixEmNode[];
}) {
  const { settings: codeSettings } = useProjectCodeSettings();
  const graph = useMemo(
    () => buildGraph(usList, mode, codeSettings.tombaStyle, emNodes),
    [mode, usList, codeSettings.tombaStyle, emNodes],
  );

  const { layout, isolated } = useMemo(() => {
    const connectedKeys = new Set<string>();
    for (const edge of graph.edges) {
      connectedKeys.add(edge.from);
      connectedKeys.add(edge.to);
    }
    const connectedNodes = graph.nodes.filter((node) => connectedKeys.has(node.key));
    const isolatedNodes = graph.nodes
      .filter((node) => !connectedKeys.has(node.key))
      .sort((a, b) => compareLabels(a.label, b.label));

    if (connectedNodes.length === 0) {
      return { layout: null, isolated: isolatedNodes };
    }

    // Layout condiviso con l'export PDF/SVG (shared/matrix_layout).
    const result = layoutHarrisMatrix(connectedNodes, graph.edges, {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      xGap: X_GAP,
      yGap: Y_GAP,
      margin: MARGIN,
    });

    const positionedNodes: PositionedNode[] = connectedNodes.map((node) => {
      const pos = result.positions.get(node.key)!;
      return { ...node, x: pos.x, y: pos.y };
    });
    const positions = new Map<string, PositionedNode>();
    for (const node of positionedNodes) {
      positions.set(node.key, node);
    }

    return {
      layout: { nodes: positionedNodes, positions, width: result.width, height: result.height },
      isolated: isolatedNodes,
    };
  }, [graph.edges, graph.nodes]);

  // Catene stratigrafiche: risalita agli antenati e discesa ai discendenti.
  const chain = useMemo(() => {
    const out = new Map<string, Set<string>>();
    const inc = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, from: string, to: string) => {
      const set = map.get(from) ?? new Set<string>();
      set.add(to);
      map.set(from, set);
    };
    for (const edge of graph.edges) {
      if (edge.directed) {
        add(out, edge.from, edge.to);
        add(inc, edge.to, edge.from);
      } else {
        add(out, edge.from, edge.to);
        add(out, edge.to, edge.from);
        add(inc, edge.from, edge.to);
        add(inc, edge.to, edge.from);
      }
    }
    return { out, inc };
  }, [graph.edges]);

  const relatedTo = useCallback(
    (key: string) => {
      const acc = new Set<string>([key]);
      const walk = (map: Map<string, Set<string>>) => {
        const stack = [key];
        while (stack.length) {
          const current = stack.pop()!;
          Array.from(map.get(current) ?? []).forEach((next) => {
            if (!acc.has(next)) {
              acc.add(next);
              stack.push(next);
            }
          });
        }
      };
      walk(chain.out);
      walk(chain.inc);
      return acc;
    },
    [chain],
  );

  const edgeTypesPresent = useMemo(() => {
    const seen = new Set<EdgeType>();
    for (const edge of graph.edges) seen.add(edge.type);
    return (Object.keys(EDGE_TYPE_LABEL) as EdgeType[]).filter((type) => seen.has(type));
  }, [graph.edges]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<EdgeType>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [isPanning, setIsPanning] = useState(false);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const k = clamp(
      Math.min(w / layout.width, h / layout.height),
      MIN_SCALE,
      1.2,
    );
    setView({
      k,
      x: (w - layout.width * k) / 2,
      y: Math.max((h - layout.height * k) / 2, 12),
    });
  }, [layout]);

  const centerOn = useCallback(
    (node: PositionedNode, targetScale?: number) => {
      const el = containerRef.current;
      if (!el) return;
      setView((prev) => {
        const k = clamp(targetScale ?? Math.max(prev.k, 0.8), MIN_SCALE, MAX_SCALE);
        const cx = node.x + NODE_WIDTH / 2;
        const cy = node.y + NODE_HEIGHT / 2;
        return {
          k,
          x: el.clientWidth / 2 - cx * k,
          y: el.clientHeight / 2 - cy * k,
        };
      });
    },
    [],
  );

  // Fit iniziale e a ogni cambio di grafo/modalita.
  useLayoutEffect(() => {
    fitView();
    setPinnedKey(null);
    setHoverKey(null);
  }, [fitView]);

  // Zoom con rotella (listener nativo non passivo per poter usare preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((prev) => {
        const k = clamp(prev.k * factor, MIN_SCALE, MAX_SCALE);
        const ratio = k / prev.k;
        return {
          k,
          x: px - (px - prev.x) * ratio,
          y: py - (py - prev.y) * ratio,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout]);

  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    setView((prev) => {
      const k = clamp(prev.k * factor, MIN_SCALE, MAX_SCALE);
      const ratio = k / prev.k;
      const px = el ? el.clientWidth / 2 : 0;
      const py = el ? el.clientHeight / 2 : 0;
      return {
        k,
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
      };
    });
  }, []);

  const resetView = useCallback(() => {
    setView({ k: 1, x: 24, y: 16 });
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Non avviare il pan (che cattura il puntatore) sui controlli o sui link.
    if ((event.target as Element).closest("a, button, input, form, label")) return;
    if (event.button !== 0) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
    setView((prev) => ({ ...prev, x: pan.originX + dx, y: pan.originY + dy }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const runSearch = useCallback(
    (raw: string) => {
      if (!layout) return;
      const term = normalizeCodeKey(raw);
      if (!term) {
        setPinnedKey(null);
        return;
      }
      const match =
        layout.nodes.find((node) => node.key === term) ||
        layout.nodes.find((node) => node.key.includes(term)) ||
        isolated.find((node) => node.key === term || node.key.includes(term));
      if (!match) return;
      if ("x" in match) {
        setPinnedKey(match.key);
        centerOn(match as PositionedNode, 1);
      }
    },
    [layout, isolated, centerOn],
  );

  const toggleType = (type: EdgeType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (usList.length === 0) {
    return null;
  }

  const canOpen = (node: GraphNode): node is GraphNode & { usId: number | string } =>
    !!cantiereId && node.usId !== null && node.usId !== undefined;

  // La navigazione avviene via hash (#/path?query) per restare compatibile con
  // l'helper extractSearchFromLocation usato dalla pagina Schede US.
  const schedaHref = (node: GraphNode) =>
    canOpen(node) ? `#/cantiere/${cantiereId}/us?openUsId=${node.usId}` : undefined;

  const activeKey = hoverKey ?? pinnedKey;
  const activeNodes = activeKey ? relatedTo(activeKey) : null;
  const visibleEdges = graph.edges.filter((edge) => !hiddenTypes.has(edge.type));

  const isDimmed = (key: string) => !!activeNodes && !activeNodes.has(key);

  const renderNode = (node: PositionedNode) => {
    const href = schedaHref(node);
    const fill = node.virtual ? "#ede9fe" : node.missing ? "#f1f5f9" : statusFill(node.qcStatus);
    const stroke = node.virtual ? "#7c3aed" : node.missing ? "#94a3b8" : "#334155";
    const dimmed = isDimmed(node.key);
    const focused = node.key === activeKey;
    const pinned = node.key === pinnedKey;

    const body = (
      <g
        opacity={dimmed ? 0.12 : 1}
        onMouseEnter={() => setHoverKey(node.key)}
        onMouseLeave={() => setHoverKey((cur) => (cur === node.key ? null : cur))}
        style={{ transition: "opacity 120ms" }}
      >
        <title>
          {node.label}
          {node.virtual ? " — unità virtuale" : ""}
          {node.missing ? " — non presente nell'elenco" : ""}
          {href ? " — apri scheda" : ""}
        </title>
        {(focused || pinned) && (
          <rect
            x={node.x - 4}
            y={node.y - 4}
            rx={12}
            width={NODE_WIDTH + 8}
            height={NODE_HEIGHT + 8}
            fill="none"
            stroke={pinned ? "#dc2626" : "#2563eb"}
            strokeWidth={2.5}
          />
        )}
        <rect
          x={node.x}
          y={node.y}
          rx={9}
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          fill={fill}
          stroke={stroke}
          strokeWidth={node.missing ? 1.2 : 1.4}
          strokeDasharray={node.virtual ? "2 2" : node.missing ? "4 3" : undefined}
        />
        <text
          x={node.x + NODE_WIDTH / 2}
          y={node.y + NODE_HEIGHT / 2 + 4}
          textAnchor="middle"
          fontSize="13"
          fill="#0f172a"
          style={{ fontWeight: 600 }}
        >
          {shortenLabel(node.label, 12)}
        </text>
      </g>
    );

    if (href) {
      return (
        <a key={node.key} href={href} className="cursor-pointer">
          {body}
        </a>
      );
    }

    return <g key={node.key}>{body}</g>;
  };

  return (
    <Card className="mb-5">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Harris Matrix</h3>
            <p className="text-xs text-muted-foreground mt-1">{legendForMode(mode)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rotella per zoom, trascina per spostare, passa sopra una US per
              evidenziarne la catena
              {cantiereId ? ", clicca per aprire la scheda." : "."}
            </p>
          </div>

          {layout && (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch(searchTerm);
              }}
            >
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    if (!event.target.value.trim()) setPinnedKey(null);
                  }}
                  placeholder="Trova US…"
                  className="h-8 w-36 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <button
                type="submit"
                className="h-8 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Vai
              </button>
            </form>
          )}
        </div>

        {edgeTypesPresent.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {edgeTypesPresent.map((type) => {
              const hidden = hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    hidden
                      ? "border-dashed border-border text-muted-foreground line-through"
                      : "border-border hover:bg-accent"
                  }`}
                  title={hidden ? "Mostra relazione" : "Nascondi relazione"}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: edgeColor(type), opacity: hidden ? 0.3 : 1 }}
                  />
                  {EDGE_TYPE_LABEL[type]}
                </button>
              );
            })}
          </div>
        )}

        {layout ? (
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-md border border-border bg-muted/10 select-none"
            style={{ height: VIEWPORT_HEIGHT, cursor: isPanning ? "grabbing" : "grab" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <svg width="100%" height="100%">
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

              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {visibleEdges.map((edge, edgeIndex) => {
                  const a = layout.positions.get(edge.from);
                  const b = layout.positions.get(edge.to);
                  if (!a || !b) return null;

                  const color = edgeColor(edge.type);
                  const dimmed =
                    !!activeNodes &&
                    !(activeNodes.has(edge.from) && activeNodes.has(edge.to));
                  const opacity = dimmed ? 0.08 : 0.85;
                  const strokeWidth = dimmed ? 1.5 : 2;

                  if (Math.abs(a.y - b.y) < 1) {
                    const left = a.x <= b.x ? a : b;
                    const right = a.x <= b.x ? b : a;
                    const y = left.y + NODE_HEIGHT / 2;
                    return (
                      <line
                        key={edge.key}
                        x1={left.x + NODE_WIDTH}
                        y1={y}
                        x2={right.x}
                        y2={y}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={edge.directed ? undefined : "5 4"}
                        markerEnd={edge.directed ? "url(#harris-arrow)" : undefined}
                        opacity={opacity}
                      />
                    );
                  }

                  const upper = a.y <= b.y ? a : b;
                  const lower = a.y <= b.y ? b : a;
                  const x1 = upper.x + NODE_WIDTH / 2;
                  const y1 = upper.y + NODE_HEIGHT;
                  const x2 = lower.x + NODE_WIDTH / 2;
                  const y2 = lower.y;

                  if (Math.abs(x1 - x2) < 1) {
                    return (
                      <line
                        key={edge.key}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={edge.directed ? undefined : "5 4"}
                        markerEnd={edge.directed ? "url(#harris-arrow)" : undefined}
                        opacity={opacity}
                      />
                    );
                  }

                  const stagger = ((edgeIndex % 5) - 2) * 8;
                  const channelY = Math.min(
                    y2 - 10,
                    Math.max(y1 + 10, (y1 + y2) / 2 + stagger),
                  );

                  return (
                    <path
                      key={edge.key}
                      d={`M ${x1} ${y1} L ${x1} ${channelY} L ${x2} ${channelY} L ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeLinejoin="round"
                      strokeDasharray={edge.directed ? undefined : "5 4"}
                      markerEnd={edge.directed ? "url(#harris-arrow)" : undefined}
                      opacity={opacity}
                    />
                  );
                })}

                {layout.nodes.map(renderNode)}
              </g>
            </svg>

            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => zoomBy(1.2)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm hover:bg-accent"
                title="Ingrandisci"
              >
                <Plus size={15} />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.2)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm hover:bg-accent"
                title="Riduci"
              >
                <Minus size={15} />
              </button>
              <button
                type="button"
                onClick={fitView}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm hover:bg-accent"
                title="Adatta alla vista"
              >
                <Maximize2 size={14} />
              </button>
              <button
                type="button"
                onClick={resetView}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm hover:bg-accent"
                title="Zoom 100%"
              >
                <RotateCcw size={14} />
              </button>
              {activeKey && (
                <button
                  type="button"
                  onClick={() => {
                    setPinnedKey(null);
                    setHoverKey(null);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm hover:bg-accent"
                  title="Togli evidenziazione"
                >
                  <Crosshair size={14} />
                </button>
              )}
            </div>

            <div className="absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {Math.round(view.k * 100)}%
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            Nessuna relazione disponibile nella modalita selezionata.
          </div>
        )}

        {isolated.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              US senza relazioni in questa modalita ({isolated.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {isolated.map((node) => {
                const href = schedaHref(node);
                if (!href) {
                  return (
                    <span
                      key={node.key}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium opacity-70"
                    >
                      {node.label}
                    </span>
                  );
                }
                return (
                  <a
                    key={node.key}
                    href={href}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {node.label}
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
