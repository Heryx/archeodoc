import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { USForm } from "@/components/us/types";

type USRelazioniProps = {
  form: USForm;
  setForm: Dispatch<SetStateAction<USForm>>;
};

export const MANAGED_RELATION_MODEL_KEYS = new Set<string>([
  "riempie",
  "riempitoDa",
  "taglia",
  "tagliatoDa",
  "siAppoggiaA",
  "gliSiAppoggia",
  "ugualeAStratigrafico",
  "posterioreA",
  "anterioreA",
]);

function setSchedaValue(
  setForm: Dispatch<SetStateAction<USForm>>,
  fieldKey: string,
  value: string,
) {
  setForm((prev) => ({
    ...prev,
    schedaData: {
      ...prev.schedaData,
      [fieldKey]: value,
    },
  }));
}

export function USRelazioni({ form, setForm }: USRelazioniProps) {
  const schedaValue = (fieldKey: string) => form.schedaData[fieldKey] || "";

  return (
    <section className="rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/20 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relazioni stratigrafiche</p>
      </div>
      <div className="space-y-4 p-3">
        <div>
          <p className="text-sm font-medium">Sequenza fisica (contatti reali)</p>
          <p className="text-xs text-muted-foreground">Inserisci codici US separati da virgola.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Coperto da</Label>
            <Input value={form.coperto_da} onChange={(e) => setForm((f) => ({ ...f, coperto_da: e.target.value }))} />
          </div>
          <div>
            <Label>Copre</Label>
            <Input value={form.copre} onChange={(e) => setForm((f) => ({ ...f, copre: e.target.value }))} />
          </div>
          <div>
            <Label>Riempie</Label>
            <Input value={schedaValue("riempie")} onChange={(e) => setSchedaValue(setForm, "riempie", e.target.value)} />
          </div>
          <div>
            <Label>Riempita da</Label>
            <Input value={schedaValue("riempitoDa")} onChange={(e) => setSchedaValue(setForm, "riempitoDa", e.target.value)} />
          </div>
          <div>
            <Label>Taglia</Label>
            <Input value={schedaValue("taglia")} onChange={(e) => setSchedaValue(setForm, "taglia", e.target.value)} />
          </div>
          <div>
            <Label>Tagliata da</Label>
            <Input value={schedaValue("tagliatoDa")} onChange={(e) => setSchedaValue(setForm, "tagliatoDa", e.target.value)} />
          </div>
          <div>
            <Label>Si appoggia a</Label>
            <Input value={schedaValue("siAppoggiaA")} onChange={(e) => setSchedaValue(setForm, "siAppoggiaA", e.target.value)} />
          </div>
          <div>
            <Label>Gli si appoggia</Label>
            <Input value={schedaValue("gliSiAppoggia")} onChange={(e) => setSchedaValue(setForm, "gliSiAppoggia", e.target.value)} />
          </div>
          <div>
            <Label>Si lega a</Label>
            <Input value={form.si_lega_a} onChange={(e) => setForm((f) => ({ ...f, si_lega_a: e.target.value }))} />
          </div>
          <div>
            <Label>Uguale a</Label>
            <Input value={form.uguale_a} onChange={(e) => setForm((f) => ({ ...f, uguale_a: e.target.value }))} />
          </div>
        </div>

        <div className="pt-1">
          <p className="text-sm font-medium">Sequenza stratigrafica (essenziale Matrix)</p>
          <p className="text-xs text-muted-foreground">Registra solo i rapporti minimi: posteriore a / anteriore a.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Posteriore a</Label>
            <Input value={schedaValue("posterioreA")} onChange={(e) => setSchedaValue(setForm, "posterioreA", e.target.value)} />
          </div>
          <div>
            <Label>Anteriore a</Label>
            <Input value={schedaValue("anterioreA")} onChange={(e) => setSchedaValue(setForm, "anterioreA", e.target.value)} />
          </div>
        </div>
      </div>
    </section>
  );
}
