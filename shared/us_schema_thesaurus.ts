import type { FieldDefinition, SchemaDefinition } from "./types/schema";
import type { USThesaurusConfig } from "./us_thesaurus";

function collectUSFields(schema: SchemaDefinition | null | undefined): FieldDefinition[] {
  if (!schema || typeof schema !== "object") return [];

  const modules = schema.modules;
  if (modules && Array.isArray(modules.us)) {
    return modules.us.flatMap((paragraph) => paragraph.fields || []);
  }

  if (Array.isArray(schema.paragraphs)) {
    return schema.paragraphs.flatMap((paragraph) => paragraph.fields || []);
  }

  return [];
}

function cleanVocabulary(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

export function getUsFieldVocabulary(
  schema: SchemaDefinition | null | undefined,
  fieldKey: string,
): string[] {
  const normalizedKey = String(fieldKey || "").trim();
  if (!normalizedKey) return [];

  const fields = collectUSFields(schema);
  for (const field of fields) {
    if ((field.key || "").trim() !== normalizedKey) continue;
    const vocabulary = cleanVocabulary(field.vocabulary);
    if (vocabulary.length > 0) return vocabulary;
  }

  return [];
}

export function getUsTopLevelThesaurusFromSchema(
  schema: SchemaDefinition | null | undefined,
): USThesaurusConfig {
  return {
    tipo: getUsFieldVocabulary(schema, "tipo"),
    definizione: getUsFieldVocabulary(schema, "definizione"),
  };
}
