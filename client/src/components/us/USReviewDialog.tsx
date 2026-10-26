import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  applyUsReviewEdits,
  requestUsReview,
  reviseUsReviewProposal,
  type UsReviewCategory,
  type UsReviewFinding,
  type UsReviewProposal,
  type UsReviewResult,
  type UsReviewSeverity,
} from "@/lib/api";
import { diffWords } from "@/lib/wordDiff";
import { cn } from "@/lib/utils";

type USReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usId: number | null;
  usCode?: string;
  /** Chiamata dopo che alcune modifiche sono state applicate (per ricaricare le schede). */
  onApplied: () => void;
  /** Genera anche il testo formattato della scheda (la vecchia funzione di «Analizza AI»). */
  onGenerateText?: (usId: number) => void;
};

type Row = UsReviewProposal & {
  /** Valore che verrà applicato: proposta dell'AI, modifica manuale o proposta rifatta. */
  value: string;
  initialValue: string;
  selected: boolean;
  editing: boolean;
  reviseOpen: boolean;
  revisePrompt: string;
  revising: boolean;
  reviseError?: string;
  applied: boolean;
};

const CATEGORY_LABEL: Record<UsReviewCategory, string> = {
  grammatica: "Grammatica",
  miglioramento: "Miglioramento del testo",
  coerenza: "Coerenza",
  rapporti: "Rapporti",
  completezza: "Completezza",
};

const SEVERITY_CLASS: Record<UsReviewSeverity, string> = {
  alta: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  media: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  bassa: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700",
};

/** I messaggi d'errore di apiRequest sono «502: {"error":"…"}»: si mostra solo il testo utile. */
function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const at = raw.indexOf(": ");
  const body = at > -1 ? raw.slice(at + 2) : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    /* testo semplice */
  }
  return body || "Errore sconosciuto";
}

function toRows(proposals: UsReviewProposal[]): Row[] {
  return proposals.map((p) => ({
    ...p,
    value: p.newValue,
    initialValue: p.newValue,
    selected: false,
    editing: false,
    reviseOpen: false,
    revisePrompt: "",
    revising: false,
    applied: false,
  }));
}

function isCheckbox(row: Pick<UsReviewProposal, "type" | "field">): boolean {
  return row.type === "checkbox" || /^chk[A-Z]/.test(row.field);
}

/** Le scelte multiple sono salvate come array JSON: nella scheda si leggono come elenco. */
function prettyValue(type: string, value: string): string {
  if (type !== "multiselect") return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(", ");
  } catch {
    /* testo semplice */
  }
  return value;
}

function DiffText({ before, after, side }: { before: string; after: string; side: "before" | "after" }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const text = side === "before" ? before : after;
  if (!text.trim()) return <span className="italic text-muted-foreground">(vuoto)</span>;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "same") return <span key={index}>{part.text}</span>;
        if (part.kind === "del" && side === "before") {
          return (
            <span key={index} className="rounded-sm bg-red-100 text-red-900 line-through decoration-red-400 dark:bg-red-950 dark:text-red-200">
              {part.text}
            </span>
          );
        }
        if (part.kind === "add" && side === "after") {
          return (
            <span key={index} className="rounded-sm bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {part.text}
            </span>
          );
        }
        return null;
      })}
    </>
  );
}

function ValueView({ row, side }: { row: Row; side: "before" | "after" }) {
  if (isCheckbox(row)) {
    const checked = (side === "before" ? row.currentValue : row.value) === "true";
    return <span>{checked ? "☑ spuntata" : "☐ non spuntata"}</span>;
  }
  return (
    <DiffText
      before={prettyValue(row.type, row.currentValue)}
      after={prettyValue(row.type, row.value)}
      side={side}
    />
  );
}

