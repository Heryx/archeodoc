import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildRelazioneDocx, type PmNode } from "../server/relazione_export";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const img = { buffer: PNG, type: "png" as const, width: 400, height: 200 };

async function documentXml(contenuto: PmNode): Promise<string> {
  const { buffer } = await buildRelazioneDocx({
    titolo: "t", contenuto, intestazione: null,
    loadSnapshot: () => img, loadProjectImage: () => img,
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

const EMU_PER_PX = 9525;
const extentCx = (xml: string) => Number(/<wp:extent cx="(\d+)"/.exec(xml)![1]);

test("export: la larghezza della figura segue la percentuale scelta", async () => {
  const fig = (widthPct?: number, align?: string): PmNode => ({ type: "doc", content: [{ type: "projectImage", attrs: { name: "a.png", didascalia: "Fig", widthPct, align } }] });
  const full = extentCx(await documentXml(fig(100)));
  const half = extentCx(await documentXml(fig(50)));
  assert.equal(full, 560 * EMU_PER_PX);
  assert.equal(half, 280 * EMU_PER_PX);
  // vecchie immagini con solo "width" in px
  const legacy = extentCx(await documentXml({ type: "doc", content: [{ type: "projectImage", attrs: { name: "a.png", width: 320 } }] }));
  assert.ok(Math.abs(legacy - Math.round((320 / 560) * 560) * EMU_PER_PX) <= EMU_PER_PX);
  assert.match(await documentXml(fig(50, "right")), /<w:jc w:val="right"\/>/);
});

test("export: larghezze delle colonne, sfondi e bordi delle tabelle", async () => {
  const cell = (w: number, extra: Record<string, unknown> = {}): PmNode => ({
    type: "tableCell", attrs: { colwidth: [w], ...extra }, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
  });
  const xml = await documentXml({
    type: "doc",
    content: [{
      type: "table", attrs: { borders: "none" },
      content: [{ type: "tableRow", content: [cell(185), cell(370, { background: "#ffe3e3", valign: "middle" })] }],
    }],
  });
  const grid = Array.from(xml.matchAll(/<w:gridCol w:w="(\d+)"/g)).map((m) => Number(m[1]));
  assert.deepEqual(grid, [2250, 4500]);
  assert.match(xml, /w:fill="FFE3E3"/i);
  assert.match(xml, /<w:vAlign w:val="center"\/>/);
  assert.match(xml, /<w:tblBorders>[\s\S]*w:val="nil"|<w:tblBorders>[\s\S]*w:val="none"/);
});

const para = (text = "x"): PmNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const tcell = (attrs: Record<string, unknown> = {}): PmNode => ({ type: "tableCell", attrs, content: [para()] });
const trow = (cells: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "tableRow", attrs, content: cells });

// Bordi (top/right/bottom/left) di ogni cella nell'ordine del documento
function cellBorders(xml: string): Record<string, string>[] {
  return Array.from(xml.matchAll(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/g)).map((m) => {
    const out: Record<string, string> = {};
    for (const b of Array.from(m[1].matchAll(/<w:(top|right|bottom|left)\b([^>]*)\/>/g))) out[b[1]] = b[2];
    return out;
  });
}

test("export: «solo riquadro esterno» lascia le linee interne vuote", async () => {
  const xml = await documentXml({
    type: "doc",
    content: [{ type: "table", attrs: { borders: "outer", lineStyle: "dashed", lineWidth: 1, lineColor: "#ff0000" }, content: [trow([tcell(), tcell()]), trow([tcell(), tcell()])] }],
  });
  const [a, b, c, d] = cellBorders(xml);
  // cella in alto a sinistra: fuori sopra e a sinistra, dentro a destra e sotto
  assert.match(a.top, /w:val="dashed" w:color="FF0000" w:sz="8"/);
  assert.match(a.left, /w:val="dashed"/);
  assert.match(a.right, /w:val="nil"|w:val="none"/);
  assert.match(a.bottom, /w:val="nil"|w:val="none"/);
  assert.match(d.right, /w:val="dashed"/);
  assert.match(d.bottom, /w:val="dashed"/);
  assert.match(b.left, /w:val="nil"|w:val="none"/);
  assert.match(c.top, /w:val="nil"|w:val="none"/);
});

test("export: il bordo impostato su una cella vale anche per la cella accanto", async () => {
  const xml = await documentXml({
    type: "doc",
    content: [{
      type: "table", attrs: { borders: "none" },
      content: [trow([tcell({ border: { right: { s: "double", w: 2.25, c: "#0000ff" } } }), tcell()])],
    }],
  });
  const [a, b] = cellBorders(xml);
  assert.match(a.right, /w:val="double" w:color="0000FF" w:sz="18"/);
  assert.match(b.left, /w:val="double" w:color="0000FF" w:sz="18"/);
  assert.match(a.left, /w:val="nil"|w:val="none"/);
});

test("export: altezza minima delle righe, allineamento della tabella e spazio interno", async () => {
  const xml = await documentXml({
    type: "doc",
    content: [{
      type: "table", attrs: { align: "center", cellPadding: 2 },
      content: [trow([tcell({ colwidth: [370] })], { height: 2 }), trow([tcell({ colwidth: [370] })])],
    }],
  });
  assert.match(xml, /<w:trHeight w:val="1134" w:hRule="atLeast"\/>/);
  assert.match(xml, /<w:tblPr>[\s\S]*<w:jc w:val="center"\/>/);
  assert.match(xml, /<w:tcMar>[\s\S]*w:w="113"/);
});

test("export: figura con testo a fianco = tabella mobile ancorata al testo", async () => {
  const fig = (align: string): PmNode => ({
    type: "doc",
    content: [
      { type: "projectImage", attrs: { name: "a.png", didascalia: "Fig 1", widthPct: 40, align, wrap: "square" } },
      para("testo che scorre accanto"),
    ],
  });
  const right = await documentXml(fig("right"));
  assert.match(right, /<w:tblpPr [^>]*w:horzAnchor="margin"[^>]*w:tblpXSpec="right"/);
  assert.match(right, /w:vertAnchor="text"/);
  assert.equal(extentCx(right), Math.round(0.4 * 560) * EMU_PER_PX);
  assert.match(right, /Fig 1/);
  assert.match(await documentXml(fig("left")), /w:tblpXSpec="left"/);
  // senza testo a fianco resta un paragrafo allineato
  const inline = await documentXml({ type: "doc", content: [{ type: "projectImage", attrs: { name: "a.png", widthPct: 50, align: "left", wrap: "none" } }] });
  assert.doesNotMatch(inline, /w:tblpPr/);
});

test("export: rientri, spaziatura e flusso del paragrafo", async () => {
  const xml = await documentXml({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { indentLeft: 2, indentFirst: -1, spaceBefore: 6, spaceAfter: 12, lineHeight: 1.5, pageBreakBefore: true }, content: [{ type: "text", text: "a" }] },
      { type: "heading", attrs: { level: 1, keepNext: false }, content: [{ type: "text", text: "b" }] },
    ],
  });
  assert.match(xml, /<w:ind [^>]*w:left="1134"[^>]*w:hanging="567"|<w:ind [^>]*w:hanging="567"[^>]*w:left="1134"/);
  assert.match(xml, /<w:spacing [^>]*w:before="120"/);
  assert.match(xml, /<w:spacing [^>]*w:after="240"/);
  assert.match(xml, /<w:spacing [^>]*w:line="360"/);
  assert.match(xml, /<w:pageBreakBefore\/>/);
  // il titolo con «mantieni con il successivo» disattivato non lo porta
  assert.match(xml, /<w:pStyle w:val="Heading1"\/><w:keepNext w:val="false"\/>/);
});
