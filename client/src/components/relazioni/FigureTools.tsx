import { useRef } from "react";
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Copy, Folder, ImagePlus, Map as MapIcon, RefreshCw, Trash2, Upload,
} from "lucide-react";
import { RELAZIONE_EXPORT_WIDTH_PX, RELAZIONE_TEXT_WIDTH_PX, figureWidthPct, type FigureAlign } from "@shared/relazione_layout";
import { buildProjectUrl } from "@/lib/project";
import { Button } from "@/components/ui/button";

// ─── Nodi figura ──────────────────────────────────────────────────────────────

export const FIGURE_NODES = ["snapshotFigure", "projectImage"] as const;
export const isFigureName = (name: string | undefined) => !!name && (FIGURE_NODES as readonly string[]).includes(name);

const snapStep = (n: number) => Math.min(100, Math.max(10, Math.round(n / 5) * 5));

function FigureView({ node, updateAttributes, deleteNode, selected }: any) {
  const pct = figureWidthPct(node.attrs);
  const align: FigureAlign = node.attrs.align || "center";
  const wrapRef = useRef<HTMLDivElement>(null);

  // Trascinando l'angolo la larghezza cambia in % del foglio (a scatti di 5)
  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startPct = pct;
    const full = wrapRef.current?.clientWidth || RELAZIONE_TEXT_WIDTH_PX;
    const factor = align === "center" ? 2 : 1;
    const move = (ev: PointerEvent) => updateAttributes({ widthPct: snapStep(startPct + ((ev.clientX - startX) / full) * 100 * factor) });
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <NodeViewWrapper className="my-4" data-drag-handle style={{ textAlign: align }}>
      <div ref={wrapRef} className="w-full">
        <div className={`relative inline-block max-w-full group align-top ${selected ? "ring-2 ring-primary rounded-sm" : ""}`} style={{ width: `${pct}%` }}>
          <img src={node.attrs.src} alt={node.attrs.didascalia || ""} draggable={false} className="block w-full h-auto" />
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
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 rounded-sm bg-primary border-2 border-white cursor-nwse-resize touch-none"
            />
          )}
          {selected && (
            <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground pointer-events-none">{pct}%</span>
          )}
        </div>
        <input
          value={node.attrs.didascalia || ""}
          onChange={(e) => updateAttributes({ didascalia: e.target.value })}
          placeholder="Didascalia della figura"
          style={{ width: `${Math.max(pct, 40)}%` }}
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
};

function renderFigure(name: string, dataKey: string, node: any) {
  const pct = figureWidthPct(node.attrs);
  const align = node.attrs.align || "center";
  return [
    "figure",
    { [dataKey]: name, "data-width-pct": pct, "data-align": align, style: `text-align:${align}` },
    ["img", { src: node.attrs.src, style: `width:${pct}%;max-width:100%` }],
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
  return { type: "projectImage", attrs: { name: img.name, src: img.url, didascalia: "", widthPct: img.widthPct, align: "center" } };
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

function selectFigure(editor: Editor, pos: number) {
  editor.chain().focus().setNodeSelection(pos).run();
  (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─── Pannello Figure ──────────────────────────────────────────────────────────

const PRESETS = [25, 33, 50, 75, 100];
const ALIGNS: { value: FigureAlign; label: string; icon: React.ReactNode }[] = [
  { value: "left", label: "A sinistra", icon: <AlignLeft size={15} /> },
  { value: "center", label: "Al centro", icon: <AlignCenter size={15} /> },
  { value: "right", label: "A destra", icon: <AlignRight size={15} /> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pt-3 border-t border-border first:border-0 first:pt-0">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

export function FigurePanel({ editor, uploading, onUploadFiles, onPickProject, onPickSnapshot, onReplaceProject, onReplaceUpload }: {
  editor: Editor;
  uploading: boolean;
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
  const index = sel ? all.findIndex((f) => f.pos === sel.pos) : -1;
  const cm = ((pct / 100) * (RELAZIONE_EXPORT_WIDTH_PX / 96) * 2.54).toFixed(1);

  return (
    <div className="space-y-3">
      {!sel && (
        <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Clicca su una figura nel documento per ridimensionarla, allinearla o cambiarne la didascalia. Gli strumenti si attivano qui.
        </p>
      )}

      {sel && (
        <div className="space-y-3">
          <Section title={`Figura ${index + 1} di ${all.length}`}>
            <img src={sel.node.attrs.src} alt="" className="max-h-28 w-full rounded border border-border bg-white object-contain" />
          </Section>

          <Section title="Dimensione">
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

          <Section title="Posizione">
            <div className="flex gap-1">
              {ALIGNS.map((a) => (
                <button key={a.value} type="button" title={a.label} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ align: a.value })}
                  className={`h-8 w-9 inline-flex items-center justify-center rounded border ${align === a.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {a.icon}
                </button>
              ))}
              <span className="mx-1 w-px bg-border" />
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" title="Sposta su" disabled={index <= 0}
                onClick={() => moveBlock(editor, sel, -1)}><ArrowUp size={14} /></Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" title="Sposta giù" disabled={index < 0}
                onClick={() => moveBlock(editor, sel, 1)}><ArrowDown size={14} /></Button>
            </div>
          </Section>

          <Section title="Didascalia">
            <textarea
              value={sel.node.attrs.didascalia || ""}
              onChange={(e) => set({ didascalia: e.target.value })}
              rows={2}
              placeholder="Es. Figura 1 – Pianta di fase"
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs"
            />
          </Section>

          <Section title="Immagine">
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

      <Section title="Importa figure">
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
                  <span className="block text-[11px] text-muted-foreground">{figureWidthPct(f.node.attrs)}% · {f.node.type.name === "snapshotFigure" ? "WebMap" : "immagine"}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
