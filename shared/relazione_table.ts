// Impaginazione delle tabelle delle relazioni, condivisa tra editor ed export Word:
// misure (cm ↔ px del foglio) e risoluzione dei bordi di ogni cella.

import { RELAZIONE_TEXT_WIDTH_PX } from "./relazione_layout";

// Larghezza del testo nell'export Word: 9000 twips = 15,875 cm. Il foglio dell'editor (740 px) la rappresenta.
export const RELAZIONE_TEXT_WIDTH_CM = 15.875;
export const PX_PER_CM = RELAZIONE_TEXT_WIDTH_PX / RELAZIONE_TEXT_WIDTH_CM;
export const TWIPS_PER_CM = 1440 / 2.54;

export const pxToCm = (px: number) => px / PX_PER_CM;
export const cmToPx = (cm: number) => cm * PX_PER_CM;
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Bordi ────────────────────────────────────────────────────────────────────

export type PenStyle = "solid" | "dashed" | "dotted" | "double";
export const PEN_STYLES: { value: PenStyle; label: string }[] = [
  { value: "solid", label: "Continuo" },
  { value: "dashed", label: "Tratteggiato" },
  { value: "dotted", label: "Punteggiato" },
  { value: "double", label: "Doppio" },
];
// Spessori in pt, come nella finestra «Bordi» di LibreOffice
export const PEN_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

export type Pen = { s: PenStyle; w: number; c: string };
export type Edge = Pen | null;
export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];

// Bordi impostati su una cella: assenti = valgono quelli della tabella; "none" = nessuna linea
export type CellEdgeValue = Pen | "none";
export type CellBorders = Partial<Record<Side, CellEdgeValue>>;

// Disposizione delle linee della tabella
export const BORDER_PRESETS = ["all", "outer", "inner", "horizontal", "vertical", "header", "none"] as const;
export type BorderPreset = (typeof BORDER_PRESETS)[number];

export const PRESET_LABELS: Record<BorderPreset, string> = {
  all: "Tutte le linee",
  outer: "Solo riquadro esterno",
  inner: "Solo linee interne",
  horizontal: "Solo righe orizzontali",
  vertical: "Solo linee verticali",
  header: "Riquadro e linea sotto l'intestazione",
  none: "Nessun bordo",
};

export const DEFAULT_PEN: Pen = { s: "solid", w: 0.5, c: "#888888" };

const PEN_STYLE_SET = new Set<string>(PEN_STYLES.map((p) => p.value));
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizePen(raw: unknown, fallback: Pen = DEFAULT_PEN): Pen {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = Number(r.w);
  return {
    s: PEN_STYLE_SET.has(String(r.s)) ? (r.s as PenStyle) : fallback.s,
    w: Number.isFinite(w) && w > 0 ? Math.min(w, 12) : fallback.w,
    c: HEX.test(String(r.c || "")) ? String(r.c).toLowerCase() : fallback.c,
  };
}

export function normalizePreset(raw: unknown): BorderPreset {
  return (BORDER_PRESETS as readonly string[]).includes(String(raw)) ? (raw as BorderPreset) : "all";
}

export function normalizeCellBorders(raw: unknown, base: Pen): CellBorders {
  if (!raw || typeof raw !== "object") return {};
  const out: CellBorders = {};
  for (const side of SIDES) {
    const v = (raw as Record<string, unknown>)[side];
    if (v === "none") out[side] = "none";
    else if (v && typeof v === "object") out[side] = normalizePen(v, base);
  }
  return out;
}

export type TableLook = { preset: BorderPreset; pen: Pen };

export function tableLook(attrs: Record<string, any> | null | undefined): TableLook {
  return {
    preset: normalizePreset(attrs?.borders),
    pen: normalizePen({ s: attrs?.lineStyle, w: attrs?.lineWidth, c: attrs?.lineColor }),
  };
}

// Posizione di una cella nella griglia della tabella
export type GridCell = { key: number; row: number; col: number; rowspan: number; colspan: number; borders?: CellBorders };

// Una linea orizzontale (y) o verticale (x) della griglia: esterna se sul bordo della tabella
function presetEdge(preset: BorderPreset, pen: Pen, horizontal: boolean, index: number, last: number): Edge {
  const outer = index === 0 || index === last;
  switch (preset) {
    case "all": return pen;
    case "none": return null;
    case "outer": return outer ? pen : null;
    case "inner": return outer ? null : pen;
    case "horizontal": return horizontal ? pen : null;
    case "vertical": return horizontal ? null : pen;
    case "header": return outer || (horizontal && index === 1) ? pen : null;
  }
}

export type ResolvedBorders = Record<Side, Edge>;

// Bordo effettivo dei quattro lati di ogni cella: prima quanto impostato sulla cella (o sulla cella
// affacciata, così le due metà di una stessa linea coincidono), altrimenti la disposizione della tabella.
export function resolveCellBorders(look: TableLook, cells: GridCell[], rows: number, cols: number): Map<number, ResolvedBorders> {
  const at = new Map<string, GridCell>();
  for (const c of cells) for (let r = c.row; r < c.row + c.rowspan; r++) for (let k = c.col; k < c.col + c.colspan; k++) at.set(`${r}:${k}`, c);

  const explicit = (c: GridCell, side: Side): CellEdgeValue | undefined => c.borders?.[side];
  const neighbours = (c: GridCell, side: Side): GridCell[] => {
    const out: GridCell[] = [];
    const push = (n: GridCell | undefined) => { if (n && n !== c && !out.includes(n)) out.push(n); };
    if (side === "top" || side === "bottom") {
      const r = side === "top" ? c.row - 1 : c.row + c.rowspan;
      for (let k = c.col; k < c.col + c.colspan; k++) push(at.get(`${r}:${k}`));
    } else {
      const k = side === "left" ? c.col - 1 : c.col + c.colspan;
      for (let r = c.row; r < c.row + c.rowspan; r++) push(at.get(`${r}:${k}`));
    }
    return out;
  };
  const facing: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

  const out = new Map<number, ResolvedBorders>();
  for (const c of cells) {
    const res = {} as ResolvedBorders;
    for (const side of SIDES) {
      let value = explicit(c, side);
      if (value === undefined) {
        for (const n of neighbours(c, side)) {
          const v = explicit(n, facing[side]);
          if (v !== undefined) { value = v; break; }
        }
      }
      if (value === undefined) {
        const horizontal = side === "top" || side === "bottom";
        const index = side === "top" ? c.row : side === "bottom" ? c.row + c.rowspan : side === "left" ? c.col : c.col + c.colspan;
        res[side] = presetEdge(look.preset, look.pen, horizontal, index, horizontal ? rows : cols);
      } else {
        res[side] = value === "none" ? null : value;
      }
    }
    out.set(c.key, res);
  }
  return out;
}

export const penCss = (p: Pen) => `${p.w}pt ${p.s} ${p.c}`;

export function bordersCss(b: ResolvedBorders): string {
  return SIDES.map((s) => `border-${s}:${b[s] ? penCss(b[s]!) : "none"}`).join(";");
}
