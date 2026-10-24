import { useState } from "react";
import { Extension, findParentNode, type Editor } from "@tiptap/react";
import { Table, TableCell, TableHeader, TableRow, TableView } from "@tiptap/extension-table";
import { CellSelection, TableMap, selectedRect } from "@tiptap/pm/tables";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Merge, Plus, Rows3, Settings2, Split, Table as TableIcon, Trash2,
} from "lucide-react";
import { RELAZIONE_TEXT_WIDTH_PX } from "@shared/relazione_layout";
import {
  BORDER_PRESETS, DEFAULT_PEN, PEN_STYLES, PEN_WIDTHS, PRESET_LABELS, PX_PER_CM, RELAZIONE_TEXT_WIDTH_CM,
  bordersCss, cmToPx, normalizeCellBorders, normalizePen, pxToCm, resolveCellBorders, round1, round2, tableLook,
  type BorderPreset, type CellBorders, type GridCell, type Pen, type PenStyle, type Side,
} from "@shared/relazione_table";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  NumField, PanelSection as Section, PanelTool as Tool, RibbonBig, RibbonBtn, RibbonGroup, RibbonRow, RibbonStack,
  useScrollToSection,
} from "@/components/relazioni/Ribbon";

// ─── Estensioni: celle, righe e tabella ───────────────────────────────────────

const jsonAttr = (name: string) => ({
  default: null as Record<string, unknown> | null,
  parseHTML: (el: HTMLElement) => {
    try { return JSON.parse(el.getAttribute(name) || "null"); } catch { return null; }
  },
  renderHTML: (attrs: Record<string, any>) => {
    const v = attrs.border;
    return v && Object.keys(v).length ? { [name]: JSON.stringify(v) } : {};
  },
});

const cellExtra = {
  background: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute("data-bg") || null,
    renderHTML: (attrs: Record<string, any>) => (attrs.background ? { "data-bg": attrs.background, style: `background-color:${attrs.background}` } : {}),
  },
  valign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.verticalAlign || null,
    renderHTML: (attrs: Record<string, any>) => (attrs.valign ? { style: `vertical-align:${attrs.valign}` } : {}),
  },
  // Bordi propri della cella, per lato; ciò che manca segue la disposizione scelta per la tabella
  border: jsonAttr("data-border"),
};

export const RTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellExtra };
  },
});

export const RTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellExtra };
  },
});

// Altezza minima della riga, in cm (null = secondo il contenuto)
export const RTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-height")) || null,
        renderHTML: (attrs: Record<string, any>) =>
          attrs.height > 0 ? { "data-height": attrs.height, style: `height:${round1(attrs.height * PX_PER_CM)}px` } : {},
      },
    };
  },
});

// La vista di base non aggiorna gli attributi della tabella dopo la creazione
class RTableView extends TableView {
  constructor(node: PmNode, cellMinWidth: number, view?: any, attrs?: Record<string, any>) {
    super(node, cellMinWidth, view, attrs);
    this.sync(node);
  }
  update(node: PmNode) {
    const ok = super.update(node);
    if (ok) this.sync(node);
    return ok;
  }
  private sync(node: PmNode) {
    const { align, cellPadding } = node.attrs;
    this.table.style.marginLeft = align === "center" || align === "right" ? "auto" : "";
    this.table.style.marginRight = align === "center" ? "auto" : "";
    if (Number(cellPadding) > 0) this.table.style.setProperty("--cp", `${cellPadding}mm`);
    else this.table.style.removeProperty("--cp");
  }
}

const dataAttr = (name: string, key: string, def: unknown, num = false) => ({
  default: def,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(name);
    return v == null || v === "" ? def : num ? Number(v) || def : v;
  },
  renderHTML: (attrs: Record<string, any>) => (attrs[key] != null && attrs[key] !== def ? { [name]: attrs[key] } : {}),
});

export const RTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // disposizione delle linee (tutte, solo esterne, …) e penna di base
      borders: dataAttr("data-borders", "borders", "all"),
      lineStyle: dataAttr("data-line-style", "lineStyle", null),
      lineWidth: dataAttr("data-line-width", "lineWidth", null, true),
      lineColor: dataAttr("data-line-color", "lineColor", null),
      align: dataAttr("data-align", "align", null),
      // spaziatura interna delle celle, in mm
      cellPadding: dataAttr("data-padding", "cellPadding", null, true),
    };
  },
}).configure({ resizable: true, cellMinWidth: 40, View: RTableView as any });

// ─── Griglia e bordi di ogni cella ────────────────────────────────────────────

type TableRef = { pos: number; start: number; node: PmNode };

function gridOf(table: PmNode) {
  const map = TableMap.get(table);
  const look = tableLook(table.attrs);
  const cells: GridCell[] = [];
  for (const offset of Array.from(new Set(map.map))) {
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const r = map.findCell(offset);
    cells.push({
      key: offset, row: r.top, col: r.left, rowspan: r.bottom - r.top, colspan: r.right - r.left,
      borders: normalizeCellBorders(cell.attrs.border, look.pen),
    });
  }
  return { map, look, cells };
}

// CSS dei bordi di ogni cella (chiave: offset nella tabella). Le tabelle non modificate sono la stessa
// istanza tra una transazione e l'altra, quindi il risultato si riutilizza.
const cssCache = new WeakMap<PmNode, Map<number, string>>();

function cellBorderCss(table: PmNode): Map<number, string> {
  const hit = cssCache.get(table);
  if (hit) return hit;
  const { map, look, cells } = gridOf(table);
  const resolved = resolveCellBorders(look, cells, map.height, map.width);
  const out = new Map<number, string>();
  resolved.forEach((b, key) => out.set(key, bordersCss(b)));
  cssCache.set(table, out);
  return out;
}

