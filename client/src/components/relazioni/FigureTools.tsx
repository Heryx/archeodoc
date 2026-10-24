import { useEffect, useRef } from "react";
import { Extension, Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  ArrowDown, ArrowUp, Copy, Crosshair, Folder, GripVertical, ImagePlus, Map as MapIcon, RefreshCw, Trash2, Type, Upload, X,
} from "lucide-react";
import {
  RELAZIONE_EXPORT_WIDTH_PX, RELAZIONE_TEXT_WIDTH_PX, figureFloatSide, figureWidthPct, figureWrap, type FigureAlign, type FigureWrap,
} from "@shared/relazione_layout";
import { buildProjectUrl } from "@/lib/project";
import { Button } from "@/components/ui/button";
import {
  NumField, PanelSection as Section, RibbonBig, RibbonBtn, RibbonGroup, RibbonRow, RibbonStack, useScrollToSection,
} from "@/components/relazioni/Ribbon";

// ─── Nodi figura ──────────────────────────────────────────────────────────────

export const FIGURE_NODES = ["snapshotFigure", "projectImage"] as const;
export const isFigureName = (name: string | undefined) => !!name && (FIGURE_NODES as readonly string[]).includes(name);

const snapStep = (n: number) => Math.min(100, Math.max(10, Math.round(n / 5) * 5));

function FigureView({ node, updateAttributes, deleteNode, selected }: any) {
  const pct = figureWidthPct(node.attrs);
  const align: FigureAlign = node.attrs.align || "center";
  const floated = figureWrap(node.attrs) === "square";
  const side = figureFloatSide(node.attrs);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Trascinando l'angolo la larghezza cambia in % del foglio (a scatti di 5)
  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startPct = pct;
    const full = floated ? RELAZIONE_TEXT_WIDTH_PX : wrapRef.current?.clientWidth || RELAZIONE_TEXT_WIDTH_PX;
    const factor = !floated && align === "center" ? 2 : 1;
    const sign = align === "right" ? -1 : 1;
    const move = (ev: PointerEvent) => updateAttributes({ widthPct: snapStep(startPct + (sign * (ev.clientX - startX) / full) * 100 * factor) });
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <NodeViewWrapper
      className={floated ? "relazione-float" : "my-4"}
      data-wrap={floated ? "square" : "none"}
      style={floated
        ? { float: side, width: `${pct}%`, margin: side === "left" ? "4px 18px 8px 0" : "4px 0 8px 18px" }
        : { textAlign: align }}
    >
      <div ref={wrapRef} className="w-full">
        <div
          className={`relative group align-top ${floated ? "block" : "inline-block max-w-full"} ${selected ? "ring-2 ring-primary rounded-sm" : ""}`}
          style={{ width: floated ? "100%" : `${pct}%` }}
        >
          <img src={node.attrs.src} alt={node.attrs.didascalia || ""} draggable={false} data-drag-handle className="block w-full h-auto cursor-grab" />
          <span
            data-drag-handle
            title="Trascina per spostare la figura in un altro punto del documento"
            className={`absolute left-1 top-1 h-6 w-5 items-center justify-center rounded bg-background/90 border border-border text-muted-foreground cursor-grab ${selected ? "flex" : "hidden group-hover:flex"}`}
          >
            <GripVertical size={14} />
          </span>
          <button
            type="button"
            onClick={() => deleteNode()}
            className="absolute top-1 right-1 hidden group-hover:block bg-background/90 border border-border rounded p-1 text-destructive"
            title="Rimuovi figura"
          >
            <Trash2 size={13} />
          </button>
          {selected && (
            <span
              onPointerDown={startResize}
              title="Trascina per ridimensionare"
              className={`absolute -bottom-1.5 h-3.5 w-3.5 rounded-sm bg-primary border-2 border-white touch-none ${align === "right" ? "-left-1.5 cursor-nesw-resize" : "-right-1.5 cursor-nwse-resize"}`}
            />
          )}
          {selected && (
            <span className="absolute left-8 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground pointer-events-none">{pct}%</span>
          )}
        </div>
        <input
          value={node.attrs.didascalia || ""}
          onChange={(e) => updateAttributes({ didascalia: e.target.value })}
          placeholder="Didascalia della figura"
          style={{ width: floated ? "100%" : `${Math.max(pct, 40)}%` }}
          className="block mt-1 mx-auto text-center text-sm italic bg-transparent border-0 border-b border-transparent focus:border-border outline-none max-w-full"
        />
      </div>
    </NodeViewWrapper>
  );
}

