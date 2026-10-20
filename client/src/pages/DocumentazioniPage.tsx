import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  Link2, Plus, FileText, Loader2, ArrowUp, ArrowDown,
  Trash2, Download, Image, Upload, FolderOpen, X, Stethoscope, CheckCircle2, AlertCircle,
  ExternalLink, FolderCog, RefreshCcw, Copy,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { GoogleSyncReviewDialog } from "@/components/giornata/GoogleSyncReviewDialog";
import { GiornataDocxImportDialog } from "@/components/giornata/GiornataDocxImportDialog";
import { GiornaleImportDialog } from "@/components/giornata/GiornaleImportDialog";
import {
  parseLastSyncSummary,
  seedGoogleDecisionState,
  withGoogleDecisionAction,
  withGoogleSchedaOverride,
  withGoogleTopFieldOverride,
} from "@/components/giornata/googleSyncState";
import type {
  GoogleSyncApplyReport,
  GoogleSyncDecisionState,
  GoogleSyncPreview,
} from "@/components/giornata/types";
import { useToast as useToastGlobal } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type DocumentazioneTipo = "giornaliera" | "settimanale" | "fine_scavo";

type DocumentazioneRecord = {
  id: number;
  cantiereId: number;
  tipo: DocumentazioneTipo;
  titolo: string;
  dataInizio: string | null;
  dataFine: string | null;
  stato: "bozza" | "completata";
  allegatoId: number | null;
  createdAt: string;
  updatedAt: string;
  allegato?: { id: number; nomeFile: string; url: string } | null;
};

type MapSnapshotRecord = {
  id: number;
  titolo: string;
  didascalia: string | null;
  url: string;
  createdAt: string;
};

type DocumentazioneSnapshotLink = {
  documentazioneId: number;
  snapshotId: number;
  posizione: number;
  snapshot: MapSnapshotRecord;
};

type DocumentazioneDetailResponse = {
  documentazione: DocumentazioneRecord;
  snapshots: DocumentazioneSnapshotLink[];
};

type ImgFile = { name: string; url: string };
type TemplateFile = { name: string; label: string; ext: string; uso: string; url: string };

const USO_OPTIONS = [
  { value: "report_settimanale", label: "Report settimanale" },
  { value: "us", label: "Scheda US" },
  { value: "ra", label: "Scheda RA" },
  { value: "giornale", label: "Giornale di scavo" },
  { value: "fine_scavo", label: "Relazione fine scavo" },
  { value: "altro", label: "Altro" },
];

type Tab = "documentazioni" | "google" | "immagini" | "template";

function tipoLabel(tipo: DocumentazioneTipo): string {
  if (tipo === "giornaliera") return "Giornaliera";
  if (tipo === "settimanale") return "Settimanale";
  return "Fine scavo";
}

// ─── TAB: Immagini ────────────────────────────────────────────────────────────

function ImmaginiTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const imgsQuery = useQuery<{ images: ImgFile[] }>({
    queryKey: ["/api/project/img"],
    queryFn: async () => (await apiRequest("GET", "/api/project/img")).json(),
  });

  const images = imgsQuery.data?.images || [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/project/img", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project/img"] });
      toast({ title: "Immagine caricata" });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("DELETE", `/api/project/img/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project/img"] });
      toast({ title: "Immagine eliminata" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Le immagini caricate qui vengono usate automaticamente nelle copertine dei report settimanali (modello personalizzato). La prima in ordine alfabetico compare come immagine d'area.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Carica nuova immagine</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="text-sm file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:text-sm file:bg-primary file:text-primary-foreground cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
              }}
            />
            {uploadMutation.isPending && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-sm font-medium">Immagini salvate ({images.length})</div>
        {imgsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento...</div>
        ) : images.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nessuna immagine caricata.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((img) => (
              <div key={img.name} className="rounded border border-border overflow-hidden group relative">
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full h-32 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="px-2 py-1.5 bg-muted/60 flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1" title={img.name}>{img.name}</span>
                  <button
                    onClick={() => deleteMutation.mutate(img.name)}
                    disabled={deleteMutation.isPending}
                    className="text-destructive hover:text-destructive/80 shrink-0"
                    title="Elimina"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB: Template ────────────────────────────────────────────────────────────

type DiagnosticsResult = {
  found: boolean;
  reason?: string;
  templateFile?: string;
  type?: string;
  tags?: Record<string, unknown>;
  availableVars?: string[];
  error?: string;
};

const AVAILABLE_VARS = [
  "nome_commessa","luogo","provincia","committente","data_inizio_wk","data_fine_wk",
  "data_relazione","settimana","archeologo_coordinatore","archeologi",
  "scavatori","topografo","escavatore","obiettivo","dettaglio_attivita",
  // alias
  "nome_archeologo_coord","nome_archeologi","nome_topografo","nome_ditta","nome_scavatori",
];

const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  nome_commessa: "Nome del cantiere/commessa",
  codice_cantiere: "Codice identificativo cantiere",
  luogo: "Località del cantiere",
  provincia: "Provincia",
  committente: "Committente/cliente",
  responsabile: "Responsabile di progetto",
  direttore_scavo: "Direttore di scavo",
  responsabile_sabap: "Responsabile SABAP",
  responsabile_scavo: "Responsabile dello scavo",
  data_inizio_wk: "Data inizio settimana",
  data_fine_wk: "Data fine settimana",
  data_relazione: "Data della relazione",
  settimana: 'Periodo (es. "05/05 – 11/05/2026")',
  archeologo_coordinatore: "Archeologo coordinatore",
  archeologi: "Lista archeologi",
  scavatori: "Lista scavatori",
  topografo: "Topografo",
  escavatore: "Escavatore meccanico",
  obiettivo: "Obiettivo della settimana",
  dettaglio_attivita: "Dettaglio attività giornaliero",
  nome_direttore: "Alias: Direttore di scavo",
  nome_archeologo_coord: "Alias: Archeologo coordinatore",
  nome_archeologi: "Alias: Lista archeologi",
  nome_topografo: "Alias: Topografo",
  nome_ditta: "Alias: Committente/ditta",
  nome_scavatori: "Alias: Lista scavatori",
};

type PlaceholdersResponse = { placeholders: Record<string, string>; keys: string[] };

function PlaceholderGuideCard({ cantiereId }: { cantiereId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<PlaceholdersResponse>({
    queryKey: [`/api/cantieri/${cantiereId}/report/placeholders`],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/report/placeholders`)).json(),
    enabled: open,
  });

  const copyTag = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`).then(() => {
      toast({ title: `Copiato: {{${key}}}` });
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Crea il tuo template</CardTitle>
          <div className="flex items-center gap-2">
            <a
              href={`/api/cantieri/${cantiereId}/report/placeholder-template`}
              download="placeholder_template.docx"
              className="inline-flex items-center gap-1.5 text-xs rounded border border-border px-2.5 py-1 hover:bg-muted"
            >
              <Download size={12} />
              Scarica DOCX esempio
            </a>
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} className="gap-1.5 text-xs">
              {open ? "Chiudi" : "Mostra placeholder"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Inserisci questi tag nel tuo documento Word. Verranno sostituiti con i dati reali all'export. Clicca su un tag per copiarlo.
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Caricamento valori...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground w-48">Placeholder</th>
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Descrizione</th>
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Valore attuale</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.keys || Object.keys(PLACEHOLDER_DESCRIPTIONS)).map((key) => (
                    <tr key={key} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 pr-3">
                        <button
                          onClick={() => copyTag(key)}
                          className="inline-flex items-center gap-1 font-mono bg-muted px-1.5 py-0.5 rounded hover:bg-primary/10 hover:text-primary transition-colors"
                          title="Clicca per copiare"
                        >
                          <Copy size={10} />
                          {`{{${key}}}`}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{PLACEHOLDER_DESCRIPTIONS[key] || ""}</td>
                      <td className="py-1.5 text-muted-foreground truncate max-w-[200px]">
                        {data?.placeholders[key] ? (
                          <span className="text-foreground">{data.placeholders[key]}</span>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function TemplateTab({ cantiereId }: { cantiereId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateUso, setTemplateUso] = useState("report_settimanale");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const templatesQuery = useQuery<{ templates: TemplateFile[] }>({
    queryKey: ["/api/project/templates"],
    queryFn: async () => (await apiRequest("GET", "/api/project/templates")).json(),
  });

  const templates = templatesQuery.data?.templates || [];

  const uploadMutation = useMutation({
    mutationFn: async ({ file, name, uso }: { file: File; name: string; uso: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim() || file.name.replace(/\.[^.]+$/, ""));
      fd.append("uso", uso);
      const res = await fetch("/api/project/templates", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project/templates"] });
      toast({ title: "Template caricato" });
      setTemplateName("");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e?.message, variant: "destructive" }),
  });

  const patchUsoMutation = useMutation({
    mutationFn: async ({ name, uso }: { name: string; uso: string }) => {
      const res = await apiRequest("PATCH", `/api/project/templates/${encodeURIComponent(name)}`, { uso });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/project/templates"] }),
    onError: (e: any) => toast({ title: "Errore aggiornamento uso", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("DELETE", `/api/project/templates/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project/templates"] });
      toast({ title: "Template eliminato" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e?.message, variant: "destructive" }),
  });

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast({ title: "Seleziona un file", variant: "destructive" });
    uploadMutation.mutate({ file, name: templateName, uso: templateUso });
  };

  const runDiagnostics = async () => {
    setDiagLoading(true);
    setDiagnostics(null);
    try {
      const res = await apiRequest("GET", `/api/cantieri/${cantiereId}/giornale/template-diagnostics`);
      setDiagnostics(await res.json());
    } catch (e: any) {
      setDiagnostics({ found: false, reason: e?.message || "Errore di rete" });
    } finally {
      setDiagLoading(false);
    }
  };

  const usoLabel = (uso: string) => USO_OPTIONS.find((o) => o.value === uso)?.label || uso;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          I template sono documenti Markdown/TXT con placeholder <code className="text-xs bg-muted px-1 rounded">{"{nome_commessa}"}</code> che vengono sostituiti con i dati reali all'export. Assegna l'<strong>uso</strong> per indicare a quale tipo di export appartiene.
        </p>
        <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-1">
          <div className="font-medium">Placeholder disponibili per report_settimanale:</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            {["{nome_commessa}","{luogo}","{provincia}","{committente}","{data_inizio_wk}","{data_fine_wk}","{data_relazione}","{settimana}","{archeologo_coordinatore}","{archeologi}","{scavatori}","{topografo}","{escavatore}","{obiettivo}","{dettaglio_attivita}",
              "— alias —","{nome_archeologo_coord}","{nome_archeologi}","{nome_topografo}","{nome_ditta}","{nome_scavatori}"].map((p) => (
              <span key={p} className={p.startsWith("—") ? "col-span-2 text-muted-foreground mt-1" : ""}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Carica nuovo template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome template</Label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Es. report_settimanale"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Uso</Label>
              <select
                value={templateUso}
                onChange={(e) => setTemplateUso(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {USO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.docx,.odt"
              className="text-sm file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:text-sm file:bg-primary file:text-primary-foreground cursor-pointer flex-1"
            />
            <Button onClick={handleUpload} disabled={uploadMutation.isPending} className="gap-2 shrink-0">
              {uploadMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Carica
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-sm font-medium">Template salvati ({templates.length})</div>
        {templatesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento...</div>
        ) : templates.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nessun template caricato. Carica un file .md o .txt con i placeholder sopra indicati.</div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.name} · {t.ext.toUpperCase()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={t.uso}
                    onChange={(e) => patchUsoMutation.mutate({ name: t.name, uso: e.target.value })}
                    className="text-xs rounded border border-input bg-background px-1.5 py-1"
                    title="Cambia uso template"
                  >
                    {USO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <Badge variant={t.uso === "report_settimanale" ? "default" : "secondary"} className="text-xs">
                    {usoLabel(t.uso)}
                  </Badge>
                  <a
                    href={t.url}
                    download
                    className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                    title="Scarica"
                  >
                    <Download size={12} />
                  </a>
                  <button
                    onClick={() => deleteMutation.mutate(t.name)}
                    disabled={deleteMutation.isPending}
                    className="text-destructive hover:text-destructive/80"
                    title="Elimina"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sezione: Crea il tuo template */}
      <PlaceholderGuideCard cantiereId={cantiereId} />

      {/* Pannello diagnostica DOCX */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Stethoscope size={14} />
              Diagnostica template DOCX
            </CardTitle>
            <Button size="sm" variant="outline" onClick={runDiagnostics} disabled={diagLoading} className="gap-1.5">
              {diagLoading ? <Loader2 size={12} className="animate-spin" /> : <Stethoscope size={12} />}
              Verifica
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!diagnostics && !diagLoading && (
            <p className="text-xs text-muted-foreground">
              Clicca "Verifica" per controllare se il template caricato riconosce correttamente i placeholder.
            </p>
          )}
          {diagLoading && <p className="text-xs text-muted-foreground">Analisi in corso...</p>}
          {diagnostics && !diagnostics.found && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Template non trovato</div>
                <div className="text-muted-foreground mt-0.5">{diagnostics.reason}</div>
              </div>
            </div>
          )}
          {diagnostics?.found && diagnostics.type === "md/txt" && (
            <div className="flex items-start gap-2 text-xs text-green-700">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <div>Template testuale (.md/.txt) — i placeholder vengono sostituiti con regex, nessuna analisi aggiuntiva necessaria.</div>
            </div>
          )}
          {diagnostics?.found && diagnostics.type === "docx" && (
            <div className="space-y-3">
              {diagnostics.error ? (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Errore analisi DOCX</div>
                    <div className="font-mono mt-0.5 text-muted-foreground">{diagnostics.error}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-xs font-medium">File: <span className="font-mono">{diagnostics.templateFile}</span></div>
                  <div>
                    <div className="text-xs font-medium mb-1">Placeholder trovati nel DOCX:</div>
                    {Object.keys(diagnostics.tags || {}).length === 0 ? (
                      <div className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle size={12} />
                        Nessun placeholder trovato. Probabile causa: Word ha spezzato il testo in più parti nell'XML.
                        Riscrivi il template con LibreOffice Writer e salva di nuovo come .docx.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(diagnostics.tags || {}).map((tag) => {
                          const ok = AVAILABLE_VARS.includes(tag);
                          return (
                            <span key={tag} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-mono ${ok ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                              {ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                              {"{" + tag + "}"}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-1">Variabili disponibili non usate nel template:</div>
                    <div className="flex flex-wrap gap-1">
                      {AVAILABLE_VARS.filter((v) => !Object.keys(diagnostics.tags || {}).includes(v)).map((v) => (
                        <span key={v} className="text-xs px-1.5 py-0.5 rounded font-mono bg-muted text-muted-foreground">
                          {"{" + v + "}"}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB: Documentazioni (snapshot WebMap) ────────────────────────────────────

function DocumentazioniTab({ cantiereId }: { cantiereId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<DocumentazioneTipo>("giornaliera");
  const [titolo, setTitolo] = useState("");
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [posizione, setPosizione] = useState("");

  const docsQuery = useQuery<{ documentazioni: DocumentazioneRecord[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni`)).json(),
    enabled: Number.isFinite(cantiereId),
  });

  const snapshotsQuery = useQuery<{ snapshots: MapSnapshotRecord[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "map-snapshots"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/map-snapshots`)).json(),
    enabled: Number.isFinite(cantiereId),
  });

  const detailQuery = useQuery<DocumentazioneDetailResponse>({
    queryKey: ["/api/cantieri", String(cantiereId), "documentazioni", String(selectedId)],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni/${selectedId}`)).json(),
    enabled: Number.isFinite(cantiereId) && !!selectedId,
  });

  const documentazioni = docsQuery.data?.documentazioni || [];
  const allSnapshots = snapshotsQuery.data?.snapshots || [];
  const linkedSnapshots = detailQuery.data?.snapshots || [];

  useEffect(() => {
    if (!selectedId && documentazioni.length > 0) setSelectedId(documentazioni[0].id);
  }, [documentazioni, selectedId]);

  const orderedLinks = useMemo(() => [...linkedSnapshots].sort((a, b) => a.posizione - b.posizione), [linkedSnapshots]);

  const availableSnapshots = useMemo(() => {
    const linked = new Set(linkedSnapshots.map((l) => l.snapshotId));
    return allSnapshots.filter((s) => !linked.has(s.id));
  }, [allSnapshots, linkedSnapshots]);

  useEffect(() => {
    setSelectedSnapshotId(availableSnapshots.length > 0 ? availableSnapshots[0].id : null);
  }, [selectedId, availableSnapshots.length]);

  const invalidateAll = async (docId?: number | null) => {
    const id = docId !== undefined ? docId : selectedId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] }),
      ...(id != null
        ? [queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni", String(id)] })]
        : []),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni`, {
        tipo,
        titolo: titolo.trim() || null,
        dataInizio: dataInizio || null,
        dataFine: dataFine || null,
      })).json(),
    onSuccess: async (data: any) => {
      await invalidateAll();
      const createdId = Number(data?.documentazione?.id);
      if (Number.isFinite(createdId)) setSelectedId(createdId);
      setTitolo("");
      toast({ title: "Documentazione creata" });
    },
    onError: (e: any) => toast({ title: "Errore creazione", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/cantieri/${cantiereId}/documentazioni/${id}`); },
    onSuccess: async (_data, id) => {
      await invalidateAll(id);
      if (selectedId === id) setSelectedId(null);
      toast({ title: "Documentazione eliminata" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e?.message, variant: "destructive" }),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Seleziona una documentazione");
      if (!selectedSnapshotId) throw new Error("Seleziona uno snapshot");
      const positionValue = Number(posizione);
      return (await apiRequest("POST", `/api/documentazioni/${selectedId}/snapshots`, {
        snapshotId: selectedSnapshotId,
        posizione: Number.isFinite(positionValue) ? Math.trunc(positionValue) : undefined,
      })).json();
    },
    onSuccess: async () => { await invalidateAll(); setPosizione(""); toast({ title: "Snapshot collegato" }); },
    onError: (e: any) => toast({ title: "Errore collegamento", description: e?.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (snapshotId: number) => {
      if (!selectedId) throw new Error("Documentazione non selezionata");
      await apiRequest("DELETE", `/api/documentazioni/${selectedId}/snapshots/${snapshotId}`);
    },
    onSuccess: async () => { await invalidateAll(); toast({ title: "Snapshot rimosso" }); },
    onError: (e: any) => toast({ title: "Errore rimozione", description: e?.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ snapshotId, newIndex }: { snapshotId: number; newIndex: number }) => {
      if (!selectedId) throw new Error("Documentazione non selezionata");
      const reordered = [...orderedLinks];
      const currentIndex = reordered.findIndex((l) => l.snapshotId === snapshotId);
      if (currentIndex === -1) return;
      const [item] = reordered.splice(currentIndex, 1);
      reordered.splice(newIndex, 0, item);
      await Promise.all(
        reordered.map((entry, idx) =>
          apiRequest("PATCH", `/api/documentazioni/${selectedId}/snapshots/${entry.snapshotId}`, { posizione: (idx + 1) * 10 }),
        ),
      );
    },
    onSuccess: async () => { await invalidateAll(); },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Seleziona una documentazione");
      return (await apiRequest("POST", `/api/documentazioni/${selectedId}/genera-docx`, {})).json();
    },
    onSuccess: async (data: any) => {
      await invalidateAll();
      const warnings = Number(data?.warnings?.length || 0);
      toast({ title: "DOCX generato", description: warnings > 0 ? `Generato con ${warnings} avviso/i` : "Documento aggiornato" });
    },
    onError: (e: any) => toast({ title: "Errore generazione DOCX", description: e?.message, variant: "destructive" }),
  });

  const selectedDetail = detailQuery.data?.documentazione;

  return (
    <div className="grid grid-cols-[300px_1fr] gap-4 min-h-[60vh]">
      {/* Colonna sinistra */}
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nuova documentazione</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Tipo</Label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as DocumentazioneTipo)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="giornaliera">Giornaliera</option>
              <option value="settimanale">Settimanale</option>
              <option value="fine_scavo">Fine scavo</option>
            </select>
          </div>
          <div>
            <Label>Titolo</Label>
            <Input value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Titolo (opzionale)" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Data inizio</Label>
              <Input type="date" value={dataInizio} onChange={(e) => setDataInizio(e.target.value)} />
            </div>
            <div>
              <Label>Data fine</Label>
              <Input type="date" value={dataFine} onChange={(e) => setDataFine(e.target.value)} />
            </div>
          </div>
          <Button className="w-full gap-2" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Crea bozza
          </Button>

          <div className="pt-3 border-t border-border space-y-1 max-h-[320px] overflow-y-auto">
            <div className="text-xs font-medium text-muted-foreground mb-2">Documentazioni cantiere</div>
            {documentazioni.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setSelectedId(doc.id)}
                className={`w-full text-left rounded border px-2 py-2 text-sm ${
                  selectedId === doc.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                <div className="font-medium truncate">{doc.titolo}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-between mt-0.5">
                  <span>{tipoLabel(doc.tipo)}</span>
                  <span>{doc.stato}</span>
                </div>
              </button>
            ))}
            {!docsQuery.isLoading && documentazioni.length === 0 && (
              <div className="text-xs text-muted-foreground">Nessuna documentazione disponibile.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Colonna destra */}
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dettaglio documentazione</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedId ? (
            <div className="text-sm text-muted-foreground">Seleziona o crea una documentazione dalla lista a sinistra.</div>
          ) : detailQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Caricamento...</div>
          ) : !selectedDetail ? (
            <div className="text-sm text-muted-foreground">Documentazione non trovata.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{selectedDetail.titolo}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {selectedDetail.dataInizio || "-"}
                    {selectedDetail.dataFine ? ` → ${selectedDetail.dataFine}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{tipoLabel(selectedDetail.tipo)}</Badge>
                  <Badge variant={selectedDetail.stato === "completata" ? "default" : "outline"}>{selectedDetail.stato}</Badge>
                  <Button variant="destructive" size="sm" className="gap-1"
                    onClick={() => deleteMutation.mutate(selectedDetail.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={12} /> Elimina
                  </Button>
                </div>
              </div>

              <div className="rounded border border-border p-3 space-y-2">
                <div className="text-sm font-medium">Collega snapshot WebMap</div>
                <p className="text-xs text-muted-foreground">
                  Gli snapshot sono le mappe salvate dalla pagina WebMap. Puoi collegarli a questa documentazione e ordinarli.
                </p>
                <div className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
                  <div>
                    <Label>Snapshot</Label>
                    <select
                      value={selectedSnapshotId ?? ""}
                      onChange={(e) => setSelectedSnapshotId(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="" disabled>Seleziona...</option>
                      {availableSnapshots.map((s) => (
                        <option key={s.id} value={s.id}>{s.titolo}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Posizione</Label>
                    <Input value={posizione} onChange={(e) => setPosizione(e.target.value)} placeholder="10" />
                  </div>
                  <Button className="gap-1" onClick={() => linkMutation.mutate()} disabled={!selectedSnapshotId || linkMutation.isPending}>
                    {linkMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    Collega
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Snapshot inclusi ({orderedLinks.length})</div>
                {orderedLinks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nessuno snapshot collegato.</div>
                ) : (
                  <div className="space-y-2">
                    {orderedLinks.map((entry, idx) => (
                      <div key={entry.snapshotId} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate">{entry.snapshot.titolo}</div>
                          <div className="text-xs text-muted-foreground">
                            #{idx + 1} · {new Date(entry.snapshot.createdAt).toLocaleString("it-IT")}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 px-2"
                            onClick={() => reorderMutation.mutate({ snapshotId: entry.snapshotId, newIndex: idx - 1 })}
                            disabled={reorderMutation.isPending || idx === 0}
                          >
                            <ArrowUp size={12} />
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2"
                            onClick={() => reorderMutation.mutate({ snapshotId: entry.snapshotId, newIndex: idx + 1 })}
                            disabled={reorderMutation.isPending || idx === orderedLinks.length - 1}
                          >
                            <ArrowDown size={12} />
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 px-2"
                            onClick={() => unlinkMutation.mutate(entry.snapshotId)}
                            disabled={unlinkMutation.isPending}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded border border-border p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Genera DOCX</div>
                  <div className="text-xs text-muted-foreground">
                    Crea un documento Word con tutti gli snapshot nell'ordine impostato.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedDetail.allegato?.url && (
                    <a href={selectedDetail.allegato.url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                    >
                      <Download size={12} /> Apri DOCX
                    </a>
                  )}
                  <Button className="gap-2"
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending || orderedLinks.length === 0}
                  >
                    {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    Genera DOCX
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB: Google Drive ────────────────────────────────────────────────────────

function GoogleDriveTab({ cantiereId }: { cantiereId: number }) {
  const { toast } = useToastGlobal();
  const queryClient = useQueryClient();

  const [googleReviewOpen, setGoogleReviewOpen] = useState(false);
  const [googlePreview, setGooglePreview] = useState<GoogleSyncPreview | null>(null);
  const [googleDecisions, setGoogleDecisions] = useState<Record<string, GoogleSyncDecisionState>>({});
  const [docxImportOpen, setDocxImportOpen] = useState(false);
  const [giornaleImportOpen, setGiornaleImportOpen] = useState(false);

  const cantiereQuery = useQuery<any[]>({
    queryKey: ["/api/cantieri"],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });
  const cantiere = (cantiereQuery.data || []).find((c: any) => c.id === cantiereId);

  function parseGoogleErrorMessage(error: any): string {
    const raw: string = error?.message || String(error || "Errore sconosciuto");
    const jsonStart = raw.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart));
        return parsed?.error || parsed?.message || raw;
      } catch { /* ignore */ }
    }
    return raw;
  }

  const setupGoogle = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/cantieri/${cantiereId}/google/setup`, {});
      return r.json() as Promise<{ ok: boolean; reused: boolean; folderUrl: string; docUrl: string }>;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri"] });
      toast({ title: data.reused ? "Collegamento Google già presente" : "Google configurato per il cantiere", description: "Documento giornale pronto su Google Docs." });
    },
    onError: (error: any) => toast({ title: "Errore setup Google", description: parseGoogleErrorMessage(error), variant: "destructive" }),
  });

  const previewGoogleSync = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/cantieri/${cantiereId}/google/sync`, { apply: false });
      return r.json() as Promise<{ mode: "preview"; preview: GoogleSyncPreview }>;
    },
    onSuccess: (payload) => {
      setGooglePreview(payload.preview);
      setGoogleDecisions(seedGoogleDecisionState(payload.preview));
      setGoogleReviewOpen(true);
      toast({ title: "Anteprima sincronizzazione pronta", description: `${payload.preview.items.length} schede US da revisionare.` });
    },
    onError: (error: any) => toast({ title: "Errore lettura Google Docs", description: parseGoogleErrorMessage(error), variant: "destructive" }),
  });

  const applyGoogleSync = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/cantieri/${cantiereId}/google/sync`, { apply: true, preview: googlePreview, decisions: googleDecisions });
      return r.json() as Promise<{ mode: "applied"; lastSyncAt: string; report: GoogleSyncApplyReport }>;
    },
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri"] });
      setGoogleReviewOpen(false);
      toast({
        title: "Sync Google completato",
        description: `Create: ${payload.report.created}, Aggiornate: ${payload.report.updated}, Invariate: ${payload.report.unchanged}, Saltate: ${payload.report.skipped}.`,
      });
    },
    onError: (error: any) => toast({ title: "Errore apply sync", description: parseGoogleErrorMessage(error), variant: "destructive" }),
  });

  const lastSyncSummary = parseLastSyncSummary(cantiere?.lastSyncReport);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Google Drive</p>
              <p className="text-sm text-muted-foreground">
                Collega il cantiere a un giornale Google Docs strutturato e sincronizza le US.
              </p>
            </div>
            {!cantiere?.googleDocId ? (
              <Button variant="outline" className="gap-2" onClick={() => setupGoogle.mutate()} disabled={setupGoogle.isPending}>
                <FolderCog size={14} />
                {setupGoogle.isPending ? "Setup..." : "Setup Google"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" className="gap-2" onClick={() => previewGoogleSync.mutate()} disabled={previewGoogleSync.isPending}>
                  <RefreshCcw size={14} />
                  {previewGoogleSync.isPending ? "Sync..." : "Sincronizza ora"}
                </Button>
                <a href={`https://docs.google.com/document/d/${cantiere.googleDocId}/edit`} target="_blank" rel="noreferrer">
                  <Button variant="ghost" className="gap-2">
                    <ExternalLink size={14} />
                    Apri documento
                  </Button>
                </a>
              </div>
            )}
          </div>
          {cantiere?.googleFolderId && (
            <p className="text-sm">
              Cartella:{" "}
              <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://drive.google.com/drive/folders/${cantiere.googleFolderId}`}>
                apri su Drive
              </a>
            </p>
          )}
          {cantiere?.googleDocId && (
            <p className="text-sm">
              Documento:{" "}
              <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://docs.google.com/document/d/${cantiere.googleDocId}/edit`}>
                apri su Google Docs
              </a>
            </p>
          )}
          {cantiere?.lastSyncAt && (
            <p className="text-sm text-muted-foreground">Ultimo sync: {new Date(cantiere.lastSyncAt).toLocaleString("it-IT")}</p>
          )}
          {lastSyncSummary && (
            <p className="text-sm text-muted-foreground">
              Ultimo report: {lastSyncSummary.created || 0} create · {lastSyncSummary.updated || 0} aggiornate · {lastSyncSummary.skipped || 0} saltate.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={() => setGiornaleImportOpen(true)}>
          <FileText size={14} /> Import giornale Google
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => setDocxImportOpen(true)}>
          <FileText size={14} /> Importa da DOCX
        </Button>
      </div>

      <GoogleSyncReviewDialog
        open={googleReviewOpen}
        preview={googlePreview}
        decisions={googleDecisions}
        applyPending={applyGoogleSync.isPending}
        onOpenChange={setGoogleReviewOpen}
        onActionChange={(key, action) => setGoogleDecisions((prev) => withGoogleDecisionAction(prev, key, action))}
        onTopFieldOverride={(key, field, value) => setGoogleDecisions((prev) => withGoogleTopFieldOverride(prev, key, field, value))}
        onSchedaOverride={(key, fieldKey, value) => setGoogleDecisions((prev) => withGoogleSchedaOverride(prev, key, fieldKey, value))}
        onApply={() => applyGoogleSync.mutate()}
      />

      <GiornataDocxImportDialog
        open={docxImportOpen}
        onOpenChange={setDocxImportOpen}
        cantiereId={cantiereId}
        projectId={getCurrentProjectId() || ""}
        onCreated={() => setDocxImportOpen(false)}
      />

      <GiornaleImportDialog
        open={giornaleImportOpen}
        onClose={() => setGiornaleImportOpen(false)}
        cantiereId={cantiereId}
        onSuccess={() => {}}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "documentazioni", label: "Documentazioni WebMap", icon: FileText },
  { id: "google", label: "Google Drive", icon: FolderCog },
  { id: "immagini", label: "Immagini progetto", icon: Image },
  { id: "template", label: "Template report", icon: FolderOpen },
];

export function DocumentazioniPage() {
  const { cid } = useParams<{ cid: string }>();
  const cantiereId = Number(cid);
  const [activeTab, setActiveTab] = useState<Tab>("documentazioni");

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Documentazioni e risorse</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestisci le documentazioni con snapshot WebMap, le immagini per i report e i template di documento.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "documentazioni" && <DocumentazioniTab cantiereId={cantiereId} />}
      {activeTab === "google" && <GoogleDriveTab cantiereId={cantiereId} />}
      {activeTab === "immagini" && <ImmaginiTab />}
      {activeTab === "template" && <TemplateTab cantiereId={cantiereId} />}
    </div>
  );
}
