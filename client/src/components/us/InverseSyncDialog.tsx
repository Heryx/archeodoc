import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";

export interface PendingInverse {
  targetId: number;
  targetCode: string;
  field: string;
  valueToAdd: string;
}

const FIELD_LABELS: Record<string, string> = {
  copre: "copre",
  coperto_da: "coperto da",
  si_lega_a: "si lega a",
  uguale_a: "uguale a",
  taglia: "taglia",
  tagliatoDa: "tagliata da",
  riempie: "riempie",
  riempitoDa: "riempita da",
  siAppoggiaA: "si appoggia a",
  gliSiAppoggia: "gli si appoggia",
  posterioreA: "posteriore a",
  anterioreA: "anteriore a",
};

type Props = {
  open: boolean;
  inverses: PendingInverse[];
  onConfirm: (selected: PendingInverse[]) => void;
  onClose: () => void;
  isApplying?: boolean;
};

export function InverseSyncDialog({ open, inverses, onConfirm, onClose, isApplying }: Props) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(inverses.map((_, i) => i)));

  // Reset when inverses change (new save)
  useState(() => {
    setChecked(new Set(inverses.map((_, i) => i)));
  });

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function handleConfirm() {
    onConfirm(inverses.filter((_, i) => checked.has(i)));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight size={16} />
            Relazioni inverse suggerite
          </DialogTitle>
          <DialogDescription>
            Il salvataggio ha generato queste relazioni inverse sulle US citate. Seleziona quelle da applicare.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1 max-h-72 overflow-y-auto">
          {inverses.map((inv, i) => (
            <label
              key={i}
              className="flex items-start gap-3 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <Checkbox
                checked={checked.has(i)}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5"
              />
              <div className="text-sm leading-snug">
                <span className="font-mono font-semibold">{inv.targetCode}</span>
                <span className="text-muted-foreground mx-1.5">→</span>
                <Badge variant="secondary" className="text-xs font-normal">
                  {FIELD_LABELS[inv.field] ?? inv.field}
                </Badge>
                <span className="text-muted-foreground mx-1.5">←</span>
                <span className="font-mono">{inv.valueToAdd}</span>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isApplying}>
            Ignora tutto
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={checked.size === 0 || isApplying}
          >
            {isApplying ? "Applicando..." : `Applica (${checked.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
