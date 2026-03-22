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
    default:
      base = z.any();
      break;
  }

  if (required) return base;
  return base.optional();
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
