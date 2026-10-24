import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { calcolaSettimaneProgetto } from "@shared/weekUtils";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export type DocTipo = "libero" | "giornaliera" | "settimanale" | "mensile" | "fine_scavo";

const TIPI: { value: DocTipo; label: string }[] = [
  { value: "libero", label: "Nessuno: documento libero" },
  { value: "giornaliera", label: "Uno o più giorni" },
  { value: "settimanale", label: "Una settimana" },
  { value: "mensile", label: "Un mese" },
  { value: "fine_scavo", label: "Tutto lo scavo (finale)" },
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

type ModelloRef = { id: string; nome: string; descrizione: string | null; titolo?: string | null };

export function NuovoDocumentoForm({ cantiereId, onCreated }: { cantiereId: number; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<DocTipo>("libero");
  const [titolo, setTitolo] = useState("");
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [week, setWeek] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [modello, setModello] = useState("");

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

  // Periodo (solo se si collega il giornale): nessuna data da digitare a mano
  const periodo = useMemo(() => {
    if (tipo === "libero" || !giornate.length) return null;
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

  // Titolo suggerito: periodo > titolo del modello > generico
  const suggerito = periodo ? `Relazione – ${periodo.label}` : modelloScelto?.titolo || "Nuovo documento";

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni`, {
        tipo,
        // Senza titolo scritto: il periodo o, per i modelli salvati, il titolo del modello (lo risolve il server)
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
      if (modello) {
        toast({ title: "Documento creato dal modello", description: "Compila i blocchi IA uno per uno, oppure tutti insieme con «Compila tutti»." });
      }
    },
    onError: (e: any) => toast({ title: "Errore creazione", description: e?.message, variant: "destructive" }),
  });

  const importModel = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const res = await (await apiRequest("POST", "/api/modelli-elaborato/importa", data)).json();
      await queryClient.invalidateQueries({ queryKey: ["/api/modelli-elaborato"] });
      setModello(res.modello.id);
      toast({
        title: `Modello «${res.modello.nome}» importato`,
        description: res.warnings?.length ? res.warnings.join(" ") : "È già selezionato: crea il documento per usarlo.",
      });
    } catch (e: any) {
      const raw = String(e?.message || "");
      let msg = raw;
      try { msg = JSON.parse(raw.slice(raw.indexOf("{")))?.error || raw; } catch { /* testo grezzo */ }
      toast({ title: "Importazione non riuscita", description: msg || "File non valido", variant: "destructive" });
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const exportModel = async () => {
    try {
      const res = await apiRequest("GET", `/api/modelli-elaborato/${modello}/esporta`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(modelloScelto?.nome || "modello").replace(/[^\w\-]+/g, "_")}.archeodoc-modello.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Esportazione non riuscita", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Titolo</Label>
        <Input value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder={suggerito} autoFocus />
        <p className="mt-1 text-xs text-muted-foreground">Se lo lasci vuoto si usa il titolo suggerito.</p>
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
          <Button type="button" variant="outline" size="icon" className="mt-1 h-9 w-9 shrink-0" title="Importa un modello da file"
            onClick={() => importRef.current?.click()}>
            <Upload size={14} />
          </Button>
          {modelloPersonale && (
            <>
              <Button type="button" variant="outline" size="icon" className="mt-1 h-9 w-9 shrink-0" title="Esporta questo modello in un file"
                onClick={exportModel}>
                <Download size={14} />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="mt-1 h-9 w-9 shrink-0 text-destructive" title="Elimina questo modello"
                onClick={async () => {
                  if (!window.confirm(`Eliminare il modello «${modelloScelto?.nome}»? I documenti già creati non cambiano.`)) return;
                  await apiRequest("DELETE", `/api/modelli-elaborato/${modello}`);
                  setModello("");
                  queryClient.invalidateQueries({ queryKey: ["/api/modelli-elaborato"] });
                }}>
                <Trash2 size={14} />
              </Button>
            </>
          )}
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importModel(f); }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {modelloScelto?.descrizione
            || "Un modello porta con sé titolo, intestazione, immagini fisse (logo) e struttura. Importane uno da file con l'icona a destra."}
        </p>
      </div>

      <div className="rounded-md border border-border p-3 space-y-3">
        <div>
          <Label>Periodo del giornale di scavo <span className="font-normal text-muted-foreground">(facoltativo)</span></Label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as DocTipo)} className={selectCls}>
            {TIPI.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {tipo === "libero" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Il documento non dipende dal giornale. Potrai comunque inserirne il testo in qualsiasi momento con «Da giornale».
            </p>
          )}
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

        {tipo !== "libero" && (
          <div className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            {giornateQuery.isLoading ? "Caricamento giornate…"
              : !giornate.length ? "Nessuna giornata nel giornale: scegli «documento libero»."
              : periodo ? <>Periodo: <strong className="text-foreground">{fmt(periodo.from)} → {fmt(periodo.to)}</strong> · {periodo.n} giornat{periodo.n === 1 ? "a" : "e"}</>
              : "Seleziona il periodo."}
          </div>
        )}
      </div>

      <Button className="w-full gap-2" onClick={() => create.mutate()} disabled={create.isPending || (tipo !== "libero" && !periodo)}>
        {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Crea documento
      </Button>
    </div>
  );
}
