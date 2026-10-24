import test from "node:test";
import assert from "node:assert/strict";
import { resolveCellBorders, tableLook, type GridCell } from "../shared/relazione_table";

const grid = (rows: number, cols: number, over: Partial<Record<number, GridCell["borders"]>> = {}): GridCell[] =>
  Array.from({ length: rows * cols }, (_, i) => ({ key: i, row: Math.floor(i / cols), col: i % cols, rowspan: 1, colspan: 1, borders: over[i] }));

const sides = (m: ReturnType<typeof resolveCellBorders>, key: number) => {
  const b = m.get(key)!;
  return `${b.top ? "T" : "-"}${b.right ? "R" : "-"}${b.bottom ? "B" : "-"}${b.left ? "L" : "-"}`;
};

test("disposizione delle linee: esterne, interne, orizzontali", () => {
  const run = (borders: string) => resolveCellBorders(tableLook({ borders }), grid(2, 2), 2, 2);
  const outer = run("outer");
  assert.deepEqual([0, 1, 2, 3].map((k) => sides(outer, k)), ["T--L", "TR--", "--BL", "-RB-"]);
  const inner = run("inner");
  assert.deepEqual([0, 1, 2, 3].map((k) => sides(inner, k)), ["-RB-", "--BL", "TR--", "T--L"]);
  const horizontal = run("horizontal");
  assert.equal(sides(horizontal, 0), "T-B-");
  const none = run("none");
  assert.equal(sides(none, 0), "----");
  // legacy: valori sconosciuti = tutte le linee
  assert.equal(sides(run("boh"), 3), "TRBL");
});

test("la riga di intestazione ha una linea sotto di sé", () => {
  const m = resolveCellBorders(tableLook({ borders: "header" }), grid(3, 1), 3, 1);
  assert.equal(sides(m, 0), "TRBL");
  assert.equal(sides(m, 1), "TR-L");
  assert.equal(sides(m, 2), "-RBL");
});

test("il bordo di una cella passa alla vicina; «nessuna linea» vince sulla disposizione", () => {
  const pen = { s: "dotted" as const, w: 1, c: "#123456" };
  const m = resolveCellBorders(tableLook({ borders: "none" }), grid(1, 2, { 0: { right: pen } }), 1, 2);
  assert.deepEqual(m.get(1)!.left, pen);
  const n = resolveCellBorders(tableLook({ borders: "all" }), grid(1, 2, { 1: { left: "none" } }), 1, 2);
  assert.equal(n.get(0)!.right, null);
  assert.equal(n.get(1)!.left, null);
  assert.ok(n.get(1)!.right);
});

test("celle unite: i lati seguono l'estensione della cella", () => {
  const cells: GridCell[] = [
    { key: 0, row: 0, col: 0, rowspan: 2, colspan: 1 },
    { key: 1, row: 0, col: 1, rowspan: 1, colspan: 1 },
    { key: 2, row: 1, col: 1, rowspan: 1, colspan: 1 },
  ];
  const m = resolveCellBorders(tableLook({ borders: "outer" }), cells, 2, 2);
  assert.equal(sides(m, 0), "T-BL");
  assert.equal(sides(m, 2), "-RB-");
});
