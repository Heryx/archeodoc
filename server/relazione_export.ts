import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LevelFormat,
  OverlapType,
  Packer,
  PageNumber,
  Paragraph,
  RelativeHorizontalPosition,
  ShadingType,
  Table,
  TableAnchorType,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from "docx";
import { RELAZIONE_EXPORT_WIDTH_PX, RELAZIONE_TEXT_WIDTH_PX, figureFloatSide, figureWidthPct, figureWrap } from "@shared/relazione_layout";
import {
  TWIPS_PER_CM, normalizeCellBorders, resolveCellBorders, tableLook, type Edge, type GridCell,
} from "@shared/relazione_table";

type Block = Paragraph | Table;

// Nodo ProseMirror/TipTap serializzato in JSON
export type PmNode = {
  type?: string;
  attrs?: Record<string, any>;
  content?: PmNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
};

export type RelazioneIntestazione = {
  intestazione?: string;
  piePagina?: string;
  numeroPagina?: boolean;
};

export type SnapshotImage = {
  buffer: Buffer;
  type: "png" | "jpg";
  width: number | null;
  height: number | null;
};

export type RelazioneExportInput = {
  titolo: string;
  contenuto: PmNode | null;
  intestazione: RelazioneIntestazione | null;
  // Risolve l'immagine di uno snapshot WebMap; null se mancante/non supportata
  loadSnapshot: (snapshotId: number) => SnapshotImage | null;
  // Immagine della cartella "Immagini progetto" (logo, stemma, ecc.), per nome file
  loadProjectImage?: (name: string) => SnapshotImage | null;
};

const ORDERED_REF = "relazione-ordered";
const MAX_IMAGE_WIDTH_PX = RELAZIONE_EXPORT_WIDTH_PX; // ~ 15 cm
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

const hex = (v: unknown): string | undefined => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v || "").trim());
  return m ? m[1].toUpperCase() : undefined;
};

// "12pt" / "16px" -> mezzi punti di Word
function halfPoints(v: unknown): number | undefined {
  const m = /^([\d.]+)(pt|px)?$/.exec(String(v || "").trim());
  if (!m) return undefined;
  const pt = m[2] === "px" ? Number(m[1]) * 0.75 : Number(m[1]);
  return pt > 0 ? Math.round(pt * 2) : undefined;
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function textRuns(node: PmNode): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const child of node.content || []) {
    if (child.type === "hardBreak") {
      out.push(new TextRun({ break: 1 }));
    } else if (child.type === "text" && child.text) {
      // I mark sconosciuti (es. i collegamenti [[US]]) non compaiono nell'export
      const marks = child.marks || [];
      const mark = (name: string) => marks.find((m) => m.type === name);
      const style = mark("textStyle")?.attrs || {};
      const highlight = hex(mark("highlight")?.attrs?.color);
      const link = mark("link")?.attrs?.href as string | undefined;
      const run = new TextRun({
        text: child.text,
        bold: !!mark("bold"),
        italics: !!mark("italic"),
        strike: !!mark("strike"),
        underline: mark("underline") || link ? {} : undefined,
        subScript: !!mark("subscript"),
        superScript: !!mark("superscript"),
        color: link ? "0563C1" : hex(style.color),
        size: halfPoints(style.fontSize),
        font: style.fontFamily ? String(style.fontFamily).split(",")[0].replace(/["']/g, "").trim() : undefined,
        shading: highlight ? { type: ShadingType.CLEAR, fill: highlight, color: "auto" } : undefined,
      });
      out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run);
    }
  }
  return out;
}

const TEXT_WIDTH_DXA = 9000;

// Larghezza delle colonne in DXA: i px salvati nell'editor (base 740 = tutto il foglio) vengono
// riportati alla pagina; senza larghezze note le colonne sono uguali e occupano tutto il testo.
function tableColumnWidths(rows: PmNode[], cols: number): number[] {
  const px: (number | null)[] = Array(cols).fill(null);
  for (const row of rows) {
    let col = 0;
    for (const cell of row.content || []) {
      const span = Number(cell.attrs?.colspan) || 1;
      const cw = cell.attrs?.colwidth as number[] | null | undefined;
      if (cw) cw.forEach((w, i) => { if (w > 0 && col + i < cols && px[col + i] == null) px[col + i] = w; });
      col += span;
    }
  }
  if (px.every((w) => w != null)) {
    return (px as number[]).map((w) => Math.max(400, Math.round((w / RELAZIONE_TEXT_WIDTH_PX) * TEXT_WIDTH_DXA)));
  }
  return Array(cols).fill(Math.floor(TEXT_WIDTH_DXA / cols));
}

