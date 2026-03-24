import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getProjectHeader } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, Save, Trash2, Upload } from "lucide-react";
import type { ProjectItem } from "@/components/projects/types";
import type {
  DocumentationFieldType,
  FieldDefinition,
  ParagraphDefinition,
  ProjectSchemaPresetSummary,
  SchemaDefinition,
  SchemaEntityType,
  SchemaModules,
} from "@shared/types/schema";

type ProjectSchemaResponse = {
  project: ProjectItem;
  schema: SchemaDefinition;
  presets: ProjectSchemaPresetSummary[];
};

type ThesaurusSuggestionResponse = {
  source: "project-db" | "sqlite";
  fieldKey: string;
  values: string[];
  tableName?: string;
  columnName?: string;
  warnings?: string[];
};

type ThesaurusField = {
  key: string;
  label: string;
  type: DocumentationFieldType;
  vocabulary: string[];
};

type ProjectSchemaDialogProps = {
  open: boolean;
  projectId: string | null;
  projectName?: string;
  fallbackPresets: ProjectSchemaPresetSummary[];
  onOpenChange: (open: boolean) => void;
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
  { value: "multiselect", label: "Scelta multipla" },
  { value: "number", label: "Numero" },
  { value: "boolean", label: "Si/No" },
];

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

function mergeVocabulary(base: string[], incoming: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of [...base, ...incoming]) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

function extractUsThesaurusFields(schema: SchemaDefinition): ThesaurusField[] {
  const byKey = new Map<string, ThesaurusField>();
  const paragraphs = schema.modules?.us || [];

  for (const paragraph of paragraphs) {
    for (const field of paragraph.fields || []) {
      const key = String(field.key || "").trim();
      if (!key) continue;

      const shouldExpose =
        field.type === "select" ||
        field.type === "multiselect" ||
        key === "tipo" ||
        key === "definizione" ||
        (Array.isArray(field.vocabulary) && field.vocabulary.length > 0);

      if (!shouldExpose) continue;

      const existing = byKey.get(key);
      const vocabulary = mergeVocabulary(existing?.vocabulary || [], field.vocabulary || []);
      byKey.set(key, {
        key,
        label: field.label || existing?.label || key,
        type: field.type,
        vocabulary,
      });
    }
  }

  return Array.from(byKey.values());
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

        if ((field.type === "select" || field.type === "multiselect") && (!field.vocabulary || field.vocabulary.length === 0)) {
          return `${entity.label}: il campo ${key} e di tipo thesaurus ma non ha voci.`;
        }
      }
    }
  }

  return null;
}

