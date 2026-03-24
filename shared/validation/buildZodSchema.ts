import { z, type ZodTypeAny } from "zod";
import { getEntityFields } from "../documentation_schema";
import type { FieldDefinition, SchemaDefinition, SchemaEntityType } from "../types/schema";

function fieldToZodType(field: FieldDefinition): ZodTypeAny {
  const { type, required, vocabulary } = field;
  let base: ZodTypeAny;
  switch (type) {
    case "textarea":
    case "text":
    case "date":
      base = z.string();
      break;
    case "number":
      base = z.coerce.number();
      break;
    case "boolean":
      base = z.coerce.boolean();
      break;
    case "select":
      base = z.string().refine(
        (value) => !Array.isArray(vocabulary) || vocabulary.length === 0 || vocabulary.includes(value),
        "Valore non ammesso",
      );
      break;
    case "multiselect":
      base = z.string().refine((value) => {
        if (!Array.isArray(vocabulary) || vocabulary.length === 0) return true;
        const trimmed = String(value || "").trim();
        if (!trimmed) return true;

        let values: string[] = [];
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            values = parsed.map((item) => String(item || "").trim()).filter(Boolean);
          } else {
            values = trimmed.split(/[|,;\n]+/g).map((item) => item.trim()).filter(Boolean);
          }
        } catch {
          values = trimmed.split(/[|,;\n]+/g).map((item) => item.trim()).filter(Boolean);
        }

        return values.every((item) => vocabulary.includes(item));
      }, "Valore non ammesso");
      break;
    default:
      base = z.any();
      break;
  }

  if (required) return base;

  // Optional fields often travel as null from existing payload builders.
  // Normalize null -> undefined so validation treats them as "not provided".
  return z.preprocess(
    (value) => (value === null ? undefined : value),
    base.optional(),
  );
}

export function buildEntityZodSchema(
  schema: SchemaDefinition,
  entity: SchemaEntityType,
  options?: { allowUnknown?: boolean },
) {
  const shape: Record<string, ZodTypeAny> = {};
  const fields = getEntityFields(schema, entity);
  for (const field of fields) {
    shape[field.key] = fieldToZodType(field);
  }

  const zodObject = z.object(shape);
  return options?.allowUnknown === false ? zodObject.strict() : zodObject.passthrough();
}

export function buildZodSchema(schema: SchemaDefinition) {
  return buildEntityZodSchema(schema, "us");
}
