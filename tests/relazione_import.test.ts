import test from "node:test";
import assert from "node:assert/strict";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { bindImages, buildUsIndex, docxToPm, linkUs, suggerisciMeta } from "../server/relazione_import";
import type { PmNode } from "../server/relazione_export";
import type { UnitaStratigrafica } from "../shared/schema";

const us = (id: number, codiceUS: string, tipo = "Strato") => ({ id, codiceUS, tipo, cantiereId: 1 }) as unknown as UnitaStratigrafica;
const index = buildUsIndex([us(1, "101"), us(2, "102"), us(3, "103"), us(4, "12", "Tomba")]);

// PNG 1x1
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function sampleDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Relazione settimanale dal 12 al 18 maggio 2025")] }),
        new Paragraph({ children: [new TextRun("Nel settore A si è scavata l'"), new TextRun({ text: "US 101", bold: true }), new TextRun(", coperta da UUSS 102 e 103; la US 999 non esiste. T.12 è una tomba.")] }),
        new Paragraph({ children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 40, height: 40 } })] }),
        new Paragraph({ children: [new TextRun("Figura 1 – Pianta di fase")] }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph("Settore")] }), new TableCell({ children: [new Paragraph("US")] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph("A")] }), new TableCell({ children: [new Paragraph("US 102")] })] }),
          ],
        }),
        new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun("Fine.")] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

const find = (n: PmNode, type: string, out: PmNode[] = []): PmNode[] => {
  if (n.type === type) out.push(n);
  (n.content || []).forEach((c) => find(c, type, out));
  return out;
};

test("docxToPm converte titoli, tabelle e immagini con didascalia", async () => {
  const { doc, images } = await docxToPm(await sampleDocx());
  assert.equal(find(doc, "heading")[0].attrs?.level, 1);
  assert.equal(find(doc, "table").length, 1);
  assert.equal(find(doc, "tableRow").length, 2);
  assert.equal(images.length, 1);
  const fig = find(doc, "projectImage");
  assert.equal(fig.length, 1);
  assert.match(String(fig[0].attrs?.didascalia), /^Figura 1/);
  // la didascalia non resta come paragrafo a parte
  assert.ok(!JSON.stringify(doc).includes('"text":"Figura 1'));
  const bold = JSON.stringify(doc).includes('"type":"bold"');
  assert.ok(bold);
});

test("linkUs collega le US citate, anche in elenco, e segnala quelle assenti", async () => {
  const { doc } = await docxToPm(await sampleDocx());
  const { doc: linked, report } = linkUs(doc, index);
  const ids = report.collegate.map((u) => u.id).sort();
  assert.deepEqual(ids, [1, 2, 3, 4]);
  assert.deepEqual(report.nonTrovate.map((u) => u.testo), ["US 999"]);
  // "US 102" in tabella + "UUSS 102" nel testo
  assert.equal(report.collegate.find((u) => u.id === 2)?.occorrenze, 2);
  const marked = find(linked, "text").filter((t) => t.marks?.some((m) => m.type === "usLink"));
  assert.ok(marked.every((t) => /\d/.test(t.text || "")));
  // il testo complessivo non cambia
  const text = (n: PmNode): string => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
  assert.equal(text(linked), text(doc));
});

test("linkUs rispetta le esclusioni", async () => {
  const { doc } = await docxToPm(await sampleDocx());
  const { doc: linked } = linkUs(doc, index, new Set([1]));
  const ids = find(linked, "text").flatMap((t) => (t.marks || []).filter((m) => m.type === "usLink").map((m) => m.attrs?.usId));
  assert.ok(!ids.includes(1));
  assert.ok(ids.includes(2));
});

test("suggerisciMeta riconosce tipo e periodo", async () => {
  const { doc } = await docxToPm(await sampleDocx());
  const meta = suggerisciMeta({ fileName: "relazione.docx", doc, giornate: [] });
  assert.equal(meta.tipo, "settimanale");
  assert.equal(meta.dataInizio, "2025-05-12");
  assert.equal(meta.dataFine, "2025-05-18");
  assert.match(meta.titolo, /Relazione settimanale/);
});

