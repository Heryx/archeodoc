import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { meteOptions, tipoScavoOptions, type GiornataForm, emptyForm } from "./types";

type AiField = {
  value: string;
  confidence: "alta" | "media" | "bassa";
  source: string;
};

type GiornataAIPreview = {
  data?: AiField;
  oraInizio?: AiField;
  oraFine?: AiField;
  settore?: AiField;
  condMeteo?: AiField;
  archeologoCoordinatore?: AiField;
  archeologi?: AiField;
  scavatori?: AiField;
  topografo?: AiField;
  escavatore?: AiField;
  tipoScavo?: AiField;
  obiettivo?: AiField;
  attivitaSvolta?: AiField;
  note?: AiField;
  campiMancanti: string[];
  testoOriginale: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cantiereId: number;
  projectId: string;
  onCreated: (giornata: any) => void;
};

const FIELD_LABELS: Record<string, string> = {
  data: "Data",
  oraInizio: "Ora inizio",
  oraFine: "Ora fine",
  settore: "Settore / Area",
  condMeteo: "Condizioni meteo",
  archeologoCoordinatore: "Archeologo coordinatore",
  archeologi: "Archeologi presenti",
  scavatori: "Scavatori / Operai",
  topografo: "Topografo",
  escavatore: "Escavatore",
  tipoScavo: "Tipo scavo",
  obiettivo: "Obiettivo",
  attivitaSvolta: "Attività svolta",
  note: "Note operative",
};

function ConfidenceBadge({ level }: { level: "alta" | "media" | "bassa" }) {
  if (level === "alta") return <Badge className="bg-green-600 text-white text-[10px] px-1.5 py-0">alta</Badge>;
  if (level === "media") return <Badge className="bg-yellow-500 text-white text-[10px] px-1.5 py-0">media</Badge>;
  return <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">bassa</Badge>;
}

function previewToForm(preview: GiornataAIPreview): GiornataForm {
  const get = (f?: AiField) => f?.value || "";
  return {
    ...emptyForm,
    data: get(preview.data),
    oraInizio: get(preview.oraInizio),
    oraFine: get(preview.oraFine),
    settore: get(preview.settore),
    condMeteo: get(preview.condMeteo),
    archeologoCoordinatore: get(preview.archeologoCoordinatore),
    archeologi: get(preview.archeologi),
    scavatori: get(preview.scavatori),
    topografo: get(preview.topografo),
    escavatore: get(preview.escavatore),
    tipoScavo: get(preview.tipoScavo),
    obiettivo: get(preview.obiettivo),
    attivitaSvolta: get(preview.attivitaSvolta),
    note: get(preview.note),
  };
}

