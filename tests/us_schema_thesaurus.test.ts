import test from "node:test";
import assert from "node:assert/strict";

import { getUsFieldVocabulary, getUsTopLevelThesaurusFromSchema } from "../shared/us_schema_thesaurus";
import type { SchemaDefinition } from "../shared/types/schema";

const schemaFixture: SchemaDefinition = {
  key: "custom",
  label: "Custom",
  version: "1",
  mode: "custom",
  exportMode: "custom",
  usModelKey: "base-us",
  modules: {
    us: [
      {
        acronym: "US",
        label: "Unita",
        fields: [
          { key: "tipo", label: "Tipo", type: "text", vocabulary: ["strato", "interfaccia"] },
          { key: "definizione", label: "Definizione", type: "textarea", vocabulary: ["strato di riporto"] },
        ],
      },
    ],
    sas: [],
    ra: [],
  },
  paragraphs: [],
};

test("us_schema_thesaurus: legge il vocabolario del campo", () => {
  const tipoVocabulary = getUsFieldVocabulary(schemaFixture, "tipo");
  assert.deepEqual(tipoVocabulary, ["strato", "interfaccia"]);
});

test("us_schema_thesaurus: ritorna thesaurus top-level", () => {
  const thesaurus = getUsTopLevelThesaurusFromSchema(schemaFixture);

  assert.deepEqual(thesaurus.tipo, ["strato", "interfaccia"]);
  assert.deepEqual(thesaurus.definizione, ["strato di riporto"]);
});

test("us_schema_thesaurus: usa vocabularies dello schema per chiavi senza campo di paragrafo", () => {
  // Tipico dello schema ICCD: "tipo" non e un campo di paragrafo, il vocabolario
  // e salvato nella mappa dedicata dello schema.
  const iccdSchema: SchemaDefinition = {
    key: "iccd-us-2021-v1",
    label: "ICCD",
    version: "1",
    mode: "iccd",
    exportMode: "iccd_strict",
    usModelKey: "iccd-us-2021",
    modules: {
      us: [{ acronym: "US", label: "Unita", fields: [{ key: "naturaUs", label: "Natura", type: "select" }] }],
      sas: [],
      ra: [],
    },
    paragraphs: [],
    vocabularies: { tipo: ["strato", "struttura", "crollo"] },
  };

  assert.deepEqual(getUsFieldVocabulary(iccdSchema, "tipo"), ["strato", "struttura", "crollo"]);
  assert.deepEqual(getUsTopLevelThesaurusFromSchema(iccdSchema).tipo, ["strato", "struttura", "crollo"]);
});