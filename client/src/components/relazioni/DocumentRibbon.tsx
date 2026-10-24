import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowUpDown, BookOpen, Download, FileText, Folder, Highlighter, ImageUp,
  IndentDecrease, IndentIncrease, LayoutTemplate, Link as LinkIcon, Link2, List, ListOrdered, Loader2, Map as MapIcon, Minus, Printer,
  Quote, Redo2, RemoveFormatting, Settings2, Sparkles, Strikethrough, Subscript as SubIcon, Superscript as SuperIcon, Table as TableIcon,
  Underline as UnderlineIcon, Undo2, Bold, Italic, PanelTop,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  RibbonBig, RibbonBtn, RibbonGroup, RibbonRow, RibbonSep, RibbonStack, ribbonSelect,
} from "@/components/relazioni/Ribbon";
import { LINE_SPACINGS, lineSpacingLabel, nudgeIndent, paragraphState, setParagraphAttrs } from "@/components/relazioni/ParagraphTools";

export type SideTab = "doc" | "paragraph" | "figure" | "table" | "us";
export type OpenPanel = (tab: SideTab, section?: string) => void;

const FONTS = ["Times New Roman", "Arial", "Calibri", "Georgia", "Verdana", "Courier New"];
const SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt"];

function ColorTool({ title, icon, value, onPick, onClear }: {
  title: string; icon: React.ReactNode; value: string; onPick: (c: string) => void; onClear: () => void;
}) {
  return (
    <span className="relative inline-flex">
      <label title={title} className="inline-flex h-7 w-7 cursor-pointer flex-col items-center justify-center rounded hover:bg-muted">
        {icon}
        <span className="-mt-0.5 block h-[3px] w-4 rounded" style={{ background: value || "transparent", border: value ? "none" : "1px solid hsl(var(--border))" }} />
        <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={value || "#000000"} onChange={(e) => onPick(e.target.value)} />
      </label>
      <button type="button" title={`${title}: rimuovi`} onMouseDown={(e) => e.preventDefault()} onClick={onClear}
        className="-ml-1 mt-0.5 self-start text-[10px] leading-none text-muted-foreground hover:text-foreground">×</button>
    </span>
  );
}

// ─── Scheda Home ──────────────────────────────────────────────────────────────

