import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileWarning, Wrench } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: string | undefined;
  /** Righe di riepilogo delle riparazioni previste (dal server). */
  summary: string[];
  /** Chiamato dopo che la scelta è stata salvata (per ritentare l'export). */
  onResolved: () => void;
};

export function ElencoTemplateRepairDialog({ open, onOpenChange, cid, summary, onResolved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const decide = useMutation({
    mutationFn: async (mode: "repair" | "as-is") => {
      const res = await apiRequest("POST", `/api/cantieri/${cid}/elenco-template/repair`, { mode });
      if (!res.ok) throw new Error((await res.json()).error || "Errore");
      return mode;
    },
    onSuccess: (mode) => {
      qc.invalidateQueries({ queryKey: ["elenco-template", cid] });
      qc.invalidateQueries({ queryKey: ["elenco-template-repair", cid] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us", "table"] });
      toast({
        title: mode === "repair" ? "Template corretto" : "Export sul template così com'è",
        description:
          mode === "repair"
            ? "Copia dell'originale salvata: ripristinabile dalle impostazioni del template."
            : "Verranno esportate solo le voci come sono nel template attuale.",
      });
      onOpenChange(false);
      onResolved();
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning size={17} className="text-amber-500" /> Il template va corretto
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1 text-sm">
          <p className="text-muted-foreground">
            Il template importato contiene righe o campi che non verrebbero esportati per ogni US:
          </p>
          <ul className="space-y-1.5">
            {summary.map((s, i) => (
              <li key={i} className="flex gap-2">
                <Wrench size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Se procedi, il <strong>template verrà modificato</strong> (ne viene salvata una copia,
            ripristinabile dalle impostazioni del template). Altrimenti l'export userà il template
            così com'è.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Button disabled={decide.isPending} onClick={() => decide.mutate("repair")}>
              {decide.isPending ? "Attendere…" : "Correggi il template ed esporta"}
            </Button>
            <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate("as-is")}>
              Esporta così com'è
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
