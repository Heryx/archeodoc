import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, RotateCcw, Sparkles, Trash2, Download, RefreshCw, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { diffWords } from "@/lib/wordDiff";
import {
  SOURCE_LABELS,
  fetchStorico,
  fetchStoricoDetail,
  restoreStorico,
  type StoricoDetail,
  type StoricoEntityType,
  type StoricoSummary,
} from "@/lib/storico";

type Filter = "tutte" | "eliminate" | "ai";

type StoricoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Con tipo e id mostra la cronologia di una sola scheda; altrimenti quella di tutto il cantiere/progetto. */
  entityType?: StoricoEntityType;
  entityId?: number;
  cantiereId?: number;
  title?: string;
  /** Chiamata dopo un ripristino, per ricaricare la scheda aperta. */
  onRestored?: () => void;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `oggi ${time}` : `${date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} ${time}`;
}

function SourceIcon({ summary }: { summary: StoricoSummary }) {
  if (summary.action === "delete") return <Trash2 size={14} className="text-red-600 shrink-0" />;
  if (summary.source === "ai") return <Sparkles size={14} className="text-violet-600 shrink-0" />;
  if (summary.source === "import") return <Download size={14} className="text-sky-600 shrink-0" />;
  if (summary.source === "sync") return <RefreshCw size={14} className="text-sky-600 shrink-0" />;
  if (summary.source === "ripristino") return <Undo2 size={14} className="text-emerald-600 shrink-0" />;
  return <Pencil size={14} className="text-muted-foreground shrink-0" />;
}

function describe(summary: StoricoSummary): string {
  if (summary.action === "delete") {
    return summary.relatedCount > 0 ? `Eliminata con ${summary.relatedCount} allegati` : "Eliminata";
  }
  const fields = summary.changedFields;
  if (fields.length === 0) return "Modificata";
  return fields.length <= 3 ? fields.join(", ") : `${fields.slice(0, 3).join(", ")} +${fields.length - 3}`;
}

function DiffText({ before, after, side }: { before: string; after: string; side: "before" | "after" }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const plain = side === "before" ? before : after;
  if (!plain) return <span className="italic text-muted-foreground">(vuoto)</span>;
  if (!parts) return <>{plain}</>;
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === "same") return <span key={i}>{part.text}</span>;
        if (part.kind === "del" && side === "before")
          return <mark key={i} className="rounded-sm bg-red-200/70 px-0.5 text-inherit dark:bg-red-900/50">{part.text}</mark>;
        if (part.kind === "add" && side === "after")
          return <mark key={i} className="rounded-sm bg-emerald-200/70 px-0.5 text-inherit dark:bg-emerald-900/50">{part.text}</mark>;
        return null;
      })}
    </>
  );
}

