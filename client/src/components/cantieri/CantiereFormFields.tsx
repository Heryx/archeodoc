import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CantiereForm } from "@/components/cantieri/types";

type CantiereFormFieldsProps = {
  form: CantiereForm;
  setForm: Dispatch<SetStateAction<CantiereForm>>;
};

export function CantiereFormFields({ form, setForm }: CantiereFormFieldsProps) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Codice *</Label>
          <Input
            data-testid="input-codice"
            placeholder="es. ITA-BO-2026-01"
            value={form.codice}
            onChange={(e) => setForm((f) => ({ ...f, codice: e.target.value }))}
          />
        </div>
        <div>
          <Label>Committente</Label>
          <Input
            value={form.committente}
            onChange={(e) => setForm((f) => ({ ...f, committente: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Nome cantiere *</Label>
        <Input
          data-testid="input-nome"
          placeholder="es. Necropoli di via Roma - Bologna"
          value={form.nome}
          onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Localita *</Label>
          <Input
            placeholder="Comune, Provincia"
            value={form.localita}
            onChange={(e) => setForm((f) => ({ ...f, localita: e.target.value }))}
          />
        </div>
        <div>
          <Label>Responsabile</Label>
          <Input
            value={form.responsabile}
            onChange={(e) => setForm((f) => ({ ...f, responsabile: e.target.value }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data inizio</Label>
          <Input
            type="date"
            value={form.dataInizio}
            onChange={(e) => setForm((f) => ({ ...f, dataInizio: e.target.value }))}
          />
        </div>
        <div>
          <Label>Data fine</Label>
          <Input
            type="date"
            value={form.dataFine}
            onChange={(e) => setForm((f) => ({ ...f, dataFine: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Note</Label>
        <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </div>
    </div>
  );
}
