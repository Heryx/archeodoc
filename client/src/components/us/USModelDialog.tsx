import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BASE_US_MODEL_KEY, type USModelDefinition } from "@shared/us_models";
import { Upload, Trash2, FileCheck, Pencil, Check, X, ChevronDown, ChevronRight, FileX } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";

type TemplateInfo = { exists: boolean; sizeBytes?: number; updatedAt?: string; modelKey?: string };

type USModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: string | undefined;
  modelDraftKey: string;
  activeModelKey: string;
  availableModels: USModelDefinition[];
  isUsModelsLoading: boolean;
  isCantiereModelLoading: boolean;
  usModelsError: unknown;
  cantiereModelError: unknown;
  applyPending: boolean;
  applyError: boolean;
  onSelectModel: (modelKey: string) => void;
  currentDraftModel?: USModelDefinition;
  canDeleteDraftModel: boolean;
  deleteCustomModelPending: boolean;
  onDeleteDraftModel: () => void;
  customModelName: string;
  setCustomModelName: (value: string) => void;
  customModelDescription: string;
  setCustomModelDescription: (value: string) => void;
  customModelFieldsRaw: string;
  setCustomModelFieldsRaw: (value: string) => void;
  createCustomModelPending: boolean;
  onCreateCustomModel: () => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Errore sconosciuto";
}

function syncDescription(sync: { added: string[]; removed: string[]; total: number }): string {
  const parts = [`La scheda mostra ora ${sync.total} voci del template`];
  if (sync.added.length) parts.push(`${sync.added.length} aggiunte`);
  if (sync.removed.length) parts.push(`${sync.removed.length} rimosse`);
  return parts.join(" · ");
}

