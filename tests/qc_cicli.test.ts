import test from "node:test";
import assert from "node:assert/strict";
import { checkAllUS, checkCicliStratigrafici } from "../server/qc";
import type { UnitaStratigrafica } from "../shared/schema";

const mk = (id: number, codiceUS: string, extra: Record<string, unknown> = {}) =>
  ({ id, codiceUS, cantiereId: 1, tipo: "US", ...extra }) as unknown as UnitaStratigrafica;
const scheda = (o: Record<string, string>) => JSON.stringify(o);

test("nessun ciclo in una sequenza corretta", () => {
  const list = [
    mk(1, "1", { copre: "2" }),
    mk(2, "2", { coperto_da: "1", copre: "3" }),
    mk(3, "3", { coperto_da: "2" }),
  ];
  assert.deepEqual(checkCicliStratigrafici(list), []);
});

test("ciclo tra 'riempie' e 'posteriore a' (caso reale 157/158)", () => {
  const list = [
    mk(1, "157", { schedaData: scheda({ riempie: "158", anterioreA: "158" }) }),
    mk(2, "158", { schedaData: scheda({ riempitoDa: "157", posterioreA: "157" }) }),
    mk(3, "159"),
  ];
  const issues = checkCicliStratigrafici(list);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((i) => i.usId).sort(), [1, 2]);
  assert.ok(issues.every((i) => i.livello === "error" && i.categoria === "coerenza"));
  assert.match(issues[0].messaggio, /157/);
  assert.match(issues[0].messaggio, /158/);
  assert.match(issues[0].messaggio, /riempie/);
});

test("ciclo lungo con inverse e disattivazione della regola", () => {
  const list = [
    mk(1, "1", { copre: "2" }),
    mk(2, "2", { copre: "3" }),
    mk(3, "3", { coperto_da: "2", schedaData: scheda({ tagliatoDa: "" , taglia: "1" }) }),
  ];
  const issues = checkCicliStratigrafici(list);
  assert.equal(issues.length, 3);
  assert.deepEqual(checkCicliStratigrafici(list, { levels: { rel_ciclo: "off" } }), []);
  assert.ok(checkAllUS(list, () => [], null).issues.some((i) => /ciclo stratigrafico/.test(i.messaggio)));
  assert.equal(checkAllUS(list, () => [], null).status, "error");
});

test("le relazioni orizzontali (uguale a, si lega a) non fanno cicli", () => {
  const list = [mk(1, "1", { uguale_a: "2" }), mk(2, "2", { uguale_a: "1", si_lega_a: "1" })];
  assert.deepEqual(checkCicliStratigrafici(list), []);
});
