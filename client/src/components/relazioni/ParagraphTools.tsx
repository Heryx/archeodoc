import { Extension, type Editor } from "@tiptap/react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, RotateCcw } from "lucide-react";
import { NumField, PanelSection, ribbonSelect, useScrollToSection } from "@/components/relazioni/Ribbon";

// ─── Formattazione del paragrafo ──────────────────────────────────────────────
// Come nella finestra «Paragrafo» di LibreOffice: rientri, spaziatura, interlinea e flusso del testo.
// Le misure sono in cm (rientri) e pt (spazi); l'export Word le riporta in twip.

export const TEXTBLOCKS = ["paragraph", "heading"];

export type ParagraphAttrs = {
  indentLeft: number | null;
  indentRight: number | null;
  indentFirst: number | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: number | null;
  keepNext: boolean | null;
  pageBreakBefore: boolean | null;
};

const EMPTY: ParagraphAttrs = {
  indentLeft: null, indentRight: null, indentFirst: null, spaceBefore: null, spaceAfter: null,
  lineHeight: null, keepNext: null, pageBreakBefore: null,
};

const numAttr = (data: string, css: (v: number) => string) => ({
  default: null as number | null,
  parseHTML: (el: HTMLElement) => {
    const raw = el.getAttribute(data);
    const n = raw == null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  },
  renderHTML: (attrs: Record<string, any>, key: string) =>
    attrs[key] != null ? { [data]: attrs[key], style: css(Number(attrs[key])) } : {},
});

const flagAttr = (data: string, css?: string) => ({
  default: null as boolean | null,
  parseHTML: (el: HTMLElement) => (el.getAttribute(data) === "1" ? true : el.getAttribute(data) === "0" ? false : null),
  renderHTML: (attrs: Record<string, any>, key: string) =>
    attrs[key] == null ? {} : { [data]: attrs[key] ? "1" : "0", ...(attrs[key] && css ? { style: css } : {}) },
});

// Gli attributi globali non conoscono il proprio nome: lo si passa dal chiamante
function build() {
  const defs = {
    indentLeft: numAttr("data-indent-left", (v) => `margin-left:${v}cm`),
    indentRight: numAttr("data-indent-right", (v) => `margin-right:${v}cm`),
    indentFirst: numAttr("data-indent-first", (v) => `text-indent:${v}cm`),
    spaceBefore: numAttr("data-space-before", (v) => `margin-top:${v}pt`),
    spaceAfter: numAttr("data-space-after", (v) => `margin-bottom:${v}pt`),
    lineHeight: numAttr("data-line-height", (v) => `line-height:${v}`),
    keepNext: flagAttr("data-keep-next"),
    pageBreakBefore: flagAttr("data-page-break", "break-before:page"),
  };
  const out: Record<string, any> = {};
  for (const [key, def] of Object.entries(defs)) {
    out[key] = { ...def, renderHTML: (attrs: Record<string, any>) => def.renderHTML(attrs, key) };
  }
  return out;
}

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addGlobalAttributes() {
    return [{ types: TEXTBLOCKS, attributes: build() }];
  },
});

// Attributi del paragrafo (o titolo) in cui si trova il cursore; null se non si è in un blocco di testo
export function paragraphState(editor: Editor): (ParagraphAttrs & { type: string; level: number | null; textAlign: string | null }) | null {
  const parent = editor.state.selection.$from.parent;
  if (!TEXTBLOCKS.includes(parent.type.name)) return null;
  return {
    ...EMPTY,
    ...(parent.attrs as Partial<ParagraphAttrs>),
    type: parent.type.name,
    level: parent.type.name === "heading" ? Number(parent.attrs.level) || 1 : null,
    textAlign: (parent.attrs.textAlign as string) || null,
  };
}

// Applica gli attributi a tutti i paragrafi e titoli della selezione
export function setParagraphAttrs(editor: Editor, patch: Partial<ParagraphAttrs>) {
  editor.chain().focus().command(({ tr, state }) => {
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (TEXTBLOCKS.includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
    });
    return true;
  }).run();
}

export const LINE_SPACINGS: { value: number; label: string }[] = [
  { value: 1, label: "Singola" },
  { value: 1.15, label: "1,15" },
  { value: 1.5, label: "1,5 righe" },
  { value: 2, label: "Doppia" },
];

export function lineSpacingLabel(v: number | null): string {
  if (v == null) return "Predefinita";
  return LINE_SPACINGS.find((l) => l.value === v)?.label || `${String(v).replace(".", ",")} righe`;
}

