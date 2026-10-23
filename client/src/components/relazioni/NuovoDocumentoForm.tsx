import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { calcolaSettimaneProgetto } from "@shared/weekUtils";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export type DocTipo = "giornaliera" | "settimanale" | "mensile" | "fine_scavo";

const TIPI: { value: DocTipo; label: string }[] = [
  { value: "giornaliera", label: "Giornaliera (uno o più giorni)" },
  { value: "settimanale", label: "Settimanale" },
  { value: "mensile", label: "Mensile" },
  { value: "fine_scavo", label: "Finale (tutto lo scavo)" },
];

const selectCls = "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const monthName = (ym: string) => {
  const d = new Date(`${ym}-15T12:00:00`);
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};

export function NuovoDocumentoForm({ cantiereId, onCreated }: { cantiereId: number; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<DocTipo>("settimanale");
  const [titolo, setTitolo] = useState("");
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [week, setWeek] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [modello, setModello] = useState("");

  type ModelloRef = { id: string; nome: string; descrizione: string | null };
  const modelliQuery = useQuery<{ builtin: ModelloRef[]; custom: ModelloRef[] }>({
    queryKey: ["/api/modelli-elaborato"],
    queryFn: async () => (await apiRequest("GET", "/api/modelli-elaborato")).json(),
  });
  const modelli = modelliQuery.data;
  const modelloScelto = [...(modelli?.builtin || []), ...(modelli?.custom || [])].find((m) => m.id === modello);
  const modelloPersonale = !!modello && !modello.startsWith("builtin:");

  const giornateQuery = useQuery<{ id: number; data: string }[]>({
    queryKey: ["/api/cantieri", String(cantiereId), "giornate", "per-relazioni"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/giornate`)).json(),
  });
  const giornate = useMemo(
    () => [...(giornateQuery.data || [])].filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.data)).sort((a, b) => a.data.localeCompare(b.data)),
    [giornateQuery.data],
  );
  const days = useMemo(() => Array.from(new Set(giornate.map((g) => g.data))), [giornate]);
  const settimane = useMemo(() => calcolaSettimaneProgetto(giornate), [giornate]);
  const months = useMemo(() => Array.from(new Set(giornate.map((g) => g.data.slice(0, 7)))), [giornate]);

  // Valori predefiniti: ultima settimana, ultimo mese, ultimo giorno
  useEffect(() => {
    if (week == null && settimane.length) setWeek(settimane[settimane.length - 1].weekNumber);
    if (!month && months.length) setMonth(months[months.length - 1]);
    if (!dayFrom && days.length) { setDayFrom(days[days.length - 1]); setDayTo(""); }
  }, [settimane, months, days]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodo risolto dalla scelta: nessuna data da digitare a mano
  const periodo = useMemo(() => {
    if (!giornate.length) return null;
    let from: string | null = null;
    let to: string | null = null;
    let label = "";
    if (tipo === "giornaliera" && dayFrom) {
      from = dayFrom;
      to = dayTo && dayTo >= dayFrom ? dayTo : dayFrom;
      label = from === to ? `Giornata ${fmt(from)}` : `Giornate ${fmt(from)} – ${fmt(to)}`;
    } else if (tipo === "settimanale") {
      const w = settimane.find((x) => x.weekNumber === week);
      if (w) { from = w.dataInizio; to = w.dataFine; label = `Settimana W${w.weekNumber} (${fmt(from)} – ${fmt(to)})`; }
    } else if (tipo === "mensile" && month) {
      const inMonth = days.filter((d) => d.startsWith(month));
      from = inMonth[0]; to = inMonth[inMonth.length - 1];
      label = `Mese di ${monthName(month)}`;
    } else if (tipo === "fine_scavo") {
      from = days[0]; to = days[days.length - 1];
      label = "Relazione finale di scavo";
    }
    if (!from || !to) return null;
    const n = giornate.filter((g) => g.data >= from! && g.data <= to!).length;
    return { from, to, label, n };
  }, [tipo, dayFrom, dayTo, week, month, giornate, settimane, days]);

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni`, {
        tipo,
        titolo: titolo.trim() || (periodo ? `Relazione – ${periodo.label}` : null),
        dataInizio: periodo?.from ?? null,
        dataFine: periodo?.to ?? null,
        modello: modello || undefined,
      })).json(),
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] });
      const id = Number(data?.documentazione?.id);
      if (Number.isFinite(id)) onCreated(id);
      setTitolo("");
      toast({
        title: "Documento creato",
        description: modello
          ? "Compila i blocchi IA uno per uno, oppure tutti insieme con «Compila tutti»."
          : "Usa «Da giornale» per precompilare il testo del periodo.",
      });
    },
    onError: (e: any) => toast({ title: "Errore creazione", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label>Tipo di relazione</Label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as DocTipo)} className={selectCls}>
          {TIPI.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {tipo === "giornaliera" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Dal giorno</Label>
            <select value={dayFrom} onChange={(e) => setDayFrom(e.target.value)} className={selectCls}>
              {days.map((d) => <option key={d} value={d}>{fmt(d)}</option>)}
            </select>
          </div>
          <div>
            <Label>Al giorno</Label>
            <select value={dayTo} onChange={(e) => setDayTo(e.target.value)} className={selectCls}>
              <option value="">solo questo</option>
              {days.filter((d) => d > dayFrom).map((d) => <option key={d} value={d}>{fmt(d)}</option>)}
            </select>
          </div>
        </div>
      )}

      {tipo === "settimanale" && (
        <div>
          <Label>Settimana di riferimento</Label>
          <select value={week ?? ""} onChange={(e) => setWeek(Number(e.target.value))} className={selectCls}>
            {[...settimane].reverse().map((w) => <option key={w.weekNumber} value={w.weekNumber}>{w.label}</option>)}
          </select>
        </div>
      )}

      {tipo === "mensile" && (
        <div>
          <Label>Mese</Label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
            {[...months].reverse().map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>
      )}

      <div className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
        {giornateQuery.isLoading ? "Caricamento giornate…"
          : !giornate.length ? "Nessuna giornata nel giornale: il periodo non può essere scelto."
          : periodo ? <>Periodo: <strong className="text-foreground">{fmt(periodo.from)} → {fmt(periodo.to)}</strong> · {periodo.n} giornat{periodo.n === 1 ? "a" : "e"}</>
          : "Seleziona il periodo."}
      </div>

      <div>
        <Label>Modello</Label>
        <div className="flex items-center gap-1.5">
          <select value={modello} onChange={(e) => setModello(e.target.value)} className={selectCls}>
            <option value="">Documento vuoto</option>
            {!!modelli?.builtin.length && (
              <optgroup label="Predefiniti">
                {modelli.builtin.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </optgroup>
            )}
            {!!modelli?.custom.length && (
              <optgroup label="I miei modelli">
                {modelli.custom.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </optgroup>
            )}
          </select>
          {modelloPersonale && (
            <Button type="button" variant="ghost" size="icon" className="mt-1 h-8 w-8 shrink-0 text-destructive" title="Elimina questo modello"
              onClick={async () => {
                if (!window.confirm(`Eliminare il modello «${modelloScelto?.nome}»? I documenti già creati non cambiano.`)) return;
                await apiRequest("DELETE", `/api/modelli-elaborato/${modello}`);
                setModello("");
                queryClient.invalidateQueries({ queryKey: ["/api/modelli-elaborato"] });
              }}>
              <Trash2 size={14} />
            </Button>
          )}
        </div>
        {modelloScelto?.descrizione && <p className="mt-1 text-xs text-muted-foreground">{modelloScelto.descrizione}</p>}
      </div>

      <div>
        <Label>Titolo</Label>
        <Input value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder={periodo ? `Relazione – ${periodo.label}` : "Titolo (opzionale)"} />
      </div>

      <Button className="w-full gap-2" onClick={() => create.mutate()} disabled={create.isPending || (giornate.length > 0 && !periodo)}>
        {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Crea documento
      </Button>
    </div>
  );
}
