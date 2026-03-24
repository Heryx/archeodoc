import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectItem } from "@/components/cantieri/types";

type CantiereTransferDialogProps = {
  open: boolean;
  pending: boolean;
  target: any | null;
  transferProjectId: string;
  transferMode: "copy" | "move";
  otherProjects: ProjectItem[];
  onOpenChange: (open: boolean) => void;
  onProjectChange: (projectId: string) => void;
  onModeChange: (mode: "copy" | "move") => void;
  onConfirm: () => void;
};

export function CantiereTransferDialog({
  open,
  pending,
  target,
  transferProjectId,
  transferMode,
  otherProjects,
  onOpenChange,
  onProjectChange,
  onModeChange,
  onConfirm,
}: CantiereTransferDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trasferisci cantiere su altro progetto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">
            {target
              ? `Cantiere selezionato: ${target.codice} - ${target.nome}`
              : "Seleziona un cantiere da trasferire."}
          </p>
          <div>
            <Label>Progetto destinazione</Label>
            <Select value={transferProjectId} onValueChange={onProjectChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona progetto..." />
              </SelectTrigger>
              <SelectContent>
                {otherProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Operazione</Label>
            <Select value={transferMode} onValueChange={(value) => onModeChange(value as "copy" | "move")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">Copia (mantieni anche nel progetto corrente)</SelectItem>
                <SelectItem value="move">Sposta (rimuovi dal progetto corrente)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Lo spostamento copia prima tutti i dati e poi elimina il cantiere dal progetto corrente.
            </p>
          </div>

          <Button className="w-full" onClick={onConfirm} disabled={!target || !transferProjectId || pending}>
            {pending
              ? "Trasferimento in corso..."
              : transferMode === "move"
                ? "Sposta cantiere"
                : "Copia cantiere"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