// Rientro di un livello (1 cm) del paragrafo corrente
export function nudgeIndent(editor: Editor, delta: number) {
  const st = paragraphState(editor);
  if (!st) return;
  const next = Math.max(0, Math.round(((st.indentLeft ?? 0) + delta) * 100) / 100);
  setParagraphAttrs(editor, { indentLeft: next || null });
}

// ─── Pannello Paragrafo ───────────────────────────────────────────────────────

export function ParagraphPanel({ editor, section, nonce = 0 }: { editor: Editor; section?: string; nonce?: number }) {
  useScrollToSection(section, nonce);
  const st = paragraphState(editor);
  const chain = () => editor.chain().focus();

  if (!st) {
    return (
      <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
        Metti il cursore in un paragrafo per impostarne rientri, spaziatura e interlinea. Le modifiche valgono per tutti i paragrafi selezionati.
      </p>
    );
  }
  const set = (patch: Partial<ParagraphAttrs>) => setParagraphAttrs(editor, patch);
  const isHeading = st.type === "heading";
  const styleValue = isHeading ? String(st.level) : "0";
  const customLine = st.lineHeight != null && !LINE_SPACINGS.some((l) => l.value === st.lineHeight);

  return (
    <div className="space-y-3">
      <PanelSection title="Stile">
        <select value={styleValue} className={`${ribbonSelect} w-full`} title="Stile del paragrafo"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v === 0) chain().setParagraph().run();
            else chain().setHeading({ level: v as 1 | 2 | 3 | 4 }).run();
          }}>
          <option value="0">Paragrafo</option>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Titolo {n}</option>)}
        </select>
      </PanelSection>

      <PanelSection title="Allineamento">
        <div className="flex gap-1">
          {([["left", <AlignLeft size={14} />], ["center", <AlignCenter size={14} />], ["right", <AlignRight size={14} />], ["justify", <AlignJustify size={14} />]] as const).map(([v, icon]) => (
            <button key={v} type="button" title={`Allinea: ${v}`} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().setTextAlign(v).run()}
              className={`h-8 w-9 inline-flex items-center justify-center rounded border ${editor.isActive({ textAlign: v }) ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
              {icon}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Rientri" id="par-rientri">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 text-xs">
          <span>Prima del testo</span>
          <NumField value={st.indentLeft} suffix="cm" min={0} max={15} placeholder="0" onCommit={(n) => set({ indentLeft: n })} />
          <span>Dopo il testo</span>
          <NumField value={st.indentRight} suffix="cm" min={0} max={15} placeholder="0" onCommit={(n) => set({ indentRight: n })} />
          <span title="Valore negativo = sporgente">Prima riga</span>
          <NumField value={st.indentFirst} suffix="cm" min={-10} max={15} placeholder="0" onCommit={(n) => set({ indentFirst: n })} />
        </div>
        <p className="text-xs text-muted-foreground">Con un valore negativo alla prima riga il paragrafo ha il rientro sporgente.</p>
      </PanelSection>

      <PanelSection title="Spaziatura" id="par-spaziatura">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 text-xs">
          <span>Sopra il paragrafo</span>
          <NumField value={st.spaceBefore} suffix="pt" min={0} max={120} placeholder="auto" onCommit={(n) => set({ spaceBefore: n })} />
          <span>Sotto il paragrafo</span>
          <NumField value={st.spaceAfter} suffix="pt" min={0} max={120} placeholder="auto" onCommit={(n) => set({ spaceAfter: n })} />
          <span>Interlinea</span>
          <select value={st.lineHeight == null ? "" : String(st.lineHeight)} className={`${ribbonSelect} w-28`}
            onChange={(e) => set({ lineHeight: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Predefinita</option>
            {LINE_SPACINGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            {customLine && <option value={String(st.lineHeight)}>{lineSpacingLabel(st.lineHeight)}</option>}
          </select>
          <span>Interlinea personalizzata</span>
          <NumField value={st.lineHeight} suffix="×" min={0.8} max={4} placeholder="1,0" onCommit={(n) => set({ lineHeight: n })} />
        </div>
      </PanelSection>

      <PanelSection title="Flusso del testo" id="par-flusso">
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={isHeading ? st.keepNext !== false : !!st.keepNext}
            onChange={(e) => set({ keepNext: e.target.checked })} />
          <span>Mantieni con il paragrafo successivo (non separarli nel cambio pagina)</span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={!!st.pageBreakBefore}
            onChange={(e) => set({ pageBreakBefore: e.target.checked ? true : null })} />
          <span>Inizia su una nuova pagina</span>
        </label>
      </PanelSection>

      <PanelSection title="Ripristina">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => set({ ...EMPTY })}
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:bg-muted">
          <RotateCcw size={13} /> Rimuovi la formattazione del paragrafo
        </button>
      </PanelSection>
    </div>
  );
}