const figureAttrs = {
  didascalia: { default: "" },
  src: { default: "" },
  // % del testo; null = ricavata dal vecchio attributo "width" o 100
  widthPct: { default: null as number | null, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-width-pct")) || null },
  align: { default: "center", parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "center" },
  wrap: { default: "none", parseHTML: (el: HTMLElement) => (el.getAttribute("data-wrap") === "square" ? "square" : "none") },
};

function renderFigure(name: string, dataKey: string, node: any) {
  const pct = figureWidthPct(node.attrs);
  const align = node.attrs.align || "center";
  const floated = figureWrap(node.attrs) === "square";
  const side = figureFloatSide(node.attrs);
  const style = floated
    ? `float:${side};width:${pct}%;margin:4px ${side === "left" ? "18px 8px 0" : "0 8px 18px"};text-align:center`
    : `text-align:${align}`;
  return [
    "figure",
    { [dataKey]: name, "data-width-pct": pct, "data-align": align, "data-wrap": floated ? "square" : "none", style },
    ["img", { src: node.attrs.src, style: floated ? "width:100%" : `width:${pct}%;max-width:100%` }],
    ["figcaption", {}, node.attrs.didascalia || ""],
  ] as any;
}

export const SnapshotFigure = Node.create({
  name: "snapshotFigure",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { snapshotId: { default: null }, ...figureAttrs };
  },
  parseHTML() {
    return [{ tag: "figure[data-snapshot-id]" }];
  },
  renderHTML({ node }) {
    return renderFigure(String(node.attrs.snapshotId ?? ""), "data-snapshot-id", node);
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

export const ProjectImage = Node.create({
  name: "projectImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { name: { default: "" }, width: { default: null }, ...figureAttrs };
  },
  parseHTML() {
    return [{ tag: "figure[data-project-image]" }];
  },
  renderHTML({ node }) {
    return renderFigure(node.attrs.name, "data-project-image", node);
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

// ─── Caricamento di immagini esterne ──────────────────────────────────────────

export type UploadedImage = { name: string; url: string; widthPct: number };

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/;
export const isImageFile = (f: File) => IMAGE_RE.test(f.type);

function naturalWidth(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth || 0); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    img.src = url;
  });
}

// Le foto grandi partono al 70% del foglio; le immagini piccole restano alla loro grandezza
export function defaultWidthPct(naturalPx: number): number {
  if (!naturalPx) return 70;
  return naturalPx <= RELAZIONE_TEXT_WIDTH_PX ? Math.max(20, snapStep((naturalPx / RELAZIONE_TEXT_WIDTH_PX) * 100)) : 70;
}

export async function uploadProjectImage(file: File, index = 0): Promise<UploadedImage> {
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || `.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("+xml", "")}`).toLowerCase();
  // Nome univoco: il server salva con il nome ricevuto e sovrascriverebbe un file omonimo
  const unique = new File([file], `fig_${Date.now()}_${index}${ext}`, { type: file.type });
  const fd = new FormData();
  fd.append("file", unique);
  const res = await fetch(buildProjectUrl("/api/project/img"), { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.text()) || "Caricamento non riuscito");
  const data = (await res.json()) as { name: string; url: string };
  return { ...data, widthPct: defaultWidthPct(await naturalWidth(file)) };
}

export function figureNodeFor(img: UploadedImage) {
  return { type: "projectImage", attrs: { name: img.name, src: img.url, didascalia: "", widthPct: img.widthPct, align: "center", wrap: "none" } };
}

// ─── Operazioni sulla figura selezionata ──────────────────────────────────────

export type FigureRef = { pos: number; node: import("@tiptap/pm/model").Node };

export function selectedFigure(editor: Editor): FigureRef | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && isFigureName(sel.node.type.name)) return { pos: sel.from, node: sel.node };
  return null;
}

export function listFigures(editor: Editor): FigureRef[] {
  const out: FigureRef[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (isFigureName(node.type.name)) { out.push({ pos, node }); return false; }
  });
  return out;
}

function moveBlock(editor: Editor, ref: FigureRef, dir: -1 | 1) {
  const { state, view } = editor;
  const $pos = state.doc.resolve(ref.pos);
  const idx = $pos.index();
  const target = idx + dir;
  if (target < 0 || target >= $pos.parent.childCount) return;
  const sibling = $pos.parent.child(target);
  const tr = state.tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
  const at = dir < 0 ? ref.pos - sibling.nodeSize : ref.pos + sibling.nodeSize;
  tr.insert(at, ref.node);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
}

