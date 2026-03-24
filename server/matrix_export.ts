import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";

export type HarrisMatrixMode = "all" | "fisica" | "stratigrafica";

type EdgeType =
  | "copre"
  | "riempie"
  | "taglia"
  | "appoggia"
  | "equivalenza"
  | "posteriore";

type MatrixEdge = {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  directed: boolean;
};

function normalizeCodeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseSchedaData(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (value == null) return acc;
          const text = String(value).trim();
          if (!text) return acc;
          acc[key] = text;
          return acc;
        },
        {},
      );
    } catch {
      return {};
    }
  }

  if (typeof raw !== "object") return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value == null) return acc;
    const text = String(value).trim();
    if (!text) return acc;
    acc[key] = text;
    return acc;
  }, {});
}

function toRelationList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    // fallback split
  }

  return trimmed
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function edgeLabel(type: EdgeType): string {
  if (type === "copre") return "copre";
  if (type === "riempie") return "riempie";
  if (type === "taglia") return "taglia";
  if (type === "appoggia") return "si appoggia a";
  if (type === "equivalenza") return "equivalente a";
  return "posteriore/anteriore";
}

function edgeDomain(type: EdgeType): "fisica" | "stratigrafica" {
  if (type === "posteriore") return "stratigrafica";
  return "fisica";
}

function modeLabel(mode: HarrisMatrixMode): string {
  if (mode === "fisica") return "Sequenza fisica";
  if (mode === "stratigrafica") return "Sequenza stratigrafica";
  return "Tutte le relazioni";
}

function buildMatrixEdges(usList: UnitaStratigrafica[], mode: HarrisMatrixMode): MatrixEdge[] {
  const edges = new Map<string, MatrixEdge>();
  const includeFisica = mode === "all" || mode === "fisica";
  const includeStratigrafica = mode === "all" || mode === "stratigrafica";

  const addEdge = (fromCode: string, toCode: string, type: EdgeType, directed: boolean) => {
    const from = normalizeCodeKey(fromCode);
    const to = normalizeCodeKey(toCode);
    if (!from || !to || from === to) return;

    let edgeKey: string;
    let edgeFrom = from;
    let edgeTo = to;
    if (directed) {
      edgeKey = `${type}:${from}->${to}`;
    } else {
      const [a, b] = from < to ? [from, to] : [to, from];
      edgeKey = `${type}:${a}<->${b}`;
      edgeFrom = a;
      edgeTo = b;
    }

    if (!edges.has(edgeKey)) {
      edges.set(edgeKey, { key: edgeKey, from: edgeFrom, to: edgeTo, type, directed });
    }
  };

  for (const us of usList) {
    if (!us.codiceUS?.trim()) continue;
    const source = us.codiceUS;
    const scheda = parseSchedaData(us.schedaData);

    if (includeFisica) {
      for (const target of toRelationList(us.copre)) addEdge(source, target, "copre", true);
      for (const coveringUs of toRelationList(us.coperto_da)) addEdge(coveringUs, source, "copre", true);
      for (const target of toRelationList(scheda.riempie)) addEdge(source, target, "riempie", true);
      for (const filler of toRelationList(scheda.riempitoDa)) addEdge(filler, source, "riempie", true);
      for (const target of toRelationList(scheda.taglia)) addEdge(source, target, "taglia", true);
      for (const cutter of toRelationList(scheda.tagliatoDa)) addEdge(cutter, source, "taglia", true);
      for (const target of toRelationList(scheda.siAppoggiaA)) addEdge(source, target, "appoggia", true);
      for (const leaning of toRelationList(scheda.gliSiAppoggia)) addEdge(leaning, source, "appoggia", true);
      for (const linked of toRelationList(us.si_lega_a)) addEdge(source, linked, "equivalenza", false);
      for (const equal of toRelationList(us.uguale_a)) addEdge(source, equal, "equivalenza", false);
      for (const equal of toRelationList(scheda.ugualeAStratigrafico)) addEdge(source, equal, "equivalenza", false);
    }

    if (includeStratigrafica) {
      for (const olderUs of toRelationList(scheda.posterioreA)) addEdge(source, olderUs, "posteriore", true);
      for (const youngerUs of toRelationList(scheda.anterioreA)) addEdge(youngerUs, source, "posteriore", true);
    }
  }

  return Array.from(edges.values()).sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;
    return a.type.localeCompare(b.type);
  });
}