function ValueEditor({ row, onChange }: { row: Row; onChange: (value: string) => void }) {
  if (isCheckbox(row)) {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={row.value === "true"} onCheckedChange={(checked) => onChange(checked === true ? "true" : "false")} />
        <span>{row.label}</span>
      </label>
    );
  }
  if (row.type === "select" && row.options?.length) {
    return (
      <select
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {!row.options.includes(row.value) && <option value={row.value}>{row.value || "(vuoto)"}</option>}
        {row.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (row.type === "multiselect" && row.options?.length) {
    let selected: string[] = [];
    try {
      const parsed = JSON.parse(row.value || "[]");
      if (Array.isArray(parsed)) selected = parsed.map(String);
    } catch {
      selected = [];
    }
    const toggle = (option: string, on: boolean) => {
      const next = row.options!.filter((o) => (o === option ? on : selected.includes(o)));
      onChange(next.length ? JSON.stringify(next) : "");
    };
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border bg-muted/10 p-2">
        {row.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(option)} onCheckedChange={(checked) => toggle(option, checked === true)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }
  const short = row.type !== "textarea" && !row.value.includes("\n") && row.value.length < 90 && row.currentValue.length < 90;
  if (short) {
    return <Input value={row.value} onChange={(e) => onChange(e.target.value)} className="text-sm" />;
  }
  return (
    <Textarea
      value={row.value}
      onChange={(e) => onChange(e.target.value)}
      rows={Math.min(14, Math.max(5, Math.ceil(row.value.length / 90) + 1))}
      className="text-sm"
    />
  );
}

export function USReviewDialog({ open, onOpenChange, usId, usCode, onApplied, onGenerateText }: USReviewDialogProps) {
  const { toast } = useToast();
  const [result, setResult] = useState<UsReviewResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [istruzioni, setIstruzioni] = useState("");
  const [applying, setApplying] = useState(false);
  const [filter, setFilter] = useState<UsReviewCategory | "tutte">("tutte");
  const abortRef = useRef<AbortController | null>(null);

  const patchRow = useCallback((id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const runAnalysis = useCallback(
    async (extra: string) => {
      if (usId == null) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const data = await requestUsReview(usId, extra, controller.signal);
        if (controller.signal.aborted) return;
        setResult(data);
        setRows(toRows(data.proposals));
        setFilter("tutte");
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(friendlyError(e));
      } finally {
        if (abortRef.current === controller) {
          setRunning(false);
          abortRef.current = null;
        }
      }
    },
    [usId],
  );

  // L'analisi parte da sola all'apertura; chiudendo il dialogo la richiesta in corso viene annullata.
  useEffect(() => {
    if (!open || usId == null) return;
    setResult(null);
    setRows([]);
    setIstruzioni("");
    void runAnalysis("");
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, usId, runAnalysis]);

  const rerun = () => {
    const touched = rows.some((r) => !r.applied && (r.selected || r.value !== r.initialValue));
    if (touched && !window.confirm("Rilanciando l'analisi le proposte attuali, comprese le tue modifiche manuali non applicate, andranno perse. Continuare?")) {
      return;
    }
    void runAnalysis(istruzioni);
  };

  const revise = async (row: Row) => {
    if (usId == null || !row.revisePrompt.trim()) return;
    patchRow(row.id, { revising: true, reviseError: undefined });
    try {
      const out = await reviseUsReviewProposal(
        usId,
        { usId: row.usId, field: row.field, currentValue: row.currentValue, proposedValue: row.value, reason: row.reason },
        row.revisePrompt,
      );
      patchRow(row.id, {
        value: out.newValue,
        reason: out.reason,
        warning: out.warning,
        revising: false,
        selected: true,
        editing: false,
        reviseOpen: false,
        revisePrompt: "",
      });
    } catch (e) {
      patchRow(row.id, { revising: false, reviseError: friendlyError(e) });
    }
  };

  const visibleRows = useMemo(
    () => rows.filter((row) => filter === "tutte" || row.category === filter),
    [rows, filter],
  );
  const pending = rows.filter((row) => !row.applied);
  const selectedRows = pending.filter((row) => row.selected);

  const categoryCounts = useMemo(() => {
    const counts = new Map<UsReviewCategory, number>();
    for (const row of pending) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return counts;
  }, [pending]);

  const setAllSelected = (value: boolean) => {
    const visibleIds = new Set(visibleRows.filter((r) => !r.applied).map((r) => r.id));
    setRows((prev) => prev.map((row) => (visibleIds.has(row.id) ? { ...row, selected: value } : row)));
  };

  const apply = async () => {
    if (usId == null || selectedRows.length === 0) return;
    setApplying(true);
    try {
      const out = await applyUsReviewEdits(
        usId,
        selectedRows.map((row) => ({ usId: row.usId, field: row.field, value: row.value })),
      );
      const done = new Set(out.applied.map((a) => `${a.usId}:${a.field}`));
      setRows((prev) =>
        prev.map((row) =>
          done.has(row.id)
            ? { ...row, applied: true, selected: false, editing: false, reviseOpen: false, currentValue: row.value }
            : row,
        ),
      );
      if (out.applied.length > 0) onApplied();
      if (out.failed.length > 0) {
        toast({
          title: `${out.failed.length} modifiche non applicate`,
          description: out.failed.map((f) => `${f.field}: ${f.error}`).join(" · "),
          variant: "destructive",
        });
      } else {
        toast({ title: `${out.applied.length} modifiche applicate alla scheda` });
      }
    } catch (e) {
      toast({ title: "Errore applicazione modifiche", description: friendlyError(e), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const findings: UsReviewFinding[] = result?.findings ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Analisi AI della scheda{usCode ? ` — ${usCode}` : ""}</DialogTitle>
          <DialogDescription>
            L'AI controlla tutta la scheda (testi, caselle, rapporti) con le tue istruzioni preimpostate e propone delle modifiche.
            Nulla viene cambiato finché non selezioni le proposte e premi «Applica».
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {running && (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={16} />
              Analisi in corso: l'AI sta leggendo l'intera scheda e i rapporti con le US collegate…
            </div>
          )}

          {error && !running && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && !running && (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Valutazione complessiva</p>
                <p className="mt-1 text-muted-foreground">{result.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.checkedFields} campi esaminati · {result.proposals.length} proposte · {findings.length} segnalazioni
                </p>
              </div>

              {findings.length > 0 && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Segnalazioni da verificare</p>
                  <ul className="mt-2 space-y-1.5">
                    {findings.map((f) => (
                      <li key={f.id} className="flex items-start gap-2 text-sm">
                        <Badge variant="outline" className={cn("mt-0.5 shrink-0 capitalize", SEVERITY_CLASS[f.severity])}>
                          {f.severity}
                        </Badge>
                        <span>
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[f.category]} · </span>
                          {f.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {rows.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  Nessuna modifica proposta: la scheda risulta corretta e coerente.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={filter === "tutte" ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setFilter("tutte")}
                    >
                      Tutte ({pending.length})
                    </Button>
                    {Array.from(categoryCounts.entries()).map(([category, count]) => (
                      <Button
                        key={category}
                        size="sm"
                        variant={filter === category ? "secondary" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => setFilter(category)}
                      >
                        {CATEGORY_LABEL[category]} ({count})
                      </Button>
                    ))}
                    <div className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAllSelected(true)}>
                        Seleziona visibili
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAllSelected(false)}>
                        Deseleziona
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {visibleRows.map((row) => {
                      const changed = row.value !== row.initialValue;
                      return (
                        <div
                          key={row.id}
                          className={cn(
                            "rounded-md border p-3",
                            row.applied && "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20",
                            !row.applied && row.selected && "border-primary/60 bg-primary/5",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <Checkbox
                                disabled={row.applied}
                                checked={row.selected}
                                onCheckedChange={(checked) => patchRow(row.id, { selected: checked === true })}
                              />
                              {row.label}
                              {row.usId !== usId && <span className="font-normal text-muted-foreground">su {row.codiceUS}</span>}
                            </label>
                            <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[row.category]}</Badge>
                            <Badge variant="outline" className={cn("text-[10px] capitalize", SEVERITY_CLASS[row.severity])}>
                              {row.severity}
                            </Badge>
                            {row.origin === "controllo" && (
                              <Badge variant="outline" className="text-[10px]">controllo automatico</Badge>
                            )}
                            {changed && !row.applied && (
                              <Badge variant="outline" className="border-primary/50 text-[10px] text-primary">modificata</Badge>
                            )}
                            {row.applied && (
                              <Badge className="gap-1 bg-emerald-600 text-[10px]">
                                <Check size={10} /> Applicata
                              </Badge>
                            )}
                          </div>

                          <p className="mt-1.5 text-xs text-muted-foreground">{row.reason}</p>
                          {row.warning && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                              <AlertTriangle size={12} /> {row.warning}
                            </p>
                          )}

                          {row.editing && !row.applied ? (
                            <div className="mt-2 space-y-1.5">
                              <ValueEditor row={row} onChange={(value) => patchRow(row.id, { value, selected: true })} />
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs"
                                  onClick={() => patchRow(row.id, { value: row.initialValue })}
                                  disabled={!changed}
                                >
                                  <RotateCcw size={12} /> Ripristina la proposta
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patchRow(row.id, { editing: false })}>
                                  Fine modifica
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <div>
                                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Attuale</p>
                                <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-2 text-sm">
                                  <ValueView row={row} side="before" />
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {row.applied ? "Applicata" : "Proposta"}
                                </p>
                                <div className="whitespace-pre-wrap rounded-md border bg-background p-2 text-sm">
                                  <ValueView row={row} side="after" />
                                </div>
                              </div>
                            </div>
                          )}

                          {!row.applied && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {!row.editing && (
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => patchRow(row.id, { editing: true })}>
                                  <Pencil size={12} /> Modifica a mano
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                onClick={() => patchRow(row.id, { reviseOpen: !row.reviseOpen })}
                              >
                                <Sparkles size={12} /> Rilancia con un prompt
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs text-muted-foreground"
                                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                              >
                                <X size={12} /> Scarta
                              </Button>
                            </div>
                          )}

                          {row.reviseOpen && !row.applied && (
                            <div className="mt-2 space-y-1.5 rounded-md border border-dashed p-2">
                              <Textarea
                                rows={2}
                                value={row.revisePrompt}
                                onChange={(e) => patchRow(row.id, { revisePrompt: e.target.value })}
                                placeholder="Es. «più sintetica», «mantieni la mia formulazione ma correggi solo gli errori», «usa il termine ‘riporto’»…"
                                className="text-sm"
                                disabled={row.revising}
                              />
                              {row.reviseError && <p className="text-xs text-red-700">{row.reviseError}</p>}
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 text-xs"
                                  disabled={row.revising || !row.revisePrompt.trim()}
                                  onClick={() => void revise(row)}
                                >
                                  {row.revising ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                                  {row.revising ? "Rifaccio la proposta…" : "Rifai la proposta"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => patchRow(row.id, { reviseOpen: false })} disabled={row.revising}>
                                  Annulla
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {!running && (result || error) && (
            <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
              <p className="text-sm font-medium">Rilancia l'analisi con indicazioni tue</p>
              <Textarea
                rows={2}
                value={istruzioni}
                onChange={(e) => setIstruzioni(e.target.value)}
                placeholder="Es. «concentrati sui rapporti con le tombe», «non toccare la definizione», «usa un tono più tecnico»…"
                className="text-sm"
              />
              <Button size="sm" variant="outline" className="gap-1" onClick={rerun}>
                <RefreshCw size={13} /> Rilancia analisi
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          <div className="mr-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>Selezionate {selectedRows.length} su {pending.length}</span>
            {onGenerateText && usId != null && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                title="Genera il testo formattato della scheda (funzione precedente di «Analizza AI»)"
                onClick={() => onGenerateText(usId)}
              >
                <ScrollText size={12} /> Genera anche scheda formattata
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Chiudi
          </Button>
          <Button onClick={() => void apply()} disabled={applying || selectedRows.length === 0}>
            {applying ? "Applicazione…" : `Applica selezionate (${selectedRows.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