// Sposta la figura nel punto indicato (posizione tra due blocchi del documento)
export function moveFigureTo(editor: Editor, ref: FigureRef, pos: number) {
  const { state, view } = editor;
  const from = ref.pos;
  const to = from + ref.node.nodeSize;
  if (pos >= from && pos <= to) return;
  const tr = state.tr.delete(from, to);
  const at = tr.mapping.map(pos);
  tr.insert(at, ref.node);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
}

// ─── Punti di inserimento ─────────────────────────────────────────────────────
// Mentre si sceglie dove mettere una figura, tra un blocco e l'altro del documento compare
// un'icona «Metti qui»: un clic su di essa conclude l'operazione.

type PlaceState = { active: boolean; skip: PmNode | null; onPick: ((pos: number) => void) | null; onEnd: (() => void) | null };
const IDLE: PlaceState = { active: false, skip: null, onPick: null, onEnd: null };
const placeKey = new PluginKey<PlaceState>("figurePlacement");

const SLOT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>';

function setPlacing(view: EditorView, next: PlaceState) {
  view.dispatch(view.state.tr.setMeta(placeKey, next).setMeta("addToHistory", false));
}

export function stopPlacing(view: EditorView) {
  const st = placeKey.getState(view.state);
  if (!st?.active) return;
  setPlacing(view, IDLE);
  st.onEnd?.();
}

export function startPlacing(editor: Editor, opts: { skip?: PmNode | null; onPick: (pos: number) => void; onEnd?: () => void }) {
  stopPlacing(editor.view);
  setPlacing(editor.view, { active: true, skip: opts.skip ?? null, onPick: opts.onPick, onEnd: opts.onEnd ?? null });
}

export const FigurePlacement = Extension.create({
  name: "figurePlacement",
  addProseMirrorPlugins() {
    return [
      new Plugin<PlaceState>({
        key: placeKey,
        state: {
          init: () => IDLE,
          apply: (tr, prev) => tr.getMeta(placeKey) ?? prev,
        },
        props: {
          decorations(state) {
            const st = placeKey.getState(state);
            if (!st?.active) return null;
            const skipAt = new Set<number>();
            const bounds: number[] = [];
            state.doc.forEach((child, offset) => {
              bounds.push(offset);
              if (child === st.skip) { skipAt.add(offset); skipAt.add(offset + child.nodeSize); }
            });
            bounds.push(state.doc.content.size);
            return DecorationSet.create(
              state.doc,
              bounds.filter((pos) => !skipAt.has(pos)).map((pos) =>
                Decoration.widget(pos, (view) => {
                  const el = document.createElement("div");
                  el.className = "fig-slot";
                  el.contentEditable = "false";
                  el.innerHTML = `<span class="fig-slot-pill">${SLOT_ICON}Metti qui</span>`;
                  el.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const cur = placeKey.getState(view.state);
                    if (!cur?.active) return;
                    stopPlacing(view);
                    cur.onPick?.(pos);
                  });
                  return el;
                }, { side: -1, key: `fig-slot-${pos}`, stopEvent: () => true, ignoreSelection: true }),
              ),
            );
          },
          handleKeyDown(view, event) {
            if (event.key === "Escape" && placeKey.getState(view.state)?.active) { stopPlacing(view); return true; }
            return false;
          },
        },
      }),
    ];
  },
});

