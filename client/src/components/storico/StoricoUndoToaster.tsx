import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient } from "@/lib/queryClient";
import { parseStoricoId, restoreStorico, subscribeStoricoChanges } from "@/lib/storico";

const UNDOABLE_SOURCES = new Set(["ai", "import", "sync"]);

/**
 * Dopo un'eliminazione o una modifica fatta dall'AI / da un'importazione mostra un avviso con «Annulla».
 * Le semplici modifiche manuali non lo mostrano (sono sempre recuperabili da «Cronologia»).
 */
export function StoricoUndoToaster() {
  const { toast } = useToast();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = subscribeStoricoChanges((ids) => {
      const relevant = ids.filter((id) => {
        const { action, source } = parseStoricoId(id);
        return action === "delete" || UNDOABLE_SOURCES.has(source);
      });
      if (relevant.length === 0) return;

      const deletes = relevant.filter((id) => parseStoricoId(id).action === "delete").length;
      const title =
        deletes > 0
          ? deletes === 1 ? "Scheda eliminata" : `${deletes} schede eliminate`
          : relevant.length === 1 ? "Scheda modificata automaticamente" : `${relevant.length} schede modificate automaticamente`;

      const undo = async () => {
        let failed = 0;
        // Dall'ultima alla prima: prima si annullano le modifiche piu' recenti.
        for (const id of [...relevant].reverse()) {
          try {
            await restoreStorico(id);
          } catch {
            failed++;
          }
        }
        queryClient.invalidateQueries();
        toast(
          failed === 0
            ? { title: "Fatto: tutto com'era prima" }
            : { title: "Annullamento incompleto", description: `${failed} voci non ripristinate: controlla «Cronologia».`, variant: "destructive" },
        );
      };

      // Aspetta che la pagina mostri il suo avviso, poi lo sostituisce con quello che permette di annullare.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        toast({
          title,
          description: "Se non va bene puoi tornare indietro. Trovi tutto anche in «Cronologia».",
          duration: 15000,
          action: (
            <ToastAction altText="Annulla" onClick={undo}>
              Annulla
            </ToastAction>
          ),
        });
      }, 500);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [toast]);

  return null;
}
