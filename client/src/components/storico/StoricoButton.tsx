import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoricoDialog } from "@/components/storico/StoricoDialog";
import type { StoricoEntityType } from "@/lib/storico";

type StoricoButtonProps = {
  entityType: StoricoEntityType;
  entityId: number;
  title: string;
  onRestored?: () => void;
};

/** Pulsante «Cronologia» di una scheda: apre l'elenco delle versioni da cui tornare indietro. */
export function StoricoButton({ entityType, entityId, title, onRestored }: StoricoButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1 text-xs"
        title="Cronologia: torna a una versione precedente"
        onClick={() => setOpen(true)}
      >
        <History size={12} /> Cronologia
      </Button>
      <StoricoDialog
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
        title={title}
        onRestored={onRestored}
      />
    </>
  );
}
