import test from "node:test";
import assert from "node:assert/strict";
import { applySequenceRepair, planSequenceRepair } from "../server/sequence_repair";
import { checkCicliStratigrafici } from "../server/qc";
import type { UnitaStratigrafica } from "../shared/schema";

const mk = (id: number, codiceUS: string, extra: Record<string, unknown> = {}) =>
  ({ id, codiceUS, cantiereId: 1, tipo: "US", ...extra }) as unknown as UnitaStratigrafica;
const sd = (o: Record<string, string>) => JSON.stringify(o);

// Caso reale 100/102: 100 copre 102, ma 100.anteriore = 102 e 102.posteriore = 100
const list = () => [
  mk(1, "100", { copre: "102", schedaData: sd({ posterioreA: "102", anterioreA: "102" }) }),
  mk(2, "102", { coperto_da: "100", schedaData: sd({ posterioreA: "100, 103", anterioreA: "100" }) }),
  mk(3, "103", {}),
];

test("propone di togliere solo le voci che contraddicono i rapporti fisici", () => {
  const plan = planSequenceRepair(list());
  const text = plan.items.map((i) => `${i.code}:${i.field}:${i.value}`).sort();
  assert.deepEqual(text, ["100:anterioreA:102", "102:posterioreA:100"]);
  assert.ok(plan.cyclesBefore > 0);
  assert.equal(plan.cyclesAfter, 0);
});

test("applica solo le voci scelte e conserva le altre", () => {
  const rows = list().map((u) => ({ ...u }));
  const storage = {
    getUSList: () => rows,
    getUS: (id: number) => rows.find((r) => r.id === id),
    updateUS: (id: number, d: any) => Object.assign(rows.find((r) => r.id === id)!, d),
  } as any;
  const plan = planSequenceRepair(rows);
  const res = applySequenceRepair(storage, 1, plan.items.map((i) => i.key));
  assert.deepEqual(res, { removed: 2, usUpdated: 2 });
  assert.deepEqual(JSON.parse(rows[0].schedaData!), { posterioreA: "102", anterioreA: "" });
  // 103 resta in "posteriore a" di 102: nessun rapporto fisico lo contraddice
  assert.deepEqual(JSON.parse(rows[1].schedaData!), { posterioreA: "103", anterioreA: "100" });
  assert.equal(checkCicliStratigrafici(rows).length, 0);
  assert.equal(planSequenceRepair(rows).items.length, 0);

  // senza selezione non cambia nulla
  const untouched = list().map((u) => ({ ...u }));
  const s2 = { ...storage, getUSList: () => untouched, getUS: (id: number) => untouched.find((r) => r.id === id), updateUS: (id: number, d: any) => Object.assign(untouched.find((r) => r.id === id)!, d) };
  assert.deepEqual(applySequenceRepair(s2 as any, 1, []), { removed: 0, usUpdated: 0 });
});

test("le colonne dirette posteriore_a / anteriore_a sono trattate come la scheda", () => {
  const l = [
    mk(1, "1", { copre: "2", posterioreA: "2", anterioreA: "2" }),
    mk(2, "2", { coperto_da: "1" }),
  ];
  const plan = planSequenceRepair(l);
  assert.deepEqual(plan.items.map((i) => i.field), ["anterioreA"]);
});