export function GiornataDocxImportDialog({ open, onOpenChange, cantiereId, projectId, onCreated }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<"upload" | "review">("upload");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<GiornataAIPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [form, setForm] = useState<GiornataForm>(emptyForm);

  function reset() {
    setPhase("upload");
    setLoading(false);
    setSaving(false);
    setPreview(null);
    setFilename("");
    setForm(emptyForm);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setFilename(file.name);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(
        `/api/cantieri/${cantiereId}/import-giornata-from-docx?projectId=${encodeURIComponent(projectId)}`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore server");

      const p = data.preview as GiornataAIPreview;
      setPreview(p);
      setForm(previewToForm(p));
      setPhase("review");
    } catch (err: any) {
      toast({ title: "Errore import", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.data.trim()) {
      toast({ title: "Campo obbligatorio", description: "La data è obbligatoria.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("confirm", "true");
      fd.append("fields", JSON.stringify(form));

      const res = await fetch(
        `/api/cantieri/${cantiereId}/import-giornata-from-docx?projectId=${encodeURIComponent(projectId)}`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore salvataggio");

      toast({ title: "Giornata creata", description: `Giornata del ${form.data} importata con successo.` });
      onCreated(data.giornata);
      handleClose(false);
    } catch (err: any) {
      toast({ title: "Errore salvataggio", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof GiornataForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const confidence = (key: keyof GiornataAIPreview) =>
    preview ? (preview[key] as AiField | undefined)?.confidence : undefined;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[92vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Importa giornata da documento
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-120px)] overflow-y-auto px-4 py-4 sm:px-6 space-y-4">

          {/* ── Fase upload ── */}
          {phase === "upload" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="rounded-full bg-muted p-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">Carica un file .doc o .docx</p>
                <p className="text-sm text-muted-foreground mt-1">
                  L'AI estrarrà automaticamente i campi della giornata di scavo
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analisi in corso…</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Scegli file</>
                )}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleUpload}
              />
              {filename && !loading && (
                <p className="text-xs text-muted-foreground">{filename}</p>
              )}
            </div>
          )}

          {/* ── Fase revisione ── */}
          {phase === "review" && preview && (
            <div className="space-y-4">
              {/* Banner attendibilità */}
              <div className="rounded-md border border-border bg-muted/10 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Anteprima campi estratti da: <span className="font-normal text-muted-foreground">{filename}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Verifica e correggi i valori prima di salvare. I badge indicano l'affidabilità dell'estrazione AI.
                </p>
                {preview.campiMancanti.length > 0 && (
                  <div className="flex items-start gap-1.5 mt-2">
                    <AlertCircle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-yellow-700 dark:text-yellow-400">
                      Campi non trovati: {preview.campiMancanti.join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {/* Legenda badge */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-medium">Attendibilità AI:</span>
                <span className="flex items-center gap-1"><ConfidenceBadge level="alta" /> esplicito nel testo</span>
                <span className="flex items-center gap-1"><ConfidenceBadge level="media" /> dedotto</span>
                <span className="flex items-center gap-1"><ConfidenceBadge level="bassa" /> incerto</span>
              </div>

              {/* Campi */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {/* Data */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.data} *</Label>
                    {confidence("data") && <ConfidenceBadge level={confidence("data")!} />}
                  </div>
                  <Input type="date" value={form.data} onChange={set("data")} />
                  {preview.data?.source && <p className="text-[11px] text-muted-foreground mt-0.5">{preview.data.source}</p>}
                </div>

                {/* Settore */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.settore}</Label>
                    {confidence("settore") && <ConfidenceBadge level={confidence("settore")!} />}
                  </div>
                  <Input value={form.settore} onChange={set("settore")} />
                  {preview.settore?.source && <p className="text-[11px] text-muted-foreground mt-0.5">{preview.settore.source}</p>}
                </div>

                {/* Ora inizio */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.oraInizio}</Label>
                    {confidence("oraInizio") && <ConfidenceBadge level={confidence("oraInizio")!} />}
                  </div>
                  <Input type="time" value={form.oraInizio} onChange={set("oraInizio")} />
                </div>

                {/* Ora fine */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.oraFine}</Label>
                    {confidence("oraFine") && <ConfidenceBadge level={confidence("oraFine")!} />}
                  </div>
                  <Input type="time" value={form.oraFine} onChange={set("oraFine")} />
                </div>

                {/* Meteo */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.condMeteo}</Label>
                    {confidence("condMeteo") && <ConfidenceBadge level={confidence("condMeteo")!} />}
                  </div>
                  <Select value={form.condMeteo} onValueChange={(v) => setForm((f) => ({ ...f, condMeteo: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleziona meteo" /></SelectTrigger>
                    <SelectContent>
                      {meteOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Tipo scavo */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS.tipoScavo}</Label>
                    {confidence("tipoScavo") && <ConfidenceBadge level={confidence("tipoScavo")!} />}
                  </div>
                  <Select value={form.tipoScavo} onValueChange={(v) => setForm((f) => ({ ...f, tipoScavo: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleziona tipo scavo" /></SelectTrigger>
                    <SelectContent>
                      {tipoScavoOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Personale */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(["archeologoCoordinatore", "topografo", "archeologi", "scavatori", "escavatore"] as const).map((key) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-1">
                      <Label>{FIELD_LABELS[key]}</Label>
                      {confidence(key) && <ConfidenceBadge level={confidence(key)!} />}
                    </div>
                    <Input
                      value={form[key as keyof GiornataForm] as string}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                    {(preview[key] as AiField | undefined)?.source && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {(preview[key] as AiField).source}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Testi lunghi */}
              {(["obiettivo", "attivitaSvolta", "note"] as const).map((key) => (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>{FIELD_LABELS[key]}</Label>
                    {confidence(key) && <ConfidenceBadge level={confidence(key)!} />}
                  </div>
                  <Textarea
                    rows={3}
                    value={form[key as keyof GiornataForm] as string}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                  {(preview[key] as AiField | undefined)?.source && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {(preview[key] as AiField).source}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-muted/10 px-4 py-3 flex justify-between gap-2">
          {phase === "review" && (
            <Button variant="outline" onClick={() => { reset(); }}>
              Ricarica file
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" onClick={() => handleClose(false)}>Annulla</Button>
            {phase === "review" && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvataggio…</> : "Crea giornata"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
