import test from "node:test";
import assert from "node:assert/strict";
import { buildEmJson, emNodeType } from "../server/em_json";
import type { Cantiere, UnitaStratigrafica } from "../shared/schema";

const cantiere = { id: 1, nome: "Scavo", codice: "SC-1" } as unknown as Cantiere;
const us = (codiceUS: string, extra: Record<string, unknown> = {}) =>
  ({ id: Number(codiceUS.replace(/\D/g, "")) || 0, codiceUS, tipo: "US", ...extra }) as unknown as UnitaStratigrafica;

const list = [
  us("US 1", { copre: JSON.stringify(["US 2"]), periodoIniziale: "Periodo II" }),
  us("US 2", { taglia: JSON.stringify(["US 3"]), periodoIniziale: "Periodo I" }),
  us("US 3", { periodoIniziale: "Periodo I", uguale_a: JSON.stringify(["US 9"]) }),
  us("USM 4", { tipo: "USM" }),
  us("US 9"),
];

test("grafo: header, nodi e direzione is_after (piu' recente -> piu' antica)", () => {
  const doc = buildEmJson(cantiere, list);
  assert.equal(doc.header.format, "em.json");
  assert.match(doc.header.version, /^1\./);
  const ids = new Set(doc.graph.nodes.map((n) => n.id));
  for (const e of doc.graph.edges) {
    assert.ok(ids.has(e.source) && ids.has(e.target), `arco pendente ${e.id}`);
  }
  assert.ok(doc.graph.edges.some((e) => e.edge_type === "is_after" && e.source === "US1" && e.target === "US2"));
  assert.ok(doc.graph.edges.some((e) => e.edge_type === "is_after" && e.source === "US2" && e.target === "US3"));
  assert.equal(new Set(doc.graph.edges.map((e) => e.id)).size, doc.graph.edges.length);
});

test("grafo: tipi di nodo, equivalenze ed epoche", () => {
  assert.equal(emNodeType("USM"), "USM");
  assert.equal(emNodeType("USR"), "US");
  const doc = buildEmJson(cantiere, list);
  assert.equal(doc.graph.nodes.find((n) => n.id === "USM4")?.node_type, "USM");
  assert.ok(doc.graph.edges.some((e) => e.edge_type === "equals"));
  const epochs = doc.graph.nodes.filter((n) => n.node_type === "EpochNode").map((n) => n.name);
  // il periodo con le US piu' in alto nella matrice (piu' recenti) viene dichiarato per primo
  assert.deepEqual(epochs, ["Periodo II", "Periodo I"]);
  assert.ok(doc.graph.edges.some((e) => e.edge_type === "has_first_epoch" && e.source === "US1"));
  assert.equal(buildEmJson(cantiere, list, { includeEpochs: false }).graph.nodes.some((n) => n.node_type === "EpochNode"), false);
});

test("grafo: modalita' fisica usa cuts/overlies", () => {
  const doc = buildEmJson(cantiere, list, { edgeMode: "physical" });
  const types = new Set(doc.graph.edges.map((e) => e.edge_type));
  assert.ok(types.has("overlies") && types.has("cuts"));
  assert.ok(!types.has("is_after"));
});
