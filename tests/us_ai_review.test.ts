import test from "node:test";
import assert from "node:assert/strict";
import { analyzeUsRelations } from "../server/us_ai_review";
import { diffWords } from "../client/src/lib/wordDiff";
import type { Cantiere, UnitaStratigrafica } from "../shared/schema";

const cantiere = { id: 1, nome: "Saggio", codice: "S1", usModelKey: "base-us" } as unknown as Cantiere;

function us(id: number, codiceUS: string, extra: Record<string, unknown> = {}): UnitaStratigrafica {
  return { id, cantiereId: 1, codiceUS, schedaData: null, ...extra } as unknown as UnitaStratigrafica;
}

test("rapporto inverso mancante: propone di aggiungerlo sull'altra US", () => {
  const list = [us(1, "US 10", { copre: "US 11" }), us(2, "US 11", {})];
  const { proposals } = analyzeUsRelations(list[0], list, cantiere, new Map());
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].usId, 2);
  assert.equal(proposals[0].field, "coperto_da");
  assert.equal(proposals[0].newValue, "US 10");
  assert.equal(proposals[0].origin, "controllo");
});

test("rapporto dichiarato dall'altra US e non qui: propone di aggiungerlo a questa scheda", () => {
  const list = [us(1, "US 10", {}), us(2, "US 11", { taglia: "" , schedaData: JSON.stringify({ taglia: "US 10" }) })];
  const { proposals } = analyzeUsRelations(list[0], list, cantiere, new Map());
  assert.deepEqual(
    proposals.map((p) => [p.usId, p.field, p.newValue]),
    [[1, "tagliatoDa", "US 11"]],
  );
});

test("i codici si confrontano senza prefisso e zeri: 'US 011' = '11'", () => {
  const list = [us(1, "US 10", { copre: "11" }), us(2, "US 011", { coperto_da: "US 10" })];
  const { proposals, findings } = analyzeUsRelations(list[0], list, cantiere, new Map());
  assert.equal(proposals.length, 0);
  assert.equal(findings.length, 0);
});

test("autoriferimento: propone di toglierlo", () => {
  const list = [us(1, "US 10", { copre: "US 10, US 11" }), us(2, "US 11", { coperto_da: "US 10" })];
  const { proposals } = analyzeUsRelations(list[0], list, cantiere, new Map());
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].field, "copre");
  assert.equal(proposals[0].newValue, "US 11");
  assert.equal(proposals[0].severity, "alta");
});

test("US inesistente e contraddizione copre/coperto_da diventano segnalazioni", () => {
  const list = [
    us(1, "US 10", { copre: "US 11, US 99", coperto_da: "US 11" }),
    us(2, "US 11", { coperto_da: "US 10", copre: "US 10" }),
  ];
  const { findings } = analyzeUsRelations(list[0], list, cantiere, new Map());
  assert.ok(findings.some((f) => /US 99/.test(f.message) && /non esiste/.test(f.message)));
  assert.ok(findings.some((f) => /si contraddicono/.test(f.message)));
});

test("diffWords evidenzia solo le parole cambiate", () => {
  const parts = diffWords("lo strato e compatto", "lo strato è compatto e scuro")!;
  const added = parts.filter((p) => p.kind === "add").map((p) => p.text.trim());
  const removed = parts.filter((p) => p.kind === "del").map((p) => p.text.trim());
  assert.ok(removed.includes("e"));
  assert.ok(added.some((t) => t.includes("è")) && added.some((t) => t.includes("scuro")));
  assert.equal(diffWords("uguale", "uguale")!.every((p) => p.kind === "same"), true);
});
