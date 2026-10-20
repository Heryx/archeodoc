import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle, CheckCircle2, User, Calendar, Clock, Cloud, Pickaxe } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type RuoloPersona = "operaio" | "archeologo" | "topografo";

interface PersonaClassificata {
  nome: string;
  ruolo: RuoloPersona;
  isNew: boolean;
}

interface GiornataPreviewItem {
  data: string;
  oraInizio: string | null;
  oraFine: string | null;
  meteo: string | null;
  personale: PersonaClassificata[];
  attivitaSvolta: string | null;
  tipoScavo: "manuale" | "meccanico" | "misto" | null;
  obiettivo: string | null;
  usRilevate: number[];
  esisteNelDb: boolean;
  campiMancanti: string[];
}

interface GiornaleImportPreview {
  docId: string;
  giornate: GiornataPreviewItem[];
  nuovePersone: string[];
  warnings: string[];
}

interface GiornataImportDecision {
  data: string;
  tipoScavo?: "manuale" | "meccanico" | "misto" | null;
  obiettivo?: string;
  coordinatori?: string[];
  oraInizio?: string;
  oraFine?: string;
  meteo?: string;
  skip?: boolean;
}

type Step = "url" | "classifica" | "preview" | "done";

const RUOLO_LABELS: Record<RuoloPersona, string> = {
  operaio: "Operaio",
  archeologo: "Archeologo",
  topografo: "Topografo",
};

const TIPO_SCAVO_OPTIONS = [
  { value: "manuale", label: "Manuale" },
  { value: "meccanico", label: "Meccanico" },
  { value: "misto", label: "Misto" },
];

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  cantiereId: number;
  onSuccess: () => void;
}

