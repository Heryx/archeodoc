import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Wand2, Download, AlertCircle, CheckCircle2, AlertTriangle, Clock, Pencil, Trash2, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buildProjectUrl, getCurrentProjectId } from "@/lib/project";
import { BASE_US_MODEL_KEY, BUILTIN_US_MODELS, type USModelDefinition, type USModelField } from "@shared/us_models";

const tipiUS = ["strato", "struttura", "interfaccia", "tomba", "riempimento", "buca", "altro"];

type USForm = {
  codiceUS: string;
  tipo: string;
  definizione: string;
  descrizione: string;
  interpretazione: string;
  quota: string;
  settore: string;
  giornataId: string;
  coperto_da: string;
  copre: string;
  si_lega_a: string;
  uguale_a: string;
  periodoIniziale: string;
  periodoFinale: string;
  materialiRinvenuti: string;
  campioni: string;
  schedaModelKey: string;
  schedaData: Record<string, string>;
};

type USModelsResponse = {
  models: USModelDefinition[];
};

type CantiereUSModelResponse = {
  cantiereId: number;
  modelKey: string;
  model: USModelDefinition;
  availableModels: USModelDefinition[];
};

type USDeleteImpact = {
  allegatiCount: number;
};

const emptyUSForm: USForm = {
  codiceUS: "",
  tipo: "",
  definizione: "",
  descrizione: "",
  interpretazione: "",
  quota: "",
  settore: "",
  giornataId: "",
  coperto_da: "",
  copre: "",
  si_lega_a: "",
  uguale_a: "",
  periodoIniziale: "",
  periodoFinale: "",
  materialiRinvenuti: "",
  campioni: "",
  schedaModelKey: BASE_US_MODEL_KEY,
  schedaData: {},
};

function asNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapUsToForm(us: any): USForm {
  let schedaData: Record<string, string> = {};
  if (typeof us.schedaData === "string" && us.schedaData.trim()) {
    try {
      const parsed = JSON.parse(us.schedaData);
      if (parsed && typeof parsed === "object") {
        schedaData = Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
          if (v == null) return acc;
          acc[k] = String(v);
          return acc;
        }, {});
      }
    } catch {
      schedaData = {};
    }
  }

  return {
    codiceUS: us.codiceUS || "",
    tipo: us.tipo || "",
    definizione: us.definizione || "",
    descrizione: us.descrizione || "",
    interpretazione: us.interpretazione || "",
    quota: us.quota != null ? String(us.quota) : "",
    settore: us.settore || "",
    giornataId: us.giornataId != null ? String(us.giornataId) : "",
    coperto_da: us.coperto_da || "",
    copre: us.copre || "",
    si_lega_a: us.si_lega_a || "",
    uguale_a: us.uguale_a || "",
    periodoIniziale: us.periodoIniziale || "",
    periodoFinale: us.periodoFinale || "",
    materialiRinvenuti: us.materialiRinvenuti || "",
    campioni: us.campioni || "",
    schedaModelKey: us.schedaModelKey || BASE_US_MODEL_KEY,
    schedaData,
  };
}

function usPayload(form: USForm) {
  const schedaDataClean = Object.entries(form.schedaData || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return acc;
    acc[key] = trimmed;
    return acc;
  }, {});

  return {
    codiceUS: form.codiceUS.trim(),
    tipo: asNullable(form.tipo),
    definizione: asNullable(form.definizione),
    descrizione: asNullable(form.descrizione),
    interpretazione: asNullable(form.interpretazione),
    quota: form.quota ? Number(form.quota) : null,
    settore: asNullable(form.settore),
    giornataId: form.giornataId ? Number(form.giornataId) : null,
    coperto_da: asNullable(form.coperto_da),
    copre: asNullable(form.copre),
    si_lega_a: asNullable(form.si_lega_a),
    uguale_a: asNullable(form.uguale_a),
    periodoIniziale: asNullable(form.periodoIniziale),
    periodoFinale: asNullable(form.periodoFinale),
    materialiRinvenuti: asNullable(form.materialiRinvenuti),
    campioni: asNullable(form.campioni),
    schedaModelKey: form.schedaModelKey || BASE_US_MODEL_KEY,
    schedaData: Object.keys(schedaDataClean).length > 0 ? JSON.stringify(schedaDataClean) : null,
  };
}

