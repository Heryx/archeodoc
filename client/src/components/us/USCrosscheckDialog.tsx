import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSearch, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getProjectHeader } from "@/lib/project";
import { cn } from "@/lib/utils";

type Preset = "materiali" | "tutti";

type PrepareResult = {
  docId: string;
  nome: string;
  totalePagine: number;
  tipoPagine: "reali" | "stimate";
  totaleCaratteri: number;
  consiglio: { pagesPerPass: number; passes: number; reason: string };
  avvisi: string[];
};

type Proposal = {
  campo: string;
  label: string;
  tipo: "mancante" | "integrazione" | "diverso";
  valoreAttuale: string;
  valoreProposto: string;
  valoreDaApplicare: string | boolean | number | string[];
  confidenza: "alta" | "media" | "bassa";
  fonte: string;
  pagina: number | null;
  selezionataDefault: boolean;
};

type USResult = {
  usId: number;
  codiceUS: string;
  definizione: string | null;
  proposte: Proposal[];
  giaPresenti: string[];
};

type AnalyzeResult = {
  da: number;
  a: number;
  totalePagine: number;
  prossimaDa: number | null;
  risultati: USResult[];
  nonPresenti: Array<{ codiceUS: string; riepilogo: string[] }>;
  avvisi: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: number;
};

const TIPO_LABEL: Record<Proposal["tipo"], string> = {
  mancante: "Mancante",
  integrazione: "Da integrare",
  diverso: "Diverso",
};

const TIPO_CLASS: Record<Proposal["tipo"], string> = {
  mancante: "bg-amber-100 text-amber-900 border-amber-300",
  integrazione: "bg-sky-100 text-sky-900 border-sky-300",
  diverso: "bg-rose-100 text-rose-900 border-rose-300",
};

const proposalId = (usId: number, campo: string) => `${usId}:${campo}`;

async function readError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