export function HomeRibbon({ editor, onOpenPanel }: { editor: Editor; onOpenPanel: OpenPanel }) {
  const chain = () => editor.chain().focus();
  const attrs = editor.getAttributes("textStyle");
  const par = paragraphState(editor);
  const inList = editor.isActive("bulletList") || editor.isActive("orderedList");
  const level = editor.isActive("heading", { level: 1 }) ? 1 : editor.isActive("heading", { level: 2 }) ? 2
    : editor.isActive("heading", { level: 3 }) ? 3 : editor.isActive("heading", { level: 4 }) ? 4 : 0;

  const setLink = () => {
    const prev = editor.getAttributes("link").href || "https://";
    const url = window.prompt("Indirizzo del collegamento (vuoto per rimuoverlo)", prev);
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <>
      <RibbonGroup label="Cronologia">
        <RibbonStack>
          <RibbonRow><RibbonBtn title="Annulla (Ctrl+Z)" label="Annulla" icon={<Undo2 size={14} />} disabled={!editor.can().undo()} onClick={() => chain().undo().run()} /></RibbonRow>
          <RibbonRow><RibbonBtn title="Ripeti (Ctrl+Y)" label="Ripeti" icon={<Redo2 size={14} />} disabled={!editor.can().redo()} onClick={() => chain().redo().run()} /></RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Carattere">
        <RibbonStack>
          <RibbonRow>
            <select title="Carattere" className={`${ribbonSelect} w-36`} value={attrs.fontFamily || ""}
              onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}>
              <option value="">Carattere predefinito</option>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
            <select title="Dimensione" className={`${ribbonSelect} w-16`} value={attrs.fontSize || ""}
              onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}>
              <option value="">Dim.</option>
              {SIZES.map((z) => <option key={z} value={z}>{z.replace("pt", "")}</option>)}
            </select>
          </RibbonRow>
          <RibbonRow>
            <RibbonBtn title="Grassetto (Ctrl+B)" icon={<Bold size={15} />} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} />
            <RibbonBtn title="Corsivo (Ctrl+I)" icon={<Italic size={15} />} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} />
            <RibbonBtn title="Sottolineato (Ctrl+U)" icon={<UnderlineIcon size={15} />} active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} />
            <RibbonBtn title="Barrato" icon={<Strikethrough size={15} />} active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} />
            <RibbonBtn title="Pedice" icon={<SubIcon size={15} />} active={editor.isActive("subscript")} onClick={() => chain().toggleSubscript().run()} />
            <RibbonBtn title="Apice" icon={<SuperIcon size={15} />} active={editor.isActive("superscript")} onClick={() => chain().toggleSuperscript().run()} />
            <RibbonSep />
            <ColorTool title="Colore del testo" icon={<span className="text-sm font-bold leading-none">A</span>}
              value={attrs.color || ""} onPick={(c) => chain().setColor(c).run()} onClear={() => chain().unsetColor().run()} />
            <ColorTool title="Evidenziatore" icon={<Highlighter size={14} />} value={editor.getAttributes("highlight").color || ""}
              onPick={(c) => chain().setHighlight({ color: c }).run()} onClear={() => chain().unsetHighlight().run()} />
            <RibbonBtn title="Cancella formattazione" icon={<RemoveFormatting size={15} />} onClick={() => chain().unsetAllMarks().clearNodes().run()} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Paragrafo" onLauncher={() => onOpenPanel("paragraph")} launcherTitle="Rientri, spaziatura e interlinea…">
        <RibbonStack>
          <RibbonRow>
            <RibbonBtn title="Elenco puntato" icon={<List size={15} />} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} />
            <RibbonBtn title="Elenco numerato" icon={<ListOrdered size={15} />} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} />
            <RibbonBtn title="Riduci rientro" icon={<IndentDecrease size={15} />} disabled={!inList && !(par?.indentLeft)}
              onClick={() => (inList ? chain().liftListItem("listItem").run() : nudgeIndent(editor, -1))} />
            <RibbonBtn title="Aumenta rientro" icon={<IndentIncrease size={15} />} disabled={!inList && !par}
              onClick={() => (inList ? chain().sinkListItem("listItem").run() : nudgeIndent(editor, 1))} />
            <RibbonSep />
            <Popover>
              <PopoverTrigger asChild>
                <RibbonBtn title={`Interlinea: ${lineSpacingLabel(par?.lineHeight ?? null)}`} icon={<ArrowUpDown size={15} />} disabled={!par} />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-44 space-y-0.5 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
                {[{ value: null as number | null, label: "Predefinita" }, ...LINE_SPACINGS].map((l) => (
                  <button key={l.label} type="button" onClick={() => setParagraphAttrs(editor, { lineHeight: l.value })}
                    className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${(par?.lineHeight ?? null) === l.value ? "bg-primary/10 text-primary" : ""}`}>
                    {l.label}
                  </button>
                ))}
                <button type="button" onClick={() => onOpenPanel("paragraph", "par-spaziatura")}
                  className="block w-full rounded border-t border-border px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">Altre opzioni…</button>
              </PopoverContent>
            </Popover>
          </RibbonRow>
          <RibbonRow>
            <RibbonBtn title="Allinea a sinistra" icon={<AlignLeft size={15} />} active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()} />
            <RibbonBtn title="Centra" icon={<AlignCenter size={15} />} active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()} />
            <RibbonBtn title="Allinea a destra" icon={<AlignRight size={15} />} active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()} />
            <RibbonBtn title="Giustifica" icon={<AlignJustify size={15} />} active={editor.isActive({ textAlign: "justify" })} onClick={() => chain().setTextAlign("justify").run()} />
            <RibbonSep />
            <RibbonBtn title="Citazione" icon={<Quote size={15} />} active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()} />
            <RibbonBtn title="Collegamento web" icon={<LinkIcon size={15} />} active={editor.isActive("link")} onClick={setLink} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Stili" onLauncher={() => onOpenPanel("paragraph")} launcherTitle="Stile e formattazione del paragrafo…">
        {([[0, "Normale", "text-xs"], [1, "Titolo 1", "text-base font-bold"], [2, "Titolo 2", "text-sm font-bold"], [3, "Titolo 3", "text-xs font-bold"], [4, "Titolo 4", "text-xs font-semibold italic"]] as const).map(([n, name, cls]) => (
          <button key={n} type="button" title={n === 0 ? "Paragrafo normale" : `Titolo di livello ${n}`} onMouseDown={(e) => e.preventDefault()}
            onClick={() => (n === 0 ? chain().setParagraph().run() : chain().setHeading({ level: n }).run())}
            className={`flex h-[54px] w-[62px] shrink-0 flex-col items-center justify-center rounded border ${level === n ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
            <span className={`${cls} leading-tight`}>Aa</span>
            <span className="text-[10px] text-muted-foreground">{name}</span>
          </button>
        ))}
      </RibbonGroup>
    </>
  );
}

