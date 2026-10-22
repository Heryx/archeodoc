import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatUsCode } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import { EditorContent, Mark, Node, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Minus, Undo2, Redo2, ImagePlus, FileText, Printer, Loader2, Download, Trash2, Check, Link2, Sparkles, BookOpen,
  Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, Subscript as SubIcon, Superscript as SuperIcon,
  Highlighter, Table as TableIcon, RemoveFormatting, Link as LinkIcon, IndentIncrease, IndentDecrease,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export type RelazioneDoc = {
  id: number;
  titolo: string;
  tipo: string;
  stato: "bozza" | "completata";
  dataInizio: string | null;
  dataFine: string | null;
  contenuto: string | null;
  intestazione: string | null;
  allegato?: { id: number; nomeFile: string; url: string } | null;
};

type SnapshotRef = { id: number; titolo: string; didascalia: string | null; url: string };
type LinkedSnapshot = { snapshotId: number; posizione: number; snapshot: SnapshotRef };

type Intestazione = { intestazione: string; piePagina: string; numeroPagina: boolean };
const EMPTY_HEADER: Intestazione = { intestazione: "", piePagina: "", numeroPagina: true };

// ─── Nodo "figura" legato a uno snapshot WebMap ───────────────────────────────

function FigureView({ node, updateAttributes, deleteNode, selected }: any) {
  return (
    <NodeViewWrapper className={`my-4 text-center ${selected ? "ring-2 ring-primary rounded" : ""}`} data-drag-handle>
      <div className="relative inline-block max-w-full group">
        <img src={node.attrs.src} alt={node.attrs.didascalia || ""} className="max-w-full rounded border border-border" />
        <button
          type="button"
          onClick={() => deleteNode()}
          className="absolute top-1 right-1 hidden group-hover:block bg-background/90 border border-border rounded p-1 text-destructive"
          title="Rimuovi figura"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <input
        value={node.attrs.didascalia || ""}
        onChange={(e) => updateAttributes({ didascalia: e.target.value })}
        placeholder="Didascalia della figura"
        className="block mx-auto mt-1 w-full max-w-md text-center text-sm italic bg-transparent border-0 border-b border-transparent focus:border-border outline-none"
      />
    </NodeViewWrapper>
  );
}

const SnapshotFigure = Node.create({
  name: "snapshotFigure",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      snapshotId: { default: null },
      src: { default: "" },
      didascalia: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-snapshot-id]" }];
  },
  renderHTML({ node }) {
    return [
      "figure",
      { "data-snapshot-id": node.attrs.snapshotId, style: "text-align:center" },
      ["img", { src: node.attrs.src, style: "max-width:100%" }],
      ["figcaption", {}, node.attrs.didascalia || ""],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

// ─── Mark "usLink": collegamento [[US]] (visibile solo nell'editor) ────────────

const UsLink = Mark.create({
  name: "usLink",
  inclusive: false,
  addAttributes() {
    return { usId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-us-id]" }];
  },
  renderHTML({ mark }) {
    return ["span", { "data-us-id": mark.attrs.usId, class: "us-link", title: "Ctrl+clic per aprire la scheda US" }, 0];
  },
});

type UsItem = { id: number; codiceUS: string; tipo: string | null; definizione: string | null };
type Suggest = { from: number; to: number; query: string; x: number; y: number };

// Elenca gli ID delle US richiamate nel documento
function collectUsIds(node: any, out = new Set<number>()): Set<number> {
  for (const m of node?.marks || []) if (m.type === "usLink" && m.attrs?.usId != null) out.add(Number(m.attrs.usId));
  (node?.content || []).forEach((c: any) => collectUsIds(c, out));
  return out;
}

// ─── Contenuto iniziale ───────────────────────────────────────────────────────

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function buildInitialContent(titolo: string, linked: LinkedSnapshot[]) {
  const content: any[] = [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: titolo }] }, { type: "paragraph" }];
  for (const l of [...linked].sort((a, b) => a.posizione - b.posizione)) {
    content.push({
      type: "snapshotFigure",
      attrs: { snapshotId: l.snapshotId, src: l.snapshot.url, didascalia: l.snapshot.didascalia || l.snapshot.titolo },
    });
  }
  return { type: "doc", content };
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ToolButton({ active, disabled, onClick, title, children }: {
  active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 w-8 inline-flex items-center justify-center rounded text-sm disabled:opacity-40 ${
        active ? "bg-primary/15 text-primary" : "hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

const FONTS = ["Times New Roman", "Arial", "Calibri", "Georgia", "Verdana", "Courier New"];
const SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt"];
const smallSelect = "h-8 rounded border border-input bg-background px-1.5 text-xs";

function ColorTool({ title, icon, value, onPick, onClear }: {
  title: string; icon: React.ReactNode; value: string; onPick: (c: string) => void; onClear: () => void;
}) {
  return (
    <span className="relative inline-flex">
      <label title={title} className="h-8 w-8 inline-flex flex-col items-center justify-center rounded hover:bg-muted cursor-pointer">
        {icon}
        <span className="block h-[3px] w-4 rounded -mt-0.5" style={{ background: value || "transparent", border: value ? "none" : "1px solid hsl(var(--border))" }} />
        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={value || "#000000"}
          onChange={(e) => onPick(e.target.value)} />
      </label>
      <button type="button" title={`${title}: rimuovi`} onMouseDown={(e) => e.preventDefault()} onClick={onClear}
        className="text-[10px] leading-none text-muted-foreground hover:text-foreground self-start -ml-1 mt-0.5">×</button>
    </span>
  );
}

function Toolbar({ editor, onInsertFigure, onGenerate }: { editor: Editor; onInsertFigure: () => void; onGenerate: () => void }) {
  const chain = () => editor.chain().focus();
  const sep = <span className="w-px h-5 bg-border mx-1" />;
  const attrs = editor.getAttributes("textStyle");
  const blockValue = editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2"
    : editor.isActive("heading", { level: 3 }) ? "3" : editor.isActive("heading", { level: 4 }) ? "4" : "0";
  const inTable = editor.isActive("table");
  const inList = editor.isActive("bulletList") || editor.isActive("orderedList");

  const setLink = () => {
    const prev = editor.getAttributes("link").href || "https://";
    const url = window.prompt("Indirizzo del collegamento (vuoto per rimuoverlo)", prev);
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const tableAction = (action: string) => {
    const c = chain();
    switch (action) {
      case "insert": c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case "addRow": c.addRowAfter().run(); break;
      case "addCol": c.addColumnAfter().run(); break;
      case "delRow": c.deleteRow().run(); break;
      case "delCol": c.deleteColumn().run(); break;
      case "merge": c.mergeCells().run(); break;
      case "split": c.splitCell().run(); break;
      case "delTable": c.deleteTable().run(); break;
    }
  };

  return (
    <div className="border-b border-border bg-muted/30 px-2 py-1 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1">
        <ToolButton title="Annulla" onClick={() => chain().undo().run()} disabled={!editor.can().undo()}><Undo2 size={15} /></ToolButton>
        <ToolButton title="Ripeti" onClick={() => chain().redo().run()} disabled={!editor.can().redo()}><Redo2 size={15} /></ToolButton>
        {sep}
        <select title="Stile del paragrafo" className={`${smallSelect} w-28`} value={blockValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v === 0) chain().setParagraph().run();
            else chain().setHeading({ level: v as 1 | 2 | 3 | 4 }).run();
          }}>
          <option value="0">Paragrafo</option>
          <option value="1">Titolo 1</option>
          <option value="2">Titolo 2</option>
          <option value="3">Titolo 3</option>
          <option value="4">Titolo 4</option>
        </select>
        <select title="Carattere" className={`${smallSelect} w-36`} value={attrs.fontFamily || ""}
          onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}>
          <option value="">Carattere predefinito</option>
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select title="Dimensione" className={`${smallSelect} w-20`} value={attrs.fontSize || ""}
          onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}>
          <option value="">Dim.</option>
          {SIZES.map((z) => <option key={z} value={z}>{z.replace("pt", "")}</option>)}
        </select>
        {sep}
        <ToolButton title="Grassetto (Ctrl+B)" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><Bold size={15} /></ToolButton>
        <ToolButton title="Corsivo (Ctrl+I)" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><Italic size={15} /></ToolButton>
        <ToolButton title="Sottolineato (Ctrl+U)" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><UnderlineIcon size={15} /></ToolButton>
        <ToolButton title="Barrato" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><Strikethrough size={15} /></ToolButton>
        <ToolButton title="Pedice" active={editor.isActive("subscript")} onClick={() => chain().toggleSubscript().run()}><SubIcon size={15} /></ToolButton>
        <ToolButton title="Apice" active={editor.isActive("superscript")} onClick={() => chain().toggleSuperscript().run()}><SuperIcon size={15} /></ToolButton>
        <ColorTool title="Colore del testo" icon={<span className="text-sm font-bold leading-none">A</span>}
          value={attrs.color || ""} onPick={(c) => chain().setColor(c).run()} onClear={() => chain().unsetColor().run()} />
        <ColorTool title="Evidenziatore" icon={<Highlighter size={14} />}
          value={editor.getAttributes("highlight").color || ""}
          onPick={(c) => chain().setHighlight({ color: c }).run()} onClear={() => chain().unsetHighlight().run()} />
        <ToolButton title="Cancella formattazione" onClick={() => chain().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} /></ToolButton>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <ToolButton title="Allinea a sinistra" active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()}><AlignLeft size={15} /></ToolButton>
        <ToolButton title="Centra" active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()}><AlignCenter size={15} /></ToolButton>
        <ToolButton title="Allinea a destra" active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()}><AlignRight size={15} /></ToolButton>
        <ToolButton title="Giustifica" active={editor.isActive({ textAlign: "justify" })} onClick={() => chain().setTextAlign("justify").run()}><AlignJustify size={15} /></ToolButton>
        {sep}
        <ToolButton title="Elenco puntato" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><List size={15} /></ToolButton>
        <ToolButton title="Elenco numerato" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={15} /></ToolButton>
        <ToolButton title="Riduci rientro" disabled={!inList} onClick={() => chain().liftListItem("listItem").run()}><IndentDecrease size={15} /></ToolButton>
        <ToolButton title="Aumenta rientro" disabled={!inList} onClick={() => chain().sinkListItem("listItem").run()}><IndentIncrease size={15} /></ToolButton>
        <ToolButton title="Citazione" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}><Quote size={15} /></ToolButton>
        <ToolButton title="Linea divisoria" onClick={() => chain().setHorizontalRule().run()}><Minus size={15} /></ToolButton>
        {sep}
        <ToolButton title="Collegamento web" active={editor.isActive("link")} onClick={setLink}><LinkIcon size={15} /></ToolButton>
        <select title="Tabella" className={`${smallSelect} w-28`} value="" onChange={(e) => { if (e.target.value) tableAction(e.target.value); e.target.value = ""; }}>
          <option value="">Tabella…</option>
          <option value="insert">Inserisci 3×3</option>
          {inTable && (
            <>
              <option value="addRow">Aggiungi riga</option>
              <option value="addCol">Aggiungi colonna</option>
              <option value="delRow">Elimina riga</option>
              <option value="delCol">Elimina colonna</option>
              <option value="merge">Unisci celle</option>
              <option value="split">Dividi cella</option>
              <option value="delTable">Elimina tabella</option>
            </>
          )}
        </select>
        {sep}
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onInsertFigure}>
          <ImagePlus size={14} /> Figura WebMap
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onGenerate}>
          <Sparkles size={14} /> Da giornale
        </Button>
      </div>
    </div>
  );
}