export function USCrosscheckDialog({ open, onOpenChange, cid }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preset, setPreset] = useState<Preset>("materiali");
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState<PrepareResult | null>(null);
  const [da, setDa] = useState(1);
  const [a, setA] = useState(1);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "prepare" | "analyze" | "apply">(null);
  const [pagineAnalizzate, setPagineAnalizzate] = useState(0);
  const [applicate, setApplicate] = useState(0);

  const reset = () => {
    setDoc(null);
    setResult(null);
    setSelected(new Set());
    setPagineAnalizzate(0);
    setApplicate(0);
    setBusy(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const prepare = async (file: File) => {
    setBusy("prepare");
    try {
      const form = new FormData();
      form.append("documento", file);
      const res = await fetch(buildProjectUrl(`/api/cantieri/${cid}/us/crosscheck/prepare`), {
        method: "POST",
        headers: getProjectHeader(),
        body: form,
      });
      if (!res.ok) throw new Error(await readError(res, "Errore nella lettura del documento"));
      const data = (await res.json()) as PrepareResult;
      setDoc(data);
      setResult(null);
      setPagineAnalizzate(0);
      setDa(1);
      setA(Math.min(data.totalePagine, data.consiglio.pagesPerPass));
    } catch (e: any) {
      toast({ title: "Documento non leggibile", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const analyze = async (from: number, to: number) => {
    if (!doc) return;
    setBusy("analyze");
    try {
      const res = await apiRequest("POST", `/api/cantieri/${cid}/us/crosscheck/analyze`, {
        docId: doc.docId,
        da: from,
        a: to,
        preset,
        note,
      });
      const data = (await res.json()) as AnalyzeResult;
      setResult(data);
      setPagineAnalizzate((prev) => prev + (data.a - data.da + 1));
      const init = new Set<string>();
      for (const r of data.risultati) {
        for (const p of r.proposte) if (p.selezionataDefault) init.add(proposalId(r.usId, p.campo));
      }
      setSelected(init);
    } catch (e: any) {
      toast({ title: "Analisi non riuscita", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  /** Applica le proposte selezionate; restituisce true se l'operazione è andata a buon fine. */
  const applySelected = async (): Promise<boolean> => {
    if (!result) return true;
    const items = result.risultati
      .map((r) => ({
        usId: r.usId,
        campi: Object.fromEntries(
          r.proposte
            .filter((p) => selected.has(proposalId(r.usId, p.campo)))
            .map((p) => [p.campo, p.valoreDaApplicare]),
        ),
      }))
      .filter((item) => Object.keys(item.campi).length > 0);

    if (!items.length) return true;
    setBusy("apply");
    try {
      const res = await apiRequest("POST", `/api/cantieri/${cid}/us/crosscheck/apply`, { items });
      const data = (await res.json()) as { aggiornate: number; campiApplicati: number; errori: unknown[] };
      setApplicate((prev) => prev + data.campiApplicati);
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us"] });
      toast({
        title: `${data.aggiornate} schede US aggiornate`,
        description: data.errori.length ? `${data.errori.length} errori` : `${data.campiApplicati} campi applicati`,
        variant: data.errori.length ? "destructive" : undefined,
      });
      return data.errori.length === 0;
    } catch (e: any) {
      toast({ title: "Applicazione non riuscita", description: e?.message, variant: "destructive" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const nextRange = useMemo(() => {
    if (!doc || !result?.prossimaDa) return null;
    const from = result.prossimaDa;
    const size = Math.max(1, a - da + 1);
    return { from, to: Math.min(doc.totalePagine, from + size - 1) };
  }, [doc, result, a, da]);

  const applyAndContinue = async () => {
    if (!nextRange) return;
    const ok = await applySelected();
    if (!ok) return;
    setDa(nextRange.from);
    setA(nextRange.to);
    await analyze(nextRange.from, nextRange.to);
  };

  const applyAndClose = async () => {
    const ok = await applySelected();
    if (ok) handleOpenChange(false);
  };

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const totalProposals = result?.risultati.reduce((n, r) => n + r.proposte.length, 0) ?? 0;
  const rangeInvalid = !doc || da < 1 || a < da || a > doc.totalePagine;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch size={18} /> Verifica schede US con documentazione
          </DialogTitle>
          <DialogDescription>
            Carica schede dei materiali, tabelle di reperti o altra documentazione: l'AI cerca le informazioni sulle US e
            ti mostra cosa manca nelle schede. Nulla viene scritto senza la tua conferma.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {/* 1. Documento */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo di controllo</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)} disabled={!!busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="materiali">Materiali e reperti (componenti, quantità, datazione)</SelectItem>
                  <SelectItem value="tutti">Tutti i campi principali della scheda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Documento (PDF, DOCX, ODT, XLSX/CSV, TXT)</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.odt,.xlsx,.xls,.csv,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void prepare(file);
                  }}
                />
                <Button variant="outline" className="gap-2" disabled={!!busy} onClick={() => fileInputRef.current?.click()}>
                  {busy === "prepare" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {doc ? "Cambia documento" : "Scegli file"}
                </Button>
                {doc && <span className="text-sm text-muted-foreground truncate">{doc.nome}</span>}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="crosscheck-note">Note per l'AI (facoltative)</Label>
            <Textarea
              id="crosscheck-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Es. Tabella dei reperti osteologici: la colonna «SU» è la US; ignora le pagine di bibliografia."
              disabled={!!busy}
            />
          </div>

          {/* 2. Intervallo di pagine */}
          {doc && (
            <div className="rounded-md border p-3 space-y-3 bg-muted/30">
              <div className="text-sm">
                <strong>{doc.totalePagine}</strong> {doc.tipoPagine === "reali" ? "pagine" : "pagine stimate"} ·{" "}
                {doc.totaleCaratteri.toLocaleString("it-IT")} caratteri.
                <span className="block text-muted-foreground">
                  Consiglio: {doc.consiglio.pagesPerPass} pagine per volta ({doc.consiglio.passes} passaggi). {doc.consiglio.reason}
                </span>
                {doc.avvisi.map((w) => (
                  <span key={w} className="block text-amber-700">{w}</span>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cc-da">Dalla pagina</Label>
                  <Input id="cc-da" type="number" min={1} max={doc.totalePagine} value={da} className="w-24"
                    onChange={(e) => setDa(Number(e.target.value))} disabled={!!busy} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cc-a">Alla pagina</Label>
                  <Input id="cc-a" type="number" min={1} max={doc.totalePagine} value={a} className="w-24"
                    onChange={(e) => setA(Number(e.target.value))} disabled={!!busy} />
                </div>
                <Button
                  className="gap-2"
                  disabled={rangeInvalid || !!busy}
                  onClick={() => void analyze(da, a)}
                >
                  {busy === "analyze" ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
                  {busy === "analyze" ? "Analisi in corso..." : `Analizza pagine ${da}–${a}`}
                </Button>
                {pagineAnalizzate > 0 && (
                  <span className="text-xs text-muted-foreground pb-2">
                    Analizzate finora: {pagineAnalizzate} · campi applicati: {applicate}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 3. Risultati */}
          {result && (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                Pagine {result.da}–{result.a}: {result.risultati.length} US con informazioni, {totalProposals} proposte
                {result.risultati.some((r) => r.giaPresenti.length > 0) && " (le altre informazioni risultano già nelle schede)"}.
              </div>
              {result.avvisi.map((w) => (
                <div key={w} className="text-sm text-amber-700">{w}</div>
              ))}

              <div className="rounded-md border">
                <div className="divide-y">
                  {result.risultati.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">
                      Nessuna US delle schede è citata con informazioni utili in queste pagine.
                    </div>
                  )}
                  {result.risultati.map((r) => (
                    <div key={r.usId} className="p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.codiceUS}</span>
                        {r.definizione && <span className="text-sm text-muted-foreground">{r.definizione}</span>}
                        {r.proposte.length === 0 && (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300">Scheda già completa</Badge>
                        )}
                      </div>
                      {r.proposte.map((p) => {
                        const id = proposalId(r.usId, p.campo);
                        return (
                          <label key={id} className="flex items-start gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/40">
                            <Checkbox
                              checked={selected.has(id)}
                              onCheckedChange={(c) => toggle(id, c === true)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0 text-sm space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{p.label}</span>
                                <Badge variant="outline" className={cn("text-xs", TIPO_CLASS[p.tipo])}>{TIPO_LABEL[p.tipo]}</Badge>
                                {p.confidenza === "bassa" && <Badge variant="outline" className="text-xs">confidenza bassa</Badge>}
                                {p.pagina != null && <span className="text-xs text-muted-foreground">p. {p.pagina}</span>}
                              </div>
                              {p.valoreAttuale && (
                                <div className="text-muted-foreground whitespace-pre-wrap">Nella scheda: {p.valoreAttuale}</div>
                              )}
                              <div className="whitespace-pre-wrap">Dal documento: {p.valoreProposto}</div>
                              {p.fonte && <div className="text-xs text-muted-foreground italic">«{p.fonte}»</div>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {result.nonPresenti.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-1">
                  <div className="font-medium text-amber-900">
                    US citate nel documento ma senza scheda US ({result.nonPresenti.length})
                  </div>
                  {result.nonPresenti.map((n) => (
                    <div key={n.codiceUS} className="text-amber-900">
                      <strong>{n.codiceUS}</strong>: {n.riepilogo.join(" · ")}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={!!busy}>
            Chiudi
          </Button>
          {result && nextRange && (
            <Button variant="secondary" disabled={!!busy} onClick={() => {
              setDa(nextRange.from);
              setA(nextRange.to);
              void analyze(nextRange.from, nextRange.to);
            }}>
              Salta e analizza pagine {nextRange.from}–{nextRange.to}
            </Button>
          )}
          {result && nextRange && (
            <Button disabled={!!busy} onClick={() => void applyAndContinue()}>
              {busy === "apply" && <Loader2 size={14} className="mr-2 animate-spin" />}
              Applica ({selected.size}) e analizza pagine {nextRange.from}–{nextRange.to}
            </Button>
          )}
          {result && !nextRange && (
            <Button disabled={!!busy || selected.size === 0} onClick={() => void applyAndClose()}>
              {busy === "apply" && <Loader2 size={14} className="mr-2 animate-spin" />}
              Applica ({selected.size}) e chiudi
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
