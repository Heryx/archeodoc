import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { withReturnTo } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getCurrentProjectId } from "@/lib/project";
import {
  Sparkles, X, ChevronRight, ChevronLeft, Send, ExternalLink, Filter, ListChecks, Loader2, Square, Pencil, Download,
} from "lucide-react";
import { useAiAssistant } from "./AiAssistantContext";
import { cancelAiJob, startAiJob, useAiJobActive } from "@/lib/aiJobs";
import { invalidateUsRelatedQueries } from "@/lib/usCache";
import {
  askAssistant,
  applyAssistantEdits,
  type AssistantChatMessage,
  type AssistantProposedEdit,
  type AssistantResult,
  type AssistantSelectionItem,
} from "@/lib/aiAssistant";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  selection?: AssistantSelectionItem[];
  proposedEdits?: AssistantProposedEdit[];
  truncated?: boolean;
  contextInfo?: AssistantResult["contextInfo"];
};

const PAGE_CONTEXT_LABELS: Record<string, string> = {
  us: "Schede US",
  "elenco-us": "Elenco US",
  matrix: "Matrix di Harris",
  qc: "Controllo qualità",
  giornata: "Giornata di scavo",
  materiali: "Materiali",
  webmap: "WebMap",
  documentazioni: "Elaborati",
  sas: "Saggi",
  report: "Report",
  stats: "Statistiche",
  cantiere: "Cantiere",
};

function editKey(e: AssistantProposedEdit): string {
  return `${e.id}::${e.field}`;
}

