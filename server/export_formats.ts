/**
 * Export aggiuntivi: Markdown e PDF (tramite pdf-lib).
 * ODT: generato come documento XML minimo compresso.
 */
import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import type { UnitaStratigrafica, Cantiere } from "@shared/schema";

// ─── Markdown ─────────────────────────────────────────────────────────────────

export function exportSchedaUSMarkdown(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): string {
  const lines: string[] = [];

  lines.push(`# Scheda US: ${us.codiceUS}`);
  lines.push("");

  if (cantiere) {
    lines.push(`**Cantiere:** ${cantiere.nome || cantiere.id}`);
    if (cantiere.localita) lines.push(`**Località:** ${cantiere.localita}`);
    lines.push("");
  }

  lines.push("## Dati generali");
  lines.push("");
  lines.push(`| Campo | Valore |`);
  lines.push(`|-------|--------|`);

  const addRow = (label: string, value: string | number | null | undefined) => {
    const v = value != null && String(value).trim() ? String(value).trim() : "—";
    lines.push(`| **${label}** | ${v.replace(/\n/g, " ").replace(/\|/g, "\\|")} |`);
  };

  addRow("Codice US", us.codiceUS);
  addRow("Tipo", us.tipo);
  addRow("Definizione", us.definizione);
  addRow("Quota s.l.m.", us.quota);
  addRow("Quota da p.c.", us.quotaPianoCampagna);
  addRow("Settore", us.settore);
  addRow("Periodo iniziale", us.periodoIniziale);
  addRow("Periodo finale", us.periodoFinale);

  lines.push("");
  lines.push("## Descrizione");
  lines.push("");
  lines.push(us.descrizione || "*Nessuna descrizione*");
  lines.push("");

  if (us.interpretazione) {
    lines.push("## Interpretazione");
    lines.push("");
    lines.push(us.interpretazione);
    lines.push("");
  }

  if (us.materialiRinvenuti) {
    lines.push("## Materiali rinvenuti");
    lines.push("");
    lines.push(us.materialiRinvenuti);
    lines.push("");
  }

  // Relazioni
  const relazioni: [string, string | null | undefined][] = [
    ["Coperto da", (us as any).coperto_da],
    ["Copre", (us as any).copre],
    ["Si lega a", (us as any).si_lega_a],
    ["Uguale a", (us as any).uguale_a],
    ["Tagliato da", (us as any).tagliatoDa],
    ["Taglia", (us as any).taglia],
    ["Riempito da", (us as any).riempitoDa],
    ["Riempie", (us as any).riempie],
  ];

  const relazioniPresenti = relazioni.filter(([, v]) => v && String(v).trim());
  if (relazioniPresenti.length > 0) {
    lines.push("## Relazioni stratigrafiche");
    lines.push("");
    lines.push("| Relazione | US |");
    lines.push("|-----------|-----|");
    for (const [label, value] of relazioniPresenti) {
      lines.push(`| ${label} | ${String(value).trim()} |`);
    }
    lines.push("");
  }

  if (us.schedaAiGenerata) {
    lines.push("## Scheda AI generata");
    lines.push("");
    lines.push(us.schedaAiGenerata);
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Esportato da ArcheoDoc il ${new Date().toLocaleDateString("it-IT")}*`);

  return lines.join("\n");
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

const MARGIN = 50;
const PAGE_WIDTH = 595; // A4
const PAGE_HEIGHT = 842;
const LINE_HEIGHT = 14;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SECTION = 12;
const FONT_SIZE_BODY = 9;

type PdfPrinter = {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: ReturnType<PDFDocument["addPage"]>;
  y: number;
  addPage: () => void;
  text: (s: string, size?: number, bold?: boolean, indent?: number) => void;
  line: (dy?: number) => void;
  rule: () => void;
  checkSpace: (needed?: number) => void;
};

function createPrinter(doc: PDFDocument, font: PDFFont, fontBold: PDFFont): PdfPrinter {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const printer: PdfPrinter = {
    doc,
    font,
    fontBold,
    get page() { return page; },
    get y() { return y; },
    set y(v: number) { y = v; },

    addPage() {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    },

    checkSpace(needed = LINE_HEIGHT * 2) {
      if (y < MARGIN + needed) printer.addPage();
    },

    text(s: string, size = FONT_SIZE_BODY, bold = false, indent = 0) {
      const f = bold ? fontBold : font;
      const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent;
      const words = s.split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        const testWidth = f.widthOfTextAtSize(test, size);
        if (testWidth > maxWidth && line) {
          printer.checkSpace();
          page.drawText(line, { x: MARGIN + indent, y, font: f, size, color: rgb(0, 0, 0) });
          y -= LINE_HEIGHT;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        printer.checkSpace();
        page.drawText(line, { x: MARGIN + indent, y, font: f, size, color: rgb(0, 0, 0) });
        y -= LINE_HEIGHT;
      }
    },

    line(dy = LINE_HEIGHT / 2) {
      y -= dy;
    },

    rule() {
      printer.checkSpace(5);
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_WIDTH - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
      y -= 8;
    },
  };

  return printer;
}

function pdfField(p: PdfPrinter, label: string, value: string | number | null | undefined) {
  if (value == null || String(value).trim() === "") return;
  p.checkSpace(LINE_HEIGHT * 2);
  const valStr = String(value).trim();
  // label bold + value normal on same line if short
  const labelText = `${label}: `;
  const f = p.fontBold;
  const labelWidth = f.widthOfTextAtSize(labelText, FONT_SIZE_BODY);
  p.page.drawText(labelText, { x: MARGIN, y: p.y, font: p.fontBold, size: FONT_SIZE_BODY, color: rgb(0.2, 0.2, 0.6) });

  if (f.widthOfTextAtSize(labelText + valStr, FONT_SIZE_BODY) < PAGE_WIDTH - MARGIN * 2) {
    p.page.drawText(valStr, { x: MARGIN + labelWidth, y: p.y, font: p.font, size: FONT_SIZE_BODY, color: rgb(0, 0, 0) });
    p.y -= LINE_HEIGHT;
  } else {
    p.y -= LINE_HEIGHT;
    p.text(valStr, FONT_SIZE_BODY, false, 10);
  }
}

export async function exportSchedaUSPdf(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const p = createPrinter(doc, font, fontBold);

  // Header
  p.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 70,
    width: PAGE_WIDTH,
    height: 70,
    color: rgb(0.17, 0.29, 0.49),
  });
  p.page.drawText("SCHEDA DI UNITÀ STRATIGRAFICA", {
    x: MARGIN,
    y: PAGE_HEIGHT - 30,
    font: fontBold,
    size: 14,
    color: rgb(1, 1, 1),
  });
  p.page.drawText(cantiere ? (cantiere.nome || `Cantiere #${cantiere.id}`) : "", {
    x: MARGIN,
    y: PAGE_HEIGHT - 50,
    font,
    size: 10,
    color: rgb(0.8, 0.8, 0.8),
  });
  p.page.drawText(`US: ${us.codiceUS}`, {
    x: PAGE_WIDTH - MARGIN - fontBold.widthOfTextAtSize(`US: ${us.codiceUS}`, 14),
    y: PAGE_HEIGHT - 38,
    font: fontBold,
    size: 14,
    color: rgb(1, 1, 1),
  });

  p.y = PAGE_HEIGHT - 90;
  p.line(4);

  // Sezione dati generali
  p.text("DATI GENERALI", FONT_SIZE_SECTION, true);
  p.rule();

  pdfField(p, "Codice US", us.codiceUS);
  pdfField(p, "Tipo", us.tipo);
  pdfField(p, "Definizione", us.definizione);
  pdfField(p, "Settore", us.settore);
  pdfField(p, "Quota s.l.m.", us.quota != null ? `${us.quota} m` : null);
  pdfField(p, "Quota da p.c.", us.quotaPianoCampagna != null ? `${us.quotaPianoCampagna} m` : null);
  pdfField(p, "Periodo iniziale", us.periodoIniziale);
  pdfField(p, "Periodo finale", us.periodoFinale);

  p.line(6);

  // Descrizione
  if (us.descrizione) {
    p.text("DESCRIZIONE", FONT_SIZE_SECTION, true);
    p.rule();
    p.text(us.descrizione, FONT_SIZE_BODY);
    p.line(6);
  }

  // Interpretazione
  if (us.interpretazione) {
    p.checkSpace(30);
    p.text("INTERPRETAZIONE", FONT_SIZE_SECTION, true);
    p.rule();
    p.text(us.interpretazione, FONT_SIZE_BODY);
    p.line(6);
  }

  // Materiali
  if (us.materialiRinvenuti) {
    p.checkSpace(30);
    p.text("MATERIALI RINVENUTI", FONT_SIZE_SECTION, true);
    p.rule();
    p.text(us.materialiRinvenuti, FONT_SIZE_BODY);
    p.line(6);
  }

  // Relazioni
  const relazioni: [string, string | null | undefined][] = [
    ["Coperto da", (us as any).coperto_da],
    ["Copre", (us as any).copre],
    ["Si lega a", (us as any).si_lega_a],
    ["Uguale a", (us as any).uguale_a],
    ["Tagliato da", (us as any).tagliatoDa],
    ["Taglia", (us as any).taglia],
    ["Riempito da", (us as any).riempitoDa],
    ["Riempie", (us as any).riempie],
  ];
  const relazioniPresenti = relazioni.filter(([, v]) => v && String(v).trim());

  if (relazioniPresenti.length > 0) {
    p.checkSpace(30);
    p.text("RELAZIONI STRATIGRAFICHE", FONT_SIZE_SECTION, true);
    p.rule();
    for (const [label, value] of relazioniPresenti) {
      pdfField(p, label, value);
    }
    p.line(6);
  }

  // Footer
  const footerText = `Esportato da ArcheoDoc - ${new Date().toLocaleDateString("it-IT")}`;
  const footerPages = doc.getPageCount();
  for (let i = 0; i < footerPages; i++) {
    const pg = doc.getPage(i);
    pg.drawText(footerText, {
      x: MARGIN,
      y: 20,
      font,
      size: 7,
      color: rgb(0.5, 0.5, 0.5),
    });
    pg.drawText(`${i + 1} / ${footerPages}`, {
      x: PAGE_WIDTH - MARGIN - 30,
      y: 20,
      font,
      size: 7,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// ─── ODT ──────────────────────────────────────────────────────────────────────
// Genera un ODT minimo (ZIP con content.xml e manifest)

import JSZip from "jszip";

function odtEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function odtPara(text: string, bold = false, size = "10pt"): string {
  const style = bold ? "text:style-name=\"Heading\"" : "";
  const bStart = bold ? "<text:span text:style-name=\"Bold\">" : "";
  const bEnd = bold ? "</text:span>" : "";
  return `<text:p ${style}>${bStart}${odtEscape(text)}${bEnd}</text:p>`;
}

function odtSection(title: string, content: string): string {
  return [
    odtPara(title, true),
    odtPara(""),
    content,
    odtPara(""),
  ].join("\n");
}

function odtField(label: string, value: string | number | null | undefined): string {
  if (value == null || String(value).trim() === "") return "";
  return odtPara(`${label}: ${String(value).trim()}`);
}

export async function exportSchedaUSOdt(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): Promise<Buffer> {
  const cantiereNome = cantiere ? (cantiere.nome || `Cantiere #${cantiere.id}`) : "";

  const bodyLines: string[] = [];

  bodyLines.push(odtPara(`SCHEDA DI UNITÀ STRATIGRAFICA — ${us.codiceUS}`, true));
  if (cantiereNome) bodyLines.push(odtPara(`Cantiere: ${cantiereNome}`));
  bodyLines.push(odtPara(""));

  // Dati generali
  bodyLines.push(odtSection("DATI GENERALI", [
    odtField("Codice US", us.codiceUS),
    odtField("Tipo", us.tipo),
    odtField("Definizione", us.definizione),
    odtField("Settore", us.settore),
    odtField("Quota s.l.m.", us.quota != null ? `${us.quota} m` : null),
    odtField("Quota da p.c.", us.quotaPianoCampagna != null ? `${us.quotaPianoCampagna} m` : null),
    odtField("Periodo iniziale", us.periodoIniziale),
    odtField("Periodo finale", us.periodoFinale),
  ].join("\n")));

  if (us.descrizione) {
    bodyLines.push(odtSection("DESCRIZIONE", odtPara(us.descrizione)));
  }

  if (us.interpretazione) {
    bodyLines.push(odtSection("INTERPRETAZIONE", odtPara(us.interpretazione)));
  }

  if (us.materialiRinvenuti) {
    bodyLines.push(odtSection("MATERIALI RINVENUTI", odtPara(us.materialiRinvenuti)));
  }

  const relazioni: [string, string | null | undefined][] = [
    ["Coperto da", (us as any).coperto_da],
    ["Copre", (us as any).copre],
    ["Si lega a", (us as any).si_lega_a],
    ["Uguale a", (us as any).uguale_a],
    ["Tagliato da", (us as any).tagliatoDa],
    ["Taglia", (us as any).taglia],
    ["Riempito da", (us as any).riempitoDa],
    ["Riempie", (us as any).riempie],
  ];
  const relazioniPresenti = relazioni.filter(([, v]) => v && String(v).trim());
  if (relazioniPresenti.length > 0) {
    bodyLines.push(odtSection(
      "RELAZIONI STRATIGRAFICHE",
      relazioniPresenti.map(([l, v]) => odtField(l, v)).join("\n"),
    ));
  }

  bodyLines.push(odtPara(`Esportato da ArcheoDoc - ${new Date().toLocaleDateString("it-IT")}`));

  const bodyContent = bodyLines.join("\n");

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="Heading" style:family="paragraph">
      <style:text-properties fo:font-weight="bold" fo:font-size="12pt"/>
    </style:style>
    <style:style style:name="Bold" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
${bodyContent}
    </office:text>
  </office:body>
</office:document-content>`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  const mimetypeContent = "application/vnd.oasis.opendocument.text";

  const zip = new JSZip();
  zip.file("mimetype", mimetypeContent, { compression: "STORE" });
  zip.file("META-INF/manifest.xml", manifestXml);
  zip.file("content.xml", contentXml);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}
