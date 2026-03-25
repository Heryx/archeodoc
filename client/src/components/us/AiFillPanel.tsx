import { useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AiFieldConfidence, AiFieldSuggestion, AiFillResult } from "@/lib/api";

type AiFillPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: AiFillResult | null;
  onApply: (fields: Record<string, string | boolean | string[]>) => void;
  isApplying?: boolean;
  usCode?: string;
};

const CONFIDENCE_ORDER: Record<AiFieldConfidence, number> = {
  alta: 0,
  media: 1,
  bassa: 2,
};

function formatValue(value: string | boolean | string[]): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }
  return value;
}

function confidenceBadgeClass(confidence: AiFieldConfidence): string {
  if (confidence === "alta") return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (confidence === "media") return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-red-100 text-red-800 border-red-300";
}

export function AiFillPanel({
  open,
  onOpenChange,
  suggestions,
  onApply,
  isApplying = false,
  usCode,
}: AiFillPanelProps) {
  const entries = useMemo(() => {
    if (!suggestions) return [] as Array<{ key: string; suggestion: AiFieldSuggestion }>;
    return Object.entries(suggestions)
      .map(([key, suggestion]) => ({ key, suggestion }))
      .sort((a, b) => {
        const byConfidence = CONFIDENCE_ORDER[a.suggestion.confidence] - CONFIDENCE_ORDER[b.suggestion.confidence];
        if (byConfidence !== 0) return byConfidence;
        return a.key.localeCompare(b.key);
      });
  }, [suggestions]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const initial = entries.reduce<Record<string, boolean>>((acc, item) => {
      acc[item.key] = item.suggestion.confidence === "alta";
      return acc;
    }, {});
    setSelected(initial);
  }, [open, entries]);

  const selectedCount = useMemo(
    () => entries.filter((entry) => selected[entry.key]).length,
    [entries, selected],
  );

  const applySelection = () => {
    const out: Record<string, string | boolean | string[]> = {};
    for (const entry of entries) {
      if (!selected[entry.key]) continue;
      out[entry.key] = entry.suggestion.value;
    }
    onApply(out);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compilazione assistita AI{usCode ? ` - ${usCode}` : ""}</DialogTitle>
          <DialogDescription>
            Seleziona i campi da applicare. I suggerimenti con confidenza alta sono gia preselezionati.
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Nessun campo dedotto automaticamente dal testo disponibile.
          </div>
        ) : (
          <ScrollArea className="h-[52vh] rounded-md border">
            <div className="space-y-2 p-3">
              {entries.map((entry) => (
                <div
                  key={entry.key}
                  className={cn(
                    "rounded-md border p-3",
                    entry.suggestion.confidence === "alta" && "border-emerald-300",
                    entry.suggestion.confidence === "media" && "border-amber-300",
                    entry.suggestion.confidence === "bassa" && "border-red-300",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!selected[entry.key]}
                        onCheckedChange={(checked) => {
                          setSelected((prev) => ({ ...prev, [entry.key]: checked === true }));
                        }}
                      />
                      <span className="font-medium">{entry.key}</span>
                    </label>
                    <Badge variant="outline" className={cn("capitalize", confidenceBadgeClass(entry.suggestion.confidence))}>
                      {entry.suggestion.confidence}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm">{formatValue(entry.suggestion.value)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Fonte: {entry.suggestion.source}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            Selezionati {selectedCount} su {entries.length}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Chiudi
          </Button>
          <Button
            onClick={applySelection}
            disabled={isApplying || selectedCount === 0 || entries.length === 0}
          >
            {isApplying ? "Applicazione..." : "Applica selezionati"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
