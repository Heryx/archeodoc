import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  applyAiFillFields,
  getAiFillSuggestions,
  getAiFillSuggestionsFromDocx,
  getAiFillSuggestionsFromGoogleDoc,
  type AIFillSource,
  type AiFillResult,
} from "@/lib/api";
import { extractSearchFromLocation } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { GitBranch, Package, Plus, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";
import { BASE_US_MODEL_KEY, BUILTIN_US_MODELS, type USModelDefinition, type USModelField } from "@shared/us_models";
import type { FieldDefinition, SchemaDefinition } from "@shared/types/schema";
import { getUsTopLevelThesaurusFromSchema } from "@shared/us_schema_thesaurus";
import { USCard } from "@/components/us/USCard";
import { USAllegatiImpact } from "@/components/us/USAllegati";
import { AiFillPanel } from "@/components/us/AiFillPanel";
import { DiarioSourceDialog } from "@/components/us/DiarioSourceDialog";
import { USFormDialog } from "@/components/us/USFormDialog";
import { USModelDialog } from "@/components/us/USModelDialog";
import {
  emptyUSForm,
  mapUsToForm,
  missingRequiredModelFields,
  usPayload,
  type USDeleteImpact,
  type USForm,
} from "@/components/us/types";

type USModelsResponse = {
  models: USModelDefinition[];
};

type CantiereUSModelResponse = {
  cantiereId: number;
  modelKey: string;
  model: USModelDefinition;
  availableModels: USModelDefinition[];
};

type ProjectSchemaResponse = {
  schema: SchemaDefinition;
};

type CantiereLiteResponse = {
  id: number;
  googleDocId?: string | null;
};

type USSaveMode = "draft" | "final";
const AUTO_GIORNATA_DATE_KEYS = ["dataCompilazione", "dataRilevamentoCampo", "giorno", "dataScheda"] as const;

function giornataFilterFromLocation(location: string): string {
  const search = extractSearchFromLocation(location);
  if (!search) return "all";

  const giornataId = new URLSearchParams(search).get("giornataId");
  if (!giornataId) return "all";
  return /^\d+$/.test(giornataId) ? giornataId : "all";
}

function isFieldFilled(value: unknown): boolean {
  if (value == null) return false;
  return String(value).trim().length > 0;
}

function applyGiornataDateDefaults(form: USForm, giornataDate: string, model?: USModelDefinition): USForm {
  if (!giornataDate) return form;

  const modelFields = model?.fields || [];
  const canAutoFill = (key: string) =>
    modelFields.some((field) => field.key === key && (field.type === "date" || key === "giorno"));
  const targetKeys = AUTO_GIORNATA_DATE_KEYS.filter((key) => canAutoFill(key));

  if (targetKeys.length === 0) return form;

  let changed = false;
  const nextSchedaData = { ...form.schedaData };

  for (const key of targetKeys) {
    if (!isFieldFilled(nextSchedaData[key])) {
      nextSchedaData[key] = giornataDate;
      changed = true;
    }
  }

  if (!changed) return form;
  return { ...form, schedaData: nextSchedaData };
}

function extractApiErrorDescription(error: unknown): string {
  const raw = String((error as any)?.message || "");
  try {
    const body = JSON.parse(raw.replace(/^\d+:\s*/, ""));
    const fieldErrors = body?.fieldErrors && typeof body.fieldErrors === "object"
      ? Object.entries(body.fieldErrors as Record<string, string[]>)
          .flatMap(([key, messages]) => (messages || []).map((message) => `${key}: ${message}`))
      : [];
    if (fieldErrors.length > 0) {
      const short = fieldErrors.slice(0, 3).join(" | ");
      return `${body.error || "Validazione non riuscita"} (${short}${fieldErrors.length > 3 ? "..." : ""})`;
    }
    return body.error || raw;
  } catch {
    return raw;
  }
}

const US_TOP_LEVEL_FORM_KEYS = new Set<string>([
  "codiceUS",
  "tipo",
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "quotaPianoCampagna",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "periodoIniziale",
  "periodoFinale",
  "materialiRinvenuti",
  "campioni",
  "giornataId",
]);

export function USPage() {
  const { cid } = useParams<{ cid: string }>();
  const [location, navigate] = useLocation();
  const activeProjectId = getCurrentProjectId();
  const qcClient = useQueryClient();
  const { toast } = useToast();

  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openModelDialog, setOpenModelDialog] = useState(false);
  const [createForm, setCreateForm] = useState<USForm>(emptyUSForm);
  const [editForm, setEditForm] = useState<USForm>(emptyUSForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterGiornata, setFilterGiornata] = useState<string>(() => giornataFilterFromLocation(location));
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<USDeleteImpact | null>(null);
  const [isLoadingDeleteImpact, setIsLoadingDeleteImpact] = useState(false);
  const [aiSourceDialogOpen, setAiSourceDialogOpen] = useState(false);
  const [aiSourceTarget, setAiSourceTarget] = useState<any | null>(null);
  const [aiFillOpen, setAiFillOpen] = useState(false);
  const [aiFillTarget, setAiFillTarget] = useState<any | null>(null);
  const [aiFillSuggestions, setAiFillSuggestions] = useState<AiFillResult | null>(null);
  const [modelDraftKey, setModelDraftKey] = useState(BASE_US_MODEL_KEY);
  const [customModelName, setCustomModelName] = useState("");
  const [customModelDescription, setCustomModelDescription] = useState("");
  const [customModelFieldsRaw, setCustomModelFieldsRaw] = useState("");

  const { data: giornate = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const { data: cantiereData } = useQuery<CantiereLiteResponse>({
    queryKey: ["/api/cantieri", cid, activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}`)).json(),
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

  const { data: schemaData } = useQuery<ProjectSchemaResponse>({
    queryKey: ["/api/projects", activeProjectId, "schema"],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${activeProjectId}/schema`)).json(),
    enabled: !!activeProjectId,
    staleTime: 0,
    refetchOnMount: true,
  });

  const usThesaurus = useMemo(
    () => getUsTopLevelThesaurusFromSchema(schemaData?.schema),
    [schemaData?.schema],
  );

  const requiredTopLevelFields = useMemo(() => {
    if (!schemaData?.schema) return [] as Array<{ key: string; label: string }>;
    const paragraphs = schemaData.schema.modules?.us || schemaData.schema.paragraphs || [];
    const byKey = new Map<string, string>();

    for (const paragraph of paragraphs) {
      for (const field of (paragraph.fields || []) as FieldDefinition[]) {
        const key = String(field.key || "").trim();
        if (!key || !field.required || !US_TOP_LEVEL_FORM_KEYS.has(key)) continue;
        if (!byKey.has(key)) {
          byKey.set(key, field.label || key);
        }
      }
    }

    return Array.from(byKey.entries()).map(([key, label]) => ({ key, label }));
  }, [schemaData?.schema]);

  useEffect(() => {
    const next = giornataFilterFromLocation(location);
    setFilterGiornata(next);
  }, [location]);

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

  useEffect(() => {
    if (!openCreate || !createForm.giornataId) return;
    const giornata = giornate.find((g: any) => String(g.id) === createForm.giornataId);
    const giornataDate = typeof giornata?.data === "string" ? giornata.data.trim() : "";
    if (!giornataDate) return;

    setCreateForm((prev) => {
      if (prev.giornataId !== createForm.giornataId) return prev;
      return applyGiornataDateDefaults(prev, giornataDate, activeModel);
    });
  }, [openCreate, createForm.giornataId, giornate, activeModel]);

  useEffect(() => {
    if (!openEdit || !editForm.giornataId) return;
    const giornata = giornate.find((g: any) => String(g.id) === editForm.giornataId);
    const giornataDate = typeof giornata?.data === "string" ? giornata.data.trim() : "";
    if (!giornataDate) return;

    setEditForm((prev) => {
      if (prev.giornataId !== editForm.giornataId) return prev;
      return applyGiornataDateDefaults(prev, giornataDate, editModel);
    });
  }, [openEdit, editForm.giornataId, giornate, editModel]);

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
          typeRaw === "textarea" || typeRaw === "date" || typeRaw === "select" || typeRaw === "multiselect"
            ? typeRaw
            : "text";
        const options =
          type === "select" || type === "multiselect"
            ? (parts[2] || "")
                .split(",")
                .map((opt) => opt.trim())
                .filter(Boolean)
            : undefined;

        if (!label) {
          throw new Error("Ogni riga deve avere almeno un'etichetta campo");
        }

        if ((type === "select" || type === "multiselect") && (!options || options.length === 0)) {
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
    mutationFn: async ({ data, saveMode }: { data: USForm; saveMode: USSaveMode }) => {
      const r = await apiRequest("POST", `/api/cantieri/${cid}/us`, {
        ...usPayload(data, usThesaurus),
        saveMode,
      });
      return r.json();
    },
    onSuccess: (_result, variables) => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      setOpenCreate(false);
      setCreateForm({
        ...emptyUSForm,
        giornataId: filterGiornata !== "all" ? filterGiornata : "",
        schedaModelKey: activeModelKey,
      });
      toast({ title: variables.saveMode === "draft" ? "US salvata in bozza" : "US registrata come completa" });
    },
    onError: (err: any) => {
      const desc = extractApiErrorDescription(err);
      toast({ title: "Errore nella creazione", description: desc || undefined, variant: "destructive" });
    },
  });

  const updateUS = useMutation({
    mutationFn: async ({ id, data, saveMode }: { id: number; data: USForm; saveMode: USSaveMode }) => {
      const r = await apiRequest("PATCH", `/api/us/${id}`, {
        ...usPayload(data, usThesaurus),
        saveMode,
      });
      return r.json();
    },
    onSuccess: (_result, variables) => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      setOpenEdit(false);
      setEditingId(null);
      toast({ title: variables.saveMode === "draft" ? "Bozza US aggiornata" : "US aggiornata come completa" });
    },
    onError: (err: any) => {
      const desc = extractApiErrorDescription(err);
      toast({ title: "Errore aggiornamento US", description: desc || undefined, variant: "destructive" });
    },
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

  const openAiSuggestionsPanel = (usId: number, suggestions: AiFillResult) => {
    const target = usList.find((item) => item.id === usId) || { id: usId, codiceUS: `US ${usId}` };
    setAiSourceDialogOpen(false);
    setAiSourceTarget(null);
    setAiFillTarget(target);
    setAiFillSuggestions(suggestions || {});
    setAiFillOpen(true);

    const suggestionCount = Object.keys(suggestions || {}).length;
    if (suggestionCount === 0) {
      toast({ title: "Nessun suggerimento trovato nel testo disponibile" });
    }
  };

  const requestAiFill = useMutation({
    mutationFn: async ({ usId, source }: { usId: number; source: AIFillSource }) => {
      return getAiFillSuggestions(usId, source);
    },
    onSuccess: (result, vars) => {
      openAiSuggestionsPanel(vars.usId, result?.suggestions || {});
    },
    onError: () => toast({ title: "Errore compilazione assistita AI", variant: "destructive" }),
  });

  const requestAiFillDocx = useMutation({
    mutationFn: async ({ usId, file }: { usId: number; file: File }) => {
      return getAiFillSuggestionsFromDocx(usId, file);
    },
    onSuccess: (result, vars) => {
      openAiSuggestionsPanel(vars.usId, result?.suggestions || {});
    },
    onError: () => toast({ title: "Errore analisi file DOCX", variant: "destructive" }),
  });

  const requestAiFillGoogle = useMutation({
    mutationFn: async ({ usId, url }: { usId: number; url?: string }) => {
      return getAiFillSuggestionsFromGoogleDoc(usId, url);
    },
    onSuccess: (result, vars) => {
      openAiSuggestionsPanel(vars.usId, result?.suggestions || {});
    },
    onError: (error: any) => {
      const description = extractApiErrorDescription(error);
      toast({
        title: "Errore analisi Google Docs",
        description: description || undefined,
        variant: "destructive",
      });
    },
  });

  const applyAiFill = useMutation({
    mutationFn: async ({
      usId,
      fields,
    }: {
      usId: number;
      fields: Record<string, string | number | boolean | string[]>;
    }) => {
      return applyAiFillFields(usId, fields);
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", filterGiornata, activeProjectId] });
      setAiFillOpen(false);
      setAiFillTarget(null);
      setAiFillSuggestions(null);
      toast({ title: "Campi AI applicati alla scheda US" });
    },
    onError: () => toast({ title: "Errore applicazione campi AI", variant: "destructive" }),
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

  const createMissingRequiredModel = missingRequiredModelFields(createForm, activeModel);
  const editMissingRequiredModel = missingRequiredModelFields(editForm, editModel);
  const createMissingRequiredTopLevel = requiredTopLevelFields
    .filter(({ key }) => {
      const value = (createForm as Record<string, unknown>)[key];
      if (value == null) return true;
      return String(value).trim() === "";
    })
    .map((item) => item.label);
  const editMissingRequiredTopLevel = requiredTopLevelFields
    .filter(({ key }) => {
      const value = (editForm as Record<string, unknown>)[key];
      if (value == null) return true;
      return String(value).trim() === "";
    })
    .map((item) => item.label);
  const createMissingRequired = Array.from(new Set([...createMissingRequiredTopLevel, ...createMissingRequiredModel]));
  const editMissingRequired = Array.from(new Set([...editMissingRequiredTopLevel, ...editMissingRequiredModel]));

  const modelByKey = useMemo(
    () => new Map(availableModels.map((model) => [model.key, model])),
    [availableModels],
  );

  const completionStatusByUsId = useMemo(() => {
    const status = new Map<number, "bozza" | "completa">();
    for (const us of usList) {
      const form = mapUsToForm(us);
      const modelForUs = modelByKey.get(form.schedaModelKey || activeModelKey) || activeModel;
      const missingTopLevelCount = requiredTopLevelFields.filter(({ key }) => {
        const value = (form as Record<string, unknown>)[key];
        return !isFieldFilled(value);
      }).length;
      const missingModelCount = missingRequiredModelFields(form, modelForUs).length;
      status.set(us.id, missingTopLevelCount + missingModelCount === 0 ? "completa" : "bozza");
    }
    return status;
  }, [usList, modelByKey, activeModelKey, activeModel, requiredTopLevelFields]);

  const counts = { ok: 0, warning: 0, error: 0, pending: 0 };
  for (const us of usList) {
    const s = (us.qcStatus || "pending") as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  const linkedGoogleDocId = String(cantiereData?.googleDocId || "").trim();
  const linkedGoogleDocUrl = linkedGoogleDocId
    ? `https://docs.google.com/document/d/${linkedGoogleDocId}/edit`
    : "";
  const isAiSourceSubmitting =
    requestAiFill.isPending || requestAiFillDocx.isPending || requestAiFillGoogle.isPending;

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
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => navigate(`/cantiere/${cid}/materiali${filterGiornata !== "all" ? `?giornataId=${filterGiornata}` : ""}`)}
          >
            <Package size={15} /> Materiali
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate(`/cantiere/${cid}/matrix`)}>
            <GitBranch size={15} /> Apri Matrix
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setOpenModelDialog(true)}>
            <Settings2 size={15} /> Modello US
          </Button>
          <div className="min-w-52">
              <Select
                value={filterGiornata}
                onValueChange={(value) => {
                  setFilterGiornata(value);
                  navigate(`/cantiere/${cid}/us${value !== "all" ? `?giornataId=${value}` : ""}`);
                }}
              >
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
          <Button
            data-testid="button-nuova-us"
            className="gap-2"
            onClick={() => {
              setCreateForm((prev) => ({
                ...prev,
                giornataId: filterGiornata !== "all" ? filterGiornata : prev.giornataId,
              }));
              setOpenCreate(true);
            }}
          >
            <Plus size={16} /> Nuova US
          </Button>
        </div>
      </div>

      <USModelDialog
        open={openModelDialog}
        onOpenChange={setOpenModelDialog}
        modelDraftKey={modelDraftKey}
        activeModelKey={activeModelKey}
        availableModels={availableModels}
        isUsModelsLoading={isUsModelsLoading}
        isCantiereModelLoading={isCantiereModelLoading}
        usModelsError={usModelsError}
        cantiereModelError={cantiereModelError}
        applyPending={setCantiereModel.isPending}
        applyError={setCantiereModel.isError}
        onSelectModel={onSelectCantiereModel}
        currentDraftModel={currentDraftModel}
        canDeleteDraftModel={canDeleteDraftModel}
        deleteCustomModelPending={deleteCustomModel.isPending}
        onDeleteDraftModel={() => deleteCustomModel.mutate(modelDraftKey)}
        customModelName={customModelName}
        setCustomModelName={setCustomModelName}
        customModelDescription={customModelDescription}
        setCustomModelDescription={setCustomModelDescription}
        customModelFieldsRaw={customModelFieldsRaw}
        setCustomModelFieldsRaw={setCustomModelFieldsRaw}
        createCustomModelPending={createCustomModel.isPending}
        onCreateCustomModel={() => createCustomModel.mutate()}
      />

      <USFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        title="Registra Unita Stratigrafica"
        form={createForm}
        setForm={setCreateForm}
        giornate={giornate}
        activeModel={activeModel}
        usThesaurus={usThesaurus}
        missingRequired={createMissingRequired}
        onSubmit={() => createUS.mutate({ data: { ...createForm, schedaModelKey: activeModelKey }, saveMode: "final" })}
        submitPending={createUS.isPending}
        submitLabelIdle="Registra US completa"
        submitLabelPending="Salvataggio..."
        submitDisabled={!createForm.codiceUS || createUS.isPending || createMissingRequired.length > 0}
        onSaveDraft={() => createUS.mutate({ data: { ...createForm, schedaModelKey: activeModelKey }, saveMode: "draft" })}
        draftLabelIdle="Salva bozza"
        draftLabelPending="Salvataggio bozza..."
        draftDisabled={!createForm.codiceUS || createUS.isPending}
        onImportedAiTextNotice={() => {
          toast({ title: "Testo importato - clicca Analisi AI per compilare i campi" });
        }}
      />

      <USFormDialog
        open={openEdit}
        onOpenChange={(value) => {
          setOpenEdit(value);
          if (!value) setEditingId(null);
        }}
        title="Modifica Unita Stratigrafica"
        form={editForm}
        setForm={setEditForm}
        giornate={giornate}
        activeModel={editModel}
        usThesaurus={usThesaurus}
        missingRequired={editMissingRequired}
        onSubmit={() => {
          if (editingId) updateUS.mutate({ id: editingId, data: editForm, saveMode: "final" });
        }}
        submitPending={updateUS.isPending}
        submitLabelIdle="Salva come completa"
        submitLabelPending="Aggiornamento..."
        submitDisabled={!editForm.codiceUS || !editingId || updateUS.isPending || editMissingRequired.length > 0}
        onSaveDraft={() => {
          if (editingId) updateUS.mutate({ id: editingId, data: editForm, saveMode: "draft" });
        }}
        draftLabelIdle="Salva bozza"
        draftLabelPending="Aggiornamento bozza..."
        draftDisabled={!editForm.codiceUS || !editingId || updateUS.isPending}
        onImportedAiTextNotice={() => {
          toast({ title: "Testo importato - clicca Analisi AI per compilare i campi" });
        }}
        onTriggerAiAnalysis={() => {
          if (editingId) {
            // Save as draft first, then trigger AI fill for field suggestions
            updateUS.mutate(
              { id: editingId, data: editForm, saveMode: "draft" },
              {
                onSuccess: () => {
                  requestAiFill.mutate({ usId: editingId, source: "descrizione" });
                },
              },
            );
          }
        }}
      />

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

          <USAllegatiImpact isLoading={isLoadingDeleteImpact} deleteImpact={deleteImpact} />

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

      <DiarioSourceDialog
        open={aiSourceDialogOpen}
        onOpenChange={(value) => {
          setAiSourceDialogOpen(value);
          if (!value && !isAiSourceSubmitting) {
            setAiSourceTarget(null);
          }
        }}
        usCode={aiSourceTarget?.codiceUS}
        defaultGoogleDocUrl={linkedGoogleDocUrl}
        hasLinkedGoogleDoc={!!linkedGoogleDocId}
        isSubmitting={isAiSourceSubmitting}
        onSubmitGiornata={() => {
          if (!aiSourceTarget) return;
          requestAiFill.mutate({ usId: aiSourceTarget.id, source: "entrambi" });
        }}
        onSubmitDocx={(file) => {
          if (!aiSourceTarget) return;
          requestAiFillDocx.mutate({ usId: aiSourceTarget.id, file });
        }}
        onSubmitGoogleDoc={(url) => {
          if (!aiSourceTarget) return;
          requestAiFillGoogle.mutate({ usId: aiSourceTarget.id, url });
        }}
      />

      <AiFillPanel
        open={aiFillOpen}
        onOpenChange={(value) => {
          setAiFillOpen(value);
          if (!value && !applyAiFill.isPending) {
            setAiFillTarget(null);
            setAiFillSuggestions(null);
          }
        }}
        suggestions={aiFillSuggestions}
        isApplying={applyAiFill.isPending}
        usCode={aiFillTarget?.codiceUS}
        onApply={(fields) => {
          if (!aiFillTarget) return;
          applyAiFill.mutate({ usId: aiFillTarget.id, fields });
        }}
      />

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
              completionStatus={completionStatusByUsId.get(us.id) || "bozza"}
              onGenerate={(id) => generateScheda.mutate(id)}
              onAiFill={(item) => {
                setAiSourceTarget(item);
                setAiSourceDialogOpen(true);
              }}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              onOpenMateriali={(selectedUs) => {
                const params = new URLSearchParams({ usId: String(selectedUs.id) });
                if (filterGiornata !== "all") params.set("giornataId", filterGiornata);
                navigate(`/cantiere/${cid}/materiali?${params.toString()}`);
              }}
              aiAvailable={aiAvailable}
            />
          ))}
        </div>
      )}
    </div>
  );
}











