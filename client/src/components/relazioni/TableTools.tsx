import { useState } from "react";
import { findParentNode, type Editor } from "@tiptap/react";
import { Table, TableCell, TableHeader, TableRow, TableView } from "@tiptap/extension-table";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine,
  Columns3, Merge, Plus, Rows3, Split, Table as TableIcon, Trash2,
} from "lucide-react";
import { RELAZIONE_TEXT_WIDTH_PX } from "@shared/relazione_layout";
import { Button } from "@/components/ui/button";

// ─── Estensioni: sfondo e allineamento verticale delle celle, bordi della tabella ──

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
    this.table.setAttribute("data-borders", node.attrs.borders || "all");
  }
}

export const RTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borders: {
        default: "all",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-borders") || "all",
        renderHTML: (attrs: Record<string, any>) => (attrs.borders && attrs.borders !== "all" ? { "data-borders": attrs.borders } : {}),
      },
    };
  },
}).configure({ resizable: true, cellMinWidth: 40, View: RTableView as any });

export { TableRow };

// ─── Operazioni sulla tabella corrente ────────────────────────────────────────

type TableRef = { pos: number; start: number; node: PmNode };

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

function setTableWidthPct(editor: Editor, pct: number) {
  const table = currentTable(editor);
  if (!table) return;
  const current = columnWidths(table);
  const sum = current.reduce((a, b) => a + b, 0) || 1;
  const target = (RELAZIONE_TEXT_WIDTH_PX * pct) / 100;
  writeColumnWidths(editor, table, current.map((w) => Math.max(30, Math.round((w / sum) * target))));
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
  if (total > RELAZIONE_TEXT_WIDTH_PX) widths = widths.map((w) => Math.max(30, Math.round((w * RELAZIONE_TEXT_WIDTH_PX) / total)));
  writeColumnWidths(editor, table, widths);
}

function equalColumns(editor: Editor) {
  const table = currentTable(editor);
  if (!table) return;
  const map = TableMap.get(table.node);
  const sum = columnWidths(table).reduce((a, b) => a + b, 0);
  writeColumnWidths(editor, table, Array(map.width).fill(Math.max(30, Math.round(sum / map.width))));
}

// ─── Pannello Tabelle ─────────────────────────────────────────────────────────

const SWATCHES = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffe3e3", "#e9ecef", "#ced4da"];
const WIDTH_PRESETS = [50, 75, 100];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pt-3 border-t border-border first:border-0 first:pt-0">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function Tool({ label, icon, onClick, active, disabled, danger }: {
  label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs disabled:opacity-40 ${
        active ? "border-primary bg-primary/10 text-primary" : danger ? "border-border text-destructive hover:bg-destructive/10" : "border-border hover:bg-muted"
      }`}
    >
      {icon}
      <span className="leading-tight">{label}</span>
    </button>
  );
}

export function TablePanel({ editor }: { editor: Editor }) {
  const table = currentTable(editor);
  const all = listTables(editor);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const chain = () => editor.chain().focus();
  const cellSel = editor.state.selection instanceof CellSelection;
  const map = table ? TableMap.get(table.node) : null;
  const width = table ? tableWidthPct(table) : null;
  const cellBg = (editor.getAttributes("tableCell").background || editor.getAttributes("tableHeader").background || "") as string;
  const valign = (editor.getAttributes("tableCell").valign || editor.getAttributes("tableHeader").valign || "") as string;
  const borders = (table?.node.attrs.borders as string) || "all";
  const setCell = (name: string, value: string | null) => chain().setCellAttribute(name, value).run();

  const jump = (pos: number) => {
    chain().setTextSelection(pos + 3).run();
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-3">
      {!table && (
        <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Clicca dentro una tabella per modificarla: righe, colonne, celle, larghezza e colori si gestiscono da qui.
        </p>
      )}

      {table && map && (
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

          <Section title="Celle">
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

          <Section title="Larghezza">
            <div className="flex flex-wrap gap-1">
              {WIDTH_PRESETS.map((p) => (
                <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTableWidthPct(editor, p)}
                  className={`h-7 min-w-10 rounded border px-2 text-xs ${width === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {p}%
                </button>
              ))}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { const t = currentTable(editor); if (t) writeColumnWidths(editor, t, null); }}
                className={`h-7 rounded border px-2 text-xs ${width === null ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                Adatta al foglio
              </button>
            </div>
            {width !== null && (
              <div className="flex items-center gap-2">
                <input type="range" min={20} max={100} step={5} value={Math.min(100, Math.max(20, width))} onChange={(e) => setTableWidthPct(editor, Number(e.target.value))} className="flex-1" />
                <span className="w-9 text-right text-xs tabular-nums">{width}%</span>
              </div>
            )}
            <Tool label="Colonne di uguale larghezza" icon={<Columns3 size={14} />} onClick={() => equalColumns(editor)} />
            <p className="text-xs text-muted-foreground">Per regolare una colonna, trascina il suo bordo nella tabella.</p>
          </Section>

          <Section title="Bordi">
            <select value={borders} onChange={(e) => chain().updateAttributes("table", { borders: e.target.value }).run()}
              className="h-8 w-full rounded border border-input bg-background px-1.5 text-xs">
              <option value="all">Tutti i bordi</option>
              <option value="horizontal">Solo righe orizzontali</option>
              <option value="none">Nessun bordo</option>
            </select>
          </Section>

          <Section title="Tabella">
            <Tool label="Elimina tabella" icon={<Trash2 size={14} />} danger onClick={() => chain().deleteTable().run()} />
          </Section>
        </>
      )}

      {!table && (
        <Section title="Nuova tabella">
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