const bordersKey = new PluginKey("relazioneTableBorders");

// Disegna i bordi calcolati sulle celle (sono derivati dalla tabella, non fanno parte del documento)
export const TableBorderStyles = Extension.create({
  name: "relazioneTableBorders",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: bordersKey,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "table") return;
              cellBorderCss(node).forEach((css, offset) => {
                const cell = node.nodeAt(offset);
                if (!cell) return;
                const at = pos + 1 + offset;
                decos.push(Decoration.node(at, at + cell.nodeSize, { style: css }));
              });
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// Per la stampa PDF: porta nell'HTML i bordi, l'allineamento e la spaziatura calcolati
export function applyTableStylesToHtml(html: string, editor: Editor): string {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const tables = listTables(editor);
  dom.querySelectorAll("table").forEach((el, i) => {
    const t = tables[i];
    if (!t) return;
    const css = cellBorderCss(t.node);
    const offsets = Array.from(css.keys());
    Array.from(el.querySelectorAll("td, th")).forEach((cell, k) => {
      const c = css.get(offsets[k]);
      if (c) (cell as HTMLElement).style.cssText += `;${c}`;
    });
    const { align, cellPadding } = t.node.attrs;
    if (align === "center" || align === "right") el.style.marginLeft = "auto";
    if (align === "center") el.style.marginRight = "auto";
    if (Number(cellPadding) > 0) el.style.setProperty("--cp", `${cellPadding}mm`);
  });
  return dom.body.innerHTML;
}

// ─── Operazioni sulla tabella corrente ────────────────────────────────────────

export function currentTable(editor: Editor): TableRef | null {
  const found = findParentNode((n) => n.type.name === "table")(editor.state.selection);
  return found ? { pos: found.pos, start: found.start, node: found.node } : null;
}

export function listTables(editor: Editor): TableRef[] {
  const out: TableRef[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "table") { out.push({ pos, start: pos + 1, node }); return false; }
  });
  return out;
}

// Celle selezionate (o quella col cursore) come rettangolo della griglia
function selection(editor: Editor) {
  try {
    const r = selectedRect(editor.state);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, map: r.map, table: r.table, start: r.tableStart };
  } catch {
    return null;
  }
}

// Larghezze (px) delle colonne: quelle salvate, altrimenti colonne uguali sul foglio intero
function columnWidths(table: TableRef): number[] {
  const map = TableMap.get(table.node);
  const widths: (number | null)[] = Array(map.width).fill(null);
  for (const offset of Array.from(new Set(map.map))) {
    const cell = table.node.nodeAt(offset);
    const cw = cell?.attrs.colwidth as number[] | null | undefined;
    if (!cell || !cw) continue;
    const col = map.colCount(offset);
    cw.forEach((w, i) => { if (w) widths[col + i] = w; });
  }
  if (widths.every((w) => w)) return widths as number[];
  return Array(map.width).fill(Math.round(RELAZIONE_TEXT_WIDTH_PX / map.width));
}

function writeColumnWidths(editor: Editor, table: TableRef, widths: number[] | null) {
  const { state, view } = editor;
  const map = TableMap.get(table.node);
  const tr = state.tr;
  for (const offset of Array.from(new Set(map.map))) {
    const cell = table.node.nodeAt(offset);
    if (!cell) continue;
    const col = map.colCount(offset);
    const span = Number(cell.attrs.colspan) || 1;
    tr.setNodeMarkup(table.start + offset, undefined, { ...cell.attrs, colwidth: widths ? widths.slice(col, col + span) : null });
  }
  view.dispatch(tr);
}

export function tableWidthPct(table: TableRef): number | null {
  const map = TableMap.get(table.node);
  const first = new Set<number>();
  for (let c = 0; c < map.width; c++) first.add(map.map[c]);
  let all = true;
  let sum = 0;
  columnWidths(table).forEach((w) => { sum += w; });
  first.forEach((offset) => { if (!table.node.nodeAt(offset)?.attrs.colwidth) all = false; });
  return all ? Math.round((sum / RELAZIONE_TEXT_WIDTH_PX) * 100) : null;
}

const MIN_COL_PX = 30;

// Porta la tabella alla larghezza indicata (px del foglio), mantenendo le proporzioni tra le colonne
function setTableWidthPx(editor: Editor, px: number) {
  const table = currentTable(editor);
  if (!table) return;
  const current = columnWidths(table);
  const sum = current.reduce((a, b) => a + b, 0) || 1;
  const target = Math.min(RELAZIONE_TEXT_WIDTH_PX, Math.max(MIN_COL_PX * current.length, px));
  writeColumnWidths(editor, table, current.map((w) => Math.max(MIN_COL_PX, Math.round((w / sum) * target))));
}

// Larghezza di una colonna in cm. Con «mantieni il totale» la differenza passa alla colonna accanto,
// come in LibreOffice; altrimenti cambia la larghezza della tabella (entro il foglio).
function setColumnWidthCm(editor: Editor, col: number, cm: number, keepTotal: boolean) {
  const table = currentTable(editor);
  if (!table) return;
  const widths = columnWidths(table);
  const total = widths.reduce((a, b) => a + b, 0);
  let next = Math.max(MIN_COL_PX, Math.round(cmToPx(cm)));
  if (keepTotal && widths.length > 1) {
    const other = col + 1 < widths.length ? col + 1 : col - 1;
    next = Math.min(next, widths[col] + widths[other] - MIN_COL_PX);
    widths[other] = widths[col] + widths[other] - next;
  } else {
    next = Math.min(next, RELAZIONE_TEXT_WIDTH_PX - (total - widths[col]));
  }
  widths[col] = Math.max(MIN_COL_PX, next);
  writeColumnWidths(editor, table, widths);
}