export function AiAssistantPanel({ cid, pageContext }: { cid?: string; pageContext: string }) {
  const { open, setOpen, toggleOpen, expanded, setExpanded, selectionFilter, setSelectionFilter } =
    useAiAssistant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: aiStatus } = useQuery<{ available: boolean }>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    staleTime: Infinity,
  });
  const aiAvailable = aiStatus?.available ?? false;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [usRange, setUsRange] = useState("");
  const [editSel, setEditSel] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // La richiesta gira nel gestore globale dei job IA: continua anche a pannello chiuso
  // e compare nella barra in basso.
  const askKey = `assistente:${cid ?? ""}`;
  const askPending = useAiJobActive(askKey);
  const ask = {
    isPending: askPending,
    mutate: ({ prompt, history, usRange }: { prompt: string; history: AssistantChatMessage[]; usRange?: string }) => {
      const id = startAiJob<AssistantResult>({
        key: askKey,
        label: `Assistente IA: ${prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt}`,
        interactive: true,
        run: ({ signal }) => askAssistant(cid!, { prompt, history, pageContext, usRange }, signal),
        onSuccess: (res) => {
          jobIdRef.current = null;
          setTurns((prev) => [
            ...prev,
            {
              role: "assistant",
              content: res.answer,
              selection: res.selection,
              proposedEdits: res.proposedEdits,
              truncated: res.truncated,
              contextInfo: res.contextInfo,
            },
          ]);
          if (res.proposedEdits.length > 0) {
            setEditSel((prev) => {
              const next = { ...prev };
              for (const e of res.proposedEdits) if (next[editKey(e)] == null) next[editKey(e)] = true;
              return next;
            });
          }
        },
        onCancel: () => {
          jobIdRef.current = null;
          setTurns((prev) => prev.slice(0, -1));
          // Interrotto dall'utente: la domanda torna nel campo per poterla modificare.
          setInput(prompt);
        },
        onError: (err: any) => {
          jobIdRef.current = null;
          setTurns((prev) => prev.slice(0, -1));
          toast({ title: "Errore assistente IA", description: err?.message, variant: "destructive" });
        },
      });
      jobIdRef.current = id;
    },
  };

  const applyEdits = useMutation({
    mutationFn: async (edits: AssistantProposedEdit[]) =>
      applyAssistantEdits(cid!, edits.map((e) => ({ id: e.id, field: e.field, value: e.newValue })), conversationIdRef.current),
    onSuccess: (res) => {
      invalidateUsRelatedQueries(qc, cid);
      const okCount = res.applied.length;
      const koCount = res.failed.length;
      toast({
        title: `Modifiche applicate: ${okCount}${koCount ? `, fallite: ${koCount}` : ""}`,
        variant: koCount ? "default" : "default",
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            `Applicate ${okCount} modifiche.` +
            (koCount
              ? `\nNon applicate:\n${res.failed.map((f) => `• US ${f.id} — ${f.field}: ${f.error}`).join("\n")}`
              : ""),
        },
      ]);
    },
    onError: (err: any) =>
      toast({ title: "Errore applicazione modifiche", description: err?.message, variant: "destructive" }),
  });

  const send = () => {
    const prompt = input.trim();
    if (!prompt || ask.isPending || !cid) return;
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: prompt }]);
    setInput("");
    ask.mutate({ prompt, history, usRange: usRange.trim() || undefined });
  };

  const stop = () => {
    if (jobIdRef.current != null) cancelAiJob(jobIdRef.current);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditText(turns[index].content);
  };

  // Riformula una domanda precedente: scarta la conversazione da quel punto in poi e la reinvia.
  const confirmEdit = () => {
    const prompt = editText.trim();
    if (editingIndex === null || !prompt || ask.isPending || !cid) return;
    const history = turns.slice(0, editingIndex).map((t) => ({ role: t.role, content: t.content }));
    setTurns([...turns.slice(0, editingIndex), { role: "user", content: prompt }]);
    setEditingIndex(null);
    ask.mutate({ prompt, history, usRange: usRange.trim() || undefined });
  };

  const contextLabel = PAGE_CONTEXT_LABELS[pageContext] || "Cantiere";

  // FAB visibile solo su una pagina cantiere con IA disponibile
  if (!cid || !aiAvailable) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90",
        )}
        title="Apri assistente IA"
      >
        <Sparkles size={16} /> Assistente IA
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 z-40 flex h-screen flex-col border-l border-border bg-background shadow-xl transition-[width]",
        expanded ? "w-[640px] max-w-[95vw]" : "w-[380px] max-w-[92vw]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles size={16} className="text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-none">Assistente IA</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Contesto: {contextLabel}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Scarica backup conversazioni (log)"
          onClick={() => {
            const pid = getCurrentProjectId();
            window.open(`/api/ai-assistant/log${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`, "_blank");
          }}>
          <Download size={15} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}
          title={expanded ? "Riduci" : "Espandi"}>
          {expanded ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} title="Chiudi">
          <X size={15} />
        </Button>
      </div>

      {selectionFilter && (
        <div className="flex items-center gap-2 border-b border-border bg-primary/10 px-3 py-1.5 text-xs text-primary">
          <Filter size={12} />
          <span>Filtro attivo: {selectionFilter.length} US</span>
          <button type="button" className="ml-auto underline" onClick={() => setSelectionFilter(null)}>
            Rimuovi
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Esempi di richieste</p>
            <ul className="mt-1.5 space-y-1">
              <li>• Elenca le US in cui manca il campo Rapporti stratigrafici</li>
              <li>• Quali US non hanno interpretazione?</li>
              <li>• Imposta settore = A per US 5 e US 6</li>
              <li>• Riassumi le relazioni di taglio nel cantiere</li>
            </ul>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[92%] rounded-lg px-3 py-2 text-sm",
                turn.role === "user" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground",
              )}
            >
              {editingIndex === i ? (
                <div className="space-y-1.5">
                  <textarea
                    autoFocus
                    className="min-h-[60px] w-full min-w-[220px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        confirmEdit();
                      } else if (e.key === "Escape") {
                        setEditingIndex(null);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingIndex(null)}>
                      Annulla
                    </Button>
                    <Button size="sm" className="h-7 text-xs" disabled={!editText.trim()} onClick={confirmEdit}>
                      Reinvia
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{turn.content}</div>
              )}
              {turn.role === "user" && editingIndex !== i && !ask.isPending && (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => startEdit(i)}
                  title="Modifica e reinvia questa domanda"
                >
                  <Pencil size={11} /> Modifica
                </button>
              )}

              {turn.contextInfo && (
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    turn.truncated ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                  )}
                >
                  Contesto: {turn.contextInfo.included} US
                  {turn.contextInfo.filtered ? " (filtro)" : ` su ${turn.contextInfo.total}`}
                  {turn.contextInfo.first && turn.contextInfo.last
                    ? ` · da ${turn.contextInfo.first} a ${turn.contextInfo.last}`
                    : ""}
                  {turn.truncated &&
                    " — troncato: le altre US non sono state analizzate. Restringi con il filtro US."}
                </p>
              )}

              {turn.selection && turn.selection.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => setSelectionFilter(turn.selection!.map((s) => s.id))}
                    >
                      <Filter size={12} /> Filtra la pagina ({turn.selection.length})
                    </Button>
                  </div>
                  <ul className="space-y-1">
                    {turn.selection.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
                      >
                        <span className="font-mono font-medium">{s.codiceUS}</span>
                        {s.reason && <span className="text-muted-foreground">— {s.reason}</span>}
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                          onClick={() => navigate(withReturnTo(`/cantiere/${cid}/us?openUsId=${s.id}`))}
                        >
                          <ExternalLink size={11} /> Apri
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {turn.proposedEdits && turn.proposedEdits.length > 0 && (
                <div className="mt-2 space-y-1.5 rounded border border-amber-400/40 bg-amber-50/60 p-2 dark:bg-amber-950/20">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <ListChecks size={13} /> Modifiche proposte
                  </p>
                  <ul className="space-y-1">
                    {turn.proposedEdits.map((e) => (
                      <li key={editKey(e)} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          className="mt-0.5"
                          checked={editSel[editKey(e)] ?? true}
                          onCheckedChange={(v) =>
                            setEditSel((prev) => ({ ...prev, [editKey(e)]: v === true }))
                          }
                        />
                        <div className="min-w-0">
                          <span className="font-mono font-medium">{e.codiceUS}</span>{" "}
                          <span className="text-muted-foreground">· {e.label}</span>
                          <div className="text-muted-foreground">
                            <span className="line-through">{e.currentValue || "(vuoto)"}</span>{" "}
                            <ChevronRight size={10} className="inline" /> <span className="text-foreground">{e.newValue}</span>
                          </div>
                          {e.reason && <div className="text-muted-foreground/80">{e.reason}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    className="h-7 w-full gap-1.5 text-xs"
                    disabled={applyEdits.isPending}
                    onClick={() => {
                      const chosen = turn.proposedEdits!.filter((e) => editSel[editKey(e)] ?? true);
                      if (chosen.length === 0) {
                        toast({ title: "Nessuna modifica selezionata" });
                        return;
                      }
                      if (!window.confirm(`Applicare ${chosen.length} modifiche alle schede US?`)) return;
                      applyEdits.mutate(chosen);
                    }}
                  >
                    {applyEdits.isPending ? <Loader2 size={12} className="animate-spin" /> : <ListChecks size={12} />}
                    Applica selezionati
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        {ask.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" /> L'assistente sta elaborando…
          </div>
        )}
      </div>

      <div className="border-t border-border p-2">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <label htmlFor="ai-us-range" className="shrink-0">Limita alle US:</label>
          <input
            id="ai-us-range"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="es. 177-188, 200 (vuoto = tutto il cantiere)"
            value={usRange}
            onChange={(e) => setUsRange(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Chiedi qualcosa sulle US del cantiere…"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {ask.isPending ? (
            <Button size="icon" variant="destructive" className="h-9 w-9 shrink-0" onClick={stop} title="Interrompi">
              <Square size={14} />
            </Button>
          ) : (
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={send} disabled={!input.trim()}>
              <Send size={15} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
