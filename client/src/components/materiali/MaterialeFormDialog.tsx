import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MaterialeForm } from "@/components/materiali/types";

type MaterialeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: MaterialeForm;
  setForm: Dispatch<SetStateAction<MaterialeForm>>;
  usList: any[];
  onSubmit: () => void;
  submitPending: boolean;
  submitLabelIdle: string;
  submitLabelPending: string;
  submitDisabled: boolean;
};

export function MaterialeFormDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  usList,
  onSubmit,
  submitPending,
  submitLabelIdle,
  submitLabelPending,
  submitDisabled,
}: MaterialeFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label>Codice materiale *</Label>
            <Input
              placeholder="es. RA-2026-001"
              value={form.codice}
              onChange={(e) => setForm((prev) => ({ ...prev, codice: e.target.value }))}
            />
          </div>

          <div>
            <Label>Tipo reperto</Label>
            <Input
              placeholder="es. ceramica comune, moneta, laterizio..."
              value={form.tipo}
              onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value }))}
            />
          </div>

          <div>
            <Label>US associata</Label>
            <Select value={form.usId} onValueChange={(value) => setForm((prev) => ({ ...prev, usId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Nessuna US associata" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nessuna</SelectItem>
                {usList.map((us) => (
                  <SelectItem key={us.id} value={String(us.id)}>
                    {us.codiceUS}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Descrizione</Label>
            <Textarea
              rows={4}
              placeholder="Descrizione sintetica del reperto/materiale..."
              value={form.descrizione}
              onChange={(e) => setForm((prev) => ({ ...prev, descrizione: e.target.value }))}
            />
          </div>

          <div>
            <Label>Campi schema RA (JSON opzionale)</Label>
            <Textarea
              rows={4}
              placeholder='es. {"classeMateriale":"Ceramica","quantita":12}'
              value={form.dataJson}
              onChange={(e) => setForm((prev) => ({ ...prev, dataJson: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Usalo solo se il tuo schema RA richiede campi extra oltre a codice/tipo/descrizione.
            </p>
          </div>
        </div>

        <Button className="w-full" onClick={onSubmit} disabled={submitDisabled}>
          {submitPending ? submitLabelPending : submitLabelIdle}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
