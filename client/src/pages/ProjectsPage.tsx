import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { FolderPlus, FolderOpen, CheckCircle2, Settings2, Plus, Trash2, Save, RefreshCcw } from "lucide-react";
import type {
  DocumentationFieldType,
  FieldDefinition,
  ParagraphDefinition,
  ProjectSchemaPresetSummary,
  SchemaDefinition,
  SchemaEntityType,
  SchemaModules,
} from "@shared/types/schema";

type ProjectItem = {
  id: string;
  name: string;
  projectRoot: string;
  dbPath: string;
  mediaDir: string;
  exportsDir: string;
  backupsDir: string;
  documentationMode: "iccd" | "custom";
  schemaKey: string;
  exportMode: "iccd_strict" | "iccd_extended" | "custom";
  defaultUsModelKey: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectsResponse = {
  workspaceRoot: string;
  currentProjectId: string | null;
  projects: ProjectItem[];
  schemaPresets: ProjectSchemaPresetSummary[];
};

type ProjectSchemaResponse = {
  project: ProjectItem;
  schema: SchemaDefinition;
  presets: ProjectSchemaPresetSummary[];
};

type CreateProjectForm = {
  name: string;
  projectId: string;
  basePath: string;
  documentationPresetKey: string;
};

const ENTITY_OPTIONS: Array<{ value: SchemaEntityType; label: string; description: string }> = [
  { value: "us", label: "US", description: "Unita Stratigrafica" },
  { value: "sas", label: "SAS", description: "Saggio / Settore" },
  { value: "ra", label: "RA", description: "Reperto Archeologico" },
];

const FIELD_TYPE_OPTIONS: Array<{ value: DocumentationFieldType; label: string }> = [
  { value: "text", label: "Testo" },
  { value: "textarea", label: "Testo lungo" },
  { value: "date", label: "Data" },
  { value: "select", label: "Thesaurus" },
  { value: "number", label: "Numero" },
  { value: "boolean", label: "Si/No" },
];

const emptyCreateForm: CreateProjectForm = {
  name: "",
  projectId: "",
  basePath: "",
  documentationPresetKey: "",
};

function defaultModules(): SchemaModules {
  return {
    us: [],
    sas: [],
    ra: [],
  };
}

function cloneParagraph(paragraph: ParagraphDefinition): ParagraphDefinition {
  return {
    acronym: paragraph.acronym || "",
    label: paragraph.label || "",
    fields: Array.isArray(paragraph.fields)
      ? paragraph.fields.map((field) => ({
          key: field.key || "",
          code: field.code || "",
          label: field.label || "",
          type: field.type || "text",
          required: !!field.required,
          vocabulary: Array.isArray(field.vocabulary) ? [...field.vocabulary] : undefined,
          help: field.help || "",
        }))
      : [],
  };
}

function ensureSchemaDefinition(schema: SchemaDefinition): SchemaDefinition {
  const modules = schema.modules || defaultModules();
  const usParagraphs = Array.isArray(modules.us)
    ? modules.us.map(cloneParagraph)
    : Array.isArray(schema.paragraphs)
      ? schema.paragraphs.map(cloneParagraph)
      : [];
  const sasParagraphs = Array.isArray(modules.sas) ? modules.sas.map(cloneParagraph) : [];
  const raParagraphs = Array.isArray(modules.ra) ? modules.ra.map(cloneParagraph) : [];

  return {
    ...schema,
    modules: {
      us: usParagraphs,
      sas: sasParagraphs,
      ra: raParagraphs,
    },
    paragraphs: usParagraphs,
  };
}

function normalizeKey(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function parseVocabulary(raw: string): string[] | undefined {
  const values = raw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function formatVocabulary(values?: string[]): string {
  if (!Array.isArray(values)) return "";
  return values.join("\n");
}

function newParagraph(entity: SchemaEntityType, position: number): ParagraphDefinition {
  return {
    acronym: `${entity.toUpperCase()}${position + 1}`,
    label: `${entity.toUpperCase()} paragrafo ${position + 1}`,
    fields: [],
  };
}

function newField(entity: SchemaEntityType, paragraphIndex: number, fieldIndex: number): FieldDefinition {
  return {
    key: `${entity}_field_${paragraphIndex + 1}_${fieldIndex + 1}`,
    label: "Nuovo campo",
    type: "text",
    required: false,
  };
}

function validateSchemaDraft(schema: SchemaDefinition): string | null {
  if (!schema.modules.us || schema.modules.us.length === 0) {
    return "Serve almeno un paragrafo per il modulo US.";
  }

  for (const entity of ENTITY_OPTIONS) {
    const paragraphs = schema.modules[entity.value] || [];
    const keys = new Set<string>();

    for (let pIndex = 0; pIndex < paragraphs.length; pIndex += 1) {
      const paragraph = paragraphs[pIndex];
      if (!paragraph.acronym.trim()) {
        return `${entity.label}: acronimo mancante nel paragrafo ${pIndex + 1}.`;
      }
      if (!paragraph.label.trim()) {
        return `${entity.label}: etichetta mancante nel paragrafo ${pIndex + 1}.`;
      }

      for (let fIndex = 0; fIndex < paragraph.fields.length; fIndex += 1) {
        const field = paragraph.fields[fIndex];
        const key = field.key.trim();
        const label = field.label.trim();

        if (!key) {
          return `${entity.label}: chiave mancante nel campo ${fIndex + 1} del paragrafo ${paragraph.acronym}.`;
        }
        if (!label) {
          return `${entity.label}: etichetta mancante nel campo ${key}.`;
        }
        if (keys.has(key)) {
          return `${entity.label}: chiave duplicata "${key}".`;
        }
        keys.add(key);

        if (field.type === "select" && (!field.vocabulary || field.vocabulary.length === 0)) {
          return `${entity.label}: il campo ${key} e di tipo thesaurus ma non ha voci.`;
        }
      }
    }
  }

  return null;
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const localProjectId = getCurrentProjectId();

  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateProjectForm>(emptyCreateForm);

  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [schemaProjectId, setSchemaProjectId] = useState<string | null>(null);
  const [schemaDraft, setSchemaDraft] = useState<SchemaDefinition | null>(null);
  const [schemaEntity, setSchemaEntity] = useState<SchemaEntityType>("us");
  const [presetDraftKey, setPresetDraftKey] = useState("");

  const { data, isLoading } = useQuery<ProjectsResponse>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!createForm.documentationPresetKey && data?.schemaPresets?.length) {
      setCreateForm((prev) => ({
        ...prev,
        documentationPresetKey: data.schemaPresets[0].key,
      }));
    }
  }, [createForm.documentationPresetKey, data?.schemaPresets]);

  useEffect(() => {
    if (!data?.currentProjectId) return;
    if (data.currentProjectId !== localProjectId) {
      setCurrentProjectId(data.currentProjectId);
    }
  }, [data?.currentProjectId, localProjectId]);

  const currentProjectId = localProjectId || data?.currentProjectId || null;

  const schemaQuery = useQuery<ProjectSchemaResponse>({
    queryKey: ["/api/projects", schemaProjectId, "schema"],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${schemaProjectId}/schema`)).json(),
    enabled: schemaDialogOpen && !!schemaProjectId,
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!schemaQuery.data) return;
    setSchemaDraft(ensureSchemaDefinition(schemaQuery.data.schema));
    setPresetDraftKey(schemaQuery.data.project.schemaKey);
  }, [schemaQuery.data]);

  const selectProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/select`, {});
      return projectId;
    },
    onSuccess: (projectId) => {
      setCurrentProjectId(projectId);
      queryClient.clear();
      window.location.hash = "#/";
      window.location.reload();
    },
    onError: () => toast({ title: "Errore selezione progetto", variant: "destructive" }),
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: createForm.name.trim(),
        projectId: createForm.projectId.trim() || null,
        basePath: createForm.basePath.trim() || null,
        documentationPresetKey: createForm.documentationPresetKey || null,
      };
      return (await apiRequest("POST", "/api/projects", payload)).json() as Promise<ProjectItem>;
    },
    onSuccess: (project) => {
      setOpenCreate(false);
      setCreateForm({
        ...emptyCreateForm,
        documentationPresetKey: data?.schemaPresets?.[0]?.key || "",
      });
      toast({ title: "Progetto creato" });
      setCurrentProjectId(project.id);
      queryClient.clear();
      window.location.hash = "#/";
      window.location.reload();
    },
    onError: (error: any) =>
      toast({
        title: "Errore creazione progetto",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const applyPresetMutation = useMutation({
    mutationFn: async ({ projectId, presetKey }: { projectId: string; presetKey: string }) =>
      (await apiRequest("POST", `/api/projects/${projectId}/schema-preset`, { presetKey })).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      await schemaQuery.refetch();
      toast({ title: "Preset schema applicato" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore applicazione preset",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const saveSchemaMutation = useMutation({
    mutationFn: async ({ projectId, schema }: { projectId: string; schema: SchemaDefinition }) =>
      (await apiRequest("PATCH", `/api/projects/${projectId}/schema`, { schema })).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      await schemaQuery.refetch();
      toast({ title: "Schema salvato" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore salvataggio schema",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const projectById = useMemo(() => {
    const map = new Map<string, ProjectItem>();
    for (const project of data?.projects || []) {
      map.set(project.id, project);
    }
    return map;
  }, [data?.projects]);

  const schemaProject = schemaProjectId ? projectById.get(schemaProjectId) : undefined;
  const schemaPresets = schemaQuery.data?.presets || data?.schemaPresets || [];
  const activeSchemaKey = schemaQuery.data?.project.schemaKey || schemaProject?.schemaKey;
  const editingDisabled = schemaQuery.data?.project.documentationMode !== "custom";

  function updateParagraphs(entity: SchemaEntityType, paragraphs: ParagraphDefinition[]) {
    setSchemaDraft((prev) => {
      if (!prev) return prev;
      const next = ensureSchemaDefinition(prev);
      next.modules[entity] = paragraphs.map(cloneParagraph);
      if (entity === "us") next.paragraphs = next.modules.us.map(cloneParagraph);
      return next;
    });
  }

  function addParagraph(entity: SchemaEntityType) {
    const current = schemaDraft?.modules[entity] || [];
    updateParagraphs(entity, [...current, newParagraph(entity, current.length)]);
  }

  function removeParagraph(entity: SchemaEntityType, paragraphIndex: number) {
    const current = schemaDraft?.modules[entity] || [];
    updateParagraphs(
      entity,
      current.filter((_, idx) => idx !== paragraphIndex),
    );
  }

  function updateParagraph(entity: SchemaEntityType, paragraphIndex: number, patch: Partial<ParagraphDefinition>) {
    const current = schemaDraft?.modules[entity] || [];
    const next = current.map((paragraph, idx) =>
      idx === paragraphIndex
        ? {
            ...paragraph,
            ...patch,
          }
        : paragraph,
    );
    updateParagraphs(entity, next);
  }

  function addField(entity: SchemaEntityType, paragraphIndex: number) {
    const current = schemaDraft?.modules[entity] || [];
    const next = current.map((paragraph, idx) => {
      if (idx !== paragraphIndex) return paragraph;
      return {
        ...paragraph,
        fields: [...paragraph.fields, newField(entity, paragraphIndex, paragraph.fields.length)],
      };
    });
    updateParagraphs(entity, next);
  }

  function removeField(entity: SchemaEntityType, paragraphIndex: number, fieldIndex: number) {
    const current = schemaDraft?.modules[entity] || [];
    const next = current.map((paragraph, pIdx) => {
      if (pIdx !== paragraphIndex) return paragraph;
      return {
        ...paragraph,
        fields: paragraph.fields.filter((_, fIdx) => fIdx !== fieldIndex),
      };
    });
    updateParagraphs(entity, next);
  }

  function updateField(
    entity: SchemaEntityType,
    paragraphIndex: number,
    fieldIndex: number,
    patch: Partial<FieldDefinition>,
  ) {
    const current = schemaDraft?.modules[entity] || [];
    const next = current.map((paragraph, pIdx) => {
      if (pIdx !== paragraphIndex) return paragraph;
      return {
        ...paragraph,
        fields: paragraph.fields.map((field, fIdx) => {
          if (fIdx !== fieldIndex) return field;
          return {
            ...field,
            ...patch,
          };
        }),
      };
    });
    updateParagraphs(entity, next);
  }

  function openSchemaEditor(projectId: string) {
    setSchemaProjectId(projectId);
    setSchemaEntity("us");
    setSchemaDraft(null);
    setSchemaDialogOpen(true);
  }

  function saveSchema() {
    if (!schemaProjectId || !schemaDraft) return;
    const normalized = ensureSchemaDefinition(schemaDraft);
    const validationError = validateSchemaDraft(normalized);
    if (validationError) {
      toast({
        title: "Schema non valido",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    saveSchemaMutation.mutate({
      projectId: schemaProjectId,
      schema: normalized,
    });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progetti dati</h1>
          <p className="text-muted-foreground mt-1">
            Ogni progetto usa database SQLite e cartelle dedicate (media, export, backup).
          </p>
        </div>

        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-nuovo-progetto" className="gap-2">
              <FolderPlus size={16} /> Nuovo progetto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crea progetto dati</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div>
                <Label>Nome progetto *</Label>
                <Input
                  placeholder="es. Scavo Via Roma 2026"
                  value={createForm.name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>

              <div>
                <Label>ID progetto (opzionale)</Label>
                <Input
                  placeholder="es. scavo-via-roma-2026"
                  value={createForm.projectId}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, projectId: event.target.value }))}
                />
              </div>

              <div>
                <Label>Percorso base (opzionale)</Label>
                <Input
                  placeholder={data?.workspaceRoot || "es. D:\\Scavi\\ArcheoDoc"}
                  value={createForm.basePath}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, basePath: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se vuoto usa il percorso predefinito: {data?.workspaceRoot || "..."}
                </p>
              </div>

              <div>
                <Label>Schema documentazione</Label>
                <Select
                  value={createForm.documentationPresetKey}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, documentationPresetKey: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona schema..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.schemaPresets || []).map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Puoi scegliere schema ministeriale ICCD oppure schema personalizzato.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={() => createProjectMutation.mutate()}
                disabled={
                  !createForm.name.trim() ||
                  !createForm.documentationPresetKey ||
                  createProjectMutation.isPending
                }
              >
                {createProjectMutation.isPending ? "Creazione..." : "Crea progetto"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((index) => (
            <div key={index} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !data || data.projects.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="font-medium">Nessun progetto disponibile</p>
          <p className="text-muted-foreground text-sm mt-1">Crea il primo progetto per iniziare</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.projects.map((project) => {
            const isCurrent = project.id === currentProjectId;
            const preset = (data.schemaPresets || []).find((item) => item.key === project.schemaKey);
            return (
              <Card key={project.id} className={isCurrent ? "border-primary/50" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{project.name}</CardTitle>
                        <Badge variant="outline">{project.documentationMode === "iccd" ? "ICCD" : "Custom"}</Badge>
                        {isCurrent && (
                          <Badge className="gap-1">
                            <CheckCircle2 size={12} /> Attivo
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1">{project.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => openSchemaEditor(project.id)}
                      >
                        <Settings2 size={13} /> Schema
                      </Button>
                      {!isCurrent && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          data-testid={`button-seleziona-progetto-${project.id}`}
                          onClick={() => selectProjectMutation.mutate(project.id)}
                          disabled={selectProjectMutation.isPending}
                        >
                          <FolderOpen size={13} /> Apri
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  <div>
                    <span className="font-medium text-foreground">Root:</span> {project.projectRoot}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Database:</span> {project.dbPath}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Media:</span> {project.mediaDir}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Schema:</span> {preset?.label || project.schemaKey}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Export mode:</span> {project.exportMode}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={schemaDialogOpen}
        onOpenChange={(value) => {
          setSchemaDialogOpen(value);
          if (!value) {
            setSchemaProjectId(null);
            setSchemaDraft(null);
          }
        }}
      >
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schema documentazione progetto</DialogTitle>
          </DialogHeader>

          {!schemaProjectId || schemaQuery.isLoading ? (
            <div className="text-sm text-muted-foreground py-6">Caricamento schema...</div>
          ) : schemaQuery.error ? (
            <div className="text-sm text-red-600 py-6">
              Errore caricamento schema: {(schemaQuery.error as Error).message}
            </div>
          ) : schemaDraft ? (
            <div className="space-y-5 mt-2">
              <div className="rounded-md border border-border p-3 bg-muted/20">
                <p className="text-sm font-medium">
                  Progetto: {schemaProject?.name || schemaQuery.data?.project.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Modalita documentazione:{" "}
                  {schemaQuery.data?.project.documentationMode === "iccd" ? "ICCD" : "Custom"}
                </p>
              </div>

              <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <Label>Preset schema</Label>
                  <Select value={presetDraftKey} onValueChange={setPresetDraftKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {schemaPresets.map((preset) => (
                        <SelectItem key={preset.key} value={preset.key}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    if (!schemaProjectId || !presetDraftKey) return;
                    applyPresetMutation.mutate({
                      projectId: schemaProjectId,
                      presetKey: presetDraftKey,
                    });
                  }}
                  disabled={
                    !schemaProjectId ||
                    !presetDraftKey ||
                    !activeSchemaKey ||
                    presetDraftKey === activeSchemaKey ||
                    applyPresetMutation.isPending
                  }
                >
                  <RefreshCcw size={14} />
                  {applyPresetMutation.isPending ? "Applico..." : "Applica preset"}
                </Button>
              </div>

              {editingDisabled ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Il progetto usa schema ICCD bloccato. Puoi solo applicare un altro preset.
                </div>
              ) : (
                <>
                  <Tabs value={schemaEntity} onValueChange={(value) => setSchemaEntity(value as SchemaEntityType)}>
                    <TabsList className="grid grid-cols-3 w-full">
                      {ENTITY_OPTIONS.map((entity) => (
                        <TabsTrigger key={entity.value} value={entity.value}>
                          {entity.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {ENTITY_OPTIONS.map((entity) => (
                      <TabsContent key={entity.value} value={entity.value} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{entity.description}</p>
                            <p className="text-xs text-muted-foreground">
                              Paragrafi: {(schemaDraft.modules[entity.value] || []).length}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => addParagraph(entity.value)}
                          >
                            <Plus size={13} /> Aggiungi paragrafo
                          </Button>
                        </div>

                        {(schemaDraft.modules[entity.value] || []).length === 0 ? (
                          <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                            Nessun paragrafo configurato per {entity.label}.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {(schemaDraft.modules[entity.value] || []).map((paragraph, paragraphIndex) => (
                              <Card key={`${entity.value}-${paragraphIndex}`}>
                                <CardHeader className="pb-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-medium">
                                      Paragrafo {paragraphIndex + 1}
                                    </div>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-red-600 hover:text-red-700"
                                      onClick={() => removeParagraph(entity.value, paragraphIndex)}
                                    >
                                      <Trash2 size={14} />
                                    </Button>
                                  </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                  <div className="grid md:grid-cols-2 gap-3">
                                    <div>
                                      <Label>Acronimo</Label>
                                      <Input
                                        value={paragraph.acronym}
                                        onChange={(event) =>
                                          updateParagraph(entity.value, paragraphIndex, {
                                            acronym: event.target.value.toUpperCase(),
                                          })
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label>Etichetta</Label>
                                      <Input
                                        value={paragraph.label}
                                        onChange={(event) =>
                                          updateParagraph(entity.value, paragraphIndex, {
                                            label: event.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Campi
                                      </p>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1"
                                        onClick={() => addField(entity.value, paragraphIndex)}
                                      >
                                        <Plus size={13} /> Campo
                                      </Button>
                                    </div>

                                    {paragraph.fields.length === 0 ? (
                                      <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                                        Nessun campo nel paragrafo.
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        {paragraph.fields.map((field, fieldIndex) => (
                                          <div
                                            key={`${entity.value}-${paragraphIndex}-${fieldIndex}`}
                                            className="rounded-md border border-border p-3 space-y-3"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-medium text-muted-foreground">
                                                Campo {fieldIndex + 1}
                                              </span>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7 text-red-600 hover:text-red-700"
                                                onClick={() => removeField(entity.value, paragraphIndex, fieldIndex)}
                                              >
                                                <Trash2 size={14} />
                                              </Button>
                                            </div>

                                            <div className="grid md:grid-cols-3 gap-3">
                                              <div>
                                                <Label>Chiave</Label>
                                                <Input
                                                  value={field.key}
                                                  onChange={(event) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      key: event.target.value,
                                                    })
                                                  }
                                                  onBlur={(event) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      key: normalizeKey(
                                                        event.target.value,
                                                        `field_${paragraphIndex + 1}_${fieldIndex + 1}`,
                                                      ),
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <Label>Etichetta</Label>
                                                <Input
                                                  value={field.label}
                                                  onChange={(event) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      label: event.target.value,
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <Label>Tipo</Label>
                                                <Select
                                                  value={field.type}
                                                  onValueChange={(value) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      type: value as DocumentationFieldType,
                                                      vocabulary:
                                                        value === "select"
                                                          ? field.vocabulary || ["Voce 1"]
                                                          : undefined,
                                                    })
                                                  }
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {FIELD_TYPE_OPTIONS.map((option) => (
                                                      <SelectItem key={option.value} value={option.value}>
                                                        {option.label}
                                                      </SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                            </div>

                                            <div className="grid md:grid-cols-2 gap-3 items-end">
                                              <div>
                                                <Label>Codice (opzionale)</Label>
                                                <Input
                                                  value={field.code || ""}
                                                  onChange={(event) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      code: event.target.value,
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div className="flex items-center gap-2 pb-2">
                                                <Checkbox
                                                  checked={!!field.required}
                                                  onCheckedChange={(checked) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      required: !!checked,
                                                    })
                                                  }
                                                />
                                                <Label>Campo obbligatorio</Label>
                                              </div>
                                            </div>

                                            {field.type === "select" && (
                                              <div>
                                                <Label>Thesaurus (una voce per riga)</Label>
                                                <Textarea
                                                  rows={4}
                                                  value={formatVocabulary(field.vocabulary)}
                                                  onChange={(event) =>
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      vocabulary: parseVocabulary(event.target.value),
                                                    })
                                                  }
                                                />
                                              </div>
                                            )}

                                            <div>
                                              <Label>Aiuto compilazione (opzionale)</Label>
                                              <Input
                                                value={field.help || ""}
                                                onChange={(event) =>
                                                  updateField(entity.value, paragraphIndex, fieldIndex, {
                                                    help: event.target.value,
                                                  })
                                                }
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                    ))}
                  </Tabs>

                  <div className="flex justify-end">
                    <Button className="gap-2" onClick={saveSchema} disabled={saveSchemaMutation.isPending}>
                      <Save size={14} />
                      {saveSchemaMutation.isPending ? "Salvataggio..." : "Salva schema custom"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Lo schema viene validato lato server e applicato subito ai moduli schema-driven (US, SAS, RA).
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-6">Nessuno schema disponibile.</div>
          )}
        </DialogContent>
      </Dialog>

      <div className="mt-6">
        <Button variant="ghost" onClick={() => navigate("/")}>
          Torna ai cantieri
        </Button>
      </div>
    </div>
  );
}
