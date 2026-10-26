import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "./projects";
import { buildModelFieldsFromTemplate } from "./docx_template_utils";
import { resolveUSTemplatePath } from "./us_template_path";
import {
  BASE_US_FIELD_KEYS,
  BASE_US_MODEL_KEY,
  BUILTIN_US_MODELS,
  type USModelDefinition,
  type USModelField,
  checkboxGroupForKey,
  getBuiltinUSModel,
  isBuiltinUSModelKey,
  isCheckboxPlaceholder,
} from "@shared/us_models";

type CustomModelInput = {
  key?: string;
  name?: string;
  description?: string | null;
  fields?: unknown;
};

const CUSTOM_MODELS_FILENAME = "us_models.custom.json";

function getCustomModelsPath(project: ProjectDefinition): string {
  return path.join(project.projectRoot, CUSTOM_MODELS_FILENAME);
}

function normalizeKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);

  return normalized || `us-model-${Date.now()}`;
}

export function normalizeFieldKey(value: string): string {
  // Un identificatore già valido (es. un placeholder del template: "chkIntatto", "uguale_a") va conservato
  // com'è: abbassarlo di caso lo scollegherebbe dal {placeholder} del documento.
  const trimmed = value.trim();
  if (/^[a-z][A-Za-z0-9_]*$/.test(trimmed)) return trimmed;

  const asText = trimmed
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.toLowerCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`))
    .join("");

  return asText || `field${Date.now()}`;
}

function parseCustomModels(filePath: string): USModelDefinition[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];

    const out: USModelDefinition[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const model = item as USModelDefinition;
      if (!model.key || typeof model.key !== "string") continue;
      if (!model.name || typeof model.name !== "string") continue;
      if (!Array.isArray(model.fields)) continue;

      out.push({
        key: normalizeKey(model.key),
        name: model.name.trim(),
        source: "custom",
        locked: false,
        description: model.description?.trim() || undefined,
        fields: model.fields
          .map((field): USModelField | null => {
            if (!field || typeof field !== "object") return null;
            const f = field as USModelField;
            if (!f.key || !f.label) return null;
            if (!["text", "textarea", "date", "select", "multiselect", "checkbox"].includes(f.type)) return null;

            // Modelli creati prima del tipo "checkbox": i placeholder chkXxx erano salvati come testo.
            const key = normalizeFieldKey(f.key);
            const type = f.type === "text" && isCheckboxPlaceholder(key) ? "checkbox" : f.type;

            return {
              key,
              label: String(f.label).trim(),
              type,
              required: !!f.required,
              locked: false,
              options: Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : undefined,
              help: typeof f.help === "string" && f.help.trim() ? f.help.trim() : undefined,
              group: type === "checkbox" ? (f.group || checkboxGroupForKey(key)) : undefined,
            };
          })
          .filter((field): field is USModelField => !!field),
      });
    }

    return out;
  } catch {
    return [];
  }
}

function saveCustomModels(project: ProjectDefinition, models: USModelDefinition[]): void {
  const filePath = getCustomModelsPath(project);
  fs.writeFileSync(filePath, JSON.stringify(models, null, 2), "utf8");
}

function toFieldList(fields: unknown): USModelField[] {
  if (!Array.isArray(fields)) {
    throw new Error("Lista campi modello non valida");
  }

  const out: USModelField[] = [];
  const seenKeys = new Set<string>();

  for (let index = 0; index < fields.length; index += 1) {
    const raw = fields[index];
    if (!raw || typeof raw !== "object") {
      throw new Error(`Campo modello non valido alla posizione ${index + 1}`);
    }

    const item = raw as Record<string, unknown>;
    const label = String(item.label || "").trim();
    if (!label) {
      throw new Error(`Etichetta campo obbligatoria alla posizione ${index + 1}`);
    }

    const typeRaw = String(item.type || "text").toLowerCase();
    const type = (
      ["text", "textarea", "date", "select", "multiselect", "checkbox"].includes(typeRaw) ? typeRaw : "text"
    ) as USModelField["type"];
    const key = normalizeFieldKey(String(item.key || label));
    if (BASE_US_FIELD_KEYS.has(key)) {
      throw new Error(`Il campo '${label}' usa una chiave riservata (${key})`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Chiave campo duplicata: ${key}`);
    }
    seenKeys.add(key);

    const options = Array.isArray(item.options)
      ? item.options.map((v) => String(v).trim()).filter(Boolean)
      : undefined;

    if ((type === "select" || type === "multiselect") && (!options || options.length === 0)) {
      throw new Error(`Il campo '${label}' richiede almeno una opzione`);
    }

    out.push({
      key,
      label,
      type,
      required: !!item.required,
      locked: false,
      options,
      help: typeof item.help === "string" && item.help.trim() ? item.help.trim() : undefined,
      group:
        type === "checkbox"
          ? (typeof item.group === "string" && item.group.trim()) || checkboxGroupForKey(key)
          : undefined,
    });
  }

  return out;
}

function nextCustomModelKey(project: ProjectDefinition, preferred: string): string {
  const allKeys = new Set(listUSModels(project).map((m) => m.key));
  if (!allKeys.has(preferred)) return preferred;

  let i = 2;
  let candidate = `${preferred}-${i}`;
  while (allKeys.has(candidate)) {
    i += 1;
    candidate = `${preferred}-${i}`;
  }
  return candidate;
}

/** Mappa key->{help,options} dei campi built-in (ICCD/Estesa) che hanno un aiuto o un vocabolario
 * definito. Usata per arricchire a runtime i modelli custom generati da template, i cui campi
 * (creati solo da placeholder DOCX) non hanno mai help/vocabolario propri. */