const BORDER_STYLE = { solid: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dotted: BorderStyle.DOTTED, double: BorderStyle.DOUBLE } as const;

const NO_LINE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_LINES = { top: NO_LINE, bottom: NO_LINE, left: NO_LINE, right: NO_LINE, insideHorizontal: NO_LINE, insideVertical: NO_LINE };

// Word misura lo spessore in ottavi di punto
const line = (e: Edge) => (e ? { style: BORDER_STYLE[e.s], size: Math.min(96, Math.max(2, Math.round(e.w * 8))), color: e.c.slice(1).toUpperCase() } : NO_LINE);

// Posizione di ogni cella nella griglia, tenendo conto delle celle unite in verticale
function gridCells(rows: PmNode[]): { cells: GridCell[]; cols: number } {
  const cells: GridCell[] = [];
  const occupied: number[] = [];
  let cols = 0;
  rows.forEach((row, r) => {
    let col = 0;
    (row.content || []).forEach((cell, idx) => {
      while ((occupied[col] || 0) > 0) col++;
      const colspan = Math.max(Number(cell.attrs?.colspan) || 1, 1);
      const rowspan = Math.max(Number(cell.attrs?.rowspan) || 1, 1);
      cells.push({ key: r * 1000 + idx, row: r, col, rowspan, colspan, borders: cell.attrs?.border });
      if (rowspan > 1) for (let c = col; c < col + colspan; c++) occupied[c] = rowspan;
      col += colspan;
      cols = Math.max(cols, col);
    });
    for (let c = 0; c < occupied.length; c++) if ((occupied[c] || 0) > 0) occupied[c]--;
  });
  return { cells, cols };
}

const mmToDxa = (mm: number) => Math.round((mm / 25.4) * 1440);

function figure(node: PmNode, input: RelazioneExportInput, warnings: string[]): Block[] {
  const snapshotId = Number(node.attrs?.snapshotId);
  const caption = String(node.attrs?.didascalia || "").trim();
  const isProject = node.type === "projectImage";
  const img = isProject
    ? input.loadProjectImage?.(String(node.attrs?.name || "")) ?? null
    : Number.isFinite(snapshotId) ? input.loadSnapshot(snapshotId) : null;
  if (!img) {
    warnings.push(isProject
      ? `Immagine di progetto mancante o non supportata (${node.attrs?.name ?? "?"}): usa PNG o JPEG`
      : `Figura mancante o non supportata (snapshot ${node.attrs?.snapshotId ?? "?"})`);
    return [];
  }
  const ratio = img.width && img.height && img.width > 0 && img.height > 0 ? img.width / img.height : 16 / 9;
  // Larghezza scelta nel gestore figure (% del testo); le altezze eccessive riducono la figura mantenendo le proporzioni
  let width = Math.round((figureWidthPct(node.attrs) / 100) * MAX_IMAGE_WIDTH_PX);
  let height = Math.round(width / ratio);
  if (height > 760) {
    height = 760;
    width = Math.round(height * ratio);
  }
  const align = ALIGN[String(node.attrs?.align || "center")] ?? AlignmentType.CENTER;

  // Testo a fianco: la figura e la didascalia stanno in una tabella mobile senza bordi, ancorata al paragrafo
  // successivo, che le scorre accanto (come «Disposizione testo: quadrato» di Word)
  if (figureWrap(node.attrs) === "square") {
    const side = figureFloatSide(node.attrs);
    const widthDxa = width * 15;
    const none = { top: NO_LINE, bottom: NO_LINE, left: NO_LINE, right: NO_LINE };
    const inner = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: !!caption,
        children: [new ImageRun({ type: img.type, data: img.buffer, transformation: { width, height } })],
      }),
    ];
    if (caption) {
      inner.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [new TextRun({ text: caption, italics: true, size: 20 })] }));
    }
    return [
      new Table({
        width: { size: widthDxa, type: WidthType.DXA },
        columnWidths: [widthDxa],
        layout: TableLayoutType.FIXED,
        borders: NO_LINES,
        float: {
          horizontalAnchor: TableAnchorType.MARGIN,
          relativeHorizontalPosition: side === "right" ? RelativeHorizontalPosition.RIGHT : RelativeHorizontalPosition.LEFT,
          verticalAnchor: TableAnchorType.TEXT,
          absoluteVerticalPosition: 0,
          leftFromText: side === "right" ? 280 : 0,
          rightFromText: side === "left" ? 280 : 0,
          topFromText: 60,
          bottomFromText: 140,
          overlap: OverlapType.NEVER,
        },
        rows: [
          new TableRow({
            cantSplit: true,
            children: [new TableCell({ width: { size: widthDxa, type: WidthType.DXA }, borders: none, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: inner })],
          }),
        ],
      }),
    ];
  }

  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: align,
      keepNext: !!caption,
      spacing: { before: 120, after: 60 },
      children: [
        new ImageRun({ type: img.type, data: img.buffer, transformation: { width, height } }),
      ],
    }),
  ];
  if (caption) {
    paragraphs.push(
      new Paragraph({
        alignment: align,
        spacing: { after: 200 },
        children: [new TextRun({ text: caption, italics: true, size: 20 })],
      }),
    );
  }
  return paragraphs;
}

