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
  FigurePanel, ProjectImage, SnapshotFigure, figureNodeFor, isFigureName, isImageFile, selectedFigure, uploadProjectImage,
} from "@/components/relazioni/FigureTools";
import { RTable, RTableCell, RTableHeader, TablePanel, currentTable } from "@/components/relazioni/TableTools";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Minus, Undo2, Redo2, ImagePlus, FileText, Printer, Loader2, Download, Trash2, Check, Link2, Sparkles, BookOpen,
  Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, Subscript as SubIcon, Superscript as SuperIcon,
  Highlighter, Table as TableIcon, RemoveFormatting, Link as LinkIcon, IndentIncrease, IndentDecrease, PanelRightClose, PanelRightOpen, LayoutTemplate,
  ArrowLeft, PanelLeftClose, PanelLeftOpen, ListTree, Image as ImageIcon, Upload,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePersistedFlag } from "@/hooks/usePersistedFlag";
import { AiBlock, errorMessage, fillAiBlock } from "@/components/relazioni/AiBlock";

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


function ProjectImagePicker({ open, onOpenChange, onPick }: {
  open: boolean; onOpenChange: (v: boolean) => void; onPick: (img: { name: string; url: string }) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/project/img"],
    queryFn: async () => (await apiRequest("GET", "/api/project/img")).json(),
    enabled: open,
  });
  const files: { name: string; url: string }[] = data?.files || data?.images || [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/project/img", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (img: { name: string; url: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/project/img"] });
      if (fileRef.current) fileRef.current.value = "";
      onPick(img);
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Caricamento non riuscito", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Inserisci un'immagine del progetto</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Logo, stemma o altre immagini fisse. Nell'export Word servono PNG o JPEG.
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="text-sm"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
          {upload.isPending && <Loader2 size={14} className="animate-spin" />}
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento...</div>
        ) : files.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nessuna immagine nel progetto: caricane una qui sopra.</div>
        ) : (
          <div className="grid grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto">
            {files.map((f) => (
              <button key={f.name} type="button" onClick={() => { onPick(f); onOpenChange(false); }}
                className="rounded border border-border overflow-hidden text-left hover:border-primary">
                <img src={f.url} alt={f.name} className="w-full h-24 object-contain bg-white" />
                <div className="px-2 py-1 text-xs truncate">{f.name}</div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

function Toolbar({ editor, onInsertFigure, onInsertImage, onOpenTables, onGenerate, onFillAll, filling }: {
  editor: Editor; onInsertFigure: () => void; onInsertImage: () => void; onOpenTables: () => void; onGenerate: () => void; onFillAll: () => void; filling: boolean;
}) {
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

  return (
    <div className="shrink-0 border-b border-border bg-muted/30 px-2 py-1 space-y-0.5">
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
        <Button type="button" size="sm" variant={inTable ? "default" : "outline"} className="h-8 gap-1.5 text-xs" onClick={onOpenTables}
          title="Apre gli strumenti Tabelle: inserisci, righe, colonne, celle, larghezza, colori">
          <TableIcon size={14} /> Tabelle
        </Button>
        {sep}
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onInsertFigure}>
          <ImagePlus size={14} /> Figura WebMap
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onInsertImage}
          title="Importa un'immagine esterna o scegline una dalle Immagini progetto; apre gli strumenti Figure">
          <ImageIcon size={14} /> Immagine
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onGenerate}>
          <Sparkles size={14} /> Da giornale
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
          onClick={() => chain().insertContent({ type: "aiBlock", attrs: { prompt: "" }, content: [{ type: "paragraph" }] }).run()}>
          <Sparkles size={14} className="text-violet-600" /> Blocco IA
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onFillAll} disabled={filling}
          title="Compila tutti i blocchi IA del documento, uno dopo l'altro">
          {filling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Compila tutti
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

// ─── Indice dei capitoli ──────────────────────────────────────────────────────

type HeadingItem = { pos: number; level: number; text: string; num: string };

function scanHeadings(ed: Editor): HeadingItem[] {
  const out: HeadingItem[] = [];
  const counters = [0, 0, 0, 0];
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = Math.min(Math.max(Number(node.attrs.level) || 1, 1), 4);
      counters[level - 1]++;
      for (let i = level; i < 4; i++) counters[i] = 0;
      out.push({ pos, level, text: node.textContent.trim(), num: counters.slice(0, level).filter((n) => n > 0).join(".") });
      return false;
    }
  });
  return out;
}