export function GiornaleImportDialog({ open, onClose, cantiereId, onSuccess }: Props) {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("url");
  const [docUrl, setDocUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const [preview, setPreview] = useState<GiornaleImportPreview | null>(null);

  // Step classifica: ruoli assegnati dall'utente per le nuove persone
  const [classificazioni, setClassificazioni] = useState<Record<string, RuoloPersona>>({});

  // Step preview: decisioni per giornata
  const [decisioni, setDecisioni] = useState<Record<string, GiornataImportDecision>>({});

  function reset() {
    setStep("url");
    setDocUrl("");
    setPreview(null);
    setClassificazioni({});
    setDecisioni({});
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFetchPreview() {
    if (!docUrl.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/cantieri/${cantiereId}/giornale/preview`, { docUrl: docUrl.trim() });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore durante la lettura del documento");
      }
      const data: GiornaleImportPreview = await res.json();
      setPreview(data);

      // Pre-compila classificazioni con ruolo default "operaio" per le nuove persone
      const init: Record<string, RuoloPersona> = {};
      for (const nome of data.nuovePersone) {
        init[nome] = "operaio";
      }
      setClassificazioni(init);

      // Pre-compila decisioni con i valori proposti dalla preview
      const decInit: Record<string, GiornataImportDecision> = {};
      for (const g of data.giornate) {
        decInit[g.data] = {
          data: g.data,
          tipoScavo: g.tipoScavo,
          obiettivo: g.obiettivo || "",
          coordinatori: [],
          skip: false,
        };
      }
      setDecisioni(decInit);

      setStep(data.nuovePersone.length > 0 ? "classifica" : "preview");
    } catch (e: any) {
      toast({ title: "Errore", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setLoading(true);
    try {
      const classificazioniArr = Object.entries(classificazioni).map(([nome, ruolo]) => ({ nome, ruolo }));
      const decisioniArr = Object.values(decisioni);

      const res = await apiRequest("POST", `/api/cantieri/${cantiereId}/giornale/apply`, {
        preview,
        decisioni: decisioniArr,
        classificazioni: classificazioniArr,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore durante l'import");
      }
      const result = await res.json();
      setStep("done");
      toast({
        title: "Import completato",
        description: `Create: ${result.created}, Aggiornate: ${result.updated}, Saltate: ${result.skipped}`,
      });
      onSuccess();
    } catch (e: any) {
      toast({ title: "Errore import", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function setDecisione(data: string, patch: Partial<GiornataImportDecision>) {
    setDecisioni((prev) => ({ ...prev, [data]: { ...prev[data], ...patch } }));
  }

  function toggleCoordinatore(data: string, nome: string) {
    setDecisioni((prev) => {
      const cur = prev[data]?.coordinatori || [];
      const next = cur.includes(nome) ? cur.filter((n) => n !== nome) : [...cur, nome];
      return { ...prev, [data]: { ...prev[data], coordinatori: next } };
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Import Giornale di Scavo
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">

          {/* ── STEP 1: URL documento ─── */}
          {step === "url" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Incolla l'URL del documento Google Docs contenente il giornale di scavo digitalizzato.
              </p>
              <div className="space-y-2">
                <Label htmlFor="docUrl">URL documento Google Docs</Label>
                <Input
                  id="docUrl"
                  placeholder="https://docs.google.com/document/d/..."
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleFetchPreview(); }}
                />
              </div>
            </div>
          )}

          {/* ── STEP 2: Classifica persone nuove ─── */}
          {step === "classifica" && preview && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Le seguenti persone non sono presenti nel database. Assegna il ruolo corretto a ciascuna.
              </p>
              {preview.nuovePersone.map((nome) => (
                <div key={nome} className="flex items-center gap-3 p-3 border rounded-lg">
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-sm font-medium">{nome}</span>
                  <Select
                    value={classificazioni[nome] || "operaio"}
                    onValueChange={(v) => setClassificazioni((p) => ({ ...p, [nome]: v as RuoloPersona }))}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operaio">Operaio</SelectItem>
                      <SelectItem value="archeologo">Archeologo</SelectItem>
                      <SelectItem value="topografo">Topografo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {/* ── STEP 3: Preview giornate ─── */}
          {step === "preview" && preview && (
            <div className="space-y-4">
              {preview.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-yellow-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {preview.giornate.map((g) => {
                const dec = decisioni[g.data] || {};
                const archeologi = g.personale.filter((p) => {
                  const ruolo = classificazioni[p.nome] || p.ruolo;
                  return ruolo === "archeologo";
                });

                return (
                  <div
                    key={g.data}
                    className={`border rounded-lg p-4 space-y-3 ${dec.skip ? "opacity-50" : ""} ${g.esisteNelDb ? "border-blue-200 bg-blue-50/30" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-blue-500" />
                        <span className="font-semibold">{formatDate(g.data)}</span>
                        {g.esisteNelDb && (
                          <Badge variant="secondary" className="text-xs">già presente</Badge>
                        )}
                        {g.usRilevate.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {g.usRilevate.length} US rilevate
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={!dec.skip}
                          onCheckedChange={(v) => setDecisione(g.data, { skip: !v })}
                          id={`skip-${g.data}`}
                        />
                        <label htmlFor={`skip-${g.data}`} className="text-xs text-muted-foreground cursor-pointer">
                          Importa
                        </label>
                      </div>
                    </div>

                    {!dec.skip && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {/* Orario */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            Orario
                          </div>
                          <div className="flex gap-1">
                            <Input
                              className="h-7 text-xs"
                              placeholder="Inizio"
                              value={dec.oraInizio ?? g.oraInizio ?? ""}
                              onChange={(e) => setDecisione(g.data, { oraInizio: e.target.value })}
                            />
                            <Input
                              className="h-7 text-xs"
                              placeholder="Fine"
                              value={dec.oraFine ?? g.oraFine ?? ""}
                              onChange={(e) => setDecisione(g.data, { oraFine: e.target.value })}
                            />
                          </div>
                        </div>

                        {/* Meteo */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Cloud className="w-3 h-3" />
                            Meteo
                          </div>
                          <Input
                            className="h-7 text-xs"
                            value={dec.meteo ?? g.meteo ?? ""}
                            onChange={(e) => setDecisione(g.data, { meteo: e.target.value })}
                          />
                        </div>

                        {/* Tipo scavo */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Pickaxe className="w-3 h-3" />
                            Tipo scavo
                            {g.campiMancanti.includes("tipoScavo") && (
                              <Badge variant="destructive" className="text-xs ml-1">richiesto</Badge>
                            )}
                          </div>
                          <Select
                            value={dec.tipoScavo ?? g.tipoScavo ?? ""}
                            onValueChange={(v) => setDecisione(g.data, { tipoScavo: v as "manuale" | "meccanico" | "misto" })}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Seleziona..." />
                            </SelectTrigger>
                            <SelectContent>
                              {TIPO_SCAVO_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Obiettivo */}
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Obiettivo
                            {g.campiMancanti.includes("obiettivo") && (
                              <Badge variant="secondary" className="text-xs ml-1">AI non disponibile</Badge>
                            )}
                          </div>
                          <Input
                            className="h-7 text-xs"
                            placeholder="es. pulizia settore nord"
                            value={dec.obiettivo ?? g.obiettivo ?? ""}
                            onChange={(e) => setDecisione(g.data, { obiettivo: e.target.value })}
                          />
                        </div>

                        {/* Personale */}
                        {g.personale.length > 0 && (
                          <div className="col-span-2 space-y-1">
                            <div className="text-xs text-muted-foreground">Personale</div>
                            <div className="flex flex-wrap gap-1">
                              {g.personale.map((p) => {
                                const ruolo = classificazioni[p.nome] || p.ruolo;
                                return (
                                  <Badge
                                    key={p.nome}
                                    variant={ruolo === "archeologo" ? "default" : ruolo === "topografo" ? "secondary" : "outline"}
                                    className="text-xs"
                                  >
                                    {p.nome} ({RUOLO_LABELS[ruolo]})
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Coordinatori (selezione tra archeologi) */}
                        {archeologi.length > 0 && (
                          <div className="col-span-2 space-y-1">
                            <div className="text-xs text-muted-foreground">Seleziona coordinatore/i</div>
                            <div className="flex flex-wrap gap-2">
                              {archeologi.map((p) => (
                                <label key={p.nome} className="flex items-center gap-1 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={(dec.coordinatori || []).includes(p.nome)}
                                    onCheckedChange={() => toggleCoordinatore(g.data, p.nome)}
                                  />
                                  {p.nome}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* US rilevate */}
                        {g.usRilevate.length > 0 && (
                          <div className="col-span-2 text-xs text-muted-foreground">
                            US menzionate nel testo: {g.usRilevate.map((n) => `US ${n}`).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── STEP 4: Done ─── */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-lg font-semibold">Import completato</p>
              <p className="text-sm text-muted-foreground text-center">
                Le giornate sono state create nel progetto. Puoi ora consultarle nella lista.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          {step === "done" ? (
            <Button onClick={handleClose}>Chiudi</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Annulla
              </Button>

              {step === "url" && (
                <Button onClick={handleFetchPreview} disabled={!docUrl.trim() || loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Analizza documento
                </Button>
              )}

              {step === "classifica" && (
                <Button onClick={() => setStep("preview")} disabled={loading}>
                  Avanti
                </Button>
              )}

              {step === "preview" && (
                <Button onClick={handleApply} disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Importa giornate
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
