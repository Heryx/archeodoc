import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

type GNode = { id: string; kind: "doc" | "us"; label: string; sub?: string | null; ref: number };
type GEdge = { from: string; to: string; kind: "cita" | "copre" | "si_lega_a" | "uguale_a" };
type GraphResponse = { nodes: GNode[]; edges: GEdge[] };
type Sim = GNode & { x: number; y: number; vx: number; vy: number; fixed?: boolean; deg: number };

const W = 900;
const H = 560;

const EDGE_STYLE: Record<GEdge["kind"], { stroke: string; dash?: string; label: string }> = {
  cita: { stroke: "hsl(var(--primary))", label: "citazione nel testo" },
  copre: { stroke: "hsl(var(--muted-foreground))", dash: "4 3", label: "copre" },
  si_lega_a: { stroke: "hsl(var(--muted-foreground))", dash: "1 3", label: "si lega a" },
  uguale_a: { stroke: "hsl(var(--muted-foreground))", dash: "8 3", label: "uguale a" },
};

export function RelazioniGrafo({ cantiereId }: { cantiereId: number }) {
  const [, navigate] = useLocation();
  const [strat, setStrat] = useState(false);
  const [, setTick] = useState(0);
  const sim = useRef<Sim[]>([]);
  const raf = useRef<number>();
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ node?: Sim; pan?: { x: number; y: number }; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { data, isLoading } = useQuery<GraphResponse>({
    queryKey: ["/api/cantieri", String(cantiereId), "relazioni-grafo", strat],
    queryFn: async () =>
      (await apiRequest("GET", `/api/cantieri/${cantiereId}/relazioni-grafo${strat ? "?stratigrafia=1" : ""}`)).json(),
  });

  // Layout a forze: repulsione tra nodi, molle sugli archi, attrazione al centro
  useEffect(() => {
    if (!data) return;
    const deg = new Map<string, number>();
    data.edges.forEach((e) => { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); });
    const n = data.nodes.length;
    sim.current = data.nodes.map((node, i) => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2;
      const r = 80 + Math.sqrt(n) * 18;
      return { ...node, x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, vx: 0, vy: 0, deg: deg.get(node.id) || 0 };
    });
    const index = new Map(sim.current.map((s) => [s.id, s]));
    const links = data.edges
      .map((e) => [index.get(e.from), index.get(e.to)] as const)
      .filter((l): l is readonly [Sim, Sim] => !!l[0] && !!l[1]);

    let alpha = 1;
    let fitted = false;
    // Inquadra l'intero grafo quando la simulazione si è quasi stabilizzata
    const fit = () => {
      const xs = sim.current.map((n) => n.x), ys = sim.current.map((n) => n.y);
      if (!xs.length) return;
      const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40;
      const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
      const k = Math.min(W / (maxX - minX), H / (maxY - minY), 1.5);
      view.current = { k, x: (W - (maxX - minX) * k) / 2 - minX * k, y: (H - (maxY - minY) * k) / 2 - minY * k };
    };
    const step = () => {
      const nodes = sim.current;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          if (d2 > 90000) continue;
          const d = Math.sqrt(d2);
          const f = (2200 / d2) * alpha;
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }
      for (const [a, b] of links) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 90) * 0.02 * alpha;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const s of nodes) {
        s.vx += (W / 2 - s.x) * 0.004 * alpha;
        s.vy += (H / 2 - s.y) * 0.004 * alpha;
        if (s.fixed) { s.vx = 0; s.vy = 0; continue; }
        s.x += s.vx; s.y += s.vy;
        s.vx *= 0.6; s.vy *= 0.6;
      }
      alpha = Math.max(alpha * 0.985, drag.current ? 0.15 : 0.0);
      if (!fitted && alpha < 0.05) { fitted = true; fit(); }
      setTick((t) => t + 1);
      if (alpha > 0.005 || drag.current) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [data]);

  const toGraph = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    const sy = ((clientY - rect.top) / rect.height) * H;
    return { x: (sx - view.current.x) / view.current.k, y: (sy - view.current.y) / view.current.k, sx, sy };
  };

  const kick = () => {
    // Riavvia la simulazione dopo un trascinamento
    if (raf.current) cancelAnimationFrame(raf.current);
    const loop = () => {
      setTick((t) => t + 1);
      if (drag.current) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };

  const open = (s: Sim) => {
    if (s.kind === "doc") navigate(`/cantiere/${cantiereId}/documentazioni?openDocId=${s.ref}`);
    else navigate(`/cantiere/${cantiereId}/us?openUsId=${s.ref}`);
  };

  const nodes = sim.current;
  const index = new Map(nodes.map((s) => [s.id, s]));
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (data?.edges || []).forEach((e) => {
      (m.get(e.from) || m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) || m.set(e.to, new Set()).get(e.to)!).add(e.from);
    });
    return m;
  }, [data]);
  const lit = (id: string) => !hover || id === hover || neighbors.get(hover)?.has(id);

  const docCount = data?.nodes.filter((x) => x.kind === "doc").length || 0;
  const usCount = data?.nodes.filter((x) => x.kind === "us").length || 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Grafo dei collegamenti: i documenti sono quadrati, le US cerchi. Una linea piena indica una US citata con [[link]]
          in un documento. Trascina i nodi, scorri per ingrandire, clicca per aprire.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={strat} onChange={(e) => setStrat(e.target.checked)} />
          Mostra tutte le US e le relazioni stratigrafiche
        </label>
      </div>

      <div className="rounded border border-border bg-background overflow-hidden relative">
        {isLoading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin" /></div>}
        {data && data.nodes.length === 0 && (
          <div className="p-8 text-sm text-muted-foreground text-center">
            Nessun collegamento ancora. Scrivi <code className="bg-muted px-1 rounded">[[</code> in un documento per citare una US.
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-[560px] select-none cursor-grab active:cursor-grabbing"
          onWheel={(e) => {
            e.preventDefault();
            const { x, y, sx, sy } = toGraph(e.clientX, e.clientY);
            const k = Math.min(4, Math.max(0.25, view.current.k * (e.deltaY < 0 ? 1.12 : 0.89)));
            view.current = { k, x: sx - x * k, y: sy - y * k };
            setTick((t) => t + 1);
          }}
          onMouseDown={(e) => {
            if ((e.target as Element).closest("[data-node]")) return;
            const { sx, sy } = toGraph(e.clientX, e.clientY);
            drag.current = { pan: { x: sx - view.current.x, y: sy - view.current.y }, moved: false };
          }}
          onMouseMove={(e) => {
            const d = drag.current;
            if (!d) return;
            d.moved = true;
            const g = toGraph(e.clientX, e.clientY);
            if (d.node) { d.node.x = g.x; d.node.y = g.y; d.node.vx = d.node.vy = 0; }
            else if (d.pan) view.current = { ...view.current, x: g.sx - d.pan.x, y: g.sy - d.pan.y };
            setTick((t) => t + 1);
          }}
          onMouseUp={() => {
            if (drag.current?.node) drag.current.node.fixed = false;
            drag.current = null;
          }}
          onMouseLeave={() => { if (drag.current?.node) drag.current.node.fixed = false; drag.current = null; }}
        >
          <g transform={`translate(${view.current.x} ${view.current.y}) scale(${view.current.k})`}>
            {(data?.edges || []).map((e, i) => {
              const a = index.get(e.from), b = index.get(e.to);
              if (!a || !b) return null;
              const st = EDGE_STYLE[e.kind];
              const on = !hover || e.from === hover || e.to === hover;
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={st.stroke} strokeDasharray={st.dash}
                  strokeWidth={e.kind === "cita" ? 1.6 : 1} opacity={on ? (e.kind === "cita" ? 0.8 : 0.5) : 0.08} />
              );
            })}
            {nodes.map((s) => {
              const isDoc = s.kind === "doc";
              const r = isDoc ? 11 : 6 + Math.min(s.deg, 6);
              return (
                <g
                  key={s.id}
                  data-node
                  transform={`translate(${s.x} ${s.y})`}
                  opacity={lit(s.id) ? 1 : 0.15}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(s.id)}
                  onMouseLeave={() => setHover(null)}
                  onMouseDown={(e) => { e.stopPropagation(); s.fixed = true; drag.current = { node: s, moved: false }; kick(); }}
                  onMouseUp={() => { if (drag.current && !drag.current.moved) open(s); }}
                >
                  {isDoc
                    ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill="hsl(var(--primary))" />
                    : <circle r={r} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth={1.5} />}
                  <text y={isDoc ? r + 12 : r + 11} textAnchor="middle" fontSize={10} fill="hsl(var(--foreground))"
                    fontWeight={isDoc ? 600 : 400}>
                    {s.label.length > 28 ? s.label.slice(0, 27) + "…" : s.label}
                  </text>
                  {hover === s.id && s.sub && (
                    <text y={isDoc ? r + 24 : r + 23} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">
                      {s.sub.length > 50 ? s.sub.slice(0, 49) + "…" : s.sub}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{docCount} documenti · {usCount} US</span>
        {Object.entries(EDGE_STYLE).filter(([k]) => strat || k === "cita").map(([k, st]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke={st.stroke} strokeDasharray={st.dash} strokeWidth="1.5" /></svg>
            {st.label}
          </span>
        ))}
      </div>
    </div>
  );
}