function Outline({ headings, activePos, onJump }: { headings: HeadingItem[]; activePos: number | null; onJump: (pos: number) => void }) {
  if (!headings.length) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        L'indice si compone dai titoli del documento. Usa «Titolo 1», «Titolo 2»… dalla barra degli strumenti per creare capitoli e sottoparagrafi.
      </p>
    );
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  return (
    <nav className="py-1">
      {headings.map((h) => (
        <button
          key={h.pos}
          type="button"
          onClick={() => onJump(h.pos)}
          style={{ paddingLeft: 8 + (h.level - minLevel) * 14 }}
          className={`w-full text-left pr-2 py-1 text-xs leading-snug flex gap-1.5 hover:bg-muted ${
            activePos === h.pos ? "bg-primary/10 text-primary font-medium" : h.level === minLevel ? "font-semibold" : "text-muted-foreground"
          }`}
        >
          <span className="shrink-0 tabular-nums opacity-70">{h.num}</span>
          <span className="truncate">{h.text || "(senza titolo)"}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Pannello principale ──────────────────────────────────────────────────────

export function RelazioneEditorPanel({ cantiereId, docId, onBack }: { cantiereId: number; docId: number; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detailKey = ["/api/cantieri", String(cantiereId), "documentazioni", String(docId)];

  const { data, isLoading } = useQuery<{ documentazione: RelazioneDoc; snapshots: LinkedSnapshot[] }>({
    queryKey: detailKey,
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni/${docId}`)).json(),
  });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Caricamento...</div>;
  // Il key rimonta l'editor quando si cambia documento
  return <EditorBody key={docId} onBack={onBack} cantiereId={cantiereId} doc={data.documentazione} linked={data.snapshots} detailKey={detailKey} queryClient={queryClient} toast={toast} />;
}

function EditorBody({ cantiereId, doc, linked, detailKey, queryClient, toast, onBack }: {
  onBack: () => void; cantiereId: number; doc: RelazioneDoc; linked: LinkedSnapshot[];
  detailKey: (string | number)[]; queryClient: ReturnType<typeof useQueryClient>; toast: ReturnType<typeof useToast>["toast"];
}) {
  const [titolo, setTitolo] = useState(doc.titolo);
  const [header, setHeader] = useState<Intestazione>({ ...EMPTY_HEADER, ...(parseJson<Intestazione>(doc.intestazione) || {}) });
  const [save, setSave] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [pickMode, setPickMode] = useState<"insert" | "replace">("insert");
  const [sideTab, setSideTab] = useState<"doc" | "figure" | "table">("doc");
  const [, setTick] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);
  const [outlineHidden, setOutlineHidden] = usePersistedFlag("elaborati-outline-hidden", false);
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
      TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
      RTable,
      RTableCell,
      RTableHeader,
      SnapshotFigure,
      ProjectImage,
      UsLink,
      AiBlock.configure({ cantiereId, docId: doc.id }),
      Placeholder.configure({ placeholder: "Scrivi la relazione, inserisci una figura dalla WebMap, oppure un blocco IA con «[# istruzione]»…" }),
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: "relazione-doc prose prose-sm max-w-none focus:outline-none min-h-[70vh] px-10 py-8 bg-white text-neutral-900 [--tw-prose-body:#171717] [--tw-prose-headings:#171717] [--tw-prose-bold:#171717] [--tw-prose-quotes:#171717] [--tw-prose-bullets:#525252] [--tw-prose-counters:#525252] [&_.us-link]:text-primary [&_.us-link]:border-b [&_.us-link]:border-dotted [&_.us-link]:border-primary [&_.us-link]:cursor-pointer [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_th]:border [&_td]:border-neutral-300 [&_th]:border-neutral-300 [&_td]:p-1.5 [&_th]:p-1.5 [&_th]:bg-neutral-100 [&_td]:align-top [&_a]:text-blue-700 [&_a]:underline" },
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
      // Immagini incollate (es. screenshot) o trascinate nel foglio diventano figure
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        const files = Array.from(data?.files || []).filter(isImageFile);
        if (!files.length || data?.types.includes("text/plain")) return false;
        event.preventDefault();
        void actions.current.insertImages(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || []).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        void actions.current.insertImages(files, at);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      schedule({ contenuto: json });
      setUsIds(Array.from(collectUsIds(json)));
      refreshOutline(editor);
      detectSuggest(editor);
      trackSelection(editor);
    },
    onSelectionUpdate: ({ editor }) => { refreshOutline(editor, false); detectSuggest(editor); trackSelection(editor); },
  });

  // I pannelli Figure e Tabelle si accendono quando si seleziona una figura o si entra in una tabella
  function trackSelection(ed: Editor) {
    setTick((t) => t + 1);
    const fig = !!selectedFigure(ed);
    const tbl = !fig && !!currentTable(ed);
    if (fig && !wasFigure.current) { setSideHidden(false); setSideTab("figure"); }
    else if (tbl && !wasTable.current) { setSideHidden(false); setSideTab("table"); }
    wasFigure.current = fig;
    wasTable.current = tbl;
  }
  const wasFigure = useRef(false);
  const wasTable = useRef(false);

  // Inserisce figure nel punto indicato, altrimenti al cursore; con una figura selezionata vanno dopo di essa
  // (inserire sopra una selezione di nodo la sostituirebbe)
  function insertFigureNodes(nodes: any[], at?: number) {
    if (!editor) return;
    const sel = selectedFigure(editor);
    const chain = editor.chain().focus();
    if (at != null) chain.insertContentAt(at, nodes);
    else if (sel) chain.insertContentAt(sel.pos + sel.node.nodeSize, nodes);
    else chain.insertContent(nodes);
    chain.run();
  }

  // Carica immagini esterne e le inserisce come figure (nel punto indicato, altrimenti al cursore)
  async function insertImages(files: File[], at?: number) {
    if (!editor) return;
    const imgs = files.filter(isImageFile);
    if (!imgs.length) return;
    setUploading(true);
    try {
      const nodes = [];
      for (let i = 0; i < imgs.length; i++) nodes.push(figureNodeFor(await uploadProjectImage(imgs[i], i)));
      insertFigureNodes(nodes, at);
      toast({ title: nodes.length === 1 ? "Figura inserita" : `${nodes.length} figure inserite`, description: "Selezionala per ridimensionarla e aggiungere la didascalia." });
    } catch (e: any) {
      toast({ title: "Caricamento non riuscito", description: errorMessage(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // Sostituisce l'immagine della figura selezionata mantenendo didascalia, larghezza e posizione
  function replaceFigure(img: { name: string; url: string }) {
    if (!editor) return;
    const sel = selectedFigure(editor);
    if (!sel) return;
    editor.chain().focus().insertContentAt({ from: sel.pos, to: sel.pos + sel.node.nodeSize }, {
      type: "projectImage",
      attrs: {
        name: img.name, src: img.url, didascalia: sel.node.attrs.didascalia || "",
        widthPct: sel.node.attrs.widthPct ?? null, width: sel.node.attrs.width ?? null, align: sel.node.attrs.align || "center",
      },
    }).run();
  }

  async function replaceWithUpload(file: File) {
    setUploading(true);
    try {
      replaceFigure(await uploadProjectImage(file));
    } catch (e: any) {
      toast({ title: "Caricamento non riuscito", description: errorMessage(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }
  const actions = useRef({ insertImages });
  actions.current = { insertImages };

  // Indice dei capitoli e capitolo in cui si trova il cursore
  function refreshOutline(ed: Editor, rescan = true) {
    const list = rescan ? scanHeadings(ed) : (outlineRef.current);
    if (rescan) { outlineRef.current = list; setHeadings(list); }
    const from = ed.state.selection.from;
    const current = [...list].reverse().find((h) => h.pos < from);
    setActiveHeading(current ? current.pos : null);
  }
  const outlineRef = useRef<HeadingItem[]>([]);
  useEffect(() => { if (editor) refreshOutline(editor); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpTo = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  const saveAsModel = async () => {
    const nome = window.prompt("Nome del modello? Restano titoli, testo fisso e prompt dei blocchi IA; il testo già generato non viene salvato.", doc.titolo);
    if (!nome?.trim()) return;
    try {
      await apiRequest("POST", "/api/modelli-elaborato", { nome: nome.trim(), titolo, contenuto: editor?.getJSON(), intestazione: header });
      queryClient.invalidateQueries({ queryKey: ["/api/modelli-elaborato"] });
      toast({ title: "Modello salvato", description: "Lo trovi in «Modello» quando crei un nuovo documento." });
    } catch (e: any) {
      toast({ title: "Salvataggio del modello non riuscito", description: errorMessage(e), variant: "destructive" });
    }
  };

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

  // Compila tutti i blocchi IA, dall'ultimo al primo così le posizioni dei precedenti restano valide
  const [filling, setFilling] = useState(false);
  const [sideHidden, setSideHidden] = usePersistedFlag("elaborati-side-hidden", false);
  const fillAll = async () => {
    if (!editor) return;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "aiBlock") { positions.push(pos); return false; }
    });
    if (!positions.length) {
      toast({ title: "Nessun blocco IA", description: "Inserisci un blocco con il pulsante «Blocco IA» o scrivendo [# istruzione]." });
      return;
    }
    if (!window.confirm(`Compilare ${positions.length} blocchi IA? Il testo già presente nei blocchi sarà sostituito.`)) return;
    setFilling(true);
    let ok = 0;
    const failed: string[] = [];
    for (const pos of positions.reverse()) {
      try { await fillAiBlock(editor, cantiereId, doc.id, pos); ok++; }
      catch (e: any) { failed.push(errorMessage(e)); }
    }
    setFilling(false);
    toast({
      title: failed.length ? `Compilati ${ok} blocchi su ${positions.length}` : `Compilati ${ok} blocchi`,
      description: failed.length ? failed[0] : "Rileggi e correggi prima di consegnare.",
      variant: failed.length ? "destructive" : undefined,
    });
  };

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="shrink-0 flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={onBack} title="Torna all'elenco dei documenti">
          <ArrowLeft size={15} /> Documenti
        </Button>
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

      {/* Tre colonne fisse: scorre solo il foglio */}
      <div className="flex-1 min-h-0 flex gap-3">
        {outlineHidden ? (
          <div className="shrink-0">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" title="Mostra l'indice dei capitoli"
              onClick={() => setOutlineHidden(false)}>
              <PanelLeftOpen size={15} />
            </Button>
          </div>
        ) : (
          <aside className="w-56 shrink-0 min-h-0 flex flex-col rounded border border-border bg-background">
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-border">
              <span className="text-xs font-semibold flex items-center gap-1.5"><ListTree size={13} /> Indice</span>
              <button type="button" title="Nascondi l'indice" aria-label="Nascondi l'indice" onClick={() => setOutlineHidden(true)}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
                <PanelLeftClose size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Outline headings={headings} activePos={activeHeading} onJump={jumpTo} />
            </div>
          </aside>
        )}

        <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded border border-border overflow-hidden">
          <Toolbar editor={editor} onInsertFigure={() => setPickerOpen(true)}
            onInsertImage={() => { setSideHidden(false); setSideTab("figure"); }}
            onOpenTables={() => { setSideHidden(false); setSideTab("table"); }}
            onGenerate={() => setGenOpen(true)} onFillAll={fillAll} filling={filling} />
          <div className="flex-1 min-h-0 overflow-auto bg-muted/50 p-4">
            {/* Foglio a larghezza fissa (testo = 740 px): figure e tabelle si misurano su questa base, come nell'export */}
            <div className="mx-auto w-[820px] shrink-0 bg-white text-neutral-900 shadow-md">
              {header.intestazione && (
                <div className="text-center text-xs text-neutral-500 border-b border-dashed border-neutral-300 py-1.5 mx-10">
                  {header.intestazione}
                </div>
              )}
              <EditorContent editor={editor} />
              {(header.piePagina || header.numeroPagina) && (
                <div className="text-center text-xs text-neutral-500 border-t border-dashed border-neutral-300 py-1.5 mx-10">
                  {header.piePagina}{header.piePagina && header.numeroPagina ? " · " : ""}{header.numeroPagina ? "Pagina n. di N" : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        {sideHidden ? (
          <div className="shrink-0">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" title="Mostra intestazione, esporta e collegamenti"
              onClick={() => setSideHidden(false)}>
              <PanelRightOpen size={15} />
            </Button>
          </div>
        ) : (
          <aside className="w-72 shrink-0 min-h-0 overflow-y-auto space-y-2">
            <div className="flex items-center gap-1 rounded border border-border bg-background p-1">
              {([["doc", "Documento"], ["figure", "Figure"], ["table", "Tabelle"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setSideTab(id)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${sideTab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {label}
                </button>
              ))}
              <button type="button" title="Nascondi il pannello" aria-label="Nascondi il pannello" onClick={() => setSideHidden(true)}
                className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
                <PanelRightClose size={14} />
              </button>
            </div>
            {sideTab === "figure" && (
              <div className="rounded border border-border bg-background p-3">
                <FigurePanel
                  editor={editor}
                  uploading={uploading}
                  onUploadFiles={(files) => void insertImages(files)}
                  onPickProject={() => { setPickMode("insert"); setImgOpen(true); }}
                  onPickSnapshot={() => setPickerOpen(true)}
                  onReplaceProject={() => { setPickMode("replace"); setImgOpen(true); }}
                  onReplaceUpload={(file) => void replaceWithUpload(file)}
                />
              </div>
            )}
            {sideTab === "table" && (
              <div className="rounded border border-border bg-background p-3">
                <TablePanel editor={editor} />
              </div>
            )}
            {sideTab === "doc" && (
    <div className="space-y-3 rounded border border-border bg-background p-3">
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
            <Button variant="outline" className="w-full gap-2" onClick={saveAsModel} title="Salva la struttura di questo documento come modello riusabile">
              <LayoutTemplate size={14} /> Salva come modello
            </Button>
          </div>
        </div>
        )}
          </aside>
        )}
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

      <ProjectImagePicker
        open={imgOpen}
        onOpenChange={setImgOpen}
        onPick={(img) => {
          const sel = selectedFigure(editor);
          if (pickMode === "replace" && sel) replaceFigure({ name: img.name, url: img.url });
          else insertFigureNodes([figureNodeFor({ name: img.name, url: img.url, widthPct: 60 })]);
        }}
      />

      <FigurePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        cantiereId={cantiereId}
        onPick={(s) =>
          insertFigureNodes([{
            type: "snapshotFigure",
            attrs: { snapshotId: s.id, src: s.url, didascalia: s.didascalia || s.titolo, widthPct: 100, align: "center" },
          }])
        }
      />
    </div>
  );
}