export function ProjectSchemaDialog({
  open,
  projectId,
  projectName,
  fallbackPresets,
  onOpenChange,
}: ProjectSchemaDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [schemaDraft, setSchemaDraft] = useState<SchemaDefinition | null>(null);
  const [schemaEntity, setSchemaEntity] = useState<SchemaEntityType>("us");
  const [presetDraftKey, setPresetDraftKey] = useState("");
  const [thesaurusFieldKey, setThesaurusFieldKey] = useState("");
  const [thesaurusValuesRaw, setThesaurusValuesRaw] = useState("");
  const [sqliteFile, setSqliteFile] = useState<File | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState<string>("");

  const schemaQuery = useQuery<ProjectSchemaResponse>({
    queryKey: ["/api/projects", projectId, "schema"],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/schema`)).json(),
    enabled: open && !!projectId,
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!schemaQuery.data) return;
    setSchemaDraft(ensureSchemaDefinition(schemaQuery.data.schema));
    setPresetDraftKey(schemaQuery.data.project.schemaKey);
  }, [schemaQuery.data]);

  const thesaurusFields = useMemo(
    () => (schemaDraft ? extractUsThesaurusFields(schemaDraft) : []),
    [schemaDraft],
  );

  useEffect(() => {
    if (!thesaurusFields.length) {
      setThesaurusFieldKey("");
      setThesaurusValuesRaw("");
      return;
    }

    if (!thesaurusFieldKey || !thesaurusFields.some((field) => field.key === thesaurusFieldKey)) {
      const first = thesaurusFields[0];
      setThesaurusFieldKey(first.key);
      setThesaurusValuesRaw(formatVocabulary(first.vocabulary));
      return;
    }

    const selected = thesaurusFields.find((field) => field.key === thesaurusFieldKey);
    if (selected) {
      setThesaurusValuesRaw(formatVocabulary(selected.vocabulary));
    }
  }, [thesaurusFields, thesaurusFieldKey]);

  const applyPresetMutation = useMutation({
    mutationFn: async ({ currentProjectId, presetKey }: { currentProjectId: string; presetKey: string }) =>
      (await apiRequest("POST", `/api/projects/${currentProjectId}/schema-preset`, { presetKey })).json(),
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
    mutationFn: async ({ currentProjectId, schema }: { currentProjectId: string; schema: SchemaDefinition }) =>
      (await apiRequest("PATCH", `/api/projects/${currentProjectId}/schema`, { schema })).json(),
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

  function applyThesaurusToDraft(fieldKey: string, vocabulary: string[]) {
    const cleaned = mergeVocabulary([], vocabulary);

    setSchemaDraft((prev) => {
      if (!prev) return prev;
      const next = ensureSchemaDefinition(prev);
      next.modules.us = next.modules.us.map((paragraph) => ({
        ...paragraph,
        fields: (paragraph.fields || []).map((field) => {
          if (field.key !== fieldKey) return field;
          return {
            ...field,
            vocabulary: cleaned.length > 0 ? cleaned : undefined,
          };
        }),
      }));
      next.paragraphs = next.modules.us.map(cloneParagraph);
      return next;
    });
  }

  const suggestFromDbMutation = useMutation({
    mutationFn: async ({ currentProjectId, fieldKey }: { currentProjectId: string; fieldKey: string }) =>
      (await apiRequest("POST", `/api/projects/${currentProjectId}/thesaurus/suggest-db`, { fieldKey })).json() as Promise<ThesaurusSuggestionResponse>,
    onSuccess: (payload) => {
      const current = parseVocabulary(thesaurusValuesRaw) || [];
      const merged = mergeVocabulary(current, payload.values || []);
      setThesaurusValuesRaw(formatVocabulary(merged));
      setSuggestionMeta(`Suggeriti ${payload.values.length} valori dal DB progetto.`);
      toast({ title: "Suggerimenti caricati dal DB progetto" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore suggerimenti dal DB",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const suggestFromSqliteMutation = useMutation({
    mutationFn: async ({
      currentProjectId,
      fieldKey,
      file,
    }: {
      currentProjectId: string;
      fieldKey: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append("fieldKey", fieldKey);
      formData.append("file", file);

      const response = await fetch(`/api/projects/${currentProjectId}/thesaurus/suggest-sqlite`, {
        method: "POST",
        headers: getProjectHeader(),
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text || "Errore import SQLite"}`);
      }

      return response.json() as Promise<ThesaurusSuggestionResponse>;
    },
    onSuccess: (payload) => {
      const current = parseVocabulary(thesaurusValuesRaw) || [];
      const merged = mergeVocabulary(current, payload.values || []);
      setThesaurusValuesRaw(formatVocabulary(merged));
      setSuggestionMeta(
        `Suggeriti ${payload.values.length} valori da SQLite (${payload.tableName || "tabella"}:${payload.columnName || "colonna"}).`,
      );
      toast({ title: "Suggerimenti importati da SQLite" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore import suggerimenti SQLite",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const schemaPresets = schemaQuery.data?.presets || fallbackPresets || [];
  const activeSchemaKey = schemaQuery.data?.project.schemaKey;
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

  function saveSchema() {
    if (!projectId || !schemaDraft) return;
    const normalized = ensureSchemaDefinition(schemaDraft);
    if (thesaurusFieldKey) {
      const values = parseVocabulary(thesaurusValuesRaw) || [];
      normalized.modules.us = normalized.modules.us.map((paragraph) => ({
        ...paragraph,
        fields: (paragraph.fields || []).map((field) =>
          field.key === thesaurusFieldKey
            ? { ...field, vocabulary: values.length > 0 ? values : undefined }
            : field,
        ),
      }));
      normalized.paragraphs = normalized.modules.us.map(cloneParagraph);
    }
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
      currentProjectId: projectId,
      schema: normalized,
    });
  }

  function handleOpenChange(value: boolean) {
    if (!value) {
      setSchemaDraft(null);
      setSchemaEntity("us");
      setPresetDraftKey("");
    }
    onOpenChange(value);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schema documentazione progetto</DialogTitle>
        </DialogHeader>

        {!projectId || schemaQuery.isLoading ? (
          <div className="text-sm text-muted-foreground py-6">Caricamento schema...</div>
        ) : schemaQuery.error ? (
          <div className="text-sm text-red-600 py-6">
            Errore caricamento schema: {(schemaQuery.error as Error).message}
          </div>
        ) : schemaDraft ? (
          <div className="space-y-5 mt-2">
            <div className="rounded-md border border-border p-3 bg-muted/20">
              <p className="text-sm font-medium">
                Progetto: {schemaQuery.data?.project.name || projectName || "N/D"}
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
                  if (!projectId || !presetDraftKey) return;
                  applyPresetMutation.mutate({
                    currentProjectId: projectId,
                    presetKey: presetDraftKey,
                  });
                }}
                disabled={
                  !projectId ||
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

            <Card>
              <CardHeader className="pb-2">
                <p className="text-sm font-medium">Sezione Thesaurus</p>
                <p className="text-xs text-muted-foreground">
                  Scegli il thesaurus da compilare e popola le voci manualmente, dal DB progetto o da file SQLite.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-[1fr_1fr] gap-3">
                  <div>
                    <Label>Thesaurus US</Label>
                    <Select value={thesaurusFieldKey} onValueChange={setThesaurusFieldKey} disabled={thesaurusFields.length === 0}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona un campo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {thesaurusFields.map((field) => (
                          <SelectItem key={`th-${field.key}`} value={field.key}>
                            {field.label} ({field.key})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>File SQLite (opzionale)</Label>
                    <Input
                      type="file"
                      accept=".sqlite,.db,.gpkg"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setSqliteFile(file);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <Label>Voci thesaurus (una per riga)</Label>
                  <Textarea
                    rows={8}
                    value={thesaurusValuesRaw}
                    onChange={(event) => setThesaurusValuesRaw(event.target.value)}
                    placeholder="Inserisci qui le voci del thesaurus..."
                    disabled={!thesaurusFieldKey}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!projectId || !thesaurusFieldKey) return;
                      suggestFromDbMutation.mutate({ currentProjectId: projectId, fieldKey: thesaurusFieldKey });
                    }}
                    disabled={!projectId || !thesaurusFieldKey || suggestFromDbMutation.isPending}
                  >
                    {suggestFromDbMutation.isPending ? "Analisi DB..." : "Suggerisci da DB progetto"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      if (!projectId || !thesaurusFieldKey || !sqliteFile) return;
                      suggestFromSqliteMutation.mutate({
                        currentProjectId: projectId,
                        fieldKey: thesaurusFieldKey,
                        file: sqliteFile,
                      });
                    }}
                    disabled={!projectId || !thesaurusFieldKey || !sqliteFile || suggestFromSqliteMutation.isPending}
                  >
                    <Upload size={14} />
                    {suggestFromSqliteMutation.isPending ? "Import SQLite..." : "Compila da SQLite"}
                  </Button>

                  <Button
                    type="button"
                    onClick={() => {
                      if (!thesaurusFieldKey) return;
                      const values = parseVocabulary(thesaurusValuesRaw) || [];
                      applyThesaurusToDraft(thesaurusFieldKey, values);
                      toast({ title: "Thesaurus applicato al draft schema" });
                    }}
                    disabled={!thesaurusFieldKey || editingDisabled}
                  >
                    Applica al draft
                  </Button>
                </div>

                {suggestionMeta && <p className="text-xs text-muted-foreground">{suggestionMeta}</p>}
                {editingDisabled && (
                  <p className="text-xs text-amber-700">
                    Il progetto ICCD e bloccato: puoi generare suggerimenti, ma non salvare modifiche thesaurus.
                  </p>
                )}
              </CardContent>
            </Card>

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
                                                  {
                                                    const preserveVocabulary =
                                                      value === "select" ||
                                                      value === "multiselect" ||
                                                      field.key === "tipo" ||
                                                      field.key === "definizione";
                                                    updateField(entity.value, paragraphIndex, fieldIndex, {
                                                      type: value as DocumentationFieldType,
                                                      vocabulary: preserveVocabulary
                                                        ? field.vocabulary || ["Voce 1"]
                                                        : undefined,
                                                    });
                                                  }
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

                                          {(field.type === "select" ||
                                            field.type === "multiselect" ||
                                            field.key === "tipo" ||
                                            field.key === "definizione") && (
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
  );
}
