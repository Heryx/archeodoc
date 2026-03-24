import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeUsDefinizione,
  normalizeUsTipo,
  normalizeUsDefinizioneWithVocabulary,
  normalizeUsTipoWithVocabulary,
  usDefinizioneSuggestions,
} from "../shared/us_thesaurus";

test("us_thesaurus: normalizza tipo da sinonimi", () => {
  assert.equal(normalizeUsTipo("Muratura"), "struttura");
  assert.equal(normalizeUsTipo("fossa"), "buca");
  assert.equal(normalizeUsTipo(""), null);
});

test("us_thesaurus: normalizza definizione da alias noti", () => {
  assert.equal(normalizeUsDefinizione("riporto", "strato"), "strato di riporto");
  assert.equal(normalizeUsDefinizione("humus", "strato"), "strato di humus");
});

test("us_thesaurus: suggerimenti dipendono dal tipo", () => {
  const strutture = usDefinizioneSuggestions("struttura");
  assert.ok(strutture.includes("muro in pietra"));

  const interfacce = usDefinizioneSuggestions("interfaccia");
  assert.ok(interfacce.includes("interfaccia di taglio"));
});

test("us_thesaurus: usa vocabolario progetto quando disponibile", () => {
  const tipoVocabulary = ["Strato speciale", "US negativa"];
  const definizioneVocabulary = ["Deposizione mista", "Riempimento rituale"];

  assert.equal(normalizeUsTipoWithVocabulary("us negativa", tipoVocabulary), "US negativa");
  assert.equal(
    normalizeUsDefinizioneWithVocabulary("riempimento rituale", "US negativa", definizioneVocabulary),
    "Riempimento rituale",
  );
});
