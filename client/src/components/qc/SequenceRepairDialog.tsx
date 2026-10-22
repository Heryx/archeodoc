import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Item = { key: string; usId: number; code: string; field: "posterioreA" | "anterioreA"; value: string; reason: string };
type Plan = { items: Item[]; cyclesBefore: number; cyclesAfter: number };

const FIELD_LABEL = { posterioreA: "posteriore a", anterioreA: "anteriore a" } as const;

type Props = { open: boolean; onClose: () => void; cid: string; onDone?: () => void };

export function SequenceRepairDialog({ open, onClose, cid, onDone }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const base = `/api/cantieri/${cid}/qc/sequenza`;

  const { data: plan, isLoading } = useQuery<Plan>({
    queryKey: ["/api/cantieri", cid, "qc", "sequenza"],
    queryFn: async () => (await apiRequest("POST", `${base}/preview`, {})).json(),
    enabled: open && !!cid,
    staleTime: 0,
    gcTime: 0,
  });

  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => setChecked(new Set(plan?.items.map((i) => i.key) ?? [])), [plan]);
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/apply`, { selected: Array.from(checked) })).json(),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      toast({
        title: "Sequenza riparata",
        description: `${r.removed} voci tolte da ${r.usUpdated} US. Rilancia il QC per aggiornare l'elenco degli errori.`,
      });
      onDone?.();
      onClose();
    },
    onError: (error: any) =>
      toast({ title: "Riparazione non riuscita", description: error?.message, variant: "destructive" }),
  });

  const byUs = new Map<string, Item[]>();
  for (const item of plan?.items ?? []) byUs.set(item.code, [...(byUs.get(item.code) ?? []), item]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench size={16} /> Ripara la sequenza stratigrafica
          </DialogTitle>
          <DialogDescription>
            Voci dei campi «posteriore a» e «anteriore a» che contraddicono i rapporti fisici (copre, taglia, riempie,
            si appoggia a). I rapporti fisici restano come sono; si tolgono solo queste voci, e solo se le confermi.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !plan ? (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        ) : plan.items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nessuna contraddizione da riparare automaticamente.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {plan.items.length} voci da togliere. Segnalazioni di ciclo: <strong>{plan.cyclesBefore}</strong> adesso,{" "}
              <strong>{plan.cyclesAfter}</strong> dopo la riparazione
              {plan.cyclesAfter > 0 && " (le restanti sono contraddizioni fra rapporti fisici, da correggere a mano)"}.
            </p>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
              {Array.from(byUs.entries()).map(([code, items]) => (
                <div key={code} className="rounded-md border border-border p-2">
                  <p className="mb-1 font-mono text-sm font-semibold">US {code}</p>
                  {items.map((item) => (
                    <label key={item.key} className="flex cursor-pointer items-start gap-2 py-0.5 text-sm">
                      <Checkbox
                        checked={checked.has(item.key)}
                        onCheckedChange={() => toggle(item.key)}
                        className="mt-0.5"
                      />
                      <span>
                        togli <span className="font-mono">{item.value}</span> da
                        <Badge variant="secondary" className="mx-1.5 text-xs font-normal">
                          {FIELD_LABEL[item.field]}
                        </Badge>
                        <span className="text-muted-foreground">— {item.reason}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Annulla
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!plan?.items.length || checked.size === 0 || apply.isPending}>
            {apply.isPending ? "Applico..." : `Applica (${checked.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