test("suggerisciMeta usa la settimana del giornale se mancano le date", () => {
  const doc: PmNode = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Relazione settimana 2" }] }] };
  const giornate = [
    { id: 1, data: "2025-05-05" }, { id: 2, data: "2025-05-06" },
    { id: 3, data: "2025-05-12" }, { id: 4, data: "2025-05-14" },
  ];
  const meta = suggerisciMeta({ fileName: "w2.docx", doc, giornate });
  assert.equal(meta.tipo, "settimanale");
  assert.equal(meta.dataInizio, "2025-05-12");
  assert.equal(meta.dataFine, "2025-05-14");
});

test("bindImages sostituisce i segnaposto con i file salvati", async () => {
  const { doc } = await docxToPm(await sampleDocx());
  const bound = bindImages(doc, ["rel_1.png"]);
  const img = find(bound, "projectImage")[0];
  assert.equal(img.attrs?.name, "rel_1.png");
  assert.equal(img.attrs?.src, "/api/project/img/rel_1.png");
  assert.equal(find(bindImages(doc, [null]), "projectImage").length, 0);
});

test("la route importa-docx: anteprima senza salvare, conferma con immagini e collegamenti", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const { registerDocumentazioniImportRoutes } = await import("../server/routes/documentazioni_import");

  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-img-"));
  const created: any[] = [];
  const ctx: any = {
    project: { imgDir },
    storage: {
      getCantiere: () => ({ id: 1 }),
      getUSList: () => [us(1, "101"), us(2, "102")],
      getGiornate: () => [],
      createDocumentazione: (d: any) => { created.push(d); return { id: 7, ...d }; },
    },
  };
  let handler: any;
  const app: any = { post: (_p: string, ...h: any[]) => { handler = h[h.length - 1]; } };
  registerDocumentazioniImportRoutes(app, (h: any) => (req: any, res: any) => h(ctx, req, res));

  const buffer = await sampleDocx();
  const call = async (body: any) => {
    let status = 200, json: any;
    const res: any = { status: (s: number) => { status = s; return res; }, json: (j: any) => { json = j; } };
    await handler({ params: { cid: "1" }, body, file: { originalname: "Relazione sett. 20.docx", buffer } }, res);
    return { status, json };
  };

  const prev = await call({});
  assert.equal(prev.status, 200);
  assert.equal(created.length, 0);
  assert.equal(fs.readdirSync(imgDir).length, 0);
  assert.equal(prev.json.preview.tipo, "settimanale");
  assert.deepEqual(prev.json.preview.usCollegate.map((u: any) => u.id).sort(), [1, 2]);

  const done = await call({ confirm: "true", fields: JSON.stringify({ titolo: "Settimana 20", tipo: "settimanale", dataInizio: "2025-05-12", dataFine: "2025-05-18", escludiUs: [2] }) });
  assert.equal(done.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].titolo, "Settimana 20");
  assert.equal(created[0].stato, "bozza");
  const files = fs.readdirSync(imgDir);
  assert.equal(files.length, 1);
  const saved = JSON.parse(created[0].contenuto) as PmNode;
  assert.equal(find(saved, "projectImage")[0].attrs?.name, files[0]);
  const linkedIds = find(saved, "text").flatMap((t) => (t.marks || []).filter((m) => m.type === "usLink").map((m) => m.attrs?.usId));
  assert.ok(linkedIds.includes(1) && !linkedIds.includes(2));
  fs.rmSync(imgDir, { recursive: true, force: true });
});

test("suggerisciMeta legge diverse forme di intervallo", () => {
  const mk = (t: string): PmNode => ({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: t }] }] });
  const range = (t: string) => {
    const m = suggerisciMeta({ fileName: "x.docx", doc: mk(t), giornate: [] });
    return [m.dataInizio, m.dataFine];
  };
  assert.deepEqual(range("Relazione dal 4 all'10 maggio 2026"), ["2026-05-04", "2026-05-10"]);
  assert.deepEqual(range("Relazione dal 12 al 18 maggio 2025"), ["2025-05-12", "2025-05-18"]);
  assert.deepEqual(range("Settimana 12-18 maggio 2025"), ["2025-05-12", "2025-05-18"]);
  assert.deepEqual(range("Dal 28 aprile al 4 maggio 2025"), ["2025-04-28", "2025-05-04"]);
  assert.deepEqual(range("Verbale del 03/06/2025"), ["2025-06-03", "2025-06-03"]);
});

test("anteprimaTesto separa le celle delle tabelle", async () => {
  const { anteprimaTesto } = await import("../server/relazione_import");
  const { doc } = await docxToPm(await sampleDocx());
  assert.match(anteprimaTesto(doc), /Settore \| US\nA \| US 102/);
});
