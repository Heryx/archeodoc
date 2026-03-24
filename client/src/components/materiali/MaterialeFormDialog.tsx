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
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-146px)] overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-4">
            <section className="rounded-md border border-border bg-background">
              <div className="border-b border-border bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificazione reperto</p>
              </div>
              <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
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
              </div>
            </section>

            <section className="rounded-md border border-border bg-background">
              <div className="border-b border-border bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrizione</p>
              </div>
              <div className="p-3">
                <Label>Descrizione</Label>
                <Textarea
                  rows={4}
                  placeholder="Descrizione sintetica del reperto/materiale..."
                  value={form.descrizione}
                  onChange={(e) => setForm((prev) => ({ ...prev, descrizione: e.target.value }))}
                />
              </div>
            </section>

            <section className="rounded-md border border-border bg-background">
              <div className="border-b border-border bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campi schema RA</p>
              </div>
              <div className="p-3">
                <Label>Campi schema RA (JSON opzionale)</Label>
                <Textarea
                  rows={4}
                  placeholder='es. {"classeMateriale":"Ceramica","quantita":12}'
                  value={form.dataJson}
                  onChange={(e) => setForm((prev) => ({ ...prev, dataJson: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Usalo solo se il tuo schema RA richiede campi extra oltre a codice/tipo/descrizione.
                </p>
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-border bg-background px-4 py-3 sm:px-6">
          <div className="flex justify-end">
            <Button className="w-full sm:w-auto sm:min-w-56" onClick={onSubmit} disabled={submitDisabled}>
              {submitPending ? submitLabelPending : submitLabelIdle}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
