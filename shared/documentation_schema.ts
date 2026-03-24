import {
  BASE_US_MODEL_KEY,
  ICCD_US_2021_MODEL,
  ICCD_US_2021_MODEL_KEY,
  type USModelFieldType,
} from "./us_models";
import { US_TIPO_THESAURUS, usDefinizioneSuggestions } from "./us_thesaurus";

export type DocumentationMode = "iccd" | "custom";
export type DocumentationExportMode = "iccd_strict" | "iccd_extended" | "custom";
export type DocumentationEntityType = "us" | "sas" | "ra";

export type DocumentationFieldType = USModelFieldType | "number" | "boolean";

export type DocumentationFieldDefinition = {
  key: string;
  code?: string;
  label: string;
  type: DocumentationFieldType;
  required?: boolean;
  vocabulary?: string[];
  help?: string;
};

export type DocumentationParagraphDefinition = {
  acronym: string;
  label: string;
  fields: DocumentationFieldDefinition[];
};

export type DocumentationSchemaModules = Record<DocumentationEntityType, DocumentationParagraphDefinition[]>;

export type DocumentationSchemaDefinition = {
  key: string;
  label: string;
  version: string;
  description?: string;
  mode: DocumentationMode;
  exportMode: DocumentationExportMode;
  usModelKey: string;
  modules: DocumentationSchemaModules;
  // Legacy alias kept for backward compatibility on older files.
  paragraphs?: DocumentationParagraphDefinition[];
};

export type ProjectDocumentationConfig = {
  documentationMode: DocumentationMode;
  schemaKey: string;
  exportMode: DocumentationExportMode;
  defaultUsModelKey: string;
};

export type ProjectSchemaPreset = ProjectDocumentationConfig & {
  key: string;
  label: string;
  description: string;
  locked: boolean;
  schema: DocumentationSchemaDefinition;
};

export type ProjectSchemaPresetSummary = Omit<ProjectSchemaPreset, "schema">;

export const ARCHEODOC_CUSTOM_SCHEMA_KEY = "archeodoc-us-base-v1";
export const ICCD_US_SCHEMA_KEY = "iccd-us-2021-v1";

const ARCHEODOC_BASE_US_FIELDS: DocumentationFieldDefinition[] = [
  { key: "codiceUS", code: "US_CD", label: "Codice US", type: "text", required: true },
  { key: "tipo", code: "US_TP", label: "Tipo", type: "text", vocabulary: [...US_TIPO_THESAURUS] },
  { key: "definizione", code: "US_DF", label: "Definizione", type: "textarea", vocabulary: usDefinizioneSuggestions() },
  { key: "descrizione", code: "US_DS", label: "Descrizione", type: "textarea", required: true },
  { key: "interpretazione", code: "US_IN", label: "Interpretazione", type: "textarea" },
  { key: "quota", code: "US_QT", label: "Quota", type: "number" },
  { key: "settore", code: "US_ST", label: "Settore", type: "text" },
  { key: "coperto_da", code: "US_REL1", label: "Coperto da", type: "text" },
  { key: "copre", code: "US_REL2", label: "Copre", type: "text" },
  { key: "si_lega_a", code: "US_REL3", label: "Si lega a", type: "text" },
  { key: "uguale_a", code: "US_REL4", label: "Uguale a", type: "text" },
  { key: "periodoIniziale", code: "US_PI", label: "Periodo iniziale", type: "text" },
  { key: "periodoFinale", code: "US_PF", label: "Periodo finale", type: "text" },
  { key: "materialiRinvenuti", code: "US_MR", label: "Materiali rinvenuti", type: "textarea" },
  { key: "campioni", code: "US_CP", label: "Campioni", type: "textarea" },
];

const ARCHEODOC_BASE_SAS_FIELDS: DocumentationFieldDefinition[] = [
  { key: "codice", code: "SAS_CD", label: "Codice SAS", type: "text", required: true },
  { key: "nome", code: "SAS_NM", label: "Nome SAS", type: "text" },
  { key: "descrizione", code: "SAS_DS", label: "Descrizione", type: "textarea" },
  { key: "area", code: "SAS_AR", label: "Area", type: "text" },
  { key: "quotaMedia", code: "SAS_QM", label: "Quota media", type: "number" },
];

const ARCHEODOC_BASE_RA_FIELDS: DocumentationFieldDefinition[] = [
  { key: "codice", code: "RA_CD", label: "Codice RA", type: "text", required: true },
  { key: "tipo", code: "RA_TP", label: "Tipo reperto", type: "text" },
  { key: "descrizione", code: "RA_DS", label: "Descrizione", type: "textarea" },
  { key: "quantita", code: "RA_QT", label: "Quantita", type: "number" },
  { key: "statoConservazione", code: "RA_SC", label: "Stato conservazione", type: "text" },
];

