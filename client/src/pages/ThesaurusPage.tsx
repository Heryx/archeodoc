import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectItem } from "@/components/projects/types";
import type { ProjectSchemaPresetSummary, SchemaDefinition } from "@shared/types/schema";

type ThesaurusPageProps = {
  embedded?: boolean;
};

type ProjectsResponse = {
  currentProjectId: string | null;
  projects: ProjectItem[];
};

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
};

type ThesaurusField = {
  key: string;
  label: string;
  vocabulary: string[];
};

function cloneParagraphs(input: any[] | undefined): any[] {
  if (!Array.isArray(input)) return [];
  return input.map((paragraph) => ({
    acronym: paragraph?.acronym || "",
    label: paragraph?.label || "",
    fields: Array.isArray(paragraph?.fields)
      ? paragraph.fields.map((field: any) => ({
          key: field?.key || "",
          code: field?.code || "",
          label: field?.label || "",
          type: field?.type || "text",
          required: !!field?.required,
          vocabulary: Array.isArray(field?.vocabulary) ? [...field.vocabulary] : undefined,
          help: field?.help || "",
        }))
      : [],
  }));
}

function ensureSchemaDefinition(schema: SchemaDefinition): SchemaDefinition {
  const fallbackUs = Array.isArray(schema.paragraphs) ? cloneParagraphs(schema.paragraphs) : [];
  const us = Array.isArray(schema.modules?.us) ? cloneParagraphs(schema.modules.us) : fallbackUs;
  const sas = Array.isArray(schema.modules?.sas) ? cloneParagraphs(schema.modules.sas) : [];
  const ra = Array.isArray(schema.modules?.ra) ? cloneParagraphs(schema.modules.ra) : [];

  return {
    ...schema,
    modules: { us, sas, ra },
    paragraphs: cloneParagraphs(us),
  };
}

function parseVocabulary(raw: string): string[] {
  return raw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
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
        vocabulary,
      });
    }
  }

  return Array.from(byKey.values());
}

function applyVocabularyToSchema(schema: SchemaDefinition, fieldKey: string, values: string[]): SchemaDefinition {
  const vocabulary = mergeVocabulary([], values);
  const next = ensureSchemaDefinition(schema);

  next.modules.us = next.modules.us.map((paragraph) => ({
    ...paragraph,
    fields: (paragraph.fields || []).map((field) =>
      field.key === fieldKey
        ? {
            ...field,
            vocabulary: vocabulary.length > 0 ? vocabulary : undefined,
          }
        : field,
    ),
  }));
  next.paragraphs = cloneParagraphs(next.modules.us);

  return next;
}