function slugify(value: string): string {
  return value.replace(/[\s/\\:*?"<>|]+/g, "_");
}

function pickCode(cantiere: Cantiere | undefined, fallback: string): string {
  return cantiere?.codice?.trim() || fallback;
}

function relationRow(edge: MatrixEdge): string {
  const direction = edge.directed ? "->" : "<->";
  return `${edge.from} ${direction} ${edge.to} | ${edgeLabel(edge.type)} | ${edgeDomain(edge.type)}`;
}

export function matrixExportFileBase(cantiere: Cantiere | undefined, fallback = "cantiere"): string {
  return `Harris_Matrix_${slugify(pickCode(cantiere, fallback))}`;
}

export async function exportHarrisMatrixDocx(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
): Promise<Buffer> {
  const edges = buildMatrixEdges(usList, mode);

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Harris Matrix", bold: true, size: 34 })],
    }),
    new Paragraph({ children: [new TextRun(`Cantiere: ${pickCode(cantiere, "N/D")}`)] }),
    new Paragraph({ children: [new TextRun(`Modalita: ${modeLabel(mode)}`)] }),
    new Paragraph({ children: [new TextRun(`US considerate: ${usList.length}`)] }),
    new Paragraph({ children: [new TextRun(`Relazioni estratte: ${edges.length}`)] }),
    new Paragraph({ children: [new TextRun(`Generato il: ${new Date().toLocaleString("it-IT")}`)] }),
    new Paragraph({ text: "" }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Relazioni")] }),
  ];

  if (edges.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("Nessuna relazione disponibile nella modalita selezionata.")] }));
  } else {
    for (const edge of edges) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(relationRow(edge))],
        }),
      );
    }
  }

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Harris Matrix - ${pickCode(cantiere, "N/D")}`,
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function splitLineByWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  widthOfText: (value: string) => number,
): string[] {
  const words = text.split(/\s+/g).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (widthOfText(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }

  lines.push(current);
  return lines;
}

export async function exportHarrisMatrixPdf(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
): Promise<Buffer> {
  const edges = buildMatrixEdges(usList, mode);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = [595.28, 841.89]; // A4
  const margin = 46;
  const bodySize = 10.5;
  const titleSize = 18;
  const subtitleSize = 11.5;
  const lineHeight = 14;
  const titleGap = 20;
  const contentWidth = pageSize[0] - margin * 2;

  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const drawTextLine = (text: string, size = bodySize, isBold = false) => {
    const currentFont = isBold ? bold : font;
    if (y < margin + lineHeight) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
    }

    page.drawText(text, {
      x: margin,
      y,
      size,
      font: currentFont,
    });
    y -= lineHeight;
  };

  const wrapAndDraw = (text: string, size = bodySize, isBold = false) => {
    const currentFont = isBold ? bold : font;
    const widthOfText = (value: string) => currentFont.widthOfTextAtSize(value, size);
    const lines = splitLineByWidth(text, contentWidth, size, widthOfText);
    for (const line of lines) {
      drawTextLine(line, size, isBold);
    }
  };

  drawTextLine("Harris Matrix", titleSize, true);
  y -= titleGap - lineHeight;
  drawTextLine(`Cantiere: ${pickCode(cantiere, "N/D")}`, subtitleSize);
  drawTextLine(`Modalita: ${modeLabel(mode)}`, subtitleSize);
  drawTextLine(`US considerate: ${usList.length}`, subtitleSize);
  drawTextLine(`Relazioni estratte: ${edges.length}`, subtitleSize);
  drawTextLine(`Generato il: ${new Date().toLocaleString("it-IT")}`, subtitleSize);
  y -= 8;

  drawTextLine("Relazioni", subtitleSize, true);
  y -= 3;

  if (edges.length === 0) {
    wrapAndDraw("Nessuna relazione disponibile nella modalita selezionata.");
  } else {
    for (const edge of edges) {
      wrapAndDraw(`- ${relationRow(edge)}`);
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

