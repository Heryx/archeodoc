import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { USModelDefinition } from "@shared/us_models";
import { getModelFieldValue, tipiUS, type USForm as USFormModel } from "@/components/us/types";
import { MANAGED_RELATION_MODEL_KEYS, USRelazioni } from "@/components/us/USRelazioni";
import type { USThesaurusConfig } from "@shared/us_thesaurus";
import { normalizeUsTipo, usDefinizioneSuggestions } from "@shared/us_thesaurus";

type USFormFieldsProps = {
  form: USFormModel;
  setForm: Dispatch<SetStateAction<USFormModel>>;
  giornate: any[];
  usThesaurus?: USThesaurusConfig;
  activeModel?: USModelDefinition;
};

function setFieldValue(
  setForm: Dispatch<SetStateAction<USFormModel>>,
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

function parseMultiSelectValue(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Fallback for legacy plain strings.
  }

  return text
    .split(/[|,;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setMultiSelectValue(
  setForm: Dispatch<SetStateAction<USFormModel>>,
  fieldKey: string,
  values: string[],
) {
  const normalized = Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
  setFieldValue(setForm, fieldKey, normalized.length > 0 ? JSON.stringify(normalized) : "");
}

export function USFormFields({ form, setForm, giornate, usThesaurus, activeModel }: USFormFieldsProps) {
  const [showGuide, setShowGuide] = useState(false);
  const tipoNormalized = normalizeUsTipo(form.tipo);
  const tipoOptions = useMemo(
    () =>
      Array.from(
        new Set((usThesaurus?.tipo && usThesaurus.tipo.length > 0 ? usThesaurus.tipo : tipiUS).map((item) => String(item))),
      ),
    [usThesaurus?.tipo],
  );
  const definizioneSuggestions = useMemo(
    () => usDefinizioneSuggestions(tipoNormalized || form.tipo, usThesaurus?.definizione),
    [tipoNormalized, form.tipo, usThesaurus?.definizione],
  );
  const suggestedChips = definizioneSuggestions.slice(0, 6);
  const definizioneListId = `us-definizione-suggest-${tipoNormalized || "all"}`;

  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Compilazione guidata disponibile per criteri, relazioni e campi ICCD.
        </p>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowGuide((prev) => !prev)}>
          <BookOpen size={14} />
          {showGuide ? "Nascondi guida" : "Guida compilazione"}
          {showGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Button>
      </div>

      {showGuide && (
        <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">Guida rapida scheda US</p>
          <p>
            1) Compila prima identificazione, natura US (NAT/ART), criteri di distinzione e modo di formazione.
          </p>
          <p>
            2) Mantieni separate sequenza fisica (contatti reali) e sequenza stratigrafica (solo relazioni essenziali
            per la Matrix).
          </p>
          <p>
            3) Per i reperti usa riferimenti alle schede materiali (ID/sigle); in questa scheda inserisci una sintesi,
            non il dettaglio di laboratorio.
          </p>
          <p>
            4) Per strati, strutture e US negative compila i sotto-campi specifici del modello attivo.
          </p>
          <p>
            5) A fine compilazione aggiungi affidabilita stratigrafica, responsabili e data compilazione.
          </p>
        </div>
      )}

      <section className="rounded-md border border-border bg-background">
        <div className="border-b border-border bg-muted/20 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificazione US</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-4">
          <div>
            <Label>Codice US *</Label>
            <Input
              data-testid="input-codice-us"
              placeholder="US 001 / T.001"
              value={form.codiceUS}
              onChange={(e) => setForm((f) => ({ ...f, codiceUS: e.target.value }))}
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona..." />
              </SelectTrigger>
              <SelectContent>
                {tipoOptions.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Quota s.l.m. (m)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="es. 12.45"
              value={form.quota}
              onChange={(e) => setForm((f) => ({ ...f, quota: e.target.value }))}
            />
          </div>
          <div>
            <Label>Quota da piano campagna (m)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="es. -0.35"
              value={form.quotaPianoCampagna}
              onChange={(e) => setForm((f) => ({ ...f, quotaPianoCampagna: e.target.value }))}
            />
          </div>
          <div>
            <Label>Settore</Label>
            <Input value={form.settore} onChange={(e) => setForm((f) => ({ ...f, settore: e.target.value }))} />
          </div>
          <div>
            <Label>Giornata</Label>
            <Select value={form.giornataId} onValueChange={(value) => setForm((f) => ({ ...f, giornataId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Collega a giornata..." />
              </SelectTrigger>
              <SelectContent>
                {giornate.map((g: any) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.data}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              La data scheda (es. data compilazione/giorno) viene proposta automaticamente dalla giornata selezionata.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-background">
        <div className="border-b border-border bg-muted/20 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrizione e interpretazione</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Definizione</Label>
            <Input
              list={definizioneListId}
              placeholder="es. strato di abbandono con materiale ceramico"
              value={form.definizione}
              onChange={(e) => setForm((f) => ({ ...f, definizione: e.target.value }))}
            />
            <datalist id={definizioneListId}>
              {definizioneSuggestions.map((option) => (
                <option key={`def-${option}`} value={option} />
              ))}
            </datalist>
            {suggestedChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {suggestedChips.map((option) => (
                  <Button
                    key={`chip-${option}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setForm((f) => ({ ...f, definizione: option }))}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <Label>Descrizione</Label>
            <Textarea
              placeholder="Descrizione stratigrafica dettagliata..."
              value={form.descrizione}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Interpretazione</Label>
            <Textarea
              placeholder="Interpretazione storico-archeologica..."
              value={form.interpretazione}
              rows={2}
              onChange={(e) => setForm((f) => ({ ...f, interpretazione: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <USRelazioni form={form} setForm={setForm} />

      <section className="rounded-md border border-border bg-background">
        <div className="border-b border-border bg-muted/20 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cronologia e reperti</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
          <div>
            <Label>Periodo iniziale</Label>
            <Input
              value={form.periodoIniziale}
              onChange={(e) => setForm((f) => ({ ...f, periodoIniziale: e.target.value }))}
            />
          </div>
          <div>
            <Label>Periodo finale</Label>
            <Input value={form.periodoFinale} onChange={(e) => setForm((f) => ({ ...f, periodoFinale: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <Label>Materiali rinvenuti</Label>
            <Input
              value={form.materialiRinvenuti}
              onChange={(e) => setForm((f) => ({ ...f, materialiRinvenuti: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Campioni</Label>
            <Input value={form.campioni} onChange={(e) => setForm((f) => ({ ...f, campioni: e.target.value }))} />
          </div>
        </div>
      </section>

      {activeModel && activeModel.fields.length > 0 && (
        <section className="rounded-md border border-border bg-background">
          <div className="border-b border-border bg-muted/20 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Campi modello attivo: {activeModel.name}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
            {activeModel.fields
              .filter((field) => !MANAGED_RELATION_MODEL_KEYS.has(field.key))
              .map((field) => {
                const value = getModelFieldValue(form, field);
                const selectedValues = field.type === "multiselect" ? parseMultiSelectValue(value) : [];
                const isWide = field.type === "textarea" || field.type === "multiselect";

                return (
                  <div key={field.key} className={isWide ? "md:col-span-2" : ""}>
                    <Label>
                      {field.label}
                      {field.required ? " *" : ""}
                    </Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        rows={3}
                        value={value}
                        onChange={(e) => setFieldValue(setForm, field.key, e.target.value)}
                      />
                    ) : field.type === "select" ? (
                      <Select value={value} onValueChange={(next) => setFieldValue(setForm, field.key, next)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options || []).map((option) => (
                            <SelectItem key={`${field.key}-${option}`} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.type === "multiselect" ? (
                      <div className="space-y-2 rounded-md border border-border bg-muted/10 p-2">
                        {(field.options || []).map((option) => {
                          const selected = selectedValues.includes(option);
                          return (
                            <label
                              key={`${field.key}-${option}`}
                              className="flex cursor-pointer items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(checked) => {
                                  const next = checked
                                    ? [...selectedValues, option]
                                    : selectedValues.filter((item) => item !== option);
                                  setMultiSelectValue(setForm, field.key, next);
                                }}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <Input
                        type={field.type === "date" ? "date" : "text"}
                        value={value}
                        onChange={(e) => setFieldValue(setForm, field.key, e.target.value)}
                      />
                    )}
                    {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
