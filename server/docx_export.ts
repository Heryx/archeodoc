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

function parseSchedaData(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value == null) continue;
      const text = String(value).trim();
      if (!text) continue;
      out[key] = text;
    }
    return out;
  } catch {
    return {};
  }
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "—";
}

function parseMulti(raw: unknown): string[] {
  const text = asText(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // fallback for legacy strings
  }
  return text
    .split(/[|,;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "si" || normalized === "yes";
}

function sectionTable(title: string, rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            shading: { type: ShadingType.CLEAR, fill: "EFE7DA", color: "auto" },
            children: [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 22 })] })],
          }),
        ],
      }),
      ...rows.map(([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
            }),
            new TableCell({
              width: { size: 65, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: value || "—", size: 20 })] })],
            }),
          ],
        }),
      ),
    ],
  });
}

async function exportArcheosistemiUSDocx(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): Promise<Buffer> {
  const schedaData = parseSchedaData(us.schedaData);

  const inorganici = Array.from(new Set([
    ...(asBool((us as any).compMaterialeCostruzione) ? ["Materiale da costruzione"] : []),
    ...(asBool((us as any).compCeramica) ? ["Ceramica"] : []),
    ...(asBool((us as any).compMetalli) ? ["Metalli"] : []),
    ...(asBool((us as any).compVetro) ? ["Vetro"] : []),
    ...(asBool((us as any).compCiottoli) ? ["Ciottoli"] : []),
    ...(asBool((us as any).compGhiaia) ? ["Ghiaia"] : []),
    ...parseMulti(schedaData.componentiInorganici),
  ]));

  const organici = Array.from(new Set([
    ...(asBool((us as any).compFauna) ? ["Reperti faunistici"] : []),
    ...(asBool((us as any).compOsso) ? ["Osso"] : []),
    ...(asBool((us as any).compCorno) ? ["Corno"] : []),
    ...(asBool((us as any).compSemi) ? ["Semi"] : []),
    ...(asBool((us as any).compFrutti) ? ["Frutti"] : []),
    ...(asBool((us as any).compCarboni) ? ["Carboni"] : []),
    ...(asBool((us as any).compLegno) ? ["Legno"] : []),
    ...(asBool((us as any).compTessuti) ? ["Tessuti"] : []),
    ...parseMulti(schedaData.componentiOrganici),
  ]));

  const metodoScavo = Array.from(new Set([
    ...(asBool((us as any).scavataIntegralmente) ? ["Unita scavata integralmente"] : []),
    ...(asBool((us as any).scavataParzialmente) ? ["Unita scavata parzialmente"] : []),
    ...(asBool((us as any).asportataConAltriStrati) ? ["Asportata insieme ad altri strati"] : []),
    ...(asText((us as any).corrispondeAltraUnita) ? ["Corrisponde ad altra unita in altro punto"] : []),
    ...parseMulti(schedaData.metodoScavo),
  ]));

  const elements: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: "SCHEDA DI UNITA STRATIGRAFICA (US) - AR/S ARCHEOSISTEMI", bold: true, size: 30 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: `Cantiere: ${cantiere?.nome || "—"} (${cantiere?.codice || "—"})`, size: 20 })],
    }),

    sectionTable("Identificazione", [
      ["Codice US", firstNonEmpty(us.codiceUS)],
      ["N. catalogo generale", firstNonEmpty((us as any).nCatalogoGenerale, schedaData.nCatalogoGenerale)],
      ["N. catalogo internazionale", firstNonEmpty((us as any).nCatalogoInternazionale, schedaData.nCatalogoInternazionale)],
      ["Localita", firstNonEmpty((us as any).localita, schedaData.localita, cantiere?.localita)],
      ["Anno", firstNonEmpty((us as any).anno, schedaData.anno)],
      ["Area", firstNonEmpty((us as any).area, schedaData.area)],
      ["Settore", firstNonEmpty((us as any).settore, schedaData.settori)],
      ["Saggio", firstNonEmpty(schedaData.saggio)],
      ["Quadrati", firstNonEmpty(schedaData.quadrati)],
    ]),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    sectionTable("Documentazione grafica", [
      ["Piante", firstNonEmpty((us as any).piante, schedaData.piante)],
      ["Sezioni", firstNonEmpty((us as any).sezioni, schedaData.sezioni)],
      ["Prospetti", firstNonEmpty((us as any).prospetti, schedaData.prospetti)],
      ["Foto", firstNonEmpty(schedaData.fotografie)],
      ["Tabelle materiali", firstNonEmpty(schedaData.tabelleMateriali)],
    ]),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    sectionTable("Descrizione e formazione", [
      ["Definizione", firstNonEmpty(us.definizione, schedaData.definizionePosizione)],
      ["Descrizione", firstNonEmpty(us.descrizione, schedaData.descrizioneEstesaArcheosistemi)],
      ["Criteri di distinzione", firstNonEmpty((us as any).criteriDistinzione, schedaData.criteriDistinzione)],
      ["Modo di formazione", firstNonEmpty((us as any).modoFormazione, schedaData.modoFormazione)],
      ["Origine formazione", firstNonEmpty((us as any).modoFormazioneOrigine, schedaData.modoFormazioneOrigine)],
      ["Consistenza", firstNonEmpty((us as any).consistenza, schedaData.consistenza)],
      ["Colore", firstNonEmpty((us as any).colore, schedaData.colore)],
      ["Misure", firstNonEmpty((us as any).misure, schedaData.misure)],
      ["Stato conservazione", firstNonEmpty((us as any).statoConservazione, schedaData.statoConservazione)],
      ["Danneggiato da", firstNonEmpty((us as any).danneggiatoDa, schedaData.danneggiatoDa)],
    ]),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    sectionTable("Componenti", [
      ["Inorganici", firstNonEmpty(inorganici.join(", "), "—")],
      ["Altro inorganico", firstNonEmpty((us as any).compAltroInorganico, schedaData.componentiInorganiciAltro)],
      ["Densita inorganici", firstNonEmpty((us as any).densitaInorganici, schedaData.densitaInorganici)],
      ["Organici", firstNonEmpty(organici.join(", "), "—")],
      ["Altro organico", firstNonEmpty((us as any).compAltroOrganico, schedaData.componentiOrganiciAltro)],
      ["Densita organici", firstNonEmpty((us as any).densitaOrganici, schedaData.densitaOrganici)],
    ]),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    sectionTable("Relazioni stratigrafiche", [
      ["Coperto da", firstNonEmpty(us.coperto_da)],
      ["Copre", firstNonEmpty(us.copre)],
      ["Gli si appoggia", firstNonEmpty((us as any).gliSiAppoggia, schedaData.gliSiAppoggia)],
      ["Si appoggia", firstNonEmpty((us as any).siAppoggia, schedaData.siAppoggiaA)],
      ["Tagliato da", firstNonEmpty((us as any).tagliatoDa, schedaData.tagliatoDa)],
      ["Taglia", firstNonEmpty((us as any).taglia, schedaData.taglia)],
      ["Riempito da", firstNonEmpty((us as any).riempitoDa, schedaData.riempitoDa)],
      ["Riempie", firstNonEmpty((us as any).riempie, schedaData.riempie)],
      ["Sequenza fisica", firstNonEmpty((us as any).sequenzaFisica, schedaData.ugualeAStratigrafico)],
      ["Si lega a", firstNonEmpty(us.si_lega_a)],
      ["Uguale a", firstNonEmpty(us.uguale_a)],
    ]),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    sectionTable("Scavo, datazione e responsabilita", [
      ["Metodo di scavo", firstNonEmpty(metodoScavo.join(", "), "—")],
      ["Altro scavo", firstNonEmpty((us as any).altroScavo, schedaData.metodoScavoAltro)],
      ["Elementi datanti", firstNonEmpty((us as any).elementiDatanti, schedaData.elementiDatanti)],
      ["Fonte elementi datanti", firstNonEmpty((us as any).elementiDatantiFonte, schedaData.elementiDatantiFonte)],
      ["Datazione", firstNonEmpty((us as any).datazione, schedaData.datazione)],
      ["Periodo/Fase", firstNonEmpty((us as any).periodoFase, schedaData.periodoFase)],
      ["Epoca", firstNonEmpty((us as any).epoca, schedaData.epoca)],
      ["Dati quantitativi reperti", firstNonEmpty((us as any).datiQuantitativiReperti, schedaData.datiQuantitativiReperti)],
      ["Campionature n.", firstNonEmpty((us as any).campionatureN, schedaData.campionatureN)],
      ["Flottazione", firstNonEmpty((us as any).flottazioneTipo, schedaData.flottazioneTipo)],
      ["Setacciatura", firstNonEmpty((us as any).setacciaturaTipo, schedaData.setacciaturaTipo)],
      ["Affidabilita stratigrafica", firstNonEmpty((us as any).affidabilitaStratigrafica, schedaData.affidabilitaStratigrafica)],
      ["Responsabile SABAP-UMB", firstNonEmpty((us as any).responsabileSabap, schedaData.responsabileSabap)],
      ["Responsabile Archeosistemi", firstNonEmpty((us as any).responsabileArcheosistemi, schedaData.responsabileArcheosistemi)],
    ]),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 180 },
      children: [new TextRun({ text: `Generato il ${new Date().toLocaleDateString("it-IT")} - ArcheoDoc`, size: 16, italics: true })],
    }),
  ];

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Scheda AR/S ${us.codiceUS}`,
    description: `Scheda Archeosistemi ${us.codiceUS}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 20 } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) } } },
      children: elements,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── Esporta scheda US come DOCX ─────────────────────────────────────────────
export async function exportSchedaUSDocx(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
  schedaAiFormattata: string,
  campiMancanti: string[],
  noteAi: string,
): Promise<Buffer> {
  if (us.schedaModelKey === "archeosistemi-us") {
    return exportArcheosistemiUSDocx(us, cantiere);
  }

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