// Dopo aver aggiunto righe o colonne alcune celle non hanno larghezza: la completa, altrimenti la tabella
// perderebbe le misure delle altre colonne. Con tabella "adatta al foglio" (nessuna larghezza) non fa nulla.
function ensureWidths(editor: Editor) {
  const table = currentTable(editor);
  if (!table) return;
  const map = TableMap.get(table.node);
  const known: (number | null)[] = Array(map.width).fill(null);
  let missingCell = false;
  for (const offset of Array.from(new Set(map.map))) {
    const cell = table.node.nodeAt(offset);
    const cw = cell?.attrs.colwidth as number[] | null | undefined;
    if (!cell) continue;
    if (!cw || cw.some((w) => !w)) { missingCell = true; continue; }
    const col = map.colCount(offset);
    cw.forEach((w, i) => { known[col + i] = w; });
  }
  const values = known.filter((w): w is number => !!w);
  if (!values.length || (!missingCell && values.length === known.length)) return;
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  let widths = known.map((w) => w || avg);
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > RELAZIONE_TEXT_WIDTH_PX) widths = widths.map((w) => Math.max(MIN_COL_PX, Math.round((w * RELAZIONE_TEXT_WIDTH_PX) / total)));
  writeColumnWidths(editor, table, widths);
}

function equalColumns(editor: Editor) {
  const table = currentTable(editor);
  if (!table) return;
  const map = TableMap.get(table.node);
  const sum = columnWidths(table).reduce((a, b) => a + b, 0);
  writeColumnWidths(editor, table, Array(map.width).fill(Math.max(MIN_COL_PX, Math.round(sum / map.width))));
}

function rowPositions(table: TableRef): number[] {
  const out: number[] = [];
  table.node.forEach((_row, offset) => out.push(table.start + offset));
  return out;
}

// Altezza minima (cm) delle righe indicate; null = automatica
function setRowHeights(editor: Editor, rows: number[], cm: number | null) {
  const table = currentTable(editor);
  if (!table) return;
  const pos = rowPositions(table);
  const tr = editor.state.tr;
  for (const r of rows) {
    const row = table.node.child(r);
    tr.setNodeMarkup(pos[r], undefined, { ...row.attrs, height: cm && cm > 0 ? round2(cm) : null });
  }
  editor.view.dispatch(tr);
}

// Tutte le righe alla stessa altezza (la media di quelle attuali)
function equalRows(editor: Editor) {
  const table = currentTable(editor);
  if (!table) return;
  const pos = rowPositions(table);
  const heights = pos.map((p) => (editor.view.nodeDOM(p) as HTMLElement | null)?.offsetHeight || 0);
  if (!heights.some(Boolean)) return;
  const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
  setRowHeights(editor, pos.map((_, i) => i), pxToCm(avg));
}

function setTableAttrs(editor: Editor, attrs: Record<string, unknown>) {
  editor.chain().focus().updateAttributes("table", attrs).run();
}

// ─── Bordi delle celle selezionate ────────────────────────────────────────────

export type CellBorderOp = "all" | "outer" | "inner-h" | "inner-v" | "top" | "bottom" | "left" | "right" | "none";

const FACING: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

// Applica una penna (o «nessuna linea», o il ripristino con `null`) ai lati scelti delle celle selezionate.
// La linea in comune con la cella accanto vale per entrambe: il lato opposto della vicina viene azzerato.
function applyCellBorders(editor: Editor, op: CellBorderOp, pen: Pen | "none" | null) {
  const sel = selection(editor);
  if (!sel) return;
  const { map, table, start } = sel;
  const rect = { left: sel.left, right: sel.right, top: sel.top, bottom: sel.bottom };
  const look = tableLook(table.attrs);
  const offsets = map.cellsInRect(rect);
  const value = pen; // Pen | "none" | null (ripristino)
  const next = new Map<number, CellBorders>();
  const bordersOf = (offset: number): CellBorders => {
    let b = next.get(offset);
    if (!b) {
      b = { ...normalizeCellBorders(table.nodeAt(offset)?.attrs.border, look.pen) };
      next.set(offset, b);
    }
    return b;
  };
  const clearFacing = (offset: number, side: Side) => {
    const r = map.findCell(offset);
    const around: number[] = [];
    if (side === "top" && r.top > 0) for (let c = r.left; c < r.right; c++) around.push(map.map[(r.top - 1) * map.width + c]);
    if (side === "bottom" && r.bottom < map.height) for (let c = r.left; c < r.right; c++) around.push(map.map[r.bottom * map.width + c]);
    if (side === "left" && r.left > 0) for (let k = r.top; k < r.bottom; k++) around.push(map.map[k * map.width + r.left - 1]);
    if (side === "right" && r.right < map.width) for (let k = r.top; k < r.bottom; k++) around.push(map.map[k * map.width + r.right]);
    for (const n of Array.from(new Set(around))) {
      if (n === offset) continue;
      delete bordersOf(n)[FACING[side]];
    }
  };
  const put = (offset: number, side: Side) => {
    const b = bordersOf(offset);
    if (value === null) delete b[side];
    else b[side] = value;
    clearFacing(offset, side);
  };

  for (const offset of offsets) {
    const r = map.findCell(offset);
    const top = r.top === rect.top;
    const bottom = r.bottom === rect.bottom;
    const left = r.left === rect.left;
    const right = r.right === rect.right;
    switch (op) {
      case "all": case "none": SIDES_ALL.forEach((s) => put(offset, s)); break;
      case "outer":
        if (top) put(offset, "top");
        if (bottom) put(offset, "bottom");
        if (left) put(offset, "left");
        if (right) put(offset, "right");
        break;
      case "top": if (top) put(offset, "top"); break;
      case "bottom": if (bottom) put(offset, "bottom"); break;
      case "left": if (left) put(offset, "left"); break;
      case "right": if (right) put(offset, "right"); break;
      case "inner-h": if (!bottom) put(offset, "bottom"); break;
      case "inner-v": if (!right) put(offset, "right"); break;
    }
  }

  const tr = editor.state.tr;
  next.forEach((b, offset) => {
    const cell = table.nodeAt(offset);
    if (!cell) return;
    tr.setNodeMarkup(start + offset, undefined, { ...cell.attrs, border: Object.keys(b).length ? b : null });
  });
  editor.view.dispatch(tr);
}