/** Sezione template per un singolo modello (o il template generico se modelKey === "generic"). */
function ModelTemplateSection({
  cid,
  modelKey,
  modelName,
  isGeneric,
  onModelCreated,
}: {
  cid: string;
  modelKey: string;
  modelName: string;
  isGeneric?: boolean;
  onModelCreated?: (model: USModelDefinition) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeProjectId = getCurrentProjectId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[] | null>(null);
  const [templateModelName, setTemplateModelName] = useState("");

  const endpoint = isGeneric
    ? `/api/cantieri/${cid}/us-template`
    : `/api/cantieri/${cid}/us-template/${encodeURIComponent(modelKey)}`;

  const { data: templateInfo, refetch: refetchTemplate } = useQuery<TemplateInfo>({
    queryKey: ["us-template", cid, isGeneric ? "generic" : modelKey],
    queryFn: async () => (await apiRequest("GET", endpoint)).json(),
    staleTime: 0,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("template", file);
      const res = await fetch(`${endpoint}?projectId=${encodeURIComponent(activeProjectId || "")}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore upload");
      return res.json();
    },
    onSuccess: (data: { sync?: { added: string[]; removed: string[]; total: number } | null; syncError?: string }) => {
      void refetchTemplate();
      if (data?.sync) {
        refreshModels();
        toast({ title: "Template caricato", description: syncDescription(data.sync) });
      } else if (data?.syncError) {
        toast({ title: "Template caricato", description: `Voci del modello non aggiornate: ${data.syncError}`, variant: "destructive" });
      } else {
        toast({ title: "Template caricato" });
      }
      setTimeout(() => { void fetchPlaceholders(); }, 600);
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e.message, variant: "destructive" }),
  });

  const refreshModels = () => {
    qc.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
    qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${endpoint}/sync-model`);
      if (!res.ok) throw new Error((await res.json()).error || "Errore");
      return res.json() as Promise<{ added: string[]; removed: string[]; total: number }>;
    },
    onSuccess: (data) => {
      refreshModels();
      toast({ title: "Voci della scheda aggiornate", description: syncDescription(data) });
    },
    onError: (e: any) => toast({ title: "Errore aggiornamento voci", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", endpoint);
      if (!res.ok) throw new Error((await res.json()).error || "Errore eliminazione");
      return res.json();
    },
    onSuccess: () => {
      void refetchTemplate();
      setDetectedPlaceholders(null);
      toast({ title: "Template rimosso" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e.message, variant: "destructive" }),
  });

  const createFromTemplateMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/cantieri/${cid}/us-template/create-model`, { name });
      if (!res.ok) throw new Error((await res.json()).error || "Errore");
      return res.json() as Promise<{ model: USModelDefinition; detectedPlaceholders: string[] }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      setDetectedPlaceholders(data.detectedPlaceholders);
      setTemplateModelName("");
      onModelCreated?.(data.model);
      toast({
        title: `Modello "${data.model.name}" creato`,
        description: `${data.detectedPlaceholders.length} placeholder rilevati — template associato al modello`,
      });
    },
    onError: (e: any) => toast({ title: "Errore creazione modello da template", description: e?.message, variant: "destructive" }),
  });

  const fetchPlaceholders = async () => {
    try {
      const placeholderEndpoint = isGeneric
        ? `/api/cantieri/${cid}/us-template/placeholders`
        : `/api/cantieri/${cid}/us-template/${encodeURIComponent(modelKey)}/placeholders`;
      const res = await apiRequest("GET", placeholderEndpoint);
      const data = await res.json() as { tags: Record<string, unknown> };
      setDetectedPlaceholders(Object.keys(data.tags || {}));
    } catch {
      setDetectedPlaceholders(null);
    }
  };

  const templateFilename = isGeneric
    ? "template_us.docx"
    : `template_us_${modelKey}.docx`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {isGeneric
          ? "Template generico usato quando il modello non ha un template specifico."
          : `Template DOCX associato al modello "${modelName}". Usato in priorità rispetto al template generico.`}
      </p>

      {templateInfo?.exists ? (
        <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCheck size={16} className="text-green-600 dark:text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">{templateFilename}</p>
              {templateInfo.sizeBytes && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {(templateInfo.sizeBytes / 1024).toFixed(1)} KB
                  {templateInfo.updatedAt && ` · ${new Date(templateInfo.updatedAt).toLocaleDateString("it-IT")}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
              <Upload size={13} className="mr-1" /> Sostituisci
            </Button>
            <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
          <Upload size={14} />
          {uploadMutation.isPending ? "Caricamento..." : `Carica template .docx${isGeneric ? " generico" : ""}`}
        </Button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { uploadMutation.mutate(f); e.target.value = ""; }
        }}
      />

      {templateInfo?.exists && (
        <div className="space-y-3">
          {detectedPlaceholders === null ? (
            <Button variant="ghost" size="sm" className="text-xs w-full" onClick={() => void fetchPlaceholders()}>
              Rileva placeholder dal template
            </Button>
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium">Placeholder rilevati ({detectedPlaceholders.length}):</p>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {detectedPlaceholders.map((p) => (
                  <code key={p} className="bg-muted border border-border rounded px-1 text-[10px]">{"{"+p+"}"}</code>
                ))}
              </div>
            </div>
          )}

          {!isGeneric && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              title="Allinea le voci della scheda a quelle del template: aggiunge le mancanti e trasforma i chk… in caselle di spunta"
            >
              {syncMutation.isPending ? "Aggiornamento..." : "Aggiorna le voci della scheda dal template"}
            </Button>
          )}

          {/* Crea modello da template solo per il template generico */}
          {isGeneric && (
            <div className="space-y-2 rounded-md border border-border p-3 bg-muted/10">
              <p className="text-xs font-medium">Crea modello da questo template</p>
              <p className="text-xs text-muted-foreground">
                Assegna un nome al modello — il template viene associato automaticamente al nuovo modello.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Es. Scheda US Cooperativa X, Modello MiC 2024..."
                  value={templateModelName}
                  onChange={(e) => setTemplateModelName(e.target.value)}
                  className="text-sm h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && templateModelName.trim()) {
                      createFromTemplateMutation.mutate(templateModelName.trim());
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={!templateModelName.trim() || createFromTemplateMutation.isPending}
                  onClick={() => createFromTemplateMutation.mutate(templateModelName.trim())}
                >
                  {createFromTemplateMutation.isPending ? "Creazione..." : "Crea modello"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function USModelDialog({
  open,
  onOpenChange,
  cid,
  modelDraftKey,
  activeModelKey,
  availableModels,
  isUsModelsLoading,
  isCantiereModelLoading,
  usModelsError,
  cantiereModelError,
  applyPending,
  applyError,
  onSelectModel,
  currentDraftModel,
  canDeleteDraftModel,
  deleteCustomModelPending,
  onDeleteDraftModel,
  customModelName,
  setCustomModelName,
  customModelDescription,
  setCustomModelDescription,
  customModelFieldsRaw,
  setCustomModelFieldsRaw,
  createCustomModelPending,
  onCreateCustomModel,
}: USModelDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeProjectId = getCurrentProjectId();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  // Quale modello ha la sezione template aperta (key del modello, o "generic" per il generico)
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const renameMutation = useMutation({
    mutationFn: async ({ key, name }: { key: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/us-models/custom/${encodeURIComponent(key)}`, { name });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      setRenaming(false);
      toast({ title: "Modello rinominato" });
    },
    onError: (e: any) => toast({ title: "Errore rinomina", description: e?.message, variant: "destructive" }),
  });

  const startRename = () => {
    setRenameValue(currentDraftModel?.name || "");
    setRenaming(true);
  };

  const handleModelCreated = (model: USModelDefinition) => {
    onSelectModel(model.key);
    // Apri la sezione template del modello appena creato
    setExpandedTemplate(model.key);
  };

  const toggleTemplate = (key: string) => {
    setExpandedTemplate((prev) => (prev === key ? null : key));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelli scheda US</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">

          {/* ── Selezione modello ── */}
          <div>
            <Label>Modello usato dal cantiere</Label>
            <Select value={modelDraftKey} onValueChange={onSelectModel}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona modello..." />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.key} value={model.key}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">I nuovi record US useranno automaticamente questo modello.</p>
          </div>

          {(isUsModelsLoading || isCantiereModelLoading) && (
            <p className="text-xs text-muted-foreground">Caricamento modelli...</p>
          )}
          {Boolean(usModelsError || cantiereModelError) && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2">
              <p className="text-xs text-red-700">
                Errore caricamento modelli: {errorMessage(usModelsError) || errorMessage(cantiereModelError)}
              </p>
            </div>
          )}

          {/* ── Lista modelli ── */}
          {availableModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Modelli disponibili</p>
              {availableModels.map((model) => {
                const selected = model.key === activeModelKey;
                const isThisDraft = model.key === modelDraftKey;
                const templateExpanded = expandedTemplate === model.key;
                return (
                  <div
                    key={model.key}
                    className={cn(
                      "rounded-md border p-3",
                      selected ? "border-primary/60 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {renaming && isThisDraft && model.source === "custom" ? (
                          <div className="flex items-center gap-2">
                            <Input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="h-7 text-sm"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") renameMutation.mutate({ key: model.key, name: renameValue });
                                if (e.key === "Escape") setRenaming(false);
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => renameMutation.mutate({ key: model.key, name: renameValue })} disabled={!renameValue.trim() || renameMutation.isPending}>
                              <Check size={13} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setRenaming(false)}>
                              <X size={13} />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{model.name}</p>
                            {model.source === "custom" && isThisDraft && (
                              <button type="button" onClick={startRename} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {model.source === "base" ? "Builtin" : model.source === "ministeriale" ? "Ministeriale" : "Personalizzato"}
                          {" · "}{model.fields.length} campi extra
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Pulsante template (solo se ha un cid e non è loading) */}
                        {cid && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn("h-7 px-2 text-xs gap-1", templateExpanded && "bg-muted")}
                            title="Gestisci template DOCX per questo modello"
                            onClick={() => toggleTemplate(model.key)}
                          >
                            {templateExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Template
                          </Button>
                        )}
                        {canDeleteDraftModel && isThisDraft && model.source === "custom" && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 px-2" onClick={onDeleteDraftModel} disabled={deleteCustomModelPending}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={selected ? "secondary" : "outline"}
                          disabled={applyPending || selected}
                          onClick={() => onSelectModel(model.key)}
                        >
                          {selected ? "Attivo" : "Usa questo"}
                        </Button>
                      </div>
                    </div>

                    {/* Sezione template inline */}
                    {templateExpanded && cid && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <ModelTemplateSection
                          cid={cid}
                          modelKey={model.key}
                          modelName={model.name}
                          isGeneric={false}
                          onModelCreated={handleModelCreated}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {applyPending && <p className="text-xs text-muted-foreground">Applicazione modello in corso...</p>}
          {applyError && <p className="text-xs text-red-600">Errore applicazione modello. Riprova.</p>}

          {/* ── Template generico (fallback) ── */}
          {cid && (
            <div className="pt-4 border-t border-border">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                onClick={() => toggleTemplate("generic")}
              >
                {expandedTemplate === "generic" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Template generico (fallback) + Crea nuovo modello da template
              </button>
              <p className="text-xs text-muted-foreground mt-1 ml-5">
                Usato per i modelli che non hanno un template specifico. Carica qui un .docx con placeholder per creare un nuovo modello.
              </p>
              {expandedTemplate === "generic" && (
                <div className="mt-3">
                  <ModelTemplateSection
                    cid={cid}
                    modelKey="generic"
                    modelName="Generico"
                    isGeneric={true}
                    onModelCreated={handleModelCreated}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Nuovo modello manuale (collassato) ── */}
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              onClick={() => setManualOpen((v) => !v)}
            >
              {manualOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Crea modello manuale (senza template)
            </button>

            {manualOpen && (
              <div className="mt-3 space-y-3">
                <div>
                  <Label>Nome modello *</Label>
                  <Input
                    placeholder="es. Scheda US personalizzata"
                    value={customModelName}
                    onChange={(event) => setCustomModelName(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Descrizione</Label>
                  <Input
                    placeholder="Uso interno progetto..."
                    value={customModelDescription}
                    onChange={(event) => setCustomModelDescription(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Campi custom (un campo per riga) *</Label>
                  <Textarea
                    rows={6}
                    placeholder={
                      "Esempio:\nTipo argilla\nData campionamento|date\nMetodo|select|manuale,strumentale\nComponenti|multiselect|ceramica,metalli,ossi\nFotografato|checkbox\nNote campione|textarea"
                    }
                    value={customModelFieldsRaw}
                    onChange={(event) => setCustomModelFieldsRaw(event.target.value)}
                  />
                  <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    <p>Formato: <code className="bg-muted px-1 rounded">Nome</code> oppure <code className="bg-muted px-1 rounded">Nome|tipo</code> oppure <code className="bg-muted px-1 rounded">Nome|tipo|opzione1,opzione2</code></p>
                    <p>Tipi: <code className="bg-muted px-1 rounded">text</code> · <code className="bg-muted px-1 rounded">textarea</code> · <code className="bg-muted px-1 rounded">date</code> · <code className="bg-muted px-1 rounded">select</code> · <code className="bg-muted px-1 rounded">multiselect</code> · <code className="bg-muted px-1 rounded">checkbox</code></p>
                    <p className="mt-1">Ogni campo diventa il placeholder <code className="bg-muted px-1 rounded">{"{"}nomeCampo{"}"}</code> nel template Word.</p>
                  </div>
                </div>
                <Button className="w-full" onClick={onCreateCustomModel} disabled={!customModelName.trim() || createCustomModelPending}>
                  {createCustomModelPending ? "Creazione..." : "Crea modello"}
                </Button>
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
