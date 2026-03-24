import test from "node:test";
import assert from "node:assert/strict";

import { __test as parserTest } from "../server/google_docs_parser";

test("google_docs_parser: mappa campi ICCD e normalizza NAT/ART", () => {
  const us: Record<string, unknown> = { numero: 205 };

  const naturaKey = parserTest.normalizeKey("Natura US (NAT/ART)");
  const areaKey = parserTest.normalizeKey("Area");
  const criteriKey = parserTest.normalizeKey("Criteri di distinzione");

  assert.equal(parserTest.assignUsField(us as any, naturaKey, "naturale"), true);
  assert.equal(parserTest.assignUsField(us as any, areaKey, "Area Nord"), true);
  assert.equal(
    parserTest.assignUsField(us as any, criteriKey, "Cambio netto di colore e consistenza rispetto alla US 204"),
    true,
  );

  assert.equal(us.naturaUs, "NAT - Naturale");
  assert.equal(us.areaEdificioStruttura, "Area Nord");
  assert.equal(us.criteriDistinzione, "Cambio netto di colore e consistenza rispetto alla US 204");
});

test("google_docs_parser: estrae relazioni stratigrafiche senza duplicati", () => {
  const us: Record<string, unknown> = { numero: 206 };
  const key = parserTest.normalizeKey("Riempito da");

  const assigned = parserTest.assignUsField(us as any, key, "US 12, US12, 44 e 44");

  assert.equal(assigned, true);
  assert.deepEqual(us.riempita_da, [12, 44]);
});

test("google_docs_parser: missing fields include nuovi campi strutturati", () => {
  const us = {
    numero: 207,
    tipo: "Strato",
    definizione: "Riporto",
    colore: "10YR 4/3",
    consistenza: "Friabile",
    misure: "1.2 x 0.8",
    interpretazione: "Riempimento moderno",
  };

  const missing = parserTest.computeMissingFields(us as any);

  assert.ok(missing.includes("naturaUs"));
  assert.ok(missing.includes("criteriDistinzione"));
  assert.ok(missing.includes("affidabilitaStratigrafica"));
});