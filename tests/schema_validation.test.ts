import test from "node:test";
import assert from "node:assert/strict";

import {
  ARCHEODOC_CUSTOM_SCHEMA_KEY,
  getProjectSchemaDefinitionByKey,
} from "../shared/documentation_schema";
import { buildEntityZodSchema } from "../shared/validation/buildZodSchema";

test("schema_validation: campi opzionali text accettano null", () => {
  const schema = getProjectSchemaDefinitionByKey(ARCHEODOC_CUSTOM_SCHEMA_KEY);
  const validator = buildEntityZodSchema(schema, "us", { allowUnknown: true });

  const result = validator.safeParse({
    codiceUS: "US 001",
    descrizione: "Descrizione test",
    si_lega_a: null,
    uguale_a: null,
    periodoIniziale: null,
    periodoFinale: null,
  });

  assert.equal(result.success, true);
});

test("schema_validation: campi required restano obbligatori", () => {
  const schema = getProjectSchemaDefinitionByKey(ARCHEODOC_CUSTOM_SCHEMA_KEY);
  const validator = buildEntityZodSchema(schema, "us", { allowUnknown: true });

  const result = validator.safeParse({
    codiceUS: null,
    descrizione: "Descrizione test",
  });

  assert.equal(result.success, false);
});