function selectFigure(editor: Editor, pos: number) {
  editor.chain().focus().setNodeSelection(pos).run();
  (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─── Pannello Figure ──────────────────────────────────────────────────────────

const PRESETS = [25, 33, 50, 75, 100];

// Larghezza approssimativa nel Word, in cm
const figureCm = (pct: number) => ((pct / 100) * (RELAZIONE_EXPORT_WIDTH_PX / 96) * 2.54).toFixed(1);

type LayoutId = "left" | "center" | "right" | "float-left" | "float-right";
const LAYOUTS: { id: LayoutId; wrap: FigureWrap; align: FigureAlign; label: string }[] = [
  { id: "left", wrap: "none", align: "left", label: "A sinistra, da sola sulla riga" },
  { id: "center", wrap: "none", align: "center", label: "Al centro, da sola sulla riga" },
  { id: "right", wrap: "none", align: "right", label: "A destra, da sola sulla riga" },
  { id: "float-left", wrap: "square", align: "left", label: "Figura a sinistra, testo a fianco" },
  { id: "float-right", wrap: "square", align: "right", label: "Figura a destra, testo a fianco" },
];

// Schema della pagina: righe di testo in grigio e la figura in colore
function LayoutIcon({ id }: { id: LayoutId }) {
  const line = (x: number, y: number, w: number) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={1.8} rx={0.9} fill="currentColor" opacity={0.35} />;
  const fig = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx={1.5} fill="currentColor" />;
  let body: React.ReactNode;
  if (id === "float-left" || id === "float-right") {
    const left = id === "float-left";
    body = (
      <>
        {fig(left ? 4 : 17, 4, 11, 10)}
        {[4, 7.5, 11].map((y) => line(left ? 18 : 4, y, 10))}
        {[16.5, 20].map((y) => line(4, y, 24))}
      </>
    );
  } else {
    const x = id === "left" ? 4 : id === "right" ? 17 : 10.5;
    body = (
      <>
        {line(4, 3, 24)}
        {fig(x, 7, 11, 9)}
        {line(4, 19.5, 24)}
        {line(4, 23, 16)}
      </>
    );
  }
  return (
    <svg width="34" height="28" viewBox="0 0 32 27" className="rounded-sm bg-background" aria-hidden>
      {body}
    </svg>
  );
}

// Con il testo a fianco una figura molto larga lascerebbe poco spazio alle parole
function applyFigureLayout(editor: Editor, sel: FigureRef, l: (typeof LAYOUTS)[number]) {
  const pct = figureWidthPct(sel.node.attrs);
  editor.chain().focus().updateAttributes(sel.node.type.name, {
    wrap: l.wrap, align: l.align, ...(l.wrap === "square" && pct > 60 ? { widthPct: 50 } : {}),
  }).run();
}

function currentLayout(sel: FigureRef): LayoutId {
  const align = (sel.node.attrs.align as FigureAlign) || "center";
  return figureWrap(sel.node.attrs) === "square" ? (align === "right" ? "float-right" : "float-left") : align;
}

export function FigurePanel({
  editor, uploading, placing, askWhere, onAskWhere, onMove, onCancelMove,
  onUploadFiles, onPickProject, onPickSnapshot, onReplaceProject, onReplaceUpload, section, nonce = 0,
}: {
  section?: string;
  nonce?: number;
  editor: Editor;
  uploading: boolean;
  placing: boolean;
  askWhere: boolean;
  onAskWhere: (v: boolean) => void;
  onMove: () => void;
  onCancelMove: () => void;
  onUploadFiles: (files: File[]) => void;
  onPickProject: () => void;
  onPickSnapshot: () => void;
  onReplaceProject: () => void;
  onReplaceUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const sel = selectedFigure(editor);
  const all = listFigures(editor);
  const set = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes(sel!.node.type.name, attrs).run();
  const pct = sel ? figureWidthPct(sel.node.attrs) : 100;
  const align = (sel?.node.attrs.align as FigureAlign) || "center";
  const wrap = sel ? figureWrap(sel.node.attrs) : "none";
  const layout: LayoutId = sel ? currentLayout(sel) : "center";
  const index = sel ? all.findIndex((f) => f.pos === sel.pos) : -1;
  const cm = figureCm(pct);
  const applyLayout = (l: (typeof LAYOUTS)[number]) => applyFigureLayout(editor, sel!, l);
  useScrollToSection(section, nonce);

  useEffect(() => {
    if (!placing) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancelMove(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [placing, onCancelMove]);

  return (
    <div className="space-y-3">
      {!sel && (
        <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Clicca su una figura nel documento per ridimensionarla, posizionarla o cambiarne la didascalia. Gli strumenti si attivano qui.
        </p>
      )}

      {sel && (
        <div className="space-y-3">
          <Section title={`Figura ${index + 1} di ${all.length}`}>
            <img src={sel.node.attrs.src} alt="" className="max-h-28 w-full rounded border border-border bg-white object-contain" />
          </Section>

          <Section title="Dimensione" id="fig-dimensione">
            <div className="flex items-center gap-2">
              <input type="range" min={10} max={100} step={5} value={pct} onChange={(e) => set({ widthPct: Number(e.target.value) })} className="flex-1" />
              <div className="flex items-center gap-1">
                <input type="number" min={10} max={100} value={pct} onChange={(e) => set({ widthPct: Math.min(100, Math.max(10, Number(e.target.value) || 10)) })}
                  className="h-7 w-14 rounded border border-input bg-background px-1.5 text-xs" />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => set({ widthPct: p })}
                  className={`h-7 min-w-9 rounded border px-2 text-xs ${pct === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {p}%
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Circa {cm} cm di larghezza nel Word. Puoi anche trascinare l'angolo della figura.</p>
          </Section>

          <Section title="Disposizione" id="fig-disposizione">
            <div className="grid grid-cols-5 gap-1">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" title={l.label} aria-label={l.label} onMouseDown={(e) => e.preventDefault()} onClick={() => applyLayout(l)}
                  className={`flex items-center justify-center rounded border p-1 ${layout === l.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <LayoutIcon id={l.id} />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {wrap === "square"
                ? `Il testo scorre a fianco: la figura sta ${align === "right" ? "a destra" : "a sinistra"} e si aggancia al paragrafo che la segue.`
                : "Le prime tre tengono la figura da sola sulla riga; le ultime due la affiancano al testo."}
            </p>
          </Section>

          <Section title="Posizione nel documento" id="fig-posizione">
            <Button type="button" size="sm" variant={placing ? "default" : "outline"} className="w-full h-8 gap-1.5 text-xs"
              onClick={placing ? onCancelMove : onMove}>
              {placing ? <><X size={13} /> Annulla spostamento</> : <><Crosshair size={13} /> Scegli dove metterla…</>}
            </Button>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1 text-xs" disabled={index < 0}
                onClick={() => moveBlock(editor, sel, -1)}><ArrowUp size={14} /> Su</Button>
              <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1 text-xs" disabled={index < 0}
                onClick={() => moveBlock(editor, sel, 1)}><ArrowDown size={14} /> Giù</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              «Scegli dove metterla» mostra nel documento le icone <b>Metti qui</b> tra un blocco e l'altro. Oppure afferra la maniglia <GripVertical size={11} className="inline" /> in alto a sinistra della figura e trascinala.
            </p>
          </Section>

          <Section title="Didascalia" id="fig-didascalia">
            <textarea
              value={sel.node.attrs.didascalia || ""}
              onChange={(e) => set({ didascalia: e.target.value })}
              rows={2}
              placeholder="Es. Figura 1 – Pianta di fase"
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs"
            />
          </Section>

          <Section title="Immagine" id="fig-immagine">
            <div className="grid grid-cols-2 gap-1.5">
              <input ref={replaceRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplaceUpload(f); e.target.value = ""; }} />
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => replaceRef.current?.click()}>
                <RefreshCw size={13} /> Sostituisci
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onReplaceProject}>
                <Folder size={13} /> Da progetto
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" title="Inserisce una copia subito dopo"
                onClick={() => editor.chain().focus().insertContentAt(sel.pos + sel.node.nodeSize, sel.node.toJSON()).run()}>
                <Copy size={13} /> Duplica
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive"
                onClick={() => editor.chain().focus().deleteSelection().run()}>
                <Trash2 size={13} /> Elimina
              </Button>
            </div>
          </Section>
        </div>
      )}

      <Section title="Importa figure" id="fig-importa">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple className="hidden"
          onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) onUploadFiles(fs); e.target.value = ""; }} />
        <Button type="button" size="sm" className="w-full h-8 gap-1.5 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> {uploading ? "Caricamento…" : "Carica dal computer…"}
        </Button>
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onPickProject}>
            <ImagePlus size={13} /> Dal progetto
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onPickSnapshot}>
            <MapIcon size={13} /> Da WebMap
          </Button>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={askWhere} onChange={(e) => onAskWhere(e.target.checked)} />
          <span>Fammi scegliere dove inserire ogni figura nuova (compaiono le icone «Metti qui» nel documento)</span>
        </label>
        <p className="text-xs text-muted-foreground">Puoi anche incollare o trascinare immagini direttamente nel documento. Nell'export Word servono PNG o JPEG.</p>
      </Section>

      <Section title={`Figure nel documento (${all.length})`}>
        {all.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessuna figura ancora.</p>
        ) : (
          <div className="space-y-1">
            {all.map((f, i) => (
              <button key={f.pos} type="button" onClick={() => selectFigure(editor, f.pos)}
                className={`w-full flex items-center gap-2 rounded border p-1 text-left hover:bg-muted ${sel?.pos === f.pos ? "border-primary bg-primary/5" : "border-border"}`}>
                <img src={f.node.attrs.src} alt="" className="h-10 w-14 shrink-0 rounded-sm bg-white object-contain" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{f.node.attrs.didascalia || `Figura ${i + 1}`}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {figureWidthPct(f.node.attrs)}% · {figureWrap(f.node.attrs) === "square" ? "testo a fianco" : "da sola"} · {f.node.type.name === "snapshotFigure" ? "WebMap" : "immagine"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Scheda «Figura» della barra multifunzione ────────────────────────────────

export function FigureRibbon({
  editor, placing, onMove, onCancelMove, onReplaceProject, onReplaceUpload, onOpenPanel,
}: {
  editor: Editor;
  placing: boolean;
  onMove: () => void;
  onCancelMove: () => void;
  onReplaceProject: () => void;
  onReplaceUpload: (file: File) => void;
  onOpenPanel: (section?: string) => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const sel = selectedFigure(editor);
  if (!sel) return null;
  const all = listFigures(editor);
  const index = all.findIndex((f) => f.pos === sel.pos);
  const pct = figureWidthPct(sel.node.attrs);
  const layout = currentLayout(sel);
  const set = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes(sel.node.type.name, attrs).run();

  return (
    <>
      <RibbonGroup label="Dimensione" onLauncher={() => onOpenPanel("fig-dimensione")} launcherTitle="Dimensione: cursore e misure">
        <RibbonStack>
          <RibbonRow>
            <span className="text-xs">Larghezza</span>
            <NumField value={pct} suffix="%" min={10} max={100} className="w-12" title="Larghezza in % del testo"
              onCommit={(n) => { if (n) set({ widthPct: Math.round(n) }); }} />
            <span className="text-[11px] text-muted-foreground">≈ {figureCm(pct)} cm</span>
          </RibbonRow>
          <RibbonRow>
            {PRESETS.map((p) => (
              <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => set({ widthPct: p })}
                className={`h-7 min-w-8 rounded border px-1 text-xs ${pct === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                {p}%
              </button>
            ))}
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Disposizione" onLauncher={() => onOpenPanel("fig-disposizione")} launcherTitle="Disposizione rispetto al testo">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" title={l.label} aria-label={l.label} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFigureLayout(editor, sel, l)}
            className={`flex items-center justify-center rounded border p-0.5 ${layout === l.id ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
            <LayoutIcon id={l.id} />
          </button>
        ))}
      </RibbonGroup>

      <RibbonGroup label="Posizione" onLauncher={() => onOpenPanel("fig-posizione")} launcherTitle="Posizione nel documento">
        <RibbonBig label={placing ? "Annulla" : "Sposta in…"} active={placing} icon={placing ? <X size={20} /> : <Crosshair size={20} />}
          title={placing ? "Annulla lo spostamento" : "Mostra nel documento i punti «Metti qui» per scegliere dove spostarla"}
          onClick={placing ? onCancelMove : onMove} />
        <RibbonStack>
          <RibbonRow><RibbonBtn title="Sposta la figura sopra il blocco precedente" label="Su" icon={<ArrowUp size={14} />} disabled={index < 0} onClick={() => moveBlock(editor, sel, -1)} /></RibbonRow>
          <RibbonRow><RibbonBtn title="Sposta la figura sotto il blocco successivo" label="Giù" icon={<ArrowDown size={14} />} disabled={index < 0} onClick={() => moveBlock(editor, sel, 1)} /></RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Didascalia" onLauncher={() => onOpenPanel("fig-didascalia")} launcherTitle="Testo della didascalia">
        <RibbonBig label="Didascalia" icon={<Type size={20} />} title="Modifica la didascalia (anche direttamente sotto la figura)" onClick={() => onOpenPanel("fig-didascalia")} />
      </RibbonGroup>

      <RibbonGroup label="Immagine" onLauncher={() => onOpenPanel("fig-immagine")} launcherTitle="Sostituisci, duplica, elimina">
        <input ref={replaceRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplaceUpload(f); e.target.value = ""; }} />
        <RibbonBig label="Sostituisci" icon={<RefreshCw size={20} />} title="Sostituisci con un file del computer, mantenendo misure e didascalia" onClick={() => replaceRef.current?.click()} />
        <RibbonBig label="Da progetto" icon={<Folder size={20} />} title="Sostituisci con un'immagine del progetto" onClick={onReplaceProject} />
        <RibbonBig label="Duplica" icon={<Copy size={20} />} title="Inserisce una copia subito dopo"
          onClick={() => editor.chain().focus().insertContentAt(sel.pos + sel.node.nodeSize, sel.node.toJSON()).run()} />
        <RibbonBig label="Elimina" danger icon={<Trash2 size={20} />} title="Elimina la figura" onClick={() => editor.chain().focus().deleteSelection().run()} />
      </RibbonGroup>
    </>
  );
}