// Rientri, spaziatura e flusso del paragrafo scelti nell'editor (cm e pt) in unità di Word (twip)
function paragraphFormat(attrs: Record<string, any> | undefined, base: { before?: number; after: number }, quoteIndent = 0) {
  const a = attrs || {};
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const cm = (v: number) => Math.round(v * TWIPS_PER_CM);
  const left = num(a.indentLeft), right = num(a.indentRight), first = num(a.indentFirst);
  const before = num(a.spaceBefore), after = num(a.spaceAfter), line = num(a.lineHeight);
  const hasIndent = left != null || right != null || first != null || quoteIndent > 0;
  return {
    indent: hasIndent
      ? {
          left: quoteIndent + (left != null ? cm(left) : 0) || undefined,
          right: right != null ? cm(right) : undefined,
          ...(first != null ? (first >= 0 ? { firstLine: cm(first) } : { hanging: cm(-first) }) : {}),
        }
      : undefined,
    spacing: {
      ...(base.before != null ? { before: base.before } : {}),
      after: base.after,
      ...(before != null ? { before: Math.round(before * 20) } : {}),
      ...(after != null ? { after: Math.round(after * 20) } : {}),
      ...(line != null ? { line: Math.round(line * 240) } : {}),
    },
    pageBreakBefore: a.pageBreakBefore === true ? true : undefined,
    keepNext: a.keepNext === true ? true : undefined,
  };
}

