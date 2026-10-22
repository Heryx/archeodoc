import test from "node:test";
import assert from "node:assert/strict";
import { buildEmJson } from "../server/em_json";
import { collectUnregistered, registerPeriodsFromUs, renamePeriod, suggestOrder } from "../server/periodi";
import type { Cantiere, Periodo, UnitaStratigrafica } from "../shared/schema";

const cantiere = { id: 1, nome: "Scavo", codice: "SC-1" } as unknown as Cantiere;
const mk = (id: number, codiceUS: string, extra: Record<string, unknown> = {}) =>
  ({ id, codiceUS, cantiereId: 1, tipo: "US", ...extra }) as unknown as UnitaStratigrafica;

// 1 copre 2 copre 3: 1 e' la piu' recente, 3 la piu' antica
const list = () => [
  mk(1, "1", { copre: "2", periodoIniziale: "Moderno" }),
  mk(2, "2", { coperto_da: "1", copre: "3", periodoIniziale: "Medievale", periodoFinale: " Moderno " }),
  mk(3, "3", { coperto_da: "2", periodoIniziale: "Romano" }),
  mk(4, "4"),
];

function fake(us: UnitaStratigrafica[], periodi: Periodo[] = []) {
  const rows = us.map((u) => ({ ...u }));
  const reg = periodi.map((p) => ({ ...p }));
  return {
    rows,
    reg,
    getUSList: () => rows,
    getPeriodi: () => [...reg].sort((a, b) => a.ordine - b.ordine),
    createPeriodo: (d: any) => {
      const row = { id: reg.length + 1, createdAt: "", ...d };
      reg.push(row);
      return row;
    },
    updatePeriodo: (id: number, d: any) => Object.assign(reg.find((p) => p.id === id)!, d),
    updateUS: (id: number, d: any) => Object.assign(rows.find((r) => r.id === id)!, d),
  } as any;
}

test("suggestOrder: dal piu' profondo (antico) al piu' recente", () => {
  assert.deepEqual(suggestOrder(list(), ["Moderno", "Romano", "Medievale", "Ignoto"]), [
    "Romano",
    "Medievale",
    "Moderno",
    "Ignoto",
  ]);
});

test("collectUnregistered e registrazione dai testi delle US", () => {
  const storage = fake(list());
  assert.deepEqual(
    collectUnregistered(list(), []).map((p) => [p.nome, p.count]),
    [["Medievale", 1], ["Moderno", 2], ["Romano", 1]],
  );
  const created = registerPeriodsFromUs(storage, 1);
  assert.deepEqual(created.map((p) => [p.nome, p.ordine]), [["Romano", 1], ["Medievale", 2], ["Moderno", 3]]);
  assert.deepEqual(collectUnregistered(storage.rows, storage.reg), []);
});

test("renamePeriod propaga il nuovo nome alle US", () => {
  const storage = fake(list(), [
    { id: 1, cantiereId: 1, nome: "Moderno", descrizione: null, ordine: 1, startTime: null, endTime: null, createdAt: "" },
  ]);
  const updated = renamePeriod(storage, storage.reg[0], "Eta moderna");
  assert.equal(updated, 2);
  assert.equal(storage.rows[0].periodoIniziale, "Eta moderna");
  assert.equal(storage.rows[1].periodoFinale, "Eta moderna");
  assert.equal(storage.reg[0].nome, "Eta moderna");
});

test("export grafo: epoche dal registro, dalla piu' recente, con le date", () => {
  const registry = [
    { id: 1, cantiereId: 1, nome: "Romano", descrizione: "impero", ordine: 1, startTime: -27, endTime: 476, createdAt: "" },
    { id: 2, cantiereId: 1, nome: "Medievale", descrizione: null, ordine: 2, startTime: 476, endTime: 1492, createdAt: "" },
  ] as Periodo[];
  const doc = buildEmJson(cantiere, list(), { periodi: registry });
  const epochs = doc.graph.nodes.filter((n) => n.node_type === "EpochNode");
  // registrati dal piu' recente; poi quelli scritti solo nelle US ("Moderno")
  assert.deepEqual(epochs.map((e) => e.name), ["Medievale", "Romano", "Moderno"]);
  assert.deepEqual(epochs[1].data, { start_time: -27, end_time: 476 });
  assert.equal(epochs[1].description, "impero");
  const romano = epochs[1].id;
  assert.ok(doc.graph.edges.some((e) => e.edge_type === "has_first_epoch" && e.source === "3" && e.target === romano));
  assert.equal(new Set(doc.graph.nodes.map((n) => n.id)).size, doc.graph.nodes.length);
});

test("parseCodeList e assegnazione a intervalli di US", async () => {
  const { parseCodeList, assignPeriod } = await import("../server/periodi");
  assert.deepEqual(parseCodeList("1-3, 7 USM4"), ["1", "2", "3", "7", "USM4"]);
  const storage = fake(list());
  const res = assignPeriod(storage, 1, "Tardoantico", parseCodeList("1-4, 99"));
  assert.equal(res.updated, 4);
  assert.deepEqual(res.notFound, ["99"]);
  assert.equal(res.created, true);
  assert.equal(storage.rows[3].periodoIniziale, "Tardoantico");
  assert.equal(storage.reg.length, 1);
});

test("storage SQLite reale: registro periodi, assegnazione, ordine e rinomina", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createStorage } = await import("../server/storage");
  const { assignPeriod, parseCodeList, reorderByStratigraphy, renamePeriod } = await import("../server/periodi");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "periodi-"));
  const storage = createStorage(path.join(dir, "t.db"));
  try {
    const c = storage.createCantiere({ codice: "T", nome: "T", localita: "x" } as any);
    storage.createUS({ cantiereId: c.id, codiceUS: "1", copre: "2" } as any);
    storage.createUS({ cantiereId: c.id, codiceUS: "2", coperto_da: "1", copre: "3" } as any);
    storage.createUS({ cantiereId: c.id, codiceUS: "3", coperto_da: "2" } as any);

    assignPeriod(storage, c.id, "Recente", parseCodeList("1"));
    assignPeriod(storage, c.id, "Antico", parseCodeList("3"));
    assert.deepEqual(storage.getPeriodi(c.id).map((p) => p.nome), ["Recente", "Antico"]);
    assert.deepEqual(reorderByStratigraphy(storage, c.id).map((p) => p.nome), ["Antico", "Recente"]);

    const antico = storage.getPeriodi(c.id)[0];
    storage.updatePeriodo(antico.id, { startTime: -50, endTime: 100 });
    assert.equal(storage.getPeriodo(antico.id)!.startTime, -50);
    renamePeriod(storage, antico, "Romano");
    assert.equal(storage.getUSList(c.id).find((u) => u.codiceUS === "3")!.periodoIniziale, "Romano");

    assert.throws(() => storage.createPeriodo({ cantiereId: c.id, nome: "Romano", ordine: 9 } as any)); // indice univoco
    storage.deleteCantiere(c.id);
    assert.deepEqual(storage.getPeriodi(c.id), []);
  } finally {
    (storage as any).db?.$client?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
