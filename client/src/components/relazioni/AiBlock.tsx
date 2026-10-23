import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InputRule, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Sparkles, Trash2, Ungroup } from "lucide-react";
import { formatUsCode } from "@shared/us_code";
import { apiRequest } from "@/lib/queryClient";

// Blocco IA: un prompt + le fonti da cui attingere (US, giornale, periodi…).
// Il testo generato è contenuto normale del blocco, modificabile; il prompt non compare mai nell'export.

export type AiBlockFonti = {
  us: "nessuna" | "tutte" | "selezione";
  usIds: number[];
  usSettore: string;
  usPeriodo: string;
  giornate: "nessuna" | "tutte" | "periodo" | "documento";
  da: string;
  a: string;
  periodi: boolean;
  reperti: boolean;
  saggi: boolean;
};

export const DEFAULT_FONTI: AiBlockFonti = {
  us: "nessuna", usIds: [], usSettore: "", usPeriodo: "",
  giornate: "nessuna", da: "", a: "",
  periodi: false, reperti: false, saggi: false,
};

type UsRow = { id: number; codiceUS: string; tipo: string | null; definizione: string | null; settore?: string | null; area?: string | null; periodoIniziale?: string | null; periodoFinale?: string | null; periodoFase?: string | null };

function fontiSummary(f: AiBlockFonti): string {
  const parts: string[] = [];
  if (f.us === "tutte") parts.push(`tutte le US${f.usSettore ? ` (${f.usSettore})` : ""}${f.usPeriodo ? ` (${f.usPeriodo})` : ""}`);
  if (f.us === "selezione") parts.push(`${f.usIds.length} US scelte`);
  if (f.giornate === "tutte") parts.push("giornale");
  if (f.giornate === "documento") parts.push("giornale del periodo del documento");
  if (f.giornate === "periodo") parts.push(`giornale ${f.da || "…"} → ${f.a || "…"}`);
  if (f.periodi) parts.push("periodi");
  if (f.reperti) parts.push("reperti");
  if (f.saggi) parts.push("saggi");
  return parts.length ? parts.join(", ") : "solo le US citate nel prompt";
}