const BUILTIN_FIELD_INFO_BY_KEY: Map<string, { help?: string; options?: string[] }> = (() => {
  const map = new Map<string, { help?: string; options?: string[] }>();
  for (const model of BUILTIN_US_MODELS) {
    for (const field of model.fields) {
      if (!field.help && !field.options) continue;
      if (map.has(field.key)) continue;
      map.set(field.key, { help: field.help, options: field.options });
    }
  }
  return map;
})();

/** Arricchisce i campi di un modello custom con help/opzioni built-in per le chiavi coincidenti
 * (es. "colore", "consistenza"), senza sovrascrivere help/opzioni già presenti sul campo custom
 * e senza persistere nulla: l'arricchimento avviene solo in lettura, ad ogni richiesta. */
function withBuiltinFieldInfo(model: USModelDefinition): USModelDefinition {
  let changed = false;
  const fields = model.fields.map((field) => {
    const info = BUILTIN_FIELD_INFO_BY_KEY.get(field.key);
    if (!info) return field;
    if (field.help && field.options) return field;
    changed = true;
    return {
      ...field,
      help: field.help || info.help,
      options: field.options || info.options,
    };
  });
  return changed ? { ...model, fields } : model;
}

export function listUSModels(project: ProjectDefinition): USModelDefinition[] {
  return [
    ...BUILTIN_US_MODELS,
    ...parseCustomModels(getCustomModelsPath(project)).map(withBuiltinFieldInfo),
  ];
}

export function getUSModel(project: ProjectDefinition, modelKey?: string | null): USModelDefinition {
  const key = modelKey?.trim() || BASE_US_MODEL_KEY;
  const builtin = getBuiltinUSModel(key);
  if (builtin) return builtin;

  const custom = parseCustomModels(getCustomModelsPath(project)).find((m) => m.key === key);
  if (custom) return withBuiltinFieldInfo(custom);
  // Modello non trovato: logga e cade sul base invece di fallire silenziosamente
  console.warn(`[getUSModel] Modello "${key}" non trovato, fallback su base`);
  return BUILTIN_US_MODELS[0];
}

export function createCustomUSModel(project: ProjectDefinition, input: CustomModelInput): USModelDefinition {
  const name = input.name?.trim();
  if (!name) throw new Error("Nome modello obbligatorio");

  const fields = toFieldList(input.fields);
  if (fields.length === 0) {
    throw new Error("Definisci almeno un campo");
  }

  const baseKey = normalizeKey(input.key?.trim() || name);
  if (isBuiltinUSModelKey(baseKey)) {
    throw new Error("La chiave modello e riservata");
  }

  const custom = parseCustomModels(getCustomModelsPath(project));
  const existingKeys = new Set(custom.map((m) => m.key));
  const modelKey = existingKeys.has(baseKey) ? nextCustomModelKey(project, baseKey) : baseKey;

  const created: USModelDefinition = {
    key: modelKey,
    name,
    source: "custom",
    locked: false,
    description: input.description?.trim() || undefined,
    fields,
  };

  custom.push(created);
  saveCustomModels(project, custom);
  return created;
}

export function updateCustomUSModel(project: ProjectDefinition, modelKey: string, input: CustomModelInput): USModelDefinition {
  if (isBuiltinUSModelKey(modelKey)) {
    throw new Error("I modelli ministeriali non sono modificabili");
  }

  const custom = parseCustomModels(getCustomModelsPath(project));
  const index = custom.findIndex((m) => m.key === modelKey);
  if (index === -1) {
    throw new Error("Modello personalizzato non trovato");
  }

  const current = custom[index];
  const updated: USModelDefinition = {
    ...current,
    name: input.name?.trim() || current.name,
    description: input.description === undefined ? current.description : input.description?.trim() || undefined,
    fields: input.fields === undefined ? current.fields : toFieldList(input.fields),
    source: "custom",
    locked: false,
  };

  custom[index] = updated;
  saveCustomModels(project, custom);
  return updated;
}

export function deleteCustomUSModel(project: ProjectDefinition, modelKey: string): void {
  if (isBuiltinUSModelKey(modelKey)) {
    throw new Error("I modelli ministeriali non sono eliminabili");
  }

  const custom = parseCustomModels(getCustomModelsPath(project));
  const next = custom.filter((m) => m.key !== modelKey);
  if (next.length === custom.length) {
    throw new Error("Modello personalizzato non trovato");
  }
  saveCustomModels(project, next);
}

/**
 * Riallinea le voci di un modello personalizzato al suo template DOCX (quello specifico del modello,
 * altrimenti il generico): la scheda mostra le stesse voci del documento, nello stesso ordine.
 * Restituisce null se il modello non è personalizzato o non c'è nessun template.
 */
export async function syncModelFieldsWithTemplate(
  project: ProjectDefinition,
  modelKey: string,
): Promise<{ model: USModelDefinition; added: string[]; removed: string[]; total: number } | null> {
  const current = parseCustomModels(getCustomModelsPath(project)).find((m) => m.key === modelKey);
  if (!current) return null;
  const templatePath = resolveUSTemplatePath(project, modelKey);
  if (!templatePath) return null;

  const { fields: templateFields } = await buildModelFieldsFromTemplate(templatePath);
  const previousByKey = new Map(current.fields.map((f) => [f.key, f]));
  const fields = templateFields.map((f) => {
    const prev = previousByKey.get(f.key);
    return prev ? { ...f, required: prev.required, help: prev.help } : f;
  });

  const nextKeys = new Set(fields.map((f) => f.key));
  const added = fields.filter((f) => !previousByKey.has(f.key)).map((f) => f.key);
  const removed = current.fields.filter((f) => !nextKeys.has(f.key)).map((f) => f.key);

  const model = updateCustomUSModel(project, modelKey, { fields });
  return { model, added, removed, total: fields.length };
}
