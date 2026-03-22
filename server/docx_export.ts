import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, convertInchesToTwip, Header,
  PageNumber, NumberFormat,
} from "docx";
import type { UnitaStratigrafica, Giornata, Cantiere } from "@shared/schema";

// ─── Helpers ────────────────────────────────────────────────────────────────
function heading1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
  });
}

function para(text: string, opts: { bold?: boolean; italic?: boolean; size?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italic,
      size: opts.size || 22, // 11pt
    })],
    spacing: { after: 100 },
  });
}

function field(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22 }),
      new TextRun({ text: value || "—", size: 22 }),
    ],
    spacing: { after: 80 },
  });
}

function separator(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "C8B89A" } },
    spacing: { after: 120 },
    text: "",
  });
}

function preformatted(text: string): Paragraph[] {
  return text.split("\n").map(line =>
    new Paragraph({
      children: [new TextRun({ text: line, size: 20, font: "Courier New" })],
      spacing: { after: 60 },
    })
  );
}

// ─── Esporta scheda US come DOCX ─────────────────────────────────────────────
export async function exportSchedaUSDocx(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
  schedaAiFormattata: string,
  campiMancanti: string[],
  noteAi: string,
): Promise<Buffer> {
  const sections: Paragraph[] = [];

  // Intestazione
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: "SCHEDA UNITÀ STRATIGRAFICA", bold: true, size: 32, allCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: cantiere?.nome || "—", size: 24, color: "6B5B45" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: cantiere?.localita || "", size: 20, italics: true, color: "8B7355" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    separator(),
  );

  // Dati sintetici
  sections.push(
    heading2("Dati identificativi"),
    field("Codice US", us.codiceUS),
    field("Tipo", us.tipo || "—"),
    field("Settore", us.settore || "—"),
    field("Quota", us.quota != null ? `${us.quota} m s.l.m.` : "—"),
    field("Cantiere", cantiere?.codice || "—"),
  );

  // Campi mancanti (se presenti)
  if (campiMancanti.length > 0) {
    sections.push(
      separator(),
      heading2("⚠ Campi mancanti o da completare"),
      ...campiMancanti.map(c =>
        new Paragraph({
          children: [
            new TextRun({ text: "• ", bold: true, color: "C0392B", size: 22 }),
            new TextRun({ text: c, size: 22, color: "C0392B" }),
          ],
          spacing: { after: 60 },
        })
      ),
    );
  }

  // Scheda formattata dall'AI
  sections.push(
    separator(),
    heading2("Scheda formattata"),
    ...schedaAiFormattata.split("\n").map(line => {
      const isHeading = line.match(/^[A-Z][A-Z\s]+:?\s*$/);
      return new Paragraph({
        children: [new TextRun({
          text: line || " ",
          bold: !!isHeading,
          size: isHeading ? 22 : 20,
        })],
        spacing: { after: isHeading ? 100 : 60 },
      });
    }),
  );

  // Note AI
  if (noteAi) {
    sections.push(
      separator(),
      heading2("Note sulla qualità della documentazione"),
      para(noteAi, { italic: true }),
    );
  }

  // Relazioni stratigrafiche
  sections.push(
    separator(),
    heading2("Relazioni stratigrafiche (dati originali)"),
    field("Coperto da", us.coperto_da || "—"),
    field("Copre", us.copre || "—"),
    field("Si lega a", us.si_lega_a || "—"),
    field("Uguale a", us.uguale_a || "—"),
    field("Periodo iniziale", us.periodoIniziale || "—"),
    field("Periodo finale", us.periodoFinale || "—"),
    field("Materiali", us.materialiRinvenuti || "—"),
    field("Campioni", us.campioni || "—"),
  );

  // Footer
  sections.push(
    separator(),
    new Paragraph({
      children: [new TextRun({
        text: `Documento generato il ${new Date().toLocaleDateString("it-IT")} — ArcheoDoc`,
        size: 16, color: "999999", italics: true,
      })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    }),
  );

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Scheda US ${us.codiceUS}`,
    description: `Scheda stratigrafica ${us.codiceUS} — ${cantiere?.nome || ""}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } },
      children: sections,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── Esporta report giornaliero come DOCX ─────────────────────────────────────
export async function exportReportGiornalieroDocx(
  giornata: Giornata,
  cantiere: Cantiere | undefined,
  reportFormattato: string,
  campiMancanti: string[],
  noteAi: string,
): Promise<Buffer> {
  let operatori = "—";
  try {
    const ops = JSON.parse(giornata.operatori || "[]");
    operatori = Array.isArray(ops) && ops.length > 0 ? ops.join(", ") : giornata.operatori || "—";
  } catch { operatori = giornata.operatori || "—"; }

  const sections: Paragraph[] = [];

  // Intestazione
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: "DIARIO GIORNALIERO DI SCAVO", bold: true, size: 32, allCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: cantiere?.nome || "—", size: 24, color: "6B5B45" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${cantiere?.localita || ""} — ${cantiere?.codice || ""}`, size: 20, italics: true, color: "8B7355" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    separator(),
    heading2("Dati della giornata"),
    field("Data", giornata.data),
    field("Operatori", operatori),
    field("Condizioni meteo", giornata.condMeteo || "—"),
    field("Settore", giornata.settore || "—"),
    field("Committente", cantiere?.committente || "—"),
  );

  // Campi mancanti
  if (campiMancanti.length > 0) {
    sections.push(
      separator(),
      heading2("⚠ Campi mancanti o da completare"),
      ...campiMancanti.map(c =>
        new Paragraph({
          children: [
            new TextRun({ text: "• ", bold: true, color: "C0392B", size: 22 }),
            new TextRun({ text: c, size: 22, color: "C0392B" }),
          ],
          spacing: { after: 60 },
        })
      ),
    );
  }

  // Report formattato
  sections.push(
    separator(),
    heading2("Diario di scavo"),
    ...reportFormattato.split("\n").map(line => {
      const isHeading = line.match(/^[A-Z][A-Z\s]+:?\s*$/) || line.match(/^\d+\./);
      return new Paragraph({
        children: [new TextRun({
          text: line || " ",
          bold: !!isHeading,
          size: isHeading ? 22 : 20,
        })],
        spacing: { after: isHeading ? 100 : 60 },
      });
    }),
  );

  // Note AI
  if (noteAi) {
    sections.push(
      separator(),
      heading2("Note sulla qualità della documentazione"),
      para(noteAi, { italic: true }),
    );
  }

  // Footer
  sections.push(
    separator(),
    new Paragraph({
      children: [new TextRun({
        text: `Documento generato il ${new Date().toLocaleDateString("it-IT")} — ArcheoDoc`,
        size: 16, color: "999999", italics: true,
      })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    }),
  );

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Diario di scavo — ${giornata.data}`,
    description: `Diario giornaliero ${giornata.data} — ${cantiere?.nome || ""}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } },
      children: sections,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