const SIDES_ALL: Side[] = ["top", "right", "bottom", "left"];

// Una disposizione scelta per la tabella sostituisce i bordi delle singole celle
function setTablePreset(editor: Editor, preset: BorderPreset) {
  const table = currentTable(editor);
  if (!table) return;
  const tr = editor.state.tr;
  const map = TableMap.get(table.node);
  tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, borders: preset });
  for (const offset of Array.from(new Set(map.map))) {
    const cell = table.node.nodeAt(offset);
    if (cell?.attrs.border) tr.setNodeMarkup(table.start + offset, undefined, { ...cell.attrs, border: null });
  }
  editor.view.dispatch(tr);
}

// ─── Pannello Tabelle ─────────────────────────────────────────────────────────

const SWATCHES = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffe3e3", "#e9ecef", "#ced4da"];
const WIDTH_PRESETS = [50, 75, 100];


// Schema 18×18: le linee sempre presenti in grigio, quelle attive in evidenza
type Seg = "t" | "b" | "l" | "r" | "h" | "v" | "x";
const SEG_LINE: Record<Seg, [number, number, number, number]> = {
  t: [2, 2, 16, 2], b: [2, 16, 16, 16], l: [2, 2, 2, 16], r: [16, 2, 16, 16], h: [2, 9, 16, 9], v: [9, 2, 9, 16], x: [2, 6, 16, 6],
};
function LineIcon({ on }: { on: Seg[] }) {
  const faint: Seg[] = ["t", "b", "l", "r", "h", "v"];
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden>
      {faint.map((s) => <line key={`f${s}`} x1={SEG_LINE[s][0]} y1={SEG_LINE[s][1]} x2={SEG_LINE[s][2]} y2={SEG_LINE[s][3]} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} strokeDasharray="1.5 1.5" />)}
      {on.map((s) => <line key={s} x1={SEG_LINE[s][0]} y1={SEG_LINE[s][1]} x2={SEG_LINE[s][2]} y2={SEG_LINE[s][3]} stroke="currentColor" strokeWidth={2} strokeLinecap="square" />)}
    </svg>
  );
}

const PRESET_SEGS: Record<BorderPreset, Seg[]> = {
  all: ["t", "b", "l", "r", "h", "v"], outer: ["t", "b", "l", "r"], inner: ["h", "v"], horizontal: ["t", "b", "h"],
  vertical: ["l", "r", "v"], header: ["t", "b", "l", "r", "x"], none: [],
};

const CELL_OPS: { op: CellBorderOp; label: string; segs: Seg[] }[] = [
  { op: "all", label: "Tutti i bordi", segs: ["t", "b", "l", "r", "h", "v"] },
  { op: "outer", label: "Riquadro esterno", segs: ["t", "b", "l", "r"] },
  { op: "inner-h", label: "Linee interne orizzontali", segs: ["h"] },
  { op: "inner-v", label: "Linee interne verticali", segs: ["v"] },
  { op: "top", label: "Bordo superiore", segs: ["t"] },
  { op: "bottom", label: "Bordo inferiore", segs: ["b"] },
  { op: "left", label: "Bordo sinistro", segs: ["l"] },
  { op: "right", label: "Bordo destro", segs: ["r"] },
];