// ─── Generazione del testo dal giornale di scavo ──────────────────────────────

function GenerateTextDialog({ open, onOpenChange, cantiereId, defaultFrom, defaultTo, onInsert }: {
  open: boolean; onOpenChange: (v: boolean) => void; cantiereId: number;
  defaultFrom: string | null; defaultTo: string | null; onInsert: (nodes: any[]) => void;
}) {
  const { toast } = useToast();
  const [da, setDa] = useState(defaultFrom || "");
  const [a, setA] = useState(defaultTo || "");
  const [useAI, setUseAI] = useState(false);
  const [includiUS, setIncludiUS] = useState(true);
  const aiStatus = useQuery<{ available: boolean }>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    enabled: open,
  });
  const aiAvailable = !!aiStatus.data?.available;

  const run = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni/genera-testo`, {
        da: da || null, a: a || null, useAI: useAI && aiAvailable, includiUS,
      })).json(),
    onSuccess: (res: any) => {
      onInsert(res.content || []);
      onOpenChange(false);
      const n = Number(res?.warnings?.length || 0);
      toast({
        title: "Testo inserito",
        description: `${res.giornate} giornate${n ? ` — ${res.warnings.join(" ")}` : ""}. Rileggi e correggi prima di consegnare.`,
      });
    },
    onError: (e: any) => {
      const raw = String(e?.message || "");
      let msg = raw;
      try { msg = JSON.parse(raw.slice(raw.indexOf("{")))?.error || raw; } catch { /* testo grezzo */ }
      toast({ title: "Generazione non riuscita", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Genera testo dal giornale di scavo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Dal</Label><Input type="date" value={da} onChange={(e) => setDa(e.target.value)} /></div>
            <div><Label className="text-xs">Al</Label><Input type="date" value={a} onChange={(e) => setA(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Lascia vuoto per usare tutte le giornate.</p>

          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={!useAI} onChange={() => setUseAI(false)} />
              <span><strong>Senza IA</strong> — riepilogo giornata per giornata con dati e diario così come sono scritti.</span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${aiAvailable ? "" : "opacity-50"}`}>
              <input type="radio" className="mt-1" checked={useAI} disabled={!aiAvailable} onChange={() => setUseAI(true)} />
              <span><strong>Con IA</strong> — testo narrativo da relazione, raggruppato per attività.
                {!aiAvailable && " (nessun provider IA configurato)"}</span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includiUS} onChange={(e) => setIncludiUS(e.target.checked)} />
            Includi le US documentate e collegale alle schede
          </label>

          <Button className="w-full gap-2" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            {run.isPending ? "Generazione…" : "Genera e inserisci"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Selettore figure ─────────────────────────────────────────────────────────

function FigurePicker({ open, onOpenChange, cantiereId, onPick }: {
  open: boolean; onOpenChange: (v: boolean) => void; cantiereId: number; onPick: (s: SnapshotRef) => void;
}) {
  const { data, isLoading } = useQuery<{ snapshots: SnapshotRef[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "map-snapshots"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/map-snapshots`)).json(),
    enabled: open,
  });
  const snapshots = data?.snapshots || [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Inserisci figura da WebMap</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento...</div>
        ) : snapshots.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nessuna mappa salvata. Salva uno snapshot dalla pagina WebMap per poterlo inserire qui.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {snapshots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onPick(s); onOpenChange(false); }}
                className="rounded border border-border overflow-hidden text-left hover:border-primary"
              >
                <img src={s.url} alt={s.titolo} className="w-full h-28 object-cover bg-muted" />
                <div className="px-2 py-1 text-xs truncate">{s.titolo}</div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Anteprima di stampa (PDF) ────────────────────────────────────────────────

function printAsPdf(html: string, header: Intestazione, titolo: string) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titolo)}</title>
<style>
@page { size: A4; margin: 22mm 20mm; }
body { font-family: "Times New Roman", serif; font-size: 11.5pt; line-height: 1.45; color: #111; }
.hd { text-align: center; font-size: 9pt; color: #555; border-bottom: 1px solid #bbb; padding-bottom: 4px; margin-bottom: 14px; }
.ft { text-align: center; font-size: 9pt; color: #555; margin-top: 18px; border-top: 1px solid #bbb; padding-top: 4px; }
h1 { font-size: 18pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
h1, h2, h3 { break-after: avoid; }
figure { margin: 12px 0; text-align: center; break-inside: avoid; } figure img { max-width: 100%; }
figcaption { font-style: italic; font-size: 10pt; }
blockquote { margin-left: 18px; padding-left: 10px; border-left: 3px solid #ccc; }
p { margin: 0 0 8px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; } td, th { border: 1px solid #888; padding: 4px 6px; vertical-align: top; } th { background: #eee; }
mark { padding: 0 1px; }
</style></head><body>
${header.intestazione ? `<div class="hd">${esc(header.intestazione)}</div>` : ""}
${html}
${header.piePagina ? `<div class="ft">${esc(header.piePagina)}</div>` : ""}
</body></html>`);
  w.document.close();
  const imgs = Array.from(w.document.images);
  const go = () => { w.focus(); w.print(); };
  if (imgs.length === 0) { setTimeout(go, 200); return true; }
  let pending = imgs.length;
  const done = () => { if (--pending <= 0) go(); };
  imgs.forEach((img) => (img.complete ? done() : (img.onload = img.onerror = done)));
  return true;
}

// ─── Pannello principale ──────────────────────────────────────────────────────

export function RelazioneEditorPanel({ cantiereId, docId }: { cantiereId: number; docId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detailKey = ["/api/cantieri", String(cantiereId), "documentazioni", String(docId)];

  const { data, isLoading } = useQuery<{ documentazione: RelazioneDoc; snapshots: LinkedSnapshot[] }>({
    queryKey: detailKey,
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni/${docId}`)).json(),
  });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Caricamento...</div>;
  // Il key rimonta l'editor quando si cambia documento
  return <EditorBody key={docId} cantiereId={cantiereId} doc={data.documentazione} linked={data.snapshots} detailKey={detailKey} queryClient={queryClient} toast={toast} />;
}

function EditorBody({ cantiereId, doc, linked, detailKey, queryClient, toast }: {
  cantiereId: number; doc: RelazioneDoc; linked: LinkedSnapshot[];
  detailKey: (string | number)[]; queryClient: ReturnType<typeof useQueryClient>; toast: ReturnType<typeof useToast>["toast"];
}) {
  const [titolo, setTitolo] = useState(doc.titolo);
  const [header, setHeader] = useState<Intestazione>({ ...EMPTY_HEADER, ...(parseJson<Intestazione>(doc.intestazione) || {}) });
  const [save, setSave] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [, navigate] = useLocation();
  const { settings: codeSettings } = useProjectCodeSettings();
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [sugIndex, setSugIndex] = useState(0);
  const [usIds, setUsIds] = useState<number[]>(() => Array.from(collectUsIds(parseJson<any>(doc.contenuto))));
  const usQuery = useQuery<UsItem[]>({
    queryKey: ["/api/cantieri", String(cantiereId), "us"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/us`)).json(),
  });
  const usList = usQuery.data || [];
  const usLabel = (u: UsItem) => formatUsCode(u.codiceUS, u.tipo, codeSettings.tombaStyle);
  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.trim().toLowerCase();
    return usList
      .filter((u) => !q || usLabel(u).toLowerCase().includes(q) || String(u.codiceUS).toLowerCase().includes(q) || (u.definizione || "").toLowerCase().includes(q))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggest, usList]);
  // Ref per i gestori dell'editor, creati una sola volta
  const live = useRef({ suggest, suggestions, sugIndex, navigate, cantiereId });
  live.current = { suggest, suggestions, sugIndex, navigate, cantiereId };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef<{ contenuto?: unknown; intestazione?: Intestazione; titolo?: string }>({});

  const initialContent = useMemo(
    () => parseJson<any>(doc.contenuto) || buildInitialContent(doc.titolo, linked),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.id],
  );

  const flush = async () => {
    clearTimeout(timer.current);
    const payload = latest.current;
    if (!Object.keys(payload).length) return;
    latest.current = {};
    setSave("saving");
    try {
      await apiRequest("PATCH", `/api/cantieri/${cantiereId}/documentazioni/${doc.id}`, payload);
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"], exact: true });
      setSave("saved");
      if (payload.contenuto) queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "relazioni-links"] });
    } catch (e: any) {
      latest.current = { ...payload, ...latest.current };
      setSave("dirty");
      toast({ title: "Salvataggio non riuscito", description: e?.message, variant: "destructive" });
    }
  };
  const schedule = (patch: typeof latest.current) => {
    latest.current = { ...latest.current, ...patch };
    setSave("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyleKit.configure({ backgroundColor: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Subscript,
      Superscript,
      TableKit.configure({ table: { resizable: false } }),
      SnapshotFigure,
      UsLink,
      Placeholder.configure({ placeholder: "Scrivi la relazione, oppure inserisci una figura dalla WebMap…" }),
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none min-h-[60vh] px-10 py-8 [&_.us-link]:text-primary [&_.us-link]:border-b [&_.us-link]:border-dotted [&_.us-link]:border-primary [&_.us-link]:cursor-pointer [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_th]:border [&_td]:border-border [&_th]:border-border [&_td]:p-1.5 [&_th]:p-1.5 [&_th]:bg-muted/60 [&_td]:align-top [&_a]:text-blue-700 [&_a]:underline" },
      handleKeyDown: (_view, event) => {
        const { suggest: sg, suggestions: list, sugIndex: idx } = live.current;
        if (!sg) return false;
        if (event.key === "ArrowDown") { setSugIndex((idx + 1) % Math.max(list.length, 1)); return true; }
        if (event.key === "ArrowUp") { setSugIndex((idx - 1 + list.length) % Math.max(list.length, 1)); return true; }
        if (event.key === "Escape") { setSuggest(null); return true; }
        if ((event.key === "Enter" || event.key === "Tab") && list[idx]) { pickUs(list[idx]); return true; }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const el = (event.target as HTMLElement).closest?.("[data-us-id]");
        if (el && (event.ctrlKey || event.metaKey)) {
          live.current.navigate(`/cantiere/${live.current.cantiereId}/us?openUsId=${el.getAttribute("data-us-id")}`);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      schedule({ contenuto: json });
      setUsIds(Array.from(collectUsIds(json)));
      detectSuggest(editor);
    },
    onSelectionUpdate: ({ editor }) => detectSuggest(editor),
  });

  // Riconosce "[[testo" prima del cursore e apre il suggeritore US
  function detectSuggest(ed: Editor) {
    const { from, empty } = ed.state.selection;
    if (!empty) return setSuggest(null);
    const before = ed.state.doc.textBetween(Math.max(0, from - 60), from, "\n", "\0");
    const m = /\[\[([^\[\]\n]*)$/.exec(before);
    if (!m) return setSuggest(null);
    const coords = ed.view.coordsAtPos(from);
    setSuggest({ from: from - m[0].length, to: from, query: m[1], x: coords.left, y: coords.bottom + 4 });
    setSugIndex(0);
  }

  function pickUs(u: UsItem) {
    const sg = live.current.suggest;
    if (!sg || !editor) return;
    const label = formatUsCode(u.codiceUS, u.tipo, codeSettings.tombaStyle);
    editor.chain().focus()
      .deleteRange({ from: sg.from, to: sg.to })
      .insertContent({ type: "text", text: label, marks: [{ type: "usLink", attrs: { usId: u.id } }] })
      .unsetMark("usLink")
      .insertContent(" ")
      .run();
    setSuggest(null);
  }

  // Salva le modifiche pendenti quando si lascia il documento
  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Un documento nuovo (contenuto null) viene persistito subito con il contenuto di partenza
  useEffect(() => {
    if (editor && !doc.contenuto) schedule({ contenuto: editor.getJSON() });
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = useMutation({
    mutationFn: async () => {
      await flush();
      return (await apiRequest("POST", `/api/documentazioni/${doc.id}/genera-docx`, {})).json();
    },
    onSuccess: async (res: any) => {
      await queryClient.invalidateQueries({ queryKey: detailKey });
      const n = Number(res?.warnings?.length || 0);
      toast({ title: "DOCX generato", description: n > 0 ? `${n} avviso/i: ${res.warnings.slice(0, 2).join("; ")}` : "Documento aggiornato" });
      if (res?.allegato?.url) window.open(res.allegato.url, "_blank");
    },
    onError: (e: any) => toast({ title: "Errore generazione DOCX", description: e?.message, variant: "destructive" }),
  });

  if (!editor) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          value={titolo}
          onChange={(e) => { setTitolo(e.target.value); if (e.target.value.trim()) schedule({ titolo: e.target.value }); }}
          className="text-lg font-semibold h-10"
        />
        <Badge variant={doc.stato === "completata" ? "default" : "outline"}>{doc.stato}</Badge>
        <span className="text-xs text-muted-foreground w-24 shrink-0 flex items-center gap-1">
          {save === "saving" && <><Loader2 size={12} className="animate-spin" /> Salvo…</>}
          {save === "saved" && <><Check size={12} /> Salvato</>}
          {save === "dirty" && "Modifiche…"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
        <div className="rounded border border-border bg-background overflow-hidden">
          {header.intestazione && (
            <div className="text-center text-xs text-muted-foreground border-b border-dashed border-border py-1.5 bg-muted/20">
              {header.intestazione}
            </div>
          )}
          <Toolbar editor={editor} onInsertFigure={() => setPickerOpen(true)} onGenerate={() => setGenOpen(true)} />
          <EditorContent editor={editor} />
          {(header.piePagina || header.numeroPagina) && (
            <div className="text-center text-xs text-muted-foreground border-t border-dashed border-border py-1.5 bg-muted/20">
              {header.piePagina}{header.piePagina && header.numeroPagina ? " · " : ""}{header.numeroPagina ? "Pagina n. di N" : ""}
            </div>
          )}
        </div>

        <div className="w-64 space-y-3 rounded border border-border p-3">
          <div className="text-sm font-medium">Intestazione e piè di pagina</div>
          <div>
            <Label className="text-xs">Intestazione (es. dicitura da cantiere)</Label>
            <Input
              value={header.intestazione}
              onChange={(e) => { const h = { ...header, intestazione: e.target.value }; setHeader(h); schedule({ intestazione: h }); }}
              placeholder="Cantiere … – Committente …"
            />
          </div>
          <div>
            <Label className="text-xs">Piè di pagina</Label>
            <Input
              value={header.piePagina}
              onChange={(e) => { const h = { ...header, piePagina: e.target.value }; setHeader(h); schedule({ intestazione: h }); }}
              placeholder="Es. Relazione archeologica"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={header.numeroPagina}
              onChange={(e) => { const h = { ...header, numeroPagina: e.target.checked }; setHeader(h); schedule({ intestazione: h }); }}
            />
            Numero di pagina
          </label>

          <div className="pt-3 border-t border-border space-y-1.5">
            <div className="text-sm font-medium flex items-center gap-1.5"><Link2 size={13} /> US collegate ({usIds.length})</div>
            <p className="text-xs text-muted-foreground">
              Scrivi <code className="bg-muted px-1 rounded">[[</code> per collegare una scheda US. Il link non compare nell'export.
            </p>
            <div className="flex flex-wrap gap-1">
              {usIds.map((id) => {
                const u = usList.find((x) => x.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(`/cantiere/${cantiereId}/us?openUsId=${id}`)}
                    className="text-xs font-mono rounded bg-primary/10 text-primary px-1.5 py-0.5 hover:bg-primary/20"
                    title="Apri scheda US"
                  >
                    {u ? usLabel(u) : `US #${id}`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-2">
            <div className="text-sm font-medium">Esporta</div>
            <Button className="w-full gap-2" onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Genera DOCX
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                if (!printAsPdf(editor.getHTML().replace(/<span[^>]*data-us-id[^>]*>([\s\S]*?)<\/span>/g, "$1"), header, titolo)) {
                  toast({ title: "Popup bloccato", description: "Consenti i popup per esportare il PDF.", variant: "destructive" });
                }
              }}
            >
              <Printer size={14} /> PDF (stampa)
            </Button>
            {doc.allegato?.url && (
              <a href={doc.allegato.url} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-1 text-xs rounded border border-border px-2 py-1.5 hover:bg-muted">
                <Download size={12} /> Ultimo DOCX
              </a>
            )}
          </div>
        </div>
      </div>

      {suggest && suggestions.length > 0 && (
        <div
          className="fixed z-50 w-72 rounded-md border border-border bg-popover shadow-md py-1"
          style={{ left: suggest.x, top: suggest.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pickUs(u)}
              className={`w-full text-left px-2 py-1 text-sm flex gap-2 ${i === sugIndex ? "bg-primary/10" : "hover:bg-muted"}`}
            >
              <span className="font-mono font-semibold text-primary shrink-0">{usLabel(u)}</span>
              <span className="truncate text-muted-foreground">{u.definizione || u.tipo || ""}</span>
            </button>
          ))}
        </div>
      )}

      <GenerateTextDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        cantiereId={cantiereId}
        defaultFrom={doc.dataInizio}
        defaultTo={doc.dataFine}
        onInsert={(nodes) => editor.chain().focus("end").insertContent(nodes).run()}
      />

      <FigurePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        cantiereId={cantiereId}
        onPick={(s) =>
          editor.chain().focus().insertContent({
            type: "snapshotFigure",
            attrs: { snapshotId: s.id, src: s.url, didascalia: s.didascalia || s.titolo },
          }).run()
        }
      />
    </div>
  );
}