// ─── Scheda Inserisci ─────────────────────────────────────────────────────────

const GRID_COLS = 8;
const GRID_ROWS = 6;

function TableGrid({ onPick }: { onPick: (rows: number, cols: number, header: boolean) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const [header, setHeader] = useState(true);
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{hover[0] ? `${hover[0]} righe × ${hover[1]} colonne` : "Scegli la dimensione"}</div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1.25rem)` }} onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
          const r = Math.floor(i / GRID_COLS) + 1;
          const c = (i % GRID_COLS) + 1;
          const on = r <= hover[0] && c <= hover[1];
          return (
            <button key={i} type="button" aria-label={`${r} × ${c}`} onMouseEnter={() => setHover([r, c])} onClick={() => onPick(r, c, header)}
              className={`h-5 w-5 rounded-[2px] border ${on ? "border-primary bg-primary/30" : "border-border bg-background"}`} />
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Prima riga di intestazione
      </label>
    </div>
  );
}

export function InsertRibbon({ editor, uploading, onUploadFiles, onPickProject, onPickSnapshot, onGenerate, onFillAll, filling, onOpenPanel }: {
  editor: Editor; uploading: boolean; onUploadFiles: (files: File[]) => void; onPickProject: () => void; onPickSnapshot: () => void;
  onGenerate: () => void; onFillAll: () => void; filling: boolean; onOpenPanel: OpenPanel;
}) {
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const prev = editor.getAttributes("link").href || "https://";
    const url = window.prompt("Indirizzo del collegamento (vuoto per rimuoverlo)", prev);
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  const [open, setOpen] = useState(false);

  return (
    <>
      <RibbonGroup label="Tabelle" onLauncher={() => onOpenPanel("table", "tbl-nuova")} launcherTitle="Tutte le tabelle del documento">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <RibbonBig label="Tabella" icon={<TableIcon size={20} />} title="Inserisci una tabella scegliendo righe e colonne" active={editor.isActive("table")} />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
            <TableGrid onPick={(rows, cols, header) => { chain().insertTable({ rows, cols, withHeaderRow: header }).run(); setOpen(false); }} />
          </PopoverContent>
        </Popover>
      </RibbonGroup>

      <RibbonGroup label="Illustrazioni" onLauncher={() => onOpenPanel("figure", "fig-importa")} launcherTitle="Figure del documento e opzioni di inserimento">
        <UploadBig uploading={uploading} onFiles={onUploadFiles} />
        <RibbonBig label="Dal progetto" icon={<Folder size={20} />} title="Scegli un'immagine già caricata nel progetto (logo, stemma…)" onClick={onPickProject} />
        <RibbonBig label="Da WebMap" icon={<MapIcon size={20} />} title="Inserisci una mappa salvata dalla WebMap" onClick={onPickSnapshot} />
      </RibbonGroup>

      <RibbonGroup label="Collegamenti">
        <RibbonBig label="Link web" icon={<LinkIcon size={20} />} active={editor.isActive("link")} onClick={setLink} />
        <RibbonBig label="Scheda US" icon={<Link2 size={20} />} title="Cita una US: scrive «[[» e apre l'elenco delle schede. Cliccandola nel testo si apre l'anteprima." onClick={() => chain().insertContent("[[").run()} />
      </RibbonGroup>

      <RibbonGroup label="Elementi">
        <RibbonBig label="Linea" icon={<Minus size={20} />} title="Linea divisoria orizzontale" onClick={() => chain().setHorizontalRule().run()} />
        <RibbonBig label="Citazione" icon={<Quote size={20} />} active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()} />
      </RibbonGroup>

      <RibbonGroup label="Testo dai dati">
        <RibbonBig label="Da giornale" icon={<Sparkles size={20} />} title="Genera il testo dal giornale di scavo" onClick={onGenerate} />
        <RibbonBig label="Blocco IA" icon={<Sparkles size={20} className="text-violet-600" />} title="Inserisce un blocco da compilare con l'IA"
          onClick={() => chain().insertContent({ type: "aiBlock", attrs: { prompt: "" }, content: [{ type: "paragraph" }] }).run()} />
        <RibbonBig label="Compila tutti" icon={filling ? <Loader2 size={20} className="animate-spin" /> : <BookOpen size={20} />} disabled={filling}
          title="Compila tutti i blocchi IA del documento, uno dopo l'altro" onClick={onFillAll} />
      </RibbonGroup>
    </>
  );
}

// «Da file» con selettore di file nascosto
function UploadBig({ uploading, onFiles }: { uploading: boolean; onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden"
        onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
      <RibbonBig label={uploading ? "Carico…" : "Da file"} icon={uploading ? <Loader2 size={20} className="animate-spin" /> : <ImageUp size={20} />}
        title="Carica una o più immagini dal computer (si può anche incollare o trascinare nel foglio)" disabled={uploading} onClick={() => ref.current?.click()} />
    </>
  );
}

// ─── Scheda Documento ─────────────────────────────────────────────────────────

export function DocumentRibbon({ numeroPagina, onNumeroPagina, usCount, allegatoUrl, generating, onGenerateDocx, onPdf, onSaveModel, onOpenPanel }: {
  numeroPagina: boolean; onNumeroPagina: (v: boolean) => void; usCount: number; allegatoUrl?: string | null; generating: boolean;
  onGenerateDocx: () => void; onPdf: () => void; onSaveModel: () => void; onOpenPanel: OpenPanel;
}) {
  return (
    <>
      <RibbonGroup label="Pagina" onLauncher={() => onOpenPanel("doc")} launcherTitle="Intestazione e piè di pagina…">
        <RibbonBig label="Intestazione" icon={<PanelTop size={20} />} title="Modifica intestazione e piè di pagina nel pannello laterale" onClick={() => onOpenPanel("doc")} />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={numeroPagina} onChange={(e) => onNumeroPagina(e.target.checked)} /> Numero di pagina
        </label>
      </RibbonGroup>

      <RibbonGroup label="Collegamenti">
        <RibbonBig label={`US citate (${usCount})`} icon={<Link2 size={20} />} title="Elenco delle schede US citate nel documento, con anteprima" onClick={() => onOpenPanel("us")} />
      </RibbonGroup>

      <RibbonGroup label="Esporta">
        <RibbonBig label="Word (DOCX)" icon={generating ? <Loader2 size={20} className="animate-spin" /> : <FileText size={20} />} disabled={generating}
          title="Genera il file Word e lo apre" onClick={onGenerateDocx} />
        <RibbonBig label="PDF (stampa)" icon={<Printer size={20} />} title="Apre la stampa del browser: scegli «Salva come PDF»" onClick={onPdf} />
        {allegatoUrl && (
          <a href={allegatoUrl} target="_blank" rel="noreferrer" title="Apre l'ultimo DOCX generato"
            className="flex h-[58px] w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded text-center text-[10px] leading-tight hover:bg-muted">
            <Download size={20} /> <span>Ultimo DOCX</span>
          </a>
        )}
      </RibbonGroup>

      <RibbonGroup label="Modello">
        <RibbonBig label="Salva modello" icon={<LayoutTemplate size={20} />} title="Salva la struttura di questo documento come modello riusabile" onClick={onSaveModel} />
      </RibbonGroup>

      <RibbonGroup label="Pannello">
        <RibbonBig label="Paragrafo" icon={<Settings2 size={20} />} title="Apre il pannello laterale delle impostazioni del paragrafo" onClick={() => onOpenPanel("paragraph")} />
      </RibbonGroup>
    </>
  );
}
