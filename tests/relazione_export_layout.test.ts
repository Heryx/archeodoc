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