function VersionDetail({
  summary,
  onRestored,
}: {
  summary: StoricoSummary;
  onRestored: (message: string) => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery<StoricoDetail>({
    queryKey: ["storico-detail", summary.id],
    queryFn: () => fetchStoricoDetail(summary.id),
    refetchOnMount: "always",
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail) return;
    setSelected(new Set(detail.fields.filter((f) => !f.alreadyRestored).map((f) => f.key)));
  }, [detail]);

  const restore = async (fields?: string[]) => {
    setBusy(true);
    try {
      const result = await restoreStorico(summary.id, fields);
      const what = result.action === "delete" ? `${summary.label} recuperata` : `Ripristinato: ${result.restored.join(", ")}`;
      onRestored(result.filesRecovered > 0 ? `${what} (${result.filesRecovered} file recuperati)` : what);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      let message = raw;
      try { message = JSON.parse(raw.replace(/^\d+:\s*/, "")).error || raw; } catch { /* messaggio semplice */ }
      toast({ title: "Ripristino non riuscito", description: message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (detailQuery.isLoading || !detail) {
    return <p className="p-4 text-sm text-muted-foreground">{detailQuery.isError ? "Versione non disponibile." : "Caricamento…"}</p>;
  }

  const header = (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{detail.label}</p>
      <p className="text-xs text-muted-foreground">
        {detail.entityTypeLabel} · {SOURCE_LABELS[detail.source]}
        {detail.sourceLabel ? ` (${detail.sourceLabel})` : ""} · {formatWhen(detail.updatedAt)}
      </p>
    </div>
  );

  if (detail.action === "delete") {
    return (
      <div className="space-y-4 p-4">
        {header}
        <p className="text-sm">
          {detail.restoredAt
            ? "Questa scheda è stata già recuperata."
            : detail.relatedCount > 0
              ? `La scheda è stata eliminata insieme a ${detail.relatedCount} allegati. Recuperandola tornano anche questi (e i relativi file).`
              : "La scheda è stata eliminata. Puoi recuperarla com'era un attimo prima."}
        </p>
        <Button onClick={() => restore()} disabled={busy || !!detail.restoredAt} className="gap-1.5">
          <RotateCcw size={14} /> Recupera scheda
        </Button>
      </div>
    );
  }

  const restorable = detail.fields.filter((f) => !f.alreadyRestored);
  const allSelected = restorable.length > 0 && restorable.every((f) => selected.has(f.key));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b px-4 py-3">
        {header}
        {!detail.exists && (
          <p className="text-xs text-amber-700">La scheda non esiste più: recupera prima la versione eliminata.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {detail.fields.map((field) => (
          <div key={field.key} className={cn("rounded-md border p-3", field.alreadyRestored && "opacity-60")}>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={selected.has(field.key)}
                disabled={field.alreadyRestored}
                onCheckedChange={(checked) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(field.key); else next.delete(field.key);
                    return next;
                  })
                }
              />
              {field.label}
              {field.alreadyRestored && <span className="text-xs font-normal text-muted-foreground">già com'era</span>}
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Prima (si torna a questo)</p>
                <p className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-sm">
                  <DiffText before={field.before} after={field.after} side="before" />
                </p>
              </div>
              <div>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Dopo la modifica</p>
                <p className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-sm">
                  <DiffText before={field.before} after={field.after} side="after" />
                </p>
              </div>
            </div>
            {!field.alreadyRestored && field.current !== field.after && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-500">
                Dopo questa modifica il campo è stato cambiato di nuovo: ora è «{field.current || "vuoto"}».
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setSelected(allSelected ? new Set() : new Set(restorable.map((f) => f.key)))}
          disabled={restorable.length === 0}
        >
          {allSelected ? "Deseleziona tutto" : "Seleziona tutto"}
        </button>
        <Button
          onClick={() => restore(Array.from(selected))}
          disabled={busy || selected.size === 0 || !detail.exists}
          className="gap-1.5"
        >
          <RotateCcw size={14} /> Ripristina {selected.size === 1 ? "1 campo" : `${selected.size} campi`}
        </Button>
      </div>
    </div>
  );
}

export function StoricoDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  cantiereId,
  title,
  onRestored,
}: StoricoDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("tutte");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const singleScheda = entityType != null && entityId != null;

  const listQuery = useQuery<StoricoSummary[]>({
    queryKey: ["storico-list", entityType ?? null, entityId ?? null, cantiereId ?? null, filter],
    queryFn: () =>
      fetchStorico({
        entityType,
        entityId,
        cantiereId,
        action: filter === "eliminate" ? "delete" : undefined,
        limit: singleScheda ? 200 : 300,
      }),
    enabled: open,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open, filter]);

  const versions = useMemo(
    () => (listQuery.data ?? []).filter((v) => filter !== "ai" || v.source === "ai"),
    [listQuery.data, filter],
  );
  const selected = versions.find((v) => v.id === selectedId) ?? null;

  const handleRestored = (message: string) => {
    toast({ title: message });
    queryClient.invalidateQueries();
    onRestored?.();
    void listQuery.refetch();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <History size={18} /> {title ?? (singleScheda ? "Cronologia della scheda" : "Cronologia modifiche")}
          </DialogTitle>
          <DialogDescription>
            Ogni modifica, anche dell'AI, viene salvata prima di essere applicata. Scegli una voce per vedere cosa è cambiato e tornare indietro.
          </DialogDescription>
        </DialogHeader>

        {!singleScheda && (
          <div className="flex gap-1.5 border-b px-5 py-2">
            {([["tutte", "Tutte"], ["eliminate", "Eliminate"], ["ai", "Fatte dall'AI"]] as const).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="min-h-0 overflow-y-auto border-r">
            {listQuery.isLoading && <p className="p-4 text-sm text-muted-foreground">Caricamento…</p>}
            {!listQuery.isLoading && versions.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {filter === "eliminate"
                  ? "Nessuna scheda eliminata."
                  : "Ancora nessuna modifica registrata: da ora ogni cambiamento comparirà qui."}
              </p>
            )}
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                  selectedId === v.id && "bg-primary/10",
                  v.restoredAt && "opacity-60",
                )}
              >
                <span className="mt-0.5"><SourceIcon summary={v} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{singleScheda ? (v.action === "delete" ? "Scheda eliminata" : SOURCE_LABELS[v.source]) : v.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatWhen(v.updatedAt)}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {singleScheda
                      ? (v.action === "delete" ? (v.relatedCount > 0 ? `con ${v.relatedCount} allegati` : "recuperabile") : describe(v))
                      : `${v.entityTypeLabel} · ${describe(v)}`}
                  </span>
                  {(v.restoredAt || (!singleScheda && v.source !== "manuale")) && (
                    <Badge variant="outline" className="mt-1 h-4 px-1.5 text-[10px]">
                      {v.restoredAt ? "recuperata" : SOURCE_LABELS[v.source]}
                    </Badge>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-hidden">
            {selected ? (
              <VersionDetail key={selected.id} summary={selected} onRestored={handleRestored} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Seleziona una voce a sinistra per vedere cosa è cambiato.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