export function ThesaurusPage({ embedded = false }: ThesaurusPageProps = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeProjectId = getCurrentProjectId();
  const [schemaDraft, setSchemaDraft] = useState<SchemaDefinition | null>(null);
  const [fieldKey, setFieldKey] = useState("");
  const [valuesRaw, setValuesRaw] = useState("");
  const [sqliteFile, setSqliteFile] = useState<File | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState("");

  const { data: projectsData } = useQuery<ProjectsResponse>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    staleTime: 0,
    refetchOnMount: true,
  });

  const projectId = activeProjectId || projectsData?.currentProjectId || null;

  const schemaQuery = useQuery<ProjectSchemaResponse>({
    queryKey: ["/api/projects", projectId, "schema"],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/schema`)).json(),
    enabled: !!projectId,
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!schemaQuery.data?.schema) {
      setSchemaDraft(null);
      return;
    }
    setSchemaDraft(ensureSchemaDefinition(schemaQuery.data.schema));
  }, [schemaQuery.data]);

  const thesaurusFields = useMemo(
    () => (schemaDraft ? extractUsThesaurusFields(schemaDraft) : []),
    [schemaDraft],
  );

  useEffect(() => {
    if (!thesaurusFields.length) {
      setFieldKey("");
      setValuesRaw("");
      return;
    }

    if (!fieldKey || !thesaurusFields.some((field) => field.key === fieldKey)) {
      setFieldKey(thesaurusFields[0].key);
      setValuesRaw(formatVocabulary(thesaurusFields[0].vocabulary));
      return;
    }

    const selected = thesaurusFields.find((field) => field.key === fieldKey);
    if (selected) {
      setValuesRaw(formatVocabulary(selected.vocabulary));
    }
  }, [thesaurusFields, fieldKey]);

  const editingDisabled = schemaQuery.data?.project.documentationMode !== "custom";

  const saveMutation = useMutation({
    mutationFn: async ({ currentProjectId, schema }: { currentProjectId: string; schema: SchemaDefinition }) =>
      (await apiRequest("PATCH", `/api/projects/${currentProjectId}/schema`, { schema })).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      await schemaQuery.refetch();
      toast({ title: "Thesaurus salvato" });
    },
    onError: (error: any) =>
      toast({
        title: "Errore salvataggio thesaurus",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const suggestFromDbMutation = useMutation({
    mutationFn: async ({ currentProjectId, currentFieldKey }: { currentProjectId: string; currentFieldKey: string }) =>
      (await apiRequest("POST", `/api/projects/${currentProjectId}/thesaurus/suggest-db`, { fieldKey: currentFieldKey })).json() as Promise<ThesaurusSuggestionResponse>,
    onSuccess: (payload) => {
      const current = parseVocabulary(valuesRaw);
      const merged = mergeVocabulary(current, payload.values || []);
      setValuesRaw(formatVocabulary(merged));
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
      currentFieldKey,
      file,
    }: {
      currentProjectId: string;
      currentFieldKey: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append("fieldKey", currentFieldKey);
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
      const current = parseVocabulary(valuesRaw);
      const merged = mergeVocabulary(current, payload.values || []);
      setValuesRaw(formatVocabulary(merged));
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

  function handleSave() {
    if (!projectId || !schemaDraft || !fieldKey) return;

    const next = applyVocabularyToSchema(schemaDraft, fieldKey, parseVocabulary(valuesRaw));
    setSchemaDraft(next);

    saveMutation.mutate({
      currentProjectId: projectId,
      schema: next,
    });
  }

  const wrapperClass = embedded ? "p-4 space-y-4" : "p-8 max-w-4xl mx-auto space-y-6";

  if (!projectId) {
    return (
      <div className={wrapperClass}>
        <p className="text-sm text-muted-foreground">Nessun progetto attivo: seleziona prima un progetto dati.</p>
      </div>
    );
  }

  if (schemaQuery.isLoading) {
    return (
      <div className={wrapperClass}>
        <div className="animate-pulse space-y-3">
          <div className="h-7 bg-muted rounded w-56" />
          <div className="h-28 bg-muted rounded" />
          <div className="h-44 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (schemaQuery.error || !schemaDraft) {
    return (
      <div className={wrapperClass}>
        <p className="text-sm text-red-600">
          Errore caricamento thesaurus: {(schemaQuery.error as Error)?.message || "schema non disponibile"}
        </p>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <div>
        <h1 className="text-2xl font-bold">Thesaurus</h1>
        <p className="text-muted-foreground mt-1">
          Gestisci le voci dei campi US con vocabolario controllato.
        </p>
      </div>

      <div className="rounded-md border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium">
          Progetto: {schemaQuery.data?.project.name || "N/D"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Modalita documentazione: {schemaQuery.data?.project.documentationMode === "iccd" ? "ICCD" : "Custom"}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid md:grid-cols-[1fr_1fr] gap-3">
          <div>
            <Label>Campo thesaurus US</Label>
            <Select value={fieldKey} onValueChange={setFieldKey} disabled={thesaurusFields.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona un campo..." />
              </SelectTrigger>
              <SelectContent>
                {thesaurusFields.map((field) => (
                  <SelectItem key={`th-field-${field.key}`} value={field.key}>
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
              onChange={(event) => setSqliteFile(event.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div>
          <Label>Voci thesaurus (una per riga)</Label>
          <Textarea
            rows={10}
            value={valuesRaw}
            onChange={(event) => setValuesRaw(event.target.value)}
            placeholder="Inserisci qui le voci del thesaurus..."
            disabled={!fieldKey}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!projectId || !fieldKey) return;
              suggestFromDbMutation.mutate({
                currentProjectId: projectId,
                currentFieldKey: fieldKey,
              });
            }}
            disabled={!projectId || !fieldKey || suggestFromDbMutation.isPending}
          >
            {suggestFromDbMutation.isPending ? "Analisi DB..." : "Suggerisci da DB progetto"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => {
              if (!projectId || !fieldKey || !sqliteFile) return;
              suggestFromSqliteMutation.mutate({
                currentProjectId: projectId,
                currentFieldKey: fieldKey,
                file: sqliteFile,
              });
            }}
            disabled={!projectId || !fieldKey || !sqliteFile || suggestFromSqliteMutation.isPending}
          >
            <Upload size={14} />
            {suggestFromSqliteMutation.isPending ? "Import SQLite..." : "Compila da SQLite"}
          </Button>

          <Button
            type="button"
            className="gap-2"
            onClick={handleSave}
            disabled={!fieldKey || editingDisabled || saveMutation.isPending}
          >
            <Save size={14} />
            {saveMutation.isPending ? "Salvataggio..." : "Salva thesaurus"}
          </Button>
        </div>

        {suggestionMeta && <p className="text-xs text-muted-foreground">{suggestionMeta}</p>}
        {editingDisabled && (
          <p className="text-xs text-amber-700">
            Progetto in modalita ICCD bloccata: puoi generare suggerimenti ma non salvare modifiche.
          </p>
        )}
      </div>
    </div>
  );
}
