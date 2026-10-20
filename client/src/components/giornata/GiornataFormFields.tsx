import { useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Cloud, Loader2 } from "lucide-react";
import { meteOptions, tipoScavoOptions, type GiornataForm } from "@/components/giornata/types";

export type GiornataSuggestions = {
  settore?: string[];
  archeologoCoordinatore?: string[];
  topografo?: string[];
  direttoreScavo?: string[];
  antropologo?: string[];
  respMateriali?: string[];
  funzionarioSabap?: string[];
  archeologoSorveglianza?: string[];
  archeologi?: string[];
  scavatori?: string[];
  escavatore?: string[];
  obiettivo?: string[];
};

type GiornataFormFieldsProps = {
  form: GiornataForm;
  setForm: Dispatch<SetStateAction<GiornataForm>>;
  suggestions?: GiornataSuggestions;
  cantiereId?: number;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/20 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function SuggestedInput({
  id,
  listId,
  suggestions,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id?: string; listId: string; suggestions?: string[] }) {
  return (
    <>
      <Input {...props} list={suggestions && suggestions.length > 0 ? listId : undefined} />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function GiornataFormFields({ form, setForm, suggestions = {}, cantiereId }: GiornataFormFieldsProps) {
  const uid = useId();
  const listId = (field: string) => `${uid}-${field}`;
  const [meteoLoading, setMeteoLoading] = useState(false);
  const [meteoError, setMeteoError] = useState<string | null>(null);
  const [meteoLocalita, setMeteoLocalita] = useState("");
  const [needsLocalita, setNeedsLocalita] = useState(false);

  const fetchMeteo = async (localitaOverride?: string) => {
    if (!cantiereId || !form.data) return;
    setMeteoLoading(true);
    setMeteoError(null);
    try {
      const params = new URLSearchParams({ data: form.data });
      if (localitaOverride) params.set("localita", localitaOverride);
      const res = await fetch(`/api/cantieri/${cantiereId}/meteo?${params}`);
      const json = await res.json();
      if (!res.ok) {
        if (json.needsLocalita) {
          setNeedsLocalita(true);
          setMeteoError(json.error);
        } else {
          setMeteoError(json.error || "Errore sconosciuto");
        }
      } else {
        setNeedsLocalita(false);
        setMeteoLocalita("");
        setForm((f) => ({ ...f, condMeteo: json.condMeteo }));
      }
    } catch {
      setMeteoError("Errore di rete");
    } finally {
      setMeteoLoading(false);
    }
  };

  const set = <K extends keyof GiornataForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="mt-2 space-y-4">

      {/* ── Dati base ── */}
      <Section title="Dati giornata">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Data *</Label>
            <Input data-testid="input-data" type="date" value={form.data} onChange={set("data")} />
          </div>
          <div>
            <Label>Ora inizio</Label>
            <Input type="time" value={form.oraInizio} onChange={set("oraInizio")} />
          </div>
          <div>
            <Label>Ora fine</Label>
            <Input type="time" value={form.oraFine} onChange={set("oraFine")} />
          </div>
          <div>
            <Label>Settore / Area</Label>
            <SuggestedInput
              placeholder="es. A1, Nord"
              value={form.settore}
              onChange={set("settore")}
              listId={listId("settore")}
              suggestions={suggestions.settore}
            />
          </div>
        </div>
      </Section>

      {/* ── Personale ── */}
      <Section title="Personale">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Archeologo coordinatore</Label>
            <SuggestedInput
              placeholder="Responsabile direzione tecnica del cantiere"
              value={form.archeologoCoordinatore}
              onChange={set("archeologoCoordinatore")}
              listId={listId("archeologoCoordinatore")}
              suggestions={suggestions.archeologoCoordinatore}
            />
          </div>
          <div>
            <Label>Topografo</Label>
            <SuggestedInput
              placeholder="Rilievi con stazione totale / GPS"
              value={form.topografo}
              onChange={set("topografo")}
              listId={listId("topografo")}
              suggestions={suggestions.topografo}
            />
          </div>
          <div>
            <Label>Direttore di scavo</Label>
            <SuggestedInput
              placeholder="Responsabile scientifico dello scavo (≠ coordinatore cantiere)"
              value={form.direttoreScavo}
              onChange={set("direttoreScavo")}
              listId={listId("direttoreScavo")}
              suggestions={suggestions.direttoreScavo}
            />
          </div>
          <div>
            <Label>Archeologi (separati da virgola)</Label>
            <SuggestedInput
              placeholder="es. Mario Rossi, Giulia Bianchi"
              value={form.archeologi}
              onChange={set("archeologi")}
              listId={listId("archeologi")}
              suggestions={suggestions.archeologi}
            />
          </div>
          <div>
            <Label>Scavatori / Operai (separati da virgola)</Label>
            <SuggestedInput
              data-testid="input-operatori"
              placeholder="es. Luca Verdi, Anna Neri"
              value={form.scavatori}
              onChange={set("scavatori")}
              listId={listId("scavatori")}
              suggestions={suggestions.scavatori}
            />
          </div>
          <div>
            <Label>Antropologo</Label>
            <SuggestedInput
              placeholder="Se presenti sepolture o resti ossei umani"
              value={form.antropologo}
              onChange={set("antropologo")}
              listId={listId("antropologo")}
              suggestions={suggestions.antropologo}
            />
          </div>
          <div>
            <Label>Archeologo resp. materiali</Label>
            <SuggestedInput
              placeholder="Siglatura, catalogazione e gestione reperti"
              value={form.respMateriali}
              onChange={set("respMateriali")}
              listId={listId("respMateriali")}
              suggestions={suggestions.respMateriali}
            />
          </div>
          <div>
            <Label>Funzionario SABAP</Label>
            <SuggestedInput
              placeholder="Funzionario Soprintendenza – Alta Sorveglianza"
              value={form.funzionarioSabap}
              onChange={set("funzionarioSabap")}
              listId={listId("funzionarioSabap")}
              suggestions={suggestions.funzionarioSabap}
            />
          </div>
          <div>
            <Label>Archeologo di sorveglianza (Committenza)</Label>
            <SuggestedInput
              placeholder="Incaricato da committente per monitoraggio opere"
              value={form.archeologoSorveglianza}
              onChange={set("archeologoSorveglianza")}
              listId={listId("archeologoSorveglianza")}
              suggestions={suggestions.archeologoSorveglianza}
            />
          </div>
        </div>
      </Section>

      {/* ── Modalità di scavo ── */}
      <Section title="Modalità di scavo">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Tipo di scavo</Label>
            <Select value={form.tipoScavo} onValueChange={(v) => setForm((f) => ({ ...f, tipoScavo: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona..." />
              </SelectTrigger>
              <SelectContent>
                {tipoScavoOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Escavatore meccanico</Label>
            <SuggestedInput
              placeholder="es. CAT 320 – assente se vuoto"
              value={form.escavatore}
              onChange={set("escavatore")}
              listId={listId("escavatore")}
              suggestions={suggestions.escavatore}
            />
          </div>
          <div>
            <Label>Condizioni meteo</Label>
            <div className="flex gap-2 mt-1">
              <Select value={form.condMeteo} onValueChange={(v) => setForm((f) => ({ ...f, condMeteo: v }))}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Seleziona..." />
                </SelectTrigger>
                <SelectContent>
                  {meteOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cantiereId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchMeteo()}
                  disabled={meteoLoading || !form.data}
                  title="Recupera meteo online per questa data e località"
                  className="shrink-0 px-2"
                >
                  {meteoLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                </Button>
              )}
            </div>
            {needsLocalita && (
              <div className="mt-2 flex gap-2 items-center">
                <Input
                  className="text-sm h-8"
                  placeholder="Inserisci città o indirizzo..."
                  value={meteoLocalita}
                  onChange={(e) => setMeteoLocalita(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && meteoLocalita.trim()) fetchMeteo(meteoLocalita.trim()); }}
                  autoFocus
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={meteoLoading || !meteoLocalita.trim()}
                  onClick={() => fetchMeteo(meteoLocalita.trim())}
                  className="shrink-0"
                >
                  {meteoLoading ? <Loader2 size={12} className="animate-spin" /> : <Cloud size={12} />}
                </Button>
              </div>
            )}
            {meteoError && !needsLocalita && <p className="text-xs text-destructive mt-1">{meteoError}</p>}
            {meteoError && needsLocalita && <p className="text-xs text-muted-foreground mt-1">{meteoError} — inserisci manualmente la città</p>}
          </div>
          <div className="md:col-span-3">
            <Label>Obiettivo giornata</Label>
            <SuggestedInput
              placeholder="es. Sorveglianza posa cavidotto, scavo US 45, pulizia area nord"
              value={form.obiettivo}
              onChange={set("obiettivo")}
              listId={listId("obiettivo")}
              suggestions={suggestions.obiettivo}
            />
          </div>
        </div>
      </Section>

      {/* ── Diario ── */}
      <Section title="Diario operativo">
        <div className="space-y-3">
          <div>
            <Label>Attività svolta</Label>
            <Textarea
              placeholder="Descrizione dettagliata delle attività svolte durante la giornata..."
              rows={5}
              value={form.attivitaSvolta}
              onChange={set("attivitaSvolta")}
            />
          </div>
          <div>
            <Label>Note aggiuntive</Label>
            <Textarea
              placeholder="Problematiche, osservazioni, elementi notevoli..."
              rows={3}
              value={form.note}
              onChange={set("note")}
            />
          </div>
        </div>
      </Section>

    </div>
  );
}
