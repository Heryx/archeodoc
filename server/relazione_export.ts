import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";

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
};

const ORDERED_REF = "relazione-ordered";
const MAX_IMAGE_WIDTH_PX = 560; // ~ 15 cm
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

function figure(node: PmNode, input: RelazioneExportInput, warnings: string[]): Paragraph[] {
  const snapshotId = Number(node.attrs?.snapshotId);
  const caption = String(node.attrs?.didascalia || "").trim();
  const img = Number.isFinite(snapshotId) ? input.loadSnapshot(snapshotId) : null;
  if (!img) {
    warnings.push(`Figura mancante o non supportata (snapshot ${node.attrs?.snapshotId ?? "?"})`);
    return [];
  }
  const ratio = img.width && img.height && img.width > 0 && img.height > 0 ? img.width / img.height : 16 / 9;
  const width = MAX_IMAGE_WIDTH_PX;
  const height = Math.round(Math.min(width / ratio, 760));
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
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
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: caption, italics: true, size: 20 })],
      }),
    );
  }
  return paragraphs;
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
        out.push(
          new Paragraph({
            children,
            alignment: ALIGN[node.attrs?.textAlign],
            indent: ctx.quote ? { left: 567 } : undefined,
            spacing: { after: 120 },
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
        out.push(
          new Paragraph({
            heading: HEADINGS[level - 1],
            alignment: ALIGN[node.attrs?.textAlign],
            children: textRuns(node),
            spacing: { before: 240, after: 120 },
            keepNext: true,
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
        const cols = (rows[0]?.content || []).reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0) || 1;
        const colWidth = Math.floor(9000 / cols);
        out.push(
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: Array(cols).fill(colWidth),
            rows: rows.map(
              (row) =>
                new TableRow({
                  tableHeader: (row.content || []).every((c) => c.type === "tableHeader"),
                  children: (row.content || []).map((cell) => {
                    const span = Number(cell.attrs?.colspan) || 1;
                    const isHeader = cell.type === "tableHeader";
                    const inner = blocks(cell.content || [], input, warnings).filter((b): b is Paragraph => b instanceof Paragraph);
                    return new TableCell({
                      columnSpan: span > 1 ? span : undefined,
                      rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
                      width: { size: colWidth * span, type: WidthType.DXA },
                      shading: isHeader ? { type: ShadingType.CLEAR, fill: "EDEDED", color: "auto" } : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
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
  if (body.length === 0) body.push(new Paragraph({ text: "" }));

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
