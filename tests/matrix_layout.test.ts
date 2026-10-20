import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { layoutHarrisMatrix } from "../shared/matrix_layout";
import { buildMatrixGraph, exportHarrisMatrixPdf } from "../server/matrix_export";
import type { Cantiere, UnitaStratigrafica } from "../shared/schema";

const OPTS = { nodeWidth: 100, nodeHeight: 40, xGap: 20, yGap: 50 };

function wideGraph(width: number, depth: number) {
  const nodes: { key: string; label: string }[] = [];
  const edges: { from: string; to: string; directed: boolean }[] = [];
  for (let d = 0; d < depth; d += 1) {
    for (let i = 0; i < width; i += 1) {
      nodes.push({ key: `L${d}_${i}`, label: `US ${d * 1000 + i}` });
      if (d > 0) edges.push({ from: `L${d - 1}_${i}`, to: `L${d}_${i}`, directed: true });
    }
  }
  return { nodes, edges };
}

test("layout senza maxCols: una riga per livello", () => {
  const { nodes, edges } = wideGraph(12, 3);
  const res = layoutHarrisMatrix(nodes, edges, OPTS);
  assert.equal(res.rows.length, 3);
  assert.equal(res.width, 12 * 100 + 11 * 20);
});

test("layout con maxCols: i livelli larghi si spezzano e la larghezza e' limitata", () => {
  const { nodes, edges } = wideGraph(12, 3);
  const res = layoutHarrisMatrix(nodes, edges, { ...OPTS, maxCols: 5 });
  assert.ok(res.rows.length > 3);
  for (const row of res.rows) assert.ok(row.keys.length <= 5);
  assert.ok(res.width <= 5 * 100 + 4 * 20 + 1e-6, `larghezza ${res.width}`);
  // il vincolo stratigrafico resta: ogni nodo sta sotto quello che lo copre
  for (const edge of edges) {
    assert.ok(res.positions.get(edge.from)!.y < res.positions.get(edge.to)!.y);
  }
  // nessuna sovrapposizione nella stessa riga
  for (const row of res.rows) {
    const xs = row.keys.map((k) => res.positions.get(k)!.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= 120 - 1e-6);
  }
});

test("le US isolate vanno in fondo, a griglia", () => {
  const nodes = [
    { key: "A", label: "US 1" },
    { key: "B", label: "US 2" },
    ...Array.from({ length: 7 }, (_, i) => ({ key: `I${i}`, label: `US ${10 + i}` })),
  ];
  const res = layoutHarrisMatrix(nodes, [{ from: "A", to: "B", directed: true }], {
    ...OPTS,
    maxCols: 3,
  });
  const lastConnectedY = res.positions.get("B")!.y;
  for (let i = 0; i < 7; i += 1) assert.ok(res.positions.get(`I${i}`)!.y > lastConnectedY);
  assert.ok(res.rows.filter((r) => r.isolated).every((r) => r.keys.length <= 3));
});

test("PDF A4 verticale: pagine A4, nessun disegno oltre la larghezza", async () => {
  const usList: any[] = [];
  const W = 30;
  const D = 12;
  for (let d = 0; d < D; d += 1) {
    for (let i = 0; i < W; i += 1) {
      usList.push({
        id: d * W + i,
        codiceUS: `${d * 100 + i + 1}`,
        tipo: "US",
        copre: d < D - 1 ? JSON.stringify([`${(d + 1) * 100 + i + 1}`]) : null,
        schedaData: null,
      });
    }
  }
  const cantiere = { id: 1, nome: "Test", codice: "T-1" } as unknown as Cantiere;
  const g = buildMatrixGraph(usList as UnitaStratigrafica[], "fisica", { maxCols: 5 });
  assert.ok(Math.max(...g.nodes.map((n) => n.x)) + 108 <= 5 * 108 + 4 * 26 + 1e-6);

  const buf = await exportHarrisMatrixPdf(cantiere, usList as UnitaStratigrafica[], "fisica", {
    page: "a4-portrait",
  });
  const pdf = await PDFDocument.load(buf);
  const pages = pdf.getPages();
  assert.ok(pages.length > 2, "il disegno deve spezzarsi su piu' pagine");
  for (const p of pages) {
    assert.ok(Math.abs(p.getWidth() - 595.28) < 0.01);
    assert.ok(Math.abs(p.getHeight() - 841.89) < 0.01);
  }

  const libero = await PDFDocument.load(
    await exportHarrisMatrixPdf(cantiere, usList as UnitaStratigrafica[], "fisica"),
  );
  assert.ok(libero.getPage(0).getWidth() > 1500, "il formato libero resta largo");
  if (process.env.MATRIX_SAMPLE_OUT) {
    (await import("node:fs")).writeFileSync(process.env.MATRIX_SAMPLE_OUT, buf);
  }
});