const ICCD_US_FIELDS: DocumentationFieldDefinition[] = ICCD_US_2021_MODEL.fields.map((field) => ({
  key: field.key,
  code: field.key.toUpperCase(),
  label: field.label,
  type: field.type,
  required: !!field.required,
  vocabulary: field.options,
  help: field.help,
}));

const ICCD_SAS_FIELDS: DocumentationFieldDefinition[] = [
  { key: "codice", code: "SAS_CD", label: "Codice SAS", type: "text", required: true },
  { key: "enteResponsabile", code: "SAS_ER", label: "Ente responsabile", type: "text", required: true },
  { key: "localita", code: "SAS_LOC", label: "Localita", type: "text" },
  { key: "metodologiaScavo", code: "SAS_MET", label: "Metodologia scavo", type: "textarea" },
  { key: "cronologia", code: "SAS_CRN", label: "Cronologia", type: "text" },
];

const ICCD_RA_FIELDS: DocumentationFieldDefinition[] = [
  { key: "codice", code: "RA_CD", label: "Codice RA", type: "text", required: true },
  { key: "classeMateriale", code: "RA_CM", label: "Classe materiale", type: "text", required: true },
  { key: "descrizione", code: "RA_DS", label: "Descrizione", type: "textarea" },
  { key: "datazione", code: "RA_DT", label: "Datazione", type: "text" },
  { key: "statoConservazione", code: "RA_SC", label: "Stato conservazione", type: "text" },
];

const ARCHEODOC_CUSTOM_SCHEMA: DocumentationSchemaDefinition = {
  key: ARCHEODOC_CUSTOM_SCHEMA_KEY,
  label: "Schema ArcheoDoc personalizzabile",
  version: "1.0.0",
  description: "Schema base flessibile per documentazione di scavo con estensioni custom.",
  mode: "custom",
  exportMode: "custom",
  usModelKey: BASE_US_MODEL_KEY,
  modules: {
    us: [
      {
        acronym: "US",
        label: "Unita Stratigrafica",
        fields: ARCHEODOC_BASE_US_FIELDS,
      },
    ],
    sas: [
      {
        acronym: "SAS",
        label: "Saggio / Settore di Scavo",
        fields: ARCHEODOC_BASE_SAS_FIELDS,
      },
    ],
    ra: [
      {
        acronym: "RA",
        label: "Reperto Archeologico",
        fields: ARCHEODOC_BASE_RA_FIELDS,
      },
    ],
  },
  paragraphs: [
    {
      acronym: "US",
      label: "Unita Stratigrafica",
      fields: ARCHEODOC_BASE_US_FIELDS,
    },
  ],
};

const ICCD_US_SCHEMA: DocumentationSchemaDefinition = {
  key: ICCD_US_SCHEMA_KEY,
  label: "Schema ICCD US 2021",
  version: "2021",
  description: "Compilazione secondo impostazione ICCD US 2021.",
  mode: "iccd",
  exportMode: "iccd_strict",
  usModelKey: ICCD_US_2021_MODEL_KEY,
  modules: {
    us: [
      {
        acronym: "US",
        label: "Scheda Unita Stratigrafica (ICCD)",
        fields: ICCD_US_FIELDS,
      },
    ],
    sas: [
      {
        acronym: "SAS",
        label: "Scheda SAS (impostazione ICCD)",
        fields: ICCD_SAS_FIELDS,
      },
    ],
    ra: [
      {
        acronym: "RA",
        label: "Scheda RA (impostazione ICCD)",
        fields: ICCD_RA_FIELDS,
      },
    ],
  },
  paragraphs: [
    {
      acronym: "US",
      label: "Scheda Unita Stratigrafica (ICCD)",
      fields: ICCD_US_FIELDS,
    },
  ],
};

const PROJECT_SCHEMA_PRESETS: ProjectSchemaPreset[] = [
  {
    key: ARCHEODOC_CUSTOM_SCHEMA_KEY,
    label: "Schema personalizzato ArcheoDoc",
    description: "Schema base modificabile con campi e thesauri personalizzati.",
    locked: true,
    documentationMode: "custom",
    exportMode: "custom",
    defaultUsModelKey: BASE_US_MODEL_KEY,
    schemaKey: ARCHEODOC_CUSTOM_SCHEMA_KEY,
    schema: ARCHEODOC_CUSTOM_SCHEMA,
  },
  {
    key: ICCD_US_SCHEMA_KEY,
    label: "Schema ufficiale ICCD (US 2021)",
    description: "Schema ministeriale con terminologia e struttura ICCD.",
    locked: true,
    documentationMode: "iccd",
    exportMode: "iccd_strict",
    defaultUsModelKey: ICCD_US_2021_MODEL_KEY,
    schemaKey: ICCD_US_SCHEMA_KEY,
    schema: ICCD_US_SCHEMA,
  },
];

