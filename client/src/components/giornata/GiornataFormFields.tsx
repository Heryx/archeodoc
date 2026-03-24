import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { meteOptions, type GiornataForm } from "@/components/giornata/types";

type GiornataFormFieldsProps = {
  form: GiornataForm;
  setForm: Dispatch<SetStateAction<GiornataForm>>;
};

export function GiornataFormFields({ form, setForm }: GiornataFormFieldsProps) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data *</Label>
          <Input
            data-testid="input-data"
            type="date"
            value={form.data}
            onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
          />
        </div>
        <div>
          <Label>Settore</Label>
          <Input
            placeholder="es. A1, Nord"
            value={form.settore}
            onChange={(e) => setForm((f) => ({ ...f, settore: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Operatori (separati da virgola)</Label>
        <Input
          data-testid="input-operatori"
          placeholder="Mario Rossi, Giulia Bianchi"
          value={form.operatori}
          onChange={(e) => setForm((f) => ({ ...f, operatori: e.target.value }))}
        />
      </div>
      <div>
        <Label>Condizioni meteo</Label>
        <Select value={form.condMeteo} onValueChange={(v) => setForm((f) => ({ ...f, condMeteo: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Seleziona..." />
          </SelectTrigger>
          <SelectContent>
            {meteOptions.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Note operative</Label>
        <Textarea
          placeholder="Attivita principali, problematiche, etc."
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </div>
    </div>
  );
}
