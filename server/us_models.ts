import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "./projects";
import {
  BASE_US_FIELD_KEYS,
  BASE_US_MODEL_KEY,
  BUILTIN_US_MODELS,
  type USModelDefinition,
  type USModelField,
  getBuiltinUSModel,
  isBuiltinUSModelKey,
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

function normalizeFieldKey(value: string): string {
  const asText = value
    .trim()
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
            if (!["text", "textarea", "date", "select"].includes(f.type)) return null;

            return {
              key: normalizeFieldKey(f.key),
              label: String(f.label).trim(),
              type: f.type,
              required: !!f.required,
              locked: false,
              options: Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : undefined,
              help: typeof f.help === "string" && f.help.trim() ? f.help.trim() : undefined,
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
    const type = (["text", "textarea", "date", "select"].includes(typeRaw) ? typeRaw : "text") as USModelField["type"];
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

    if (type === "select" && (!options || options.length === 0)) {
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

export function listUSModels(project: ProjectDefinition): USModelDefinition[] {
  return [...BUILTIN_US_MODELS, ...parseCustomModels(getCustomModelsPath(project))];
}

export function getUSModel(project: ProjectDefinition, modelKey?: string | null): USModelDefinition {
  const key = modelKey?.trim() || BASE_US_MODEL_KEY;
  const builtin = getBuiltinUSModel(key);
  if (builtin) return builtin;

  const custom = parseCustomModels(getCustomModelsPath(project)).find((m) => m.key === key);
  return custom || BUILTIN_US_MODELS[0];
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