export const DEFAULT_PROJECT_SCHEMA_PRESET_KEY = ARCHEODOC_CUSTOM_SCHEMA_KEY;

function cloneField(field: DocumentationFieldDefinition): DocumentationFieldDefinition {
  return {
    ...field,
    vocabulary: Array.isArray(field.vocabulary) ? [...field.vocabulary] : undefined,
  };
}

function cloneParagraph(paragraph: DocumentationParagraphDefinition): DocumentationParagraphDefinition {
  return {
    acronym: paragraph.acronym,
    label: paragraph.label,
    fields: paragraph.fields.map(cloneField),
  };
}

function cloneParagraphs(paragraphs: DocumentationParagraphDefinition[]): DocumentationParagraphDefinition[] {
  return paragraphs.map(cloneParagraph);
}

function emptyModules(): DocumentationSchemaModules {
  return {
    us: [],
    sas: [],
    ra: [],
  };
}

export function listProjectSchemaPresets(): ProjectSchemaPresetSummary[] {
  return PROJECT_SCHEMA_PRESETS.map(({ schema: _schema, ...summary }) => summary);
}

export function getProjectSchemaPreset(presetKey?: string | null): ProjectSchemaPreset {
  if (!presetKey) return PROJECT_SCHEMA_PRESETS[0];
  return PROJECT_SCHEMA_PRESETS.find((preset) => preset.key === presetKey) || PROJECT_SCHEMA_PRESETS[0];
}

export function getProjectSchemaPresetForMode(mode: DocumentationMode): ProjectSchemaPreset {
  if (mode === "iccd") {
    return PROJECT_SCHEMA_PRESETS.find((preset) => preset.documentationMode === "iccd") || PROJECT_SCHEMA_PRESETS[0];
  }
  return PROJECT_SCHEMA_PRESETS.find((preset) => preset.documentationMode === "custom") || PROJECT_SCHEMA_PRESETS[0];
}

export function getProjectSchemaDefinitionByKey(schemaKey?: string | null): DocumentationSchemaDefinition {
  return normalizeDocumentationSchemaDefinition(getProjectSchemaPreset(schemaKey).schema);
}

export function getEntityParagraphs(
  schema: DocumentationSchemaDefinition,
  entity: DocumentationEntityType,
): DocumentationParagraphDefinition[] {
  const modules = schema.modules;
  if (modules && Array.isArray(modules[entity])) {
    return cloneParagraphs(modules[entity]);
  }

  if (entity === "us" && Array.isArray(schema.paragraphs)) {
    return cloneParagraphs(schema.paragraphs);
  }

  return [];
}

export function getEntityFields(
  schema: DocumentationSchemaDefinition,
  entity: DocumentationEntityType,
): DocumentationFieldDefinition[] {
  return getEntityParagraphs(schema, entity).flatMap((paragraph) => paragraph.fields.map(cloneField));
}

export function normalizeDocumentationSchemaDefinition(
  schema: DocumentationSchemaDefinition | null | undefined,
): DocumentationSchemaDefinition {
  const fallback = getProjectSchemaPreset(DEFAULT_PROJECT_SCHEMA_PRESET_KEY).schema;
  if (!schema || typeof schema !== "object") {
    return {
      ...fallback,
      modules: {
        us: cloneParagraphs(fallback.modules.us),
        sas: cloneParagraphs(fallback.modules.sas),
        ra: cloneParagraphs(fallback.modules.ra),
      },
      paragraphs: cloneParagraphs(fallback.modules.us),
    };
  }

  const resolvedModules: DocumentationSchemaModules = emptyModules();
  for (const entity of ["us", "sas", "ra"] as DocumentationEntityType[]) {
    const moduleParagraphs = schema.modules?.[entity];
    if (Array.isArray(moduleParagraphs)) {
      resolvedModules[entity] = cloneParagraphs(moduleParagraphs);
    }
  }

  if (resolvedModules.us.length === 0 && Array.isArray(schema.paragraphs)) {
    resolvedModules.us = cloneParagraphs(schema.paragraphs);
  }

  if (resolvedModules.us.length === 0) {
    resolvedModules.us = cloneParagraphs(fallback.modules.us);
  }

  return {
    key: schema.key || fallback.key,
    label: schema.label || fallback.label,
    version: schema.version || fallback.version,
    description: schema.description || fallback.description,
    mode: schema.mode || fallback.mode,
    exportMode: schema.exportMode || fallback.exportMode,
    usModelKey: schema.usModelKey || fallback.usModelKey,
    modules: resolvedModules,
    paragraphs: cloneParagraphs(resolvedModules.us),
  };
}
