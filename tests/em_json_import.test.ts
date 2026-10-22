import test from "node:test";
import assert from "node:assert/strict";
import { buildEmJson } from "../server/em_json";
import { applyEmImport, planEmImport, EmImportError } from "../server/em_json_import";
import type { Cantiere, UnitaStratigrafica } from "../shared/schema";

const cantiere = { id: 1, nome: "Scavo", codice: "SC-1", usModelKey: "base-us" } as unknown as Cantiere;
const mk = (id: number, codiceUS: string, extra: Record<string, unknown> = {}) =>
  ({ id, codiceUS, cantiereId: 1, tipo: "US", ...extra }) as unknown as UnitaStratigrafica;

function fakeStorage(initial: UnitaStratigrafica[]) {
  const rows = initial.map((u) => ({ ...u }));
  let nextId = 100;
  return {
    rows,
    getUSList: () => rows,
    getUS: (id: number) => rows.find((r) => r.id === id),
    createUS: (data: any) => {
      const row = { id: nextId++, ...data };
      rows.push(row);
      return row;
    },
    updateUS: (id: number, data: any) => Object.assign(rows.find((r) => r.id === id)!, data),
  } as any;
}

const base = () => [
  mk(1, "1", { copre: JSON.stringify(["2"]) }),
  mk(2, "2", { coperto_da: "1", schedaData: JSON.stringify({ taglia: "3" }) }),
  mk(3, "3"),
];

test("round-trip: esportare e reimportare lo stesso cantiere non propone nulla", () => {
  for (const edgeMode of ["sequence", "physical"] as const) {
    const text = JSON.stringify(buildEmJson(cantiere, base(), { edgeMode }));
    const plan = planEmImport(text, base());
    assert.deepEqual(plan.newUnits, [], edgeMode);
    assert.deepEqual(plan.newRelations, [], edgeMode);
    assert.deepEqual(plan.conflicts, [], edgeMode);
    assert.ok(plan.stats.unchanged > 0);
  }
});

test("import: nuove US, nuovi rapporti, conflitti e periodi", () => {
  const doc = buildEmJson(cantiere, base(), { includeEpochs: false });
  doc.graph.nodes.push(
    { id: "US4", node_type: "US", name: "US4", description: "nuovo strato", data: {} },
    { id: "V1", node_type: "USVs", name: "USVs1", data: {} },
    { id: "EP1", node_type: "EpochNode", name: "Periodo II", data: {} },
  );
  doc.graph.edges.push(
    { id: "n1", edge_type: "is_after", source: "3", target: "US4" },
    { id: "n2", edge_type: "cuts", source: "US4", target: "3" }, // opposto a is_after 3->4: gia' in questo file
    { id: "n3", edge_type: "is_after", source: "2", target: "1" }, // contraddice 1 copre 2
    { id: "n4", edge_type: "has_first_epoch", source: "3", target: "EP1" },
    { id: "n5", edge_type: "has_property", source: "3", target: "V1" },
  );
  const plan = planEmImport(JSON.stringify(doc), base());
  assert.deepEqual(plan.newUnits.map((u) => u.code), ["US4"]);
  assert.ok(plan.newRelations.some((r) => r.source === "3" && r.target === "US4" && r.needsNewUnit));
  assert.ok(plan.conflicts.some((c) => c.source === "2" && c.target === "1"));
  assert.deepEqual(plan.periods.map((p) => [p.code, p.to]), [["3", "Periodo II"]]);
  assert.equal(plan.ignored.nodeTypes.USVs, 1);

  const storage = fakeStorage(base());
  const selected = [
    ...plan.newUnits.map((u) => `unit|${u.key}`),
    ...plan.newRelations.map((r) => r.key),
    ...plan.periods.map((p) => p.key),
  ];
  const result = applyEmImport(storage, cantiere, JSON.stringify(doc), selected);
  assert.equal(result.createdUnits, 1);
  assert.ok(result.addedRelations >= 1);
  assert.equal(result.updatedPeriods, 1);
  const us3 = storage.rows.find((r: any) => r.codiceUS === "3");
  const us4 = storage.rows.find((r: any) => r.codiceUS === "US4");
  assert.equal(us3.periodoIniziale, "Periodo II");
  assert.match(String(JSON.parse(us3.schedaData).posterioreA), /US4/);
  assert.match(String(JSON.parse(us4.schedaData).anterioreA), /3/);
  // una nuova lettura dello stesso file non ha piu' nulla da aggiungere
  const again = planEmImport(JSON.stringify(doc), storage.rows);
  assert.deepEqual(again.newUnits, []);
  assert.deepEqual(again.newRelations.filter((r) => !r.needsNewUnit), []);
});

test("import: file non validi", () => {
  assert.throws(() => planEmImport("non json", []), EmImportError);
  assert.throws(() => planEmImport(JSON.stringify({ header: { format: "x" } }), []), EmImportError);
  assert.throws(
    () => planEmImport(JSON.stringify({ header: { format: "em.json", version: "2.0" }, graph: { nodes: [], edges: [] } }), []),
    /Versione/,
  );
});