function getFieldValue(form: USForm, field: USModelField): string {
  return form.schedaData[field.key] || "";
}

function setFieldValue(
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

function missingRequiredModelFields(form: USForm, model?: USModelDefinition): string[] {
  if (!model) return [];
  return model.fields
    .filter((field) => field.required)
    .filter((field) => !getFieldValue(form, field).trim())
    .map((field) => field.label);
}

function QcIcon({ status }: { status?: string | null }) {
  if (status === "ok") return <CheckCircle2 size={14} className="text-green-600" />;
  if (status === "error") return <AlertCircle size={14} className="text-red-600" />;
  if (status === "warning") return <AlertTriangle size={14} className="text-amber-500" />;
  return <Clock size={14} className="text-muted-foreground" />;
}

function USCard({
  us,
  modelName,
  onGenerate,
  onEdit,
  onDelete,
  aiAvailable,
}: {
  us: any;
  modelName?: string;
  onGenerate: (id: number) => void;
  onEdit: (us: any) => void;
  onDelete: (us: any) => void;
  aiAvailable?: boolean;
}) {
  const [showScheda, setShowScheda] = useState(false);
  let qcIssues: any[] = [];
  try {
    qcIssues = JSON.parse(us.qcProblemi || "[]");
  } catch {
    qcIssues = [];
  }

  return (
    <Card
      data-testid={`card-us-${us.id}`}
      className={cn(
        "border-l-4",
        us.qcStatus === "error"
          ? "border-l-red-500"
          : us.qcStatus === "warning"
            ? "border-l-amber-500"
            : us.qcStatus === "ok"
              ? "border-l-green-500"
              : "border-l-border",
      )}
    >
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono font-semibold text-primary">{us.codiceUS}</span>
              {us.tipo && (
                <Badge variant="secondary" className="text-xs capitalize">
                  {us.tipo}
                </Badge>
              )}
              {modelName && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {modelName}
                </Badge>
              )}
              <QcIcon status={us.qcStatus} />
              {us.giornataId && <span className="text-xs text-muted-foreground">Giornata #{us.giornataId}</span>}
            </div>
            {us.descrizione && <p className="text-sm text-muted-foreground line-clamp-2">{us.descrizione}</p>}
            {us.quota != null && <p className="text-xs text-muted-foreground mt-1">Quota: {us.quota} m s.l.m.</p>}
            {qcIssues.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {qcIssues.slice(0, 3).map((issue: any, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded",
                      issue.livello === "error"
                        ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                        : issue.livello === "warning"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
                    )}
                  >
                    {issue.messaggio}
                  </div>
                ))}
                {qcIssues.length > 3 && <div className="text-xs text-muted-foreground px-2">+{qcIssues.length - 3} altri problemi</div>}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => onGenerate(us.id)} disabled={!aiAvailable} title={!aiAvailable ? "Configura ANTHROPIC_API_KEY nel file .env per usare l'AI" : undefined}>
              <Wand2 size={12} /> Analizza AI
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onEdit(us)}>
              <Pencil size={12} /> Modifica
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 text-xs text-red-600 hover:text-red-700" onClick={() => onDelete(us)}>
              <Trash2 size={12} /> Elimina
            </Button>
            {us.schedaAiGenerata && (
              <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => setShowScheda(!showScheda)}>
                {showScheda ? "Nascondi" : "Vedi scheda"}
              </Button>
            )}
          </div>
        </div>
        {showScheda && us.schedaAiGenerata && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium text-muted-foreground">Scheda AI generata</span>
              <a href={buildProjectUrl(`/api/us/${us.id}/export-docx`)} download className="text-xs text-primary hover:underline">
                <Download size={12} className="inline mr-1" />
                Scarica .docx
              </a>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/50 rounded p-3 max-h-64 overflow-y-auto">{us.schedaAiGenerata}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function USFormFields({
  form,
  setForm,
  giornate,
  activeModel,
}: {
  form: USForm;
  setForm: Dispatch<SetStateAction<USForm>>;
  giornate: any[];
  activeModel?: USModelDefinition;
}) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-3 gap-3">
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
              {tipiUS.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Quota (m s.l.m.)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="es. 12.45"
            value={form.quota}
            onChange={(e) => setForm((f) => ({ ...f, quota: e.target.value }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
        </div>
      </div>
      <div>
        <Label>Definizione</Label>
        <Input
          placeholder="es. strato di abbandono con materiale ceramico"
          value={form.definizione}
          onChange={(e) => setForm((f) => ({ ...f, definizione: e.target.value }))}
        />
      </div>
      <div>
        <Label>Descrizione</Label>
        <Textarea
          placeholder="Descrizione stratigrafica dettagliata..."
          value={form.descrizione}
          rows={4}
          onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))}
        />
      </div>
      <div>
        <Label>Interpretazione</Label>
        <Textarea
          placeholder="Interpretazione storico-archeologica..."
          value={form.interpretazione}
          rows={2}
          onChange={(e) => setForm((f) => ({ ...f, interpretazione: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Coperto da (US, separate da virgola)</Label>
          <Input value={form.coperto_da} onChange={(e) => setForm((f) => ({ ...f, coperto_da: e.target.value }))} />
        </div>
        <div>
          <Label>Copre</Label>
          <Input value={form.copre} onChange={(e) => setForm((f) => ({ ...f, copre: e.target.value }))} />
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
      <div className="grid grid-cols-2 gap-3">
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
      </div>
      <div>
        <Label>Materiali rinvenuti</Label>
        <Input
          value={form.materialiRinvenuti}
          onChange={(e) => setForm((f) => ({ ...f, materialiRinvenuti: e.target.value }))}
        />
      </div>
      <div>
        <Label>Campioni</Label>
        <Input value={form.campioni} onChange={(e) => setForm((f) => ({ ...f, campioni: e.target.value }))} />
      </div>

      {activeModel && activeModel.fields.length > 0 && (
        <div className="pt-2 border-t border-border">
          <p className="text-sm font-medium mb-3">Campi modello: {activeModel.name}</p>
          <div className="space-y-3">
            {activeModel.fields.map((field) => {
              const value = getFieldValue(form, field);
              return (
                <div key={field.key}>
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
                  ) : (
                    <Input
                      type={field.type === "date" ? "date" : "text"}
                      value={value}
                      onChange={(e) => setFieldValue(setForm, field.key, e.target.value)}
                    />
                  )}
                  {field.help && <p className="text-xs text-muted-foreground mt-1">{field.help}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function USPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const qcClient = useQueryClient();
  const { toast } = useToast();

  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openModelDialog, setOpenModelDialog] = useState(false);
  const [createForm, setCreateForm] = useState<USForm>(emptyUSForm);
  const [editForm, setEditForm] = useState<USForm>(emptyUSForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterGiornata, setFilterGiornata] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<USDeleteImpact | null>(null);
  const [isLoadingDeleteImpact, setIsLoadingDeleteImpact] = useState(false);
  const [modelDraftKey, setModelDraftKey] = useState(BASE_US_MODEL_KEY);
  const [customModelName, setCustomModelName] = useState("");
  const [customModelDescription, setCustomModelDescription] = useState("");
  const [customModelFieldsRaw, setCustomModelFieldsRaw] = useState("");

  const { data: giornate = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const { data: usList = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId],
    queryFn: async () => {
      const query = filterGiornata !== "all" ? `?giornataId=${filterGiornata}` : "";
      return (await apiRequest("GET", `/api/cantieri/${cid}/us${query}`)).json();
    },
    enabled: !!cid,
  });

  const {
    data: usModelsData,
    isLoading: isUsModelsLoading,
    error: usModelsError,
    refetch: refetchUsModels,
  } = useQuery<USModelsResponse>({
    queryKey: ["/api/us-models", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/us-models")).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const {
    data: cantiereModelData,
    isLoading: isCantiereModelLoading,
    error: cantiereModelError,
    refetch: refetchCantiereModel,
  } = useQuery<CantiereUSModelResponse>({
    queryKey: ["/api/cantieri", cid, "us-model", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us-model`)).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: aiStatus } = useQuery<{ available: boolean }>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    staleTime: Infinity,
  });
  const aiAvailable = aiStatus?.available ?? false;

  const availableModels = useMemo(
    () => cantiereModelData?.availableModels || usModelsData?.models || BUILTIN_US_MODELS,
    [cantiereModelData?.availableModels, usModelsData?.models],
  );
  const activeModelKey = cantiereModelData?.modelKey || BASE_US_MODEL_KEY;
  const activeModel =
    availableModels.find((m) => m.key === activeModelKey) || availableModels[0] || undefined;
  const editModel =
    availableModels.find((m) => m.key === editForm.schedaModelKey) || activeModel;
  const modelNameByKey = useMemo(
    () =>
      availableModels.reduce<Record<string, string>>((acc, model) => {
        acc[model.key] = model.name;
        return acc;
      }, {}),
    [availableModels],
  );

  useEffect(() => {
    setModelDraftKey(activeModelKey);
    setCreateForm((prev) => ({
      ...prev,
      schedaModelKey: activeModelKey,
      schedaData: prev.schedaModelKey === activeModelKey ? prev.schedaData : {},
    }));
  }, [activeModelKey]);

  useEffect(() => {
    if (!openModelDialog) return;
    void refetchUsModels();
    if (cid) {
      void refetchCantiereModel();
    }
  }, [openModelDialog, refetchUsModels, refetchCantiereModel, cid]);

  const setCantiereModel = useMutation({
    mutationFn: async (modelKey: string) => {
      const response = await apiRequest("POST", `/api/cantieri/${cid}/us-model`, { modelKey });
      return response.json();
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      toast({ title: "Modello US aggiornato per il cantiere" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore selezione modello",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const createCustomModel = useMutation({
    mutationFn: async () => {
      const lines = customModelFieldsRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        throw new Error("Inserisci almeno un campo personalizzato");
      }

      const fields = lines.map((line) => {
        const parts = line.split("|").map((p) => p.trim());
        const label = parts[0];
        const typeRaw = (parts[1] || "text").toLowerCase();
        const type: USModelField["type"] =
          typeRaw === "textarea" || typeRaw === "date" || typeRaw === "select" ? typeRaw : "text";
        const options =
          type === "select"
            ? (parts[2] || "")
                .split(",")
                .map((opt) => opt.trim())
                .filter(Boolean)
            : undefined;

        if (!label) {
          throw new Error("Ogni riga deve avere almeno un'etichetta campo");
        }

        if (type === "select" && (!options || options.length === 0)) {
          throw new Error(`Il campo '${label}' richiede almeno una opzione (separata da virgole)`);
        }

        return {
          label,
          type,
          options,
        };
      });

      const payload = {
        name: customModelName.trim(),
        description: customModelDescription.trim() || null,
        fields,
      };
      const response = await apiRequest("POST", "/api/us-models/custom", payload);
      return response.json() as Promise<USModelDefinition>;
    },
    onSuccess: (model) => {
      qcClient.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      setCustomModelName("");
      setCustomModelDescription("");
      setCustomModelFieldsRaw("");
      setModelDraftKey(model.key);
      setCantiereModel.mutate(model.key);
      toast({ title: "Modello personalizzato creato" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore creazione modello",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const deleteCustomModel = useMutation({
    mutationFn: async (modelKey: string) => {
      await apiRequest("DELETE", `/api/us-models/custom/${encodeURIComponent(modelKey)}`);
      return modelKey;
    },
    onSuccess: (deletedKey) => {
      qcClient.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      if (modelDraftKey === deletedKey) setModelDraftKey(BASE_US_MODEL_KEY);
      if (activeModelKey === deletedKey) {
        setCantiereModel.mutate(BASE_US_MODEL_KEY);
      }
      toast({ title: "Modello personalizzato eliminato" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore eliminazione modello",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const onSelectCantiereModel = (nextKey: string) => {
    setModelDraftKey(nextKey);
    if (nextKey && nextKey !== activeModelKey) {
      setCantiereModel.mutate(nextKey);
    }
  };

  const createUS = useMutation({
    mutationFn: async (data: USForm) => {
      const r = await apiRequest("POST", `/api/cantieri/${cid}/us`, usPayload(data));
      return r.json();
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      setOpenCreate(false);
      setCreateForm({
        ...emptyUSForm,
        schedaModelKey: activeModelKey,
      });
      toast({ title: "US creata" });
    },
    onError: () => toast({ title: "Errore nella creazione", variant: "destructive" }),
  });

  const updateUS = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: USForm }) => {
      const r = await apiRequest("PATCH", `/api/us/${id}`, usPayload(data));
      return r.json();
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      setOpenEdit(false);
      setEditingId(null);
      toast({ title: "US aggiornata" });
    },
    onError: () => toast({ title: "Errore aggiornamento US", variant: "destructive" }),
  });

  const deleteUS = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/us/${id}`);
      return id;
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati", activeProjectId] });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
      toast({ title: "US eliminata" });
    },
    onError: () => toast({ title: "Errore eliminazione US", variant: "destructive" }),
  });

  const openDeleteDialog = async (usValue: any) => {
    setDeleteTarget(usValue);
    setDeleteImpact(null);
    setDeleteDialogOpen(true);
    setIsLoadingDeleteImpact(true);

    try {
      const impact: USDeleteImpact = await (await apiRequest("GET", `/api/us/${usValue.id}/delete-impact`)).json();
      setDeleteImpact(impact);
    } catch {
      toast({ title: "Impossibile calcolare l'impatto eliminazione", variant: "destructive" });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
    } finally {
      setIsLoadingDeleteImpact(false);
    }
  };

  const generateScheda = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/us/${id}/analizza-ai`, {});
      return r.json();
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      toast({ title: "Scheda US generata con AI" });
    },
    onError: () => toast({ title: "Errore generazione scheda AI", variant: "destructive" }),
  });

  const openEditDialog = (us: any) => {
    setEditingId(us.id);
    const mapped = mapUsToForm(us);
    setEditForm({
      ...mapped,
      schedaModelKey: mapped.schedaModelKey || activeModelKey,
    });
    setOpenEdit(true);
  };

  const currentDraftModel = availableModels.find((m) => m.key === modelDraftKey);
  const canDeleteDraftModel = !!currentDraftModel && currentDraftModel.source === "custom";

  const createMissingRequired = missingRequiredModelFields(createForm, activeModel);
  const editMissingRequired = missingRequiredModelFields(editForm, editModel);

  const counts = { ok: 0, warning: 0, error: 0, pending: 0 };
  for (const us of usList) {
    const s = (us.qcStatus || "pending") as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Unita Stratigrafiche</h1>
          <div className="flex gap-3 mt-2 text-sm">
            <span className="qc-ok px-2 py-0.5 rounded">{counts.ok} OK</span>
            <span className="qc-warning px-2 py-0.5 rounded">{counts.warning} avvisi</span>
            <span className="qc-error px-2 py-0.5 rounded">{counts.error} errori</span>
            <span className="qc-pending px-2 py-0.5 rounded">{counts.pending} non verificate</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Modello cantiere attivo: <span className="font-medium text-foreground">{activeModel?.name || "US base ArcheoDoc"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={openModelDialog} onOpenChange={setOpenModelDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Settings2 size={15} /> Modello US
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Modelli scheda US</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Modello usato dal cantiere</Label>
                  <Select value={modelDraftKey} onValueChange={onSelectCantiereModel}>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    I nuovi record US useranno automaticamente questo modello.
                  </p>
                </div>

                {(isUsModelsLoading || isCantiereModelLoading) && (
                  <p className="text-xs text-muted-foreground">Caricamento modelli...</p>
                )}

                {!isUsModelsLoading && availableModels.length === 0 && (
                  <p className="text-xs text-red-600">
                    Nessun modello disponibile. Verifica il progetto attivo e riapri la pagina.
                  </p>
                )}

                {(usModelsError || cantiereModelError) && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2">
                    <p className="text-xs text-red-700">
                      Errore caricamento modelli:
                      {" "}
                      {(usModelsError as Error | undefined)?.message ||
                        (cantiereModelError as Error | undefined)?.message ||
                        "Errore sconosciuto"}
                    </p>
                    <p className="text-xs text-red-700 mt-1">
                      Se il messaggio contiene "Unexpected token &lt;", riavvia il server con `avvia.bat` per caricare
                      l'ultima build.
                    </p>
                  </div>
                )}

                {availableModels.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Modelli disponibili</p>
                    {availableModels.map((model) => {
                      const selected = model.key === activeModelKey;
                      return (
                        <div
                          key={model.key}
                          className={cn(
                            "rounded-md border p-3 flex items-start justify-between gap-3",
                            selected ? "border-primary/60 bg-primary/5" : "border-border",
                          )}
                        >
                          <div>
                            <p className="text-sm font-medium">{model.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Chiave: {model.key} · Fonte: {model.source} · Campi extra: {model.fields.length}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={selected ? "secondary" : "outline"}
                            disabled={setCantiereModel.isPending || selected}
                            onClick={() => onSelectCantiereModel(model.key)}
                          >
                            {selected ? "Attivo" : "Usa questo"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {setCantiereModel.isPending && (
                  <p className="text-xs text-muted-foreground">Applicazione modello in corso...</p>
                )}
                {setCantiereModel.isError && (
                  <p className="text-xs text-red-600">
                    Errore applicazione modello. Riprova selezionando di nuovo.
                  </p>
                )}

                {currentDraftModel && (
                  <div className="rounded-md border border-border p-3 bg-muted/20">
                    <p className="text-sm font-medium">{currentDraftModel.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fonte: {currentDraftModel.source} · Campi extra: {currentDraftModel.fields.length}
                    </p>
                    {currentDraftModel.fields.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {currentDraftModel.fields.slice(0, 8).map((field) => (
                          <Badge key={field.key} variant="outline" className="text-[10px]">
                            {field.label}
                          </Badge>
                        ))}
                        {currentDraftModel.fields.length > 8 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{currentDraftModel.fields.length - 8}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {canDeleteDraftModel && (
                  <div>
                    <Button
                      variant="destructive"
                      onClick={() => deleteCustomModel.mutate(modelDraftKey)}
                      disabled={deleteCustomModel.isPending}
                    >
                      {deleteCustomModel.isPending ? "Eliminazione..." : "Elimina modello custom"}
                    </Button>
                  </div>
                )}

                <div className="pt-3 border-t border-border space-y-3">
                  <p className="text-sm font-medium">Nuovo modello personalizzato</p>
                  <div>
                    <Label>Nome modello *</Label>
                    <Input
                      placeholder="es. US Cooperativa XYZ"
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Descrizione</Label>
                    <Input
                      placeholder="Uso interno progetto..."
                      value={customModelDescription}
                      onChange={(e) => setCustomModelDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Campi custom (una etichetta per riga) *</Label>
                    <Textarea
                      rows={6}
                      placeholder={
                        "Esempio:\nTipo argilla\nData campionamento|date\nMetodo|select|manuale,strumentale\nNote campione|textarea"
                      }
                      value={customModelFieldsRaw}
                      onChange={(e) => setCustomModelFieldsRaw(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Formato riga: Etichetta|tipo|opzioni. Tipi: text, textarea, date, select.
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createCustomModel.mutate()}
                    disabled={!customModelName.trim() || createCustomModel.isPending}
                  >
                    {createCustomModel.isPending ? "Creazione..." : "Crea modello custom"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <div className="min-w-52">
            <Select value={filterGiornata} onValueChange={setFilterGiornata}>
              <SelectTrigger>
                <SelectValue placeholder="Filtra per giornata" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le giornate</SelectItem>
                {giornate.map((g: any) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.data}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button data-testid="button-nuova-us" className="gap-2">
                <Plus size={16} /> Nuova US
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Registra Unita Stratigrafica</DialogTitle>
              </DialogHeader>
              <USFormFields form={createForm} setForm={setCreateForm} giornate={giornate} activeModel={activeModel} />
              {createMissingRequired.length > 0 && (
                <p className="text-xs text-red-600">
                  Campi obbligatori mancanti: {createMissingRequired.slice(0, 3).join(", ")}
                  {createMissingRequired.length > 3 ? "..." : ""}
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => createUS.mutate({ ...createForm, schedaModelKey: activeModelKey })}
                disabled={!createForm.codiceUS || createUS.isPending || createMissingRequired.length > 0}
              >
                {createUS.isPending ? "Salvataggio..." : "Registra US"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog
        open={openEdit}
        onOpenChange={(value) => {
          setOpenEdit(value);
          if (!value) setEditingId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica Unita Stratigrafica</DialogTitle>
          </DialogHeader>
          <USFormFields form={editForm} setForm={setEditForm} giornate={giornate} activeModel={editModel} />
          {editMissingRequired.length > 0 && (
            <p className="text-xs text-red-600">
              Campi obbligatori mancanti: {editMissingRequired.slice(0, 3).join(", ")}
              {editMissingRequired.length > 3 ? "..." : ""}
            </p>
          )}
          <Button
            className="w-full"
            onClick={() => {
              if (editingId) updateUS.mutate({ id: editingId, data: editForm });
            }}
            disabled={!editForm.codiceUS || !editingId || updateUS.isPending || editMissingRequired.length > 0}
          >
            {updateUS.isPending ? "Aggiornamento..." : "Salva modifiche"}
          </Button>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(value) => {
          setDeleteDialogOpen(value);
          if (!value && !deleteUS.isPending) {
            setDeleteTarget(null);
            setDeleteImpact(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la scheda US?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Stai per eliminare la scheda ${deleteTarget.codiceUS}.` : "Stai per eliminare una scheda US."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isLoadingDeleteImpact ? (
            <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>
          ) : deleteImpact ? (
            <div className="text-sm space-y-1">
              <p className="font-medium">Impatto:</p>
              <p>- Allegati collegati: {deleteImpact.allegatiCount}</p>
              <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUS.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              disabled={!deleteTarget || !deleteImpact || deleteUS.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteUS.mutate(deleteTarget.id);
              }}
            >
              {deleteUS.isPending ? "Eliminazione..." : "Elimina US"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : usList.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <p className="font-medium">Nessuna US registrata</p>
        </div>
      ) : (
        <div className="space-y-2">
          {usList.map((us: any) => (
            <USCard
              key={us.id}
              us={us}
              modelName={modelNameByKey[us.schedaModelKey || activeModelKey]}
              onGenerate={(id) => generateScheda.mutate(id)}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              aiAvailable={aiAvailable}
            />
          ))}
        </div>
      )}
    </div>
  );
}