/** Compila il blocco che inizia alla posizione indicata, sostituendone il contenuto. */
export async function fillAiBlock(editor: Editor, cantiereId: number, docId: number, pos: number): Promise<{ warnings: string[] }> {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "aiBlock") throw new Error("Blocco non trovato");
  const res = await (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni/genera-blocco`, {
    docId,
    prompt: node.attrs.prompt,
    fonti: node.attrs.fonti,
    useAI: node.attrs.useAI,
  })).json();
  // Il documento può essere cambiato durante l'attesa: si rilegge il blocco alla stessa posizione
  const current = editor.state.doc.nodeAt(pos);
  if (!current || current.type.name !== "aiBlock") throw new Error("Il blocco è stato spostato durante la generazione");
  editor.chain()
    .insertContentAt({ from: pos + 1, to: pos + current.nodeSize - 1 }, res.content?.length ? res.content : [{ type: "paragraph" }])
    .command(({ tr }) => { tr.setNodeAttribute(pos, "stato", "generato"); return true; })
    .run();
  return { warnings: res.warnings || [] };
}

export function errorMessage(e: any): string {
  const raw = String(e?.message || "");
  try { return JSON.parse(raw.slice(raw.indexOf("{")))?.error || raw; } catch { return raw; }
}

const field = "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-violet-500";
const small = "rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-900";

function AiBlockView({ node, updateAttributes, deleteNode, editor, getPos, extension }: any) {
  const cantiereId: number = extension.options.cantiereId;
  const attrs = node.attrs as { prompt: string; useAI: boolean; fonti: AiBlockFonti; stato: string };
  const fonti: AiBlockFonti = { ...DEFAULT_FONTI, ...(attrs.fonti || {}) };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const aiStatus = useQuery<{ available: boolean }>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
  });
  const aiAvailable = !!aiStatus.data?.available;

  const usQuery = useQuery<UsRow[]>({
    queryKey: ["/api/cantieri", String(cantiereId), "us"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/us`)).json(),
    enabled: open,
  });
  const usList = usQuery.data || [];
  const settori = useMemo(() => Array.from(new Set(usList.flatMap((u) => [u.settore, u.area]).filter(Boolean) as string[])).sort(), [usList]);
  const periodi = useMemo(
    () => Array.from(new Set(usList.flatMap((u) => [u.periodoIniziale, u.periodoFinale, u.periodoFase]).filter(Boolean) as string[])).sort(),
    [usList],
  );
  const shown = usList.filter((u) => {
    const q = filter.trim().toLowerCase();
    return !q || u.codiceUS.toLowerCase().includes(q) || (u.definizione || "").toLowerCase().includes(q);
  });

  const setFonti = (patch: Partial<AiBlockFonti>) => updateAttributes({ fonti: { ...fonti, ...patch } });

  const run = async () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const hasText = node.textContent.trim().length > 0;
    if (attrs.stato === "generato" && hasText && !window.confirm("Il testo attuale del blocco, comprese le tue modifiche, sarà sostituito. Continuare?")) return;
    setBusy(true); setError(null); setWarn(null);
    try {
      const { warnings } = await fillAiBlock(editor, cantiereId, extension.options.docId, pos);
      if (warnings.length) setWarn(warnings.join(" "));
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeKeepingText = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    if (!window.confirm("Togliere il blocco IA? Il testo resta nel documento, il prompt viene eliminato.")) return;
    editor.chain().focus()
      .command(({ tr }: any) => { tr.replaceWith(pos, pos + node.nodeSize, node.content); return true; })
      .run();
  };

  return (
    <NodeViewWrapper className="my-4 rounded-md border border-violet-300 bg-violet-50/60" data-ai-block>
      <div contentEditable={false} className="not-prose space-y-2 border-b border-violet-200 p-2.5 text-neutral-800">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles size={14} className="text-violet-600" />
          <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">Blocco IA</span>
          <label className={`ml-2 flex items-center gap-1.5 text-xs ${aiAvailable ? "" : "opacity-50"}`} title={aiAvailable ? "" : "Nessun provider IA configurato"}>
            <input type="checkbox" checked={attrs.useAI && aiAvailable} disabled={!aiAvailable}
              onChange={(e) => updateAttributes({ useAI: e.target.checked })} />
            Compila con IA
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={run} disabled={busy}
              className="inline-flex h-7 items-center gap-1.5 rounded bg-violet-600 px-2.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60">
              {busy ? <Loader2 size={12} className="animate-spin" /> : attrs.stato === "generato" ? <RefreshCw size={12} /> : <Sparkles size={12} />}
              {busy ? "Generazione…" : attrs.stato === "generato" ? "Rigenera" : "Genera"}
            </button>
            <button type="button" onClick={removeKeepingText} title="Togli il blocco, tieni il testo"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-violet-100">
              <Ungroup size={14} />
            </button>
            <button type="button" onClick={() => { if (window.confirm("Eliminare il blocco e il suo testo?")) deleteNode(); }} title="Elimina blocco"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-red-600 hover:bg-red-50">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <textarea
          value={attrs.prompt}
          onChange={(e) => updateAttributes({ prompt: e.target.value })}
          rows={2}
          placeholder="Che cosa deve contenere questa sezione? Es. «Descrivi la sequenza stratigrafica del saggio 2, dal più recente al più antico, in 2 paragrafi»"
          className={`${field} resize-y`}
        />

        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Fonti: <span className="font-medium">{fontiSummary(fonti)}</span>
        </button>

        {open && (
          <div className="space-y-2.5 rounded border border-violet-200 bg-white p-2.5 text-xs">
            <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
              <span className="pt-1 font-medium">US</span>
              <div className="space-y-1.5">
                <select className={small} value={fonti.us} onChange={(e) => setFonti({ us: e.target.value as AiBlockFonti["us"] })}>
                  <option value="nessuna">Solo quelle citate nel prompt</option>
                  <option value="tutte">Tutte (con filtri)</option>
                  <option value="selezione">Scelgo io</option>
                </select>
                {fonti.us === "tutte" && (
                  <div className="flex flex-wrap gap-2">
                    <select className={small} value={fonti.usSettore} onChange={(e) => setFonti({ usSettore: e.target.value })}>
                      <option value="">Tutte le aree / settori</option>
                      {settori.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className={small} value={fonti.usPeriodo} onChange={(e) => setFonti({ usPeriodo: e.target.value })}>
                      <option value="">Tutti i periodi</option>
                      {periodi.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {fonti.us === "selezione" && (
                  <div className="space-y-1">
                    <input className={`${small} w-full`} placeholder="Cerca per codice o definizione…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                    <div className="max-h-40 overflow-y-auto rounded border border-neutral-200 p-1">
                      {usQuery.isLoading && <div className="p-1 text-neutral-500">Caricamento…</div>}
                      {shown.map((u) => (
                        <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-violet-50">
                          <input type="checkbox" checked={fonti.usIds.includes(u.id)}
                            onChange={(e) => setFonti({ usIds: e.target.checked ? [...fonti.usIds, u.id] : fonti.usIds.filter((i) => i !== u.id) })} />
                          <span className="font-mono">{formatUsCode(u.codiceUS, u.tipo)}</span>
                          <span className="truncate text-neutral-500">{u.definizione}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
              <span className="pt-1 font-medium">Giornale</span>
              <div className="flex flex-wrap items-center gap-2">
                <select className={small} value={fonti.giornate} onChange={(e) => setFonti({ giornate: e.target.value as AiBlockFonti["giornate"] })}>
                  <option value="nessuna">Non usare</option>
                  <option value="tutte">Tutte le giornate</option>
                  <option value="documento">Il periodo del documento</option>
                  <option value="periodo">Un periodo a scelta</option>
                </select>
                {fonti.giornate === "periodo" && (
                  <>
                    <input type="date" className={small} value={fonti.da} onChange={(e) => setFonti({ da: e.target.value })} />
                    <span>→</span>
                    <input type="date" className={small} value={fonti.a} onChange={(e) => setFonti({ a: e.target.value })} />
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <span className="font-medium">Altre schede</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {([["periodi", "Periodi"], ["reperti", "Reperti"], ["saggi", "Saggi / settori"]] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={fonti[key]} onChange={(e) => setFonti({ [key]: e.target.checked } as Partial<AiBlockFonti>)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-neutral-500">Senza la spunta «Compila con IA», il blocco elenca i dati delle schede così come sono.</p>
          </div>
        )}

        {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
        {warn && <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{warn}</div>}
      </div>
      <NodeViewContent className="min-h-[2.5rem] px-3 py-2" />
    </NodeViewWrapper>
  );
}

export const AiBlock = Node.create<{ cantiereId: number; docId: number }>({
  name: "aiBlock",
  group: "block",
  // niente blocchi IA annidati
  content: "(paragraph | heading | bulletList | orderedList | blockquote | horizontalRule | table | snapshotFigure)+",
  defining: true,
  isolating: true,
  draggable: true,

  addOptions() {
    return { cantiereId: 0, docId: 0 };
  },

  addAttributes() {
    return {
      prompt: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-prompt") || "",
        renderHTML: (attrs) => ({ "data-prompt": attrs.prompt }),
      },
      useAI: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-use-ai") !== "false",
        renderHTML: (attrs) => ({ "data-use-ai": String(attrs.useAI) }),
      },
      fonti: {
        default: DEFAULT_FONTI,
        parseHTML: (el) => { try { return JSON.parse(el.getAttribute("data-fonti") || ""); } catch { return DEFAULT_FONTI; } },
        renderHTML: (attrs) => ({ "data-fonti": JSON.stringify(attrs.fonti) }),
      },
      stato: {
        default: "vuoto",
        parseHTML: (el) => el.getAttribute("data-stato") || "vuoto",
        renderHTML: (attrs) => ({ "data-stato": attrs.stato }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-ai-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-ai-block": "", ...HTMLAttributes }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiBlockView);
  },

  // "[# istruzione]" a inizio riga diventa un blocco IA con quel prompt
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /^\[#\s*([^\]]*)\]$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
          const para = state.schema.nodes.paragraph.create();
          const block = type.create({ prompt: (match[1] || "").trim() }, para);
          state.tr.replaceWith($from.before(), $from.after(), block);
        },
      }),
    ];
  },
});