function PenControls({ pen, onChange }: { pen: Pen; onChange: (p: Pen) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={pen.s} onChange={(e) => onChange({ ...pen, s: e.target.value as PenStyle })} title="Stile della linea"
        className="h-7 rounded border border-input bg-background px-1 text-xs">
        {PEN_STYLES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <select value={String(pen.w)} onChange={(e) => onChange({ ...pen, w: Number(e.target.value) })} title="Spessore (pt)"
        className="h-7 rounded border border-input bg-background px-1 text-xs">
        {Array.from(new Set([...PEN_WIDTHS, pen.w])).sort((a, b) => a - b).map((w) => <option key={w} value={w}>{String(w).replace(".", ",")} pt</option>)}
      </select>
      <label className="relative h-7 w-8 cursor-pointer rounded border border-input" title="Colore della linea" style={{ background: pen.c }}>
        <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={pen.c} onChange={(e) => onChange({ ...pen, c: e.target.value })} />
      </label>
    </div>
  );
}

export function TablePanel({ editor, section, nonce = 0 }: { editor: Editor; section?: string; nonce?: number }) {
  useScrollToSection(section, nonce);
  const table = currentTable(editor);
  const all = listTables(editor);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const [keepTotal, setKeepTotal] = useState(true);
  const [cellPen, setCellPen] = useState<Pen>(DEFAULT_PEN);
  const chain = () => editor.chain().focus();
  const cellSel = editor.state.selection instanceof CellSelection;
  const map = table ? TableMap.get(table.node) : null;
  const width = table ? tableWidthPct(table) : null;
  const look = table ? tableLook(table.node.attrs) : null;
  const sel = table ? selection(editor) : null;
  const widthsPx = table ? columnWidths(table) : [];
  const totalCm = pxToCm(widthsPx.reduce((a, b) => a + b, 0));
  const selRows = sel ? Array.from({ length: sel.bottom - sel.top }, (_, i) => sel.top + i) : [];
  const rowHeight = table && selRows.length ? (table.node.child(selRows[0]).attrs.height as number | null) ?? null : null;
  const align = (table?.node.attrs.align as string) || "left";
  const cellBg = (editor.getAttributes("tableCell").background || editor.getAttributes("tableHeader").background || "") as string;
  const valign = (editor.getAttributes("tableCell").valign || editor.getAttributes("tableHeader").valign || "") as string;
  const setCell = (name: string, value: string | null) => chain().setCellAttribute(name, value).run();

  const jump = (pos: number) => {
    chain().setTextSelection(pos + 3).run();
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-3">
      {!table && (
        <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Clicca dentro una tabella per modificarla: righe, colonne, celle, misure e bordi si gestiscono da qui.
        </p>
      )}

      {table && map && look && (
        <>
          <p className="text-xs text-muted-foreground">
            Tabella {map.height} righe × {map.width} colonne{cellSel ? " · celle selezionate" : ""}.
          </p>

          <Section title="Righe">
            <div className="grid grid-cols-2 gap-1.5">
              <Tool label="Aggiungi sopra" icon={<ArrowUpToLine size={14} />} onClick={() => { chain().addRowBefore().run(); ensureWidths(editor); }} />
              <Tool label="Aggiungi sotto" icon={<ArrowDownToLine size={14} />} onClick={() => { chain().addRowAfter().run(); ensureWidths(editor); }} />
              <Tool label="Elimina riga" icon={<Rows3 size={14} />} danger disabled={map.height <= 1} onClick={() => chain().deleteRow().run()} />
              <Tool label="Riga di intestazione" icon={<Rows3 size={14} />} onClick={() => chain().toggleHeaderRow().run()} />
            </div>
          </Section>

          <Section title="Colonne">
            <div className="grid grid-cols-2 gap-1.5">
              <Tool label="Aggiungi a sinistra" icon={<ArrowLeftToLine size={14} />} onClick={() => { chain().addColumnBefore().run(); ensureWidths(editor); }} />
              <Tool label="Aggiungi a destra" icon={<ArrowRightToLine size={14} />} onClick={() => { chain().addColumnAfter().run(); ensureWidths(editor); }} />
              <Tool label="Elimina colonna" icon={<Columns3 size={14} />} danger disabled={map.width <= 1} onClick={() => chain().deleteColumn().run()} />
              <Tool label="Colonna di intestazione" icon={<Columns3 size={14} />} onClick={() => chain().toggleHeaderColumn().run()} />
            </div>
          </Section>

          <Section title="Celle" id="tbl-celle">
            <div className="grid grid-cols-2 gap-1.5">
              <Tool label="Unisci celle" icon={<Merge size={14} />} disabled={!editor.can().mergeCells()} onClick={() => chain().mergeCells().run()} />
              <Tool label="Dividi cella" icon={<Split size={14} />} disabled={!editor.can().splitCell()} onClick={() => chain().splitCell().run()} />
            </div>
            <p className="text-xs text-muted-foreground">Per unire, trascina il mouse su più celle.</p>
            <div className="flex flex-wrap gap-1">
              {([["left", <AlignLeft size={14} />], ["center", <AlignCenter size={14} />], ["right", <AlignRight size={14} />], ["justify", <AlignJustify size={14} />]] as const).map(([v, icon]) => (
                <button key={v} type="button" title={`Testo ${v}`} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().setTextAlign(v).run()}
                  className={`h-8 w-8 inline-flex items-center justify-center rounded border ${editor.isActive({ textAlign: v }) ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {icon}
                </button>
              ))}
              <select value={valign} onChange={(e) => setCell("valign", e.target.value || null)} title="Allineamento verticale"
                className="h-8 rounded border border-input bg-background px-1.5 text-xs">
                <option value="">In alto</option>
                <option value="middle">Al centro</option>
                <option value="bottom">In basso</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Sfondo</span>
              {SWATCHES.map((c) => (
                <button key={c} type="button" title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => setCell("background", c)}
                  className={`h-5 w-5 rounded border ${cellBg === c ? "ring-2 ring-primary" : "border-border"}`} style={{ background: c }} />
              ))}
              <label className="relative h-5 w-5 cursor-pointer rounded border border-border text-center text-[10px] leading-5" title="Altro colore">
                +
                <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={cellBg || "#ffffff"} onChange={(e) => setCell("background", e.target.value)} />
              </label>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setCell("background", null)}
                className="text-xs text-muted-foreground underline">nessuno</button>
            </div>
          </Section>

          <Section title="Larghezza delle colonne" id="tbl-larghezza">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs">Tabella</span>
              <NumField value={round1(totalCm)} suffix="cm" min={2} max={RELAZIONE_TEXT_WIDTH_CM}
                title={`Larghezza totale (foglio: ${RELAZIONE_TEXT_WIDTH_CM} cm)`}
                onCommit={(n) => { if (n) setTableWidthPx(editor, cmToPx(n)); }} />
              {WIDTH_PRESETS.map((p) => (
                <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTableWidthPx(editor, (RELAZIONE_TEXT_WIDTH_PX * p) / 100)}
                  className={`h-7 min-w-10 rounded border px-2 text-xs ${width === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {p}%
                </button>
              ))}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { const t = currentTable(editor); if (t) writeColumnWidths(editor, t, null); }}
                className={`h-7 rounded border px-2 text-xs ${width === null ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                Adatta al foglio
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {widthsPx.map((px, c) => {
                const inSel = sel ? c >= sel.left && c < sel.right : false;
                return (
                  <label key={c} className={`flex items-center justify-between gap-1 rounded px-1 text-xs ${inSel ? "bg-primary/10 text-primary" : ""}`}>
                    <span>Col. {c + 1}</span>
                    <NumField value={round2(pxToCm(px))} suffix="cm" min={0.5} className="w-14" onCommit={(n) => { if (n) setColumnWidthCm(editor, c, n, keepTotal); }} />
                  </label>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={keepTotal} onChange={(e) => setKeepTotal(e.target.checked)} />
              Mantieni la larghezza totale (la differenza va alla colonna accanto)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <Tool label="Colonne uguali" icon={<Columns3 size={14} />} onClick={() => equalColumns(editor)} />
              <Tool label="Righe uguali" icon={<Rows3 size={14} />} onClick={() => equalRows(editor)} />
            </div>
            <p className="text-xs text-muted-foreground">Puoi anche trascinare il bordo di una colonna nella tabella.</p>
          </Section>

          <Section title="Altezza e margini" id="tbl-altezza">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-xs">{selRows.length > 1 ? `Righe ${selRows[0] + 1}–${selRows[selRows.length - 1] + 1}` : `Riga ${(selRows[0] ?? 0) + 1}`}</span>
              <NumField value={rowHeight} suffix="cm" min={0.3} max={25} placeholder="auto" title="Altezza minima della riga; vuoto = secondo il contenuto"
                onCommit={(n) => setRowHeights(editor, selRows, n)} />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setRowHeights(editor, selRows, null)}
                className="text-xs text-muted-foreground underline">automatica</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Spazio dentro le celle</span>
              <NumField value={(table.node.attrs.cellPadding as number | null) ?? null} suffix="mm" min={0} max={10} className="w-12" placeholder="std"
                onCommit={(n) => setTableAttrs(editor, { cellPadding: n })} />
            </div>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs">Tabella sul foglio</span>
              {([["left", "A sinistra", <AlignLeft size={14} />], ["center", "Al centro", <AlignCenter size={14} />], ["right", "A destra", <AlignRight size={14} />]] as const).map(([v, label, icon]) => (
                <button key={v} type="button" title={label} onMouseDown={(e) => e.preventDefault()} onClick={() => setTableAttrs(editor, { align: v === "left" ? null : v })}
                  className={`h-7 w-8 inline-flex items-center justify-center rounded border ${align === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {icon}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">L'allineamento si vede solo se la tabella è più stretta del foglio.</p>
          </Section>

          <Section title="Bordi della tabella" id="tbl-bordi">
            <div className="grid grid-cols-4 gap-1">
              {BORDER_PRESETS.map((p) => (
                <button key={p} type="button" title={PRESET_LABELS[p]} aria-label={PRESET_LABELS[p]} onMouseDown={(e) => e.preventDefault()} onClick={() => setTablePreset(editor, p)}
                  className={`flex items-center justify-center rounded border p-1.5 ${look.preset === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <LineIcon on={PRESET_SEGS[p]} />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{PRESET_LABELS[look.preset]}. Scegliere una disposizione azzera i bordi impostati sulle singole celle.</p>
            <PenControls pen={look.pen} onChange={(p) => setTableAttrs(editor, { lineStyle: p.s, lineWidth: p.w, lineColor: p.c })} />
          </Section>

          <Section title="Bordi delle celle selezionate" id="tbl-bordi-celle">
            <PenControls pen={cellPen} onChange={(p) => setCellPen(normalizePen(p))} />
            <div className="grid grid-cols-4 gap-1">
              {CELL_OPS.map((o) => (
                <button key={o.op} type="button" title={o.label} aria-label={o.label} onMouseDown={(e) => e.preventDefault()} onClick={() => applyCellBorders(editor, o.op, cellPen)}
                  className="flex items-center justify-center rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <LineIcon on={o.segs} />
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Tool label="Togli i bordi" icon={<LineIcon on={[]} />} onClick={() => applyCellBorders(editor, "none", "none")} />
              <Tool label="Come la tabella" icon={<TableIcon size={14} />} onClick={() => applyCellBorders(editor, "all", null)} />
            </div>
            <p className="text-xs text-muted-foreground">Seleziona una o più celle (trascinando), scegli stile, spessore e colore, poi i lati a cui applicarli.</p>
          </Section>

          <Section title="Tabella">
            <Tool label="Elimina tabella" icon={<Trash2 size={14} />} danger onClick={() => chain().deleteTable().run()} />
          </Section>
        </>
      )}

      {!table && (
        <Section title="Nuova tabella" id="tbl-nuova">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Righe
              <input type="number" min={1} max={40} value={rows} onChange={(e) => setRows(Math.min(40, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 h-8 w-full rounded border border-input bg-background px-2 text-sm" />
            </label>
            <label className="text-xs">
              Colonne
              <input type="number" min={1} max={12} value={cols} onChange={(e) => setCols(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 h-8 w-full rounded border border-input bg-background px-2 text-sm" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
            Prima riga di intestazione
          </label>
          <Button type="button" size="sm" className="w-full h-8 gap-1.5 text-xs"
            onClick={() => chain().insertTable({ rows, cols, withHeaderRow: header }).run()}>
            <Plus size={13} /> Inserisci tabella
          </Button>
        </Section>
      )}

      <Section title={`Tabelle nel documento (${all.length})`}>
        {all.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessuna tabella ancora.</p>
        ) : (
          <div className="space-y-1">
            {all.map((t, i) => {
              const m = TableMap.get(t.node);
              const row = t.node.firstChild;
              const first = row
                ? Array.from({ length: row.childCount }, (_, k) => row.child(k).textContent.trim()).filter(Boolean).join(" · ").slice(0, 40)
                : "";
              return (
                <button key={t.pos} type="button" onClick={() => jump(t.pos)}
                  className={`w-full flex items-center gap-2 rounded border p-1.5 text-left hover:bg-muted ${table?.pos === t.pos ? "border-primary bg-primary/5" : "border-border"}`}>
                  <TableIcon size={14} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">Tabella {i + 1}{first ? ` · ${first}` : ""}</span>
                    <span className="block text-[11px] text-muted-foreground">{m.height} × {m.width}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Scheda «Tabella» della barra multifunzione ───────────────────────────────

function RibbonPop({ trigger, children, width = "w-64" }: { trigger: React.ReactNode; children: React.ReactNode; width?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className={`${width} space-y-2 p-2`} onOpenAutoFocus={(e) => e.preventDefault()}>{children}</PopoverContent>
    </Popover>
  );
}

export function TableRibbon({ editor, onOpenPanel }: { editor: Editor; onOpenPanel: (section?: string) => void }) {
  const [cellPen, setCellPen] = useState<Pen>(DEFAULT_PEN);
  const table = currentTable(editor);
  if (!table) return null;
  const chain = () => editor.chain().focus();
  const map = TableMap.get(table.node);
  const look = tableLook(table.node.attrs);
  const sel = selection(editor);
  const totalCm = pxToCm(columnWidths(table).reduce((a, b) => a + b, 0));
  const selRows = sel ? Array.from({ length: sel.bottom - sel.top }, (_, i) => sel.top + i) : [];
  const rowHeight = selRows.length ? (table.node.child(selRows[0]).attrs.height as number | null) ?? null : null;
  const align = (table.node.attrs.align as string) || "left";
  const cellBg = (editor.getAttributes("tableCell").background || editor.getAttributes("tableHeader").background || "") as string;
  const valign = (editor.getAttributes("tableCell").valign || editor.getAttributes("tableHeader").valign || "") as string;
  const setCell = (name: string, value: string | null) => chain().setCellAttribute(name, value).run();
  const widthPct = tableWidthPct(table);

  return (
    <>
      <RibbonGroup label="Righe">
        <RibbonStack>
          <RibbonRow>
            <RibbonBtn title="Inserisci una riga sopra" label="Sopra" icon={<ArrowUpToLine size={14} />} onClick={() => { chain().addRowBefore().run(); ensureWidths(editor); }} />
            <RibbonBtn title="Inserisci una riga sotto" label="Sotto" icon={<ArrowDownToLine size={14} />} onClick={() => { chain().addRowAfter().run(); ensureWidths(editor); }} />
          </RibbonRow>
          <RibbonRow>
            <RibbonBtn title="Elimina la riga" label="Elimina" danger icon={<Rows3 size={14} />} disabled={map.height <= 1} onClick={() => chain().deleteRow().run()} />
            <RibbonBtn title="Trasforma la riga in intestazione (o viceversa)" label="Intestaz." icon={<Rows3 size={14} />} onClick={() => chain().toggleHeaderRow().run()} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Colonne">
        <RibbonStack>
          <RibbonRow>
            <RibbonBtn title="Inserisci una colonna a sinistra" label="Sinistra" icon={<ArrowLeftToLine size={14} />} onClick={() => { chain().addColumnBefore().run(); ensureWidths(editor); }} />
            <RibbonBtn title="Inserisci una colonna a destra" label="Destra" icon={<ArrowRightToLine size={14} />} onClick={() => { chain().addColumnAfter().run(); ensureWidths(editor); }} />
          </RibbonRow>
          <RibbonRow>
            <RibbonBtn title="Elimina la colonna" label="Elimina" danger icon={<Columns3 size={14} />} disabled={map.width <= 1} onClick={() => chain().deleteColumn().run()} />
            <RibbonBtn title="Trasforma la colonna in intestazione (o viceversa)" label="Intestaz." icon={<Columns3 size={14} />} onClick={() => chain().toggleHeaderColumn().run()} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Celle" onLauncher={() => onOpenPanel("tbl-celle")} launcherTitle="Impostazioni delle celle">
        <RibbonBig label="Unisci" icon={<Merge size={20} />} title="Unisci le celle selezionate (trascina il mouse su più celle)"
          disabled={!editor.can().mergeCells()} onClick={() => chain().mergeCells().run()} />
        <RibbonBig label="Dividi" icon={<Split size={20} />} title="Dividi la cella unita" disabled={!editor.can().splitCell()} onClick={() => chain().splitCell().run()} />
        <RibbonStack>
          <RibbonRow>
            {([["left", <AlignLeft size={14} />], ["center", <AlignCenter size={14} />], ["right", <AlignRight size={14} />], ["justify", <AlignJustify size={14} />]] as const).map(([v, icon]) => (
              <RibbonBtn key={v} title={`Testo ${v}`} icon={icon} active={editor.isActive({ textAlign: v })} onClick={() => chain().setTextAlign(v).run()} />
            ))}
          </RibbonRow>
          <RibbonRow>
            {([["", "In alto", <AlignVerticalJustifyStart size={14} />], ["middle", "Al centro", <AlignVerticalJustifyCenter size={14} />], ["bottom", "In basso", <AlignVerticalJustifyEnd size={14} />]] as const).map(([v, label, icon]) => (
              <RibbonBtn key={v || "top"} title={`Allineamento verticale: ${label}`} icon={icon} active={valign === v} onClick={() => setCell("valign", v || null)} />
            ))}
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Dimensioni" onLauncher={() => onOpenPanel("tbl-larghezza")} launcherTitle="Larghezza di ogni colonna, altezza righe e spazi">
        <RibbonStack>
          <RibbonRow>
            <span className="w-14 text-xs">Larghezza</span>
            <NumField value={round1(totalCm)} suffix="cm" min={2} max={RELAZIONE_TEXT_WIDTH_CM} className="w-14"
              title={`Larghezza totale (foglio: ${RELAZIONE_TEXT_WIDTH_CM} cm)`} onCommit={(n) => { if (n) setTableWidthPx(editor, cmToPx(n)); }} />
            {[50, 100].map((p) => (
              <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTableWidthPx(editor, (RELAZIONE_TEXT_WIDTH_PX * p) / 100)}
                className={`h-7 rounded border px-1.5 text-xs ${widthPct === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>{p}%</button>
            ))}
          </RibbonRow>
          <RibbonRow>
            <span className="w-14 text-xs">{selRows.length > 1 ? "Altezze" : "Altezza"}</span>
            <NumField value={rowHeight} suffix="cm" min={0.3} max={25} placeholder="auto" className="w-14" title="Altezza minima delle righe selezionate"
              onCommit={(n) => setRowHeights(editor, selRows, n)} />
            <RibbonBtn title="Colonne alla stessa larghezza" icon={<Columns3 size={14} />} onClick={() => equalColumns(editor)} />
            <RibbonBtn title="Righe alla stessa altezza" icon={<Rows3 size={14} />} onClick={() => equalRows(editor)} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Bordi" onLauncher={() => onOpenPanel("tbl-bordi")} launcherTitle="Bordi della tabella e delle celle">
        <RibbonPop width="w-60" trigger={<RibbonBig label="Tabella" title="Disposizione dei bordi di tutta la tabella" icon={<LineIcon on={PRESET_SEGS[look.preset]} />} />}>
          <div className="grid grid-cols-4 gap-1">
            {BORDER_PRESETS.map((p) => (
              <button key={p} type="button" title={PRESET_LABELS[p]} aria-label={PRESET_LABELS[p]} onClick={() => setTablePreset(editor, p)}
                className={`flex items-center justify-center rounded border p-1.5 ${look.preset === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                <LineIcon on={PRESET_SEGS[p]} />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{PRESET_LABELS[look.preset]}. Azzera i bordi impostati sulle singole celle.</p>
          <PenControls pen={look.pen} onChange={(p) => setTableAttrs(editor, { lineStyle: p.s, lineWidth: p.w, lineColor: p.c })} />
        </RibbonPop>
        <RibbonPop width="w-60" trigger={<RibbonBig label="Celle" title="Bordi delle celle selezionate" icon={<TableIcon size={20} />} />}>
          <PenControls pen={cellPen} onChange={(p) => setCellPen(normalizePen(p))} />
          <div className="grid grid-cols-4 gap-1">
            {CELL_OPS.map((o) => (
              <button key={o.op} type="button" title={o.label} aria-label={o.label} onClick={() => applyCellBorders(editor, o.op, cellPen)}
                className="flex items-center justify-center rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <LineIcon on={o.segs} />
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Tool label="Togli i bordi" icon={<LineIcon on={[]} />} onClick={() => applyCellBorders(editor, "none", "none")} />
            <Tool label="Come la tabella" icon={<TableIcon size={14} />} onClick={() => applyCellBorders(editor, "all", null)} />
          </div>
          <p className="text-xs text-muted-foreground">Seleziona le celle trascinando, poi scegli i lati.</p>
        </RibbonPop>
      </RibbonGroup>

      <RibbonGroup label="Sfondo">
        <div className="grid grid-cols-4 gap-1">
          {SWATCHES.map((c) => (
            <button key={c} type="button" title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => setCell("background", c)}
              className={`h-5 w-5 rounded border ${cellBg === c ? "ring-2 ring-primary" : "border-border"}`} style={{ background: c }} />
          ))}
          <label className="relative h-5 w-5 cursor-pointer rounded border border-border text-center text-[10px] leading-5" title="Altro colore">
            +
            <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={cellBg || "#ffffff"} onChange={(e) => setCell("background", e.target.value)} />
          </label>
          <button type="button" title="Nessuno sfondo" onMouseDown={(e) => e.preventDefault()} onClick={() => setCell("background", null)}
            className="h-5 w-5 rounded border border-border text-[10px] leading-5 text-muted-foreground hover:bg-muted">∅</button>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Tabella" onLauncher={() => onOpenPanel()} launcherTitle="Tutte le impostazioni della tabella">
        <RibbonBig label="Proprietà" title="Apre il pannello laterale con tutte le impostazioni della tabella" icon={<Settings2 size={20} />} onClick={() => onOpenPanel()} />
        <RibbonBig label="Elimina" danger title="Elimina l'intera tabella" icon={<Trash2 size={20} />} onClick={() => chain().deleteTable().run()} />
        <RibbonStack>
          <RibbonRow>
            {([["left", "A sinistra", <AlignLeft size={14} />], ["center", "Al centro", <AlignCenter size={14} />], ["right", "A destra", <AlignRight size={14} />]] as const).map(([v, label, icon]) => (
              <RibbonBtn key={v} title={`Tabella sul foglio: ${label.toLowerCase()}`} icon={icon} active={align === v}
                onClick={() => setTableAttrs(editor, { align: v === "left" ? null : v })} />
            ))}
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>
    </>
  );
}