function blocks(
  nodes: PmNode[],
  input: RelazioneExportInput,
  warnings: string[],
  ctx: { list?: { ordered: boolean; level: number }; quote?: boolean } = {},
): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const children = textRuns(node);
        // in un elenco il rientro lo gestisce la numerazione
        const fmt = paragraphFormat(ctx.list ? undefined : node.attrs, { after: 120 }, ctx.quote ? 567 : 0);
        out.push(
          new Paragraph({
            children,
            alignment: ALIGN[node.attrs?.textAlign],
            indent: fmt.indent,
            spacing: fmt.spacing,
            pageBreakBefore: fmt.pageBreakBefore,
            keepNext: fmt.keepNext,
            ...(ctx.list
              ? ctx.list.ordered
                ? { numbering: { reference: ORDERED_REF, level: Math.min(ctx.list.level, 3) } }
                : { bullet: { level: Math.min(ctx.list.level, 3) } }
              : {}),
          }),
        );
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 4);
        const fmt = paragraphFormat(node.attrs, { before: 240, after: 120 });
        out.push(
          new Paragraph({
            heading: HEADINGS[level - 1],
            alignment: ALIGN[node.attrs?.textAlign],
            children: textRuns(node),
            indent: fmt.indent,
            spacing: fmt.spacing,
            pageBreakBefore: fmt.pageBreakBefore,
            keepNext: node.attrs?.keepNext !== false,
          }),
        );
        break;
      }
      case "bulletList":
      case "orderedList": {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        for (const item of node.content || []) {
          out.push(...blocks(item.content || [], input, warnings, {
            ...ctx,
            list: { ordered: node.type === "orderedList", level },
          }));
        }
        break;
      }
      case "blockquote":
        out.push(...blocks(node.content || [], input, warnings, { ...ctx, quote: true }));
        break;
      case "horizontalRule":
        out.push(new Paragraph({ border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } }, spacing: { after: 120 } }));
        break;
      case "table": {
        const rows = (node.content || []).filter((r) => r.type === "tableRow");
        const grid = gridCells(rows);
        const cols = grid.cols || 1;
        const colWidths = tableColumnWidths(rows, cols);
        const total = colWidths.reduce((a, b) => a + b, 0);
        const look = tableLook(node.attrs);
        // Bordi di ogni cella: i propri, altrimenti la disposizione scelta per la tabella
        const borders = resolveCellBorders(
          look,
          grid.cells.map((c) => ({ ...c, borders: normalizeCellBorders(c.borders, look.pen) })),
          rows.length,
          cols,
        );
        const colOf = (row: PmNode, idx: number) =>
          (row.content || []).slice(0, idx).reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0);
        const pad = Number(node.attrs?.cellPadding) > 0 ? mmToDxa(Number(node.attrs?.cellPadding)) : null;
        const margins = pad != null ? { top: pad, bottom: pad, left: pad, right: pad } : { top: 60, bottom: 60, left: 100, right: 100 };
        const tableAlign = node.attrs?.align === "center" ? AlignmentType.CENTER : node.attrs?.align === "right" ? AlignmentType.RIGHT : undefined;
        out.push(
          new Table({
            width: { size: total, type: WidthType.DXA },
            columnWidths: colWidths,
            layout: TableLayoutType.FIXED,
            alignment: tableAlign,
            borders: NO_LINES,
            rows: rows.map(
              (row, r) =>
                new TableRow({
                  tableHeader: (row.content || []).every((c) => c.type === "tableHeader"),
                  height: Number(row.attrs?.height) > 0
                    ? { value: Math.round(Number(row.attrs?.height) * TWIPS_PER_CM), rule: HeightRule.ATLEAST }
                    : undefined,
                  children: (row.content || []).map((cell, idx) => {
                    const span = Number(cell.attrs?.colspan) || 1;
                    const isHeader = cell.type === "tableHeader";
                    const inner = blocks(cell.content || [], input, warnings).filter((b): b is Paragraph => b instanceof Paragraph);
                    const fill = hex(cell.attrs?.background) ?? (isHeader ? "EDEDED" : undefined);
                    const first = colOf(row, idx);
                    const width = colWidths.slice(first, first + span).reduce((a, b) => a + b, 0);
                    const valign = cell.attrs?.valign === "middle" ? VerticalAlign.CENTER : cell.attrs?.valign === "bottom" ? VerticalAlign.BOTTOM : undefined;
                    const b = borders.get(r * 1000 + idx);
                    return new TableCell({
                      columnSpan: span > 1 ? span : undefined,
                      rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
                      width: { size: width || Math.floor(total / cols) * span, type: WidthType.DXA },
                      shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
                      verticalAlign: valign,
                      borders: b ? { top: line(b.top), right: line(b.right), bottom: line(b.bottom), left: line(b.left) } : undefined,
                      margins,
                      children: inner.length ? inner : [new Paragraph({ text: "" })],
                    });
                  }),
                }),
            ),
          }),
        );
        out.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        break;
      }
      case "snapshotFigure":
      case "projectImage":
        out.push(...figure(node, input, warnings));
        break;
      default:
        if (node.content) out.push(...blocks(node.content, input, warnings, ctx));
    }
  }
  return out;
}

export async function buildRelazioneDocx(
  input: RelazioneExportInput,
): Promise<{ buffer: Buffer; warnings: string[] }> {
  const warnings: string[] = [];
  const body = blocks(input.contenuto?.content || [], input, warnings);
  if (body.length === 0 || body[body.length - 1] instanceof Table) body.push(new Paragraph({ text: "" }));

  const head = input.intestazione || {};
  const headerText = String(head.intestazione || "").trim();
  const footerText = String(head.piePagina || "").trim();
  const withPageNumber = head.numeroPagina !== false;

  const footerChildren: ParagraphChild[] = [];
  if (footerText) footerChildren.push(new TextRun({ text: footerText, size: 18 }));
  if (withPageNumber) {
    if (footerText) footerChildren.push(new TextRun({ text: "    ", size: 18 }));
    footerChildren.push(
      new TextRun({ children: ["Pagina ", PageNumber.CURRENT, " di ", PageNumber.TOTAL_PAGES], size: 18 }),
    );
  }

  const doc = new Document({
    creator: "ArcheoDoc",
    title: input.titolo,
    numbering: {
      config: [
        {
          reference: ORDERED_REF,
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        headers: headerText
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: headerText, size: 18, color: "555555" })],
                  }),
                ],
              }),
            }
          : undefined,
        footers: footerChildren.length
          ? {
              default: new Footer({
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerChildren })],
              }),
            }
          : undefined,
        children: body,
      },
    ],
  });

  return { buffer: Buffer.from(await Packer.toBuffer(doc)), warnings };
}
