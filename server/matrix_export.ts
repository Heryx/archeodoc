import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { Cantiere, UnitaStratigrafica } from "@shared/schema";
import { layoutHarrisMatrix } from "@shared/matrix_layout";
import { VIRTUAL_NODE_TYPES, type GraphParts } from "./paradati";
import { normalizeUSCode } from "@shared/normalize_us_code";

export type HarrisMatrixMode = "all" | "fisica" | "stratigrafica";

/** Forma archeologica dell'US, dedotta da tipo / definizione / relazioni. */
export type USForma = "struttura" | "deposito" | "taglio" | "riempimento" | "virtuale";

const FORMA_ORDER: USForma[] = ["struttura", "deposito", "taglio", "riempimento", "virtuale"];

type EdgeType =
  | "copre"
  | "riempie"
  | "taglia"
  | "appoggia"
  | "equivalenza"
  | "posteriore";

export type MatrixEdge = {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  directed: boolean;
};

export type MatrixNode = {
  /** Chiave normalizzata senza spazi, es. "US1". */
  key: string;
  /** Etichetta leggibile, es. "US 1". */
  label: string;
  forma: USForma;
  /** true se l'US e' citata da una relazione ma non presente nell'elenco. */
  missing: boolean;
  level: number;
  x: number;
  y: number;
};

export type MatrixGraph = {
  nodes: MatrixNode[];
  edges: MatrixEdge[];
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Helpers di parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Chiave di confronto: niente spazi interni, maiuscolo. "US 2" -> "US2". */
function normalizeCodeKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

/** Reinserisce lo spazio fra prefisso e numero per la visualizzazione. */
function prettyKey(key: string): string {
  return key.replace(/^([A-Za-z]+)(\d.*)$/, "$1 $2");
}

function parseSchedaData(raw: unknown): Record<string, string> {
  if (!raw) return {};

  let source: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") source = parsed as Record<string, unknown>;
    } catch {
      source = null;
    }
  } else if (typeof raw === "object") {
    source = raw as Record<string, unknown>;
  }

  if (!source) return {};

  return Object.entries(source).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value == null) return acc;
    const text = String(value).trim();
    if (text) acc[key] = text;
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
    // fallback: valore delimitato
  }

  return trimmed
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Unisce piu' fonti di relazioni (colonna DB + chiavi schedaData) senza duplicati. */
function collectRelations(...sources: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const source of sources) {
    for (const item of toRelationList(source)) {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Metadati di archi e forme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

function edgeStroke(type: EdgeType): string {
  if (type === "copre") return "#0f766e";
  if (type === "riempie") return "#0369a1";
  if (type === "taglia") return "#b45309";
  if (type === "appoggia") return "#334155";
  if (type === "equivalenza") return "#7c3aed";
  return "#dc2626";
}

function formaFill(forma: USForma): string {
  if (forma === "struttura") return "#bfdbfe";
  if (forma === "taglio") return "#fecaca";
  if (forma === "riempimento") return "#bbf7d0";
  if (forma === "virtuale") return "#e9d5ff";
  return "#fde68a"; // deposito
}

function formaLabel(forma: USForma): string {
  if (forma === "struttura") return "Struttura";
  if (forma === "taglio") return "Taglio";
  if (forma === "riempimento") return "Riempimento";
  if (forma === "virtuale") return "Unità virtuale";
  return "Deposito";
}

function modeLabel(mode: HarrisMatrixMode): string {
  if (mode === "fisica") return "Sequenza fisica";
  if (mode === "stratigrafica") return "Sequenza stratigrafica";
  return "Tutte le relazioni";
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Forma dell'US â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type USFormaInput = Pick<
  UnitaStratigrafica,
  "tipo" | "definizione" | "descrizione" | "interpretazione" | "taglia" | "riempie"
>;

const STRUTTURA_TIPI = /^(USM|USR|USF|EM|MR|MA|M)\b/;
const STRUTTURA_LESSICO =
  /\b(muro|muratur|struttur|fondazion|setto|pilastr|soglia|stipite|elevato|pavimentazion|battuto|lastricat|acciottolat|vespai|risega|crepidine)\b/;
const RIEMPIMENTO_LESSICO = /\briemp/;
const TAGLIO_LESSICO =
  /\b(taglio|interfaccia negativa|fossa|buca|trincea|fossato|cavo di|cava di spoglio|asportazion|spoliazion)\b/;

/**
 * Deduce la forma archeologica dell'US. L'ordine dei controlli e' significativo:
 * struttura -> riempimento -> taglio -> deposito.
 */
export function inferUSType(
  us: USFormaInput,
  scheda: Record<string, string> = {},
): USForma {
  const tipo = String(us.tipo ?? "").trim().toUpperCase();
  const definizione = String(us.definizione ?? "").toLowerCase();
  const testo = [
    definizione,
    String(us.descrizione ?? "").toLowerCase(),
    String(us.interpretazione ?? "").toLowerCase(),
  ].join(" ");

  const haRiempie = collectRelations(us.riempie, scheda.riempie).length > 0;
  const haTaglia = collectRelations(us.taglia, scheda.taglia).length > 0;

  if (STRUTTURA_TIPI.test(tipo) || STRUTTURA_LESSICO.test(definizione)) {
    return "struttura";
  }

  if (haRiempie || RIEMPIMENTO_LESSICO.test(definizione)) {
    return "riempimento";
  }

  if (haTaglia || /^US[NV]\b/.test(tipo) || TAGLIO_LESSICO.test(testo)) {
    return "taglio";
  }

  return "deposito";
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Costruzione del grafo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Estrae tutte le relazioni stratigrafiche/fisiche dalle US.
 * Ogni relazione viene letta sia dalle colonne dedicate sia dal blob schedaData.
 */
export function buildMatrixEdges(
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
): MatrixEdge[] {
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
      for (const target of collectRelations(us.copre, scheda.copre)) {
        addEdge(source, target, "copre", true);
      }
      for (const covering of collectRelations(us.coperto_da, scheda.coperto_da, scheda.copertoDa)) {
        addEdge(covering, source, "copre", true);
      }

      for (const target of collectRelations(us.riempie, scheda.riempie)) {
        addEdge(source, target, "riempie", true);
      }
      for (const filler of collectRelations(us.riempitoDa, scheda.riempitoDa)) {
        addEdge(filler, source, "riempie", true);
      }

      for (const target of collectRelations(us.taglia, scheda.taglia)) {
        addEdge(source, target, "taglia", true);
      }
      for (const cutter of collectRelations(us.tagliatoDa, scheda.tagliatoDa)) {
        addEdge(cutter, source, "taglia", true);
      }

      for (const target of collectRelations(us.siAppoggia, scheda.siAppoggiaA, scheda.siAppoggia)) {
        addEdge(source, target, "appoggia", true);
      }
      for (const leaning of collectRelations(us.gliSiAppoggia, scheda.gliSiAppoggia)) {
        addEdge(leaning, source, "appoggia", true);
      }

      for (const linked of collectRelations(us.si_lega_a, scheda.siLegaA)) {
        addEdge(source, linked, "equivalenza", false);
      }
      for (const equal of collectRelations(us.uguale_a, scheda.ugualeA, scheda.ugualeAStratigrafico)) {
        addEdge(source, equal, "equivalenza", false);
      }
    }

    if (includeStratigrafica) {
      for (const older of collectRelations(us.posterioreA, scheda.posterioreA)) {
        addEdge(source, older, "posteriore", true);
      }
      for (const younger of collectRelations(us.anterioreA, scheda.anterioreA)) {
        addEdge(younger, source, "posteriore", true);
      }
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

const GRAPH_NODE_W = 108;
const GRAPH_NODE_H = 40;
const GRAPH_GAP_X = 26;
const GRAPH_GAP_Y = 60;

export type MatrixLayoutOptions = {
  /** Numero massimo di nodi per riga; i livelli piu' larghi si spezzano in piu' righe. */
  maxCols?: number;
};

/**
 * Costruisce il grafo completo della Harris Matrix: nodi (con forma e coordinate
 * di layout) e archi. Le US che coprono altre US stanno piu' in alto (y minore).
 * Il layout e' quello condiviso con la vista a schermo (shared/matrix_layout).
 */
export function buildMatrixGraph(
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
  layoutOptions: MatrixLayoutOptions = {},
  paradatiGraph?: GraphParts,
): MatrixGraph {
  const edges = buildMatrixEdges(usList, mode);

  const nodes = new Map<string, MatrixNode>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (!code) continue;
    const key = normalizeCodeKey(code);
    if (nodes.has(key)) continue;
    nodes.set(key, {
      key,
      label: code,
      forma: inferUSType(us, parseSchedaData(us.schedaData)),
      missing: false,
      level: 0,
      x: 0,
      y: 0,
    });
  }

  // Unita' virtuali: partecipano alla sequenza (sequenza) come nodi propri.
  // Le US si riconoscono per codice normalizzato, gli altri nodi per nome.
  if (paradatiGraph && mode !== "fisica") {
    const keyByUsCode = new Map<string, string>();
    for (const node of Array.from(nodes.values())) keyByUsCode.set(normalizeUSCode(node.label), node.key);
    const virtualKey = new Map<string, string>();
    for (const em of paradatiGraph.nodes) {
      if (!VIRTUAL_NODE_TYPES.has(em.nodeType)) continue;
      const key = normalizeCodeKey(em.uid);
      virtualKey.set(em.uid, key);
      nodes.set(key, { key, label: em.uid, forma: "virtuale", missing: false, level: 0, x: 0, y: 0 });
    }
    const keyOf = (end: { kind: "us" | "nodo"; ref: string }) =>
      end.kind === "nodo" ? virtualKey.get(end.ref) : keyByUsCode.get(end.ref);
    for (const e of paradatiGraph.edges) {
      if (e.edgeType !== "sequenza") continue;
      const from = keyOf(e.source);
      const to = keyOf(e.target);
      if (!from || !to || from === to) continue;
      if (e.source.kind === "us" && e.target.kind === "us") continue;
      const edgeKey = `posteriore:${from}->${to}`;
      if (!edges.some((x) => x.key === edgeKey)) {
        edges.push({ key: edgeKey, from, to, type: "posteriore", directed: true });
      }
    }
  }

  for (const edge of edges) {
    for (const key of [edge.from, edge.to]) {
      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          label: prettyKey(key),
          forma: "deposito",
          missing: true,
          level: 0,
          x: 0,
          y: 0,
        });
      }
    }
  }

  const layout = layoutHarrisMatrix(
    Array.from(nodes.values()).map((node) => ({ key: node.key, label: node.label })),
    edges.map((edge) => ({ from: edge.from, to: edge.to, directed: edge.directed })),
    {
      nodeWidth: GRAPH_NODE_W,
      nodeHeight: GRAPH_NODE_H,
      xGap: GRAPH_GAP_X,
      yGap: GRAPH_GAP_Y,
      maxCols: layoutOptions.maxCols,
    },
  );
  nodes.forEach((node, key) => {
    const pos = layout.positions.get(key);
    if (!pos) return;
    node.x = pos.x;
    node.y = pos.y;
    node.level = pos.level;
  });

  const orderedNodes = Array.from(nodes.values()).sort(
    (a, b) =>
      a.level - b.level || a.label.localeCompare(b.label, "it", { numeric: true }),
  );

  return { nodes: orderedNodes, edges };
}

function contaForme(nodes: MatrixNode[]): Record<USForma, number> {
  const counts: Record<USForma, number> = {
    struttura: 0,
    deposito: 0,
    taglio: 0,
    riempimento: 0,
    virtuale: 0,
  };
  for (const node of nodes) {
    if (node.missing) continue;
    counts[node.forma] += 1;
  }
  return counts;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Utility di export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function slugify(value: string): string {
  return value.replace(/[\s/\\:*?"<>|]+/g, "_");
}

function pickCode(cantiere: Cantiere | undefined, fallback: string): string {
  return cantiere?.codice?.trim() || fallback;
}

function relationRow(edge: MatrixEdge): string {
  const direction = edge.directed ? "->" : "<->";
  return `${prettyKey(edge.from)} ${direction} ${prettyKey(edge.to)} | ${edgeLabel(edge.type)} | ${edgeDomain(edge.type)}`;
}

export function matrixExportFileBase(cantiere: Cantiere | undefined, fallback = "cantiere"): string {
  return `Harris_Matrix_${slugify(pickCode(cantiere, fallback))}`;
}

// PNG 16x16 tinta neutra: fallback per i visualizzatori che non renderizzano
// l'SVG incorporato nel DOCX (Word mostra comunque il diagramma vettoriale).
const FALLBACK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mN49OIDSYhhVMOohuGrAQADs7offat6nAAAAABJRU5ErkJggg==";

function hexRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const value = parseInt(full, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
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

function formeSummaryLine(forme: Record<USForma, number>): string {
  return FORMA_ORDER.map((forma) => `${formaLabel(forma)} ${forme[forma]}`).join("   ");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Export DOCX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function exportHarrisMatrixDocx(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
  paradatiGraph?: GraphParts,
): Promise<Buffer> {
  const { nodes, edges } = buildMatrixGraph(usList, mode, {}, paradatiGraph);
  const forme = contaForme(nodes);
  const referenziateMancanti = nodes.filter((node) => node.missing).length;

  const svg = exportHarrisMatrixSvg(cantiere, usList, mode);
  const dim = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/);
  const svgW = dim ? Math.round(parseFloat(dim[1])) : 900;
  const svgH = dim ? Math.round(parseFloat(dim[2])) : 600;
  const cap = 2400;
  const scale = Math.min(1, cap / Math.max(svgW, svgH, 1));
  const dispW = Math.max(1, Math.round(svgW * scale));
  const dispH = Math.max(1, Math.round(svgH * scale));
  const landscape = svgW >= svgH;

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
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Diagramma")] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: "svg",
          data: Buffer.from(svg, "utf8"),
          transformation: { width: dispW, height: dispH },
          fallback: {
            type: "png",
            data: Buffer.from(FALLBACK_PNG_BASE64, "base64"),
          },
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:
            "Se il diagramma non e' visibile, apri il file con Microsoft Word oppure usa l'export PDF.",
          italics: true,
          size: 18,
          color: "64748B",
        }),
      ],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Unita per forma")] }),
  ];

  for (const forma of FORMA_ORDER) {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(`${formaLabel(forma)}: ${forme[forma]}`)],
      }),
    );
  }
  if (referenziateMancanti > 0) {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(`US citate ma non presenti nell'elenco: ${referenziateMancanti}`)],
      }),
    );
  }

  children.push(
    new Paragraph({ text: "" }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Relazioni")] }),
  );

  if (edges.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun("Nessuna relazione disponibile nella modalita selezionata.")],
      }),
    );
  } else {
    for (const edge of edges) {
      children.push(
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun(relationRow(edge))] }),
      );
    }
  }

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Harris Matrix - ${pickCode(cantiere, "N/D")}`,
    sections: [
      {
        properties: landscape
          ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
          : {},
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Export PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type MatrixPdfPage = "libero" | "a4-portrait" | "a4-landscape";

export type MatrixPdfOptions = {
  /** libero = una pagina grande quanto il disegno; a4-* = pagine A4 con il disegno spezzato. */
  page?: MatrixPdfPage;
  /** Unita' virtuali e loro sequenze, se presenti. */
  paradatiGraph?: GraphParts;
};

export function parseMatrixPdfPage(value: unknown): MatrixPdfPage {
  return value === "a4-portrait" || value === "a4-landscape" ? value : "libero";
}

/** Scala target dei nodi su A4: ne deriva il numero massimo di colonne per riga. */
const A4_TARGET_NODE_SCALE = 0.8;

export async function exportHarrisMatrixPdf(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
  options: MatrixPdfOptions = {},
): Promise<Buffer> {
  const pageFormat = options.page ?? "libero";
  const a4 = pageFormat !== "libero";
  const a4Size: [number, number] =
    pageFormat === "a4-landscape" ? [841.89, 595.28] : [595.28, 841.89];
  const a4Margin = 30;
  const maxCols = a4
    ? Math.max(
        1,
        Math.floor(
          ((a4Size[0] - a4Margin * 2) / A4_TARGET_NODE_SCALE + GRAPH_GAP_X) /
            (GRAPH_NODE_W + GRAPH_GAP_X),
        ),
      )
    : undefined;
  const { nodes, edges } = buildMatrixGraph(usList, mode, { maxCols }, options.paradatiGraph);
  const forme = contaForme(nodes);
  const referenziateMancanti = nodes.filter((node) => node.missing).length;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = hexRgb("#0f172a");
  const slate = hexRgb("#334155");
  const code = pickCode(cantiere, "N/D");
  const generato = new Date().toLocaleString("it-IT");

  const formePresenti = FORMA_ORDER.filter((forma) =>
    nodes.some((node) => !node.missing && node.forma === forma),
  );
  const relazioniPresenti: EdgeType[] = [];
  for (const edge of edges) {
    if (!relazioniPresenti.includes(edge.type)) relazioniPresenti.push(edge.type);
  }

  // â”€â”€ Pagina 1: il disegno della matrix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const outerMargin = a4 ? a4Margin : 36;
  const MAX_SIDE = 13000;
  const TAG_SPACE = 18;
  const HEADER_STRIP = 16;

  // Legenda: nell'A4 le voci vanno a capo, nel formato libero restano su una riga.
  const legendPerRow = a4
    ? Math.max(1, Math.floor((a4Size[0] - outerMargin * 2 - 78) / 104))
    : Number.POSITIVE_INFINITY;
  const formeRows = a4 ? Math.max(1, Math.ceil(formePresenti.length / legendPerRow)) : 1;
  const relRows = a4 ? Math.max(1, Math.ceil(relazioniPresenti.length / legendPerRow)) : 1;
  const cartHeight = 132 + (formeRows - 1) * 14 + (relRows - 1) * 14;

  const graphW = nodes.length
    ? Math.max(GRAPH_NODE_W, ...nodes.map((node) => node.x + GRAPH_NODE_W))
    : GRAPH_NODE_W;
  const graphH = nodes.length
    ? Math.max(...nodes.map((node) => node.y + GRAPH_NODE_H))
    : GRAPH_NODE_H;

  const availW = a4 ? a4Size[0] - outerMargin * 2 : MAX_SIDE - outerMargin * 2;
  const drawScale = a4
    ? Math.min(1, availW / graphW)
    : Math.min(
        1,
        (MAX_SIDE - outerMargin * 2) / graphW,
        (MAX_SIDE - outerMargin * 2 - cartHeight) / graphH,
      );
  const gxOffset = a4 ? (availW - graphW * drawScale) / 2 : 0;

  // Righe del disegno (nodi con la stessa y) e loro ripartizione in pagine.
  const rowYs = Array.from(new Set(nodes.map((node) => node.y))).sort((a, b) => a - b);
  const rowIndexOf = new Map<number, number>(rowYs.map((y, index) => [y, index]));
  const nodeRow = (node: MatrixNode) => rowIndexOf.get(node.y) ?? 0;
  const nodeByKey = new Map<string, MatrixNode>(nodes.map((node) => [node.key, node]));
  const rowPitchG = GRAPH_NODE_H + GRAPH_GAP_Y;

  /** Archi che attraversano un taglio tra la riga cut-1 e la riga cut. */
  const crossingAt = (cut: number) =>
    edges.filter((edge) => {
      const a = nodeByKey.get(edge.from);
      const b = nodeByKey.get(edge.to);
      if (!a || !b) return false;
      const ra = nodeRow(a);
      const rb = nodeRow(b);
      return Math.min(ra, rb) < cut && Math.max(ra, rb) >= cut;
    }).length;

  const pagePlan: Array<{ from: number; to: number }> = [];
  if (!a4 || rowYs.length === 0) {
    pagePlan.push({ from: 0, to: rowYs.length });
  } else {
    const rowsFit = (availH: number) =>
      Math.max(1, Math.floor((availH / drawScale + GRAPH_GAP_Y) / rowPitchG));
    let start = 0;
    while (start < rowYs.length) {
      const availH =
        a4Size[1] -
        outerMargin * 2 -
        TAG_SPACE * 2 -
        (start === 0 ? cartHeight : HEADER_STRIP);
      const fit = rowsFit(availH);
      if (start + fit >= rowYs.length) {
        pagePlan.push({ from: start, to: rowYs.length });
        break;
      }
      // Taglio nel punto con meno archi attraversanti, nelle ultime righe utili.
      let bestCut = start + fit;
      let bestCrossing = crossingAt(bestCut);
      for (let cut = start + fit - 1; cut > start && cut >= start + fit - 3; cut -= 1) {
        const crossing = crossingAt(cut);
        if (crossing < bestCrossing) {
          bestCrossing = crossing;
          bestCut = cut;
        }
      }
      pagePlan.push({ from: start, to: bestCut });
      start = bestCut;
    }
  }
  const pageOfRow = new Map<number, number>();
  pagePlan.forEach((plan, index) => {
    for (let r = plan.from; r < plan.to; r += 1) pageOfRow.set(r, index + 1);
  });
  const totalPages = pagePlan.length;

  const drawCartouche = (page: PDFPage, topY: number, pageW: number) => {
    page.drawText("HARRIS MATRIX", { x: outerMargin, y: topY - 18, size: 20, font: bold, color: ink });
    page.drawText(`Cantiere ${code}   -   ${modeLabel(mode)}`, {
      x: outerMargin,
      y: topY - 35,
      size: 10,
      font,
      color: slate,
    });
    page.drawText(
      `US: ${usList.length}    Relazioni: ${edges.length}    Generato ${generato}`,
      { x: outerMargin, y: topY - 49, size: 10, font, color: slate },
    );
    page.drawText(formeSummaryLine(forme), {
      x: outerMargin,
      y: topY - 63,
      size: 9,
      font,
      color: slate,
    });

    const lyForme = topY - 84;
    page.drawText("FORME US", { x: outerMargin, y: lyForme, size: 9, font: bold, color: ink });
    formePresenti.forEach((forma, index) => {
      const lx = outerMargin + 78 + (index % legendPerRow) * 104;
      const ly = lyForme - Math.floor(index / legendPerRow) * 14;
      page.drawRectangle({
        x: lx,
        y: ly - 1,
        width: 10,
        height: 10,
        color: hexRgb(formaFill(forma)),
        borderColor: ink,
        borderWidth: 0.75,
      });
      page.drawText(formaLabel(forma), { x: lx + 15, y: ly, size: 8, font, color: slate });
    });

    const lyRel = topY - 102 - (formeRows - 1) * 14;
    page.drawText("RELAZIONI", { x: outerMargin, y: lyRel, size: 9, font: bold, color: ink });
    relazioniPresenti.forEach((type, index) => {
      const lx = outerMargin + 78 + (index % legendPerRow) * 104;
      const ly = lyRel - Math.floor(index / legendPerRow) * 14;
      page.drawLine({
        start: { x: lx, y: ly + 3 },
        end: { x: lx + 20, y: ly + 3 },
        thickness: 2,
        color: hexRgb(edgeStroke(type)),
        dashArray: type === "equivalenza" ? [3, 2] : undefined,
      });
      page.drawText(edgeLabel(type), { x: lx + 26, y: ly, size: 8, font, color: slate });
    });

    page.drawLine({
      start: { x: outerMargin, y: topY - cartHeight + 10 },
      end: { x: pageW - outerMargin, y: topY - cartHeight + 10 },
      thickness: 0.75,
      color: hexRgb("#e2e8f0"),
    });
  };

  /** Disegna le righe [from, to) del grafo con il bordo superiore a topPdfY. */
  const drawSlice = (page: PDFPage, from: number, to: number, topPdfY: number) => {
    const inSlice = (node: MatrixNode) => {
      const r = nodeRow(node);
      return r >= from && r < to;
    };
    const originY = rowYs[from] ?? 0;
    const gx = (x: number) => outerMargin + gxOffset + x * drawScale;
    const gyTop = (y: number) => topPdfY - (y - originY) * drawScale;
    const nodeW = GRAPH_NODE_W * drawScale;
    const nodeH = GRAPH_NODE_H * drawScale;

    // Archi interni alla pagina
    for (const edge of edges) {
      const a = nodeByKey.get(edge.from);
      const b = nodeByKey.get(edge.to);
      if (!a || !b || !inSlice(a) || !inSlice(b)) continue;
      const color = hexRgb(edgeStroke(edge.type));

      if (!edge.directed) {
        page.drawLine({
          start: { x: gx(a.x + GRAPH_NODE_W / 2), y: gyTop(a.y) - nodeH / 2 },
          end: { x: gx(b.x + GRAPH_NODE_W / 2), y: gyTop(b.y) - nodeH / 2 },
          thickness: 1.1,
          color,
          dashArray: [3, 2],
        });
        continue;
      }

      const upper = a.y <= b.y ? a : b;
      const lower = a.y <= b.y ? b : a;
      const x1 = gx(upper.x + GRAPH_NODE_W / 2);
      const y1 = gyTop(upper.y) - nodeH;
      const x2 = gx(lower.x + GRAPH_NODE_W / 2);
      const y2 = gyTop(lower.y);
      const midY = (y1 + y2) / 2;

      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x1, y: midY }, thickness: 1.1, color });
      page.drawLine({ start: { x: x1, y: midY }, end: { x: x2, y: midY }, thickness: 1.1, color });
      page.drawLine({ start: { x: x2, y: midY }, end: { x: x2, y: y2 }, thickness: 1.1, color });
      page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - 3.5, y: y2 + 6 }, thickness: 1.1, color });
      page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 + 3.5, y: y2 + 6 }, thickness: 1.1, color });
    }

    // Nodi
    const labelSize = Math.max(6, Math.min(11, 12 * drawScale));
    for (const node of nodes) {
      if (!inSlice(node)) continue;
      const rx = gx(node.x);
      const rTop = gyTop(node.y);
      page.drawRectangle({
        x: rx,
        y: rTop - nodeH,
        width: nodeW,
        height: nodeH,
        color: node.missing ? hexRgb("#f1f5f9") : hexRgb(formaFill(node.forma)),
        borderColor: ink,
        borderWidth: 0.9,
      });
      const textWidth = bold.widthOfTextAtSize(node.label, labelSize);
      page.drawText(node.label, {
        x: rx + Math.max(2, (nodeW - textWidth) / 2),
        y: rTop - nodeH / 2 - labelSize * 0.34,
        size: labelSize,
        font: bold,
        color: ink,
      });
    }

    if (totalPages <= 1) return;

    // Connettori di continuazione: archi che escono dalla pagina.
    type LinkMap = Map<string, Map<number, string[]>>;
    const below: LinkMap = new Map();
    const above: LinkMap = new Map();
    const addLink = (target: LinkMap, near: MatrixNode, far: MatrixNode) => {
      const byPage = target.get(near.key) ?? new Map<number, string[]>();
      const pageOfFar = pageOfRow.get(nodeRow(far)) ?? 0;
      const labels = byPage.get(pageOfFar) ?? [];
      if (!labels.includes(far.label)) labels.push(far.label);
      byPage.set(pageOfFar, labels);
      target.set(near.key, byPage);
    };
    for (const edge of edges) {
      const a = nodeByKey.get(edge.from);
      const b = nodeByKey.get(edge.to);
      if (!a || !b) continue;
      const aIn = inSlice(a);
      const bIn = inSlice(b);
      if (aIn === bIn) continue;
      const near = aIn ? a : b;
      const far = aIn ? b : a;
      addLink(nodeRow(far) > nodeRow(near) ? below : above, near, far);
    }

    const tagSize = 6.5;
    const tagColor = hexRgb("#b45309");
    const maxTagW = (GRAPH_NODE_W + GRAPH_GAP_X) * drawScale - 4;
    const fitText = (text: string) => {
      if (font.widthOfTextAtSize(text, tagSize) <= maxTagW) return text;
      let cut = text;
      while (cut.length > 3 && font.widthOfTextAtSize(`${cut}..`, tagSize) > maxTagW) {
        cut = cut.slice(0, -1);
      }
      return `${cut}..`;
    };
    const drawTags = (map: LinkMap, isBelow: boolean) => {
      map.forEach((byPage, key) => {
        const node = nodeByKey.get(key);
        if (!node) return;
        const text = fitText(
          Array.from(byPage.entries())
            .sort((x, y) => x[0] - y[0])
            .map(([p, labels]) => `p.${p}: ${labels.join(", ")}`)
            .join("; "),
        );
        const cx = gx(node.x + GRAPH_NODE_W / 2);
        const edgeY = isBelow ? gyTop(node.y) - nodeH : gyTop(node.y);
        const dir = isBelow ? -1 : 1;
        page.drawLine({
          start: { x: cx, y: edgeY },
          end: { x: cx, y: edgeY + dir * 6 },
          thickness: 0.9,
          color: tagColor,
          dashArray: [2, 1.5],
        });
        const tw = font.widthOfTextAtSize(text, tagSize);
        page.drawText(text, {
          x: cx - tw / 2,
          y: isBelow ? edgeY - 6 - tagSize : edgeY + 8,
          size: tagSize,
          font,
          color: tagColor,
        });
      });
    };
    drawTags(below, true);
    drawTags(above, false);
  };

  // Disegno della matrix (una o piu' pagine)
  pagePlan.forEach((plan, index) => {
    const pageNo = index + 1;
    let page: PDFPage;
    let topPdfY: number;

    if (a4) {
      page = pdf.addPage(a4Size);
      const pageTop = a4Size[1] - outerMargin;
      if (index === 0) {
        drawCartouche(page, pageTop, a4Size[0]);
        topPdfY = pageTop - cartHeight - TAG_SPACE;
      } else {
        page.drawText(`Harris Matrix - Cantiere ${code}`, {
          x: outerMargin,
          y: pageTop - 10,
          size: 9,
          font: bold,
          color: slate,
        });
        topPdfY = pageTop - HEADER_STRIP - TAG_SPACE;
      }
      if (totalPages > 1) {
        const label = `pag. ${pageNo}/${totalPages}`;
        page.drawText(label, {
          x: a4Size[0] - outerMargin - font.widthOfTextAtSize(label, 9),
          y: pageTop - 10,
          size: 9,
          font,
          color: slate,
        });
      }
    } else {
      const pageW = Math.max(560, graphW * drawScale + outerMargin * 2);
      const pageH = Math.max(320, graphH * drawScale + cartHeight + outerMargin * 2);
      page = pdf.addPage([pageW, pageH]);
      drawCartouche(page, pageH - outerMargin, pageW);
      topPdfY = pageH - outerMargin - cartHeight;
    }

    if (nodes.length === 0) {
      page.drawText("Nessuna US disponibile.", {
        x: outerMargin,
        y: topPdfY - 16,
        size: 12,
        font,
        color: slate,
      });
      return;
    }
    drawSlice(page, plan.from, plan.to, topPdfY);
  });

  // Pagine successive: elenco testuale delle relazioni

  const pageSize: [number, number] = [595.28, 841.89]; // A4
  const margin = 46;
  const bodySize = 10;
  const lineHeight = 13;
  const contentWidth = pageSize[0] - margin * 2;

  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const drawTextLine = (text: string, size = bodySize, isBold = false) => {
    if (y < margin + lineHeight) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
    }
    page.drawText(text, { x: margin, y, size, font: isBold ? bold : font });
    y -= lineHeight;
  };

  drawTextLine("Dettaglio relazioni", 15, true);
  y -= 6;
  drawTextLine(`Cantiere ${code}  -  ${modeLabel(mode)}`, 10);
  drawTextLine(`US considerate: ${usList.length}   Relazioni estratte: ${edges.length}`, 10);
  y -= 4;

  drawTextLine("Unita per forma", 12, true);
  y -= 2;
  for (const forma of FORMA_ORDER) {
    drawTextLine(`- ${formaLabel(forma)}: ${forme[forma]}`);
  }
  if (referenziateMancanti > 0) {
    drawTextLine(`- US citate ma non presenti nell'elenco: ${referenziateMancanti}`);
  }
  y -= 6;

  drawTextLine("Relazioni", 12, true);
  y -= 2;
  if (edges.length === 0) {
    drawTextLine("Nessuna relazione disponibile nella modalita selezionata.");
  } else {
    const widthOfText = (value: string) => font.widthOfTextAtSize(value, bodySize);
    for (const edge of edges) {
      for (const line of splitLineByWidth(`- ${relationRow(edge)}`, contentWidth, bodySize, widthOfText)) {
        drawTextLine(line);
      }
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Export SVG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportHarrisMatrixSvg(
  cantiere: Cantiere | undefined,
  usList: UnitaStratigrafica[],
  mode: HarrisMatrixMode,
  paradatiGraph?: GraphParts,
): string {
  const { nodes, edges } = buildMatrixGraph(usList, mode, {}, paradatiGraph);
  const nodeByKey = new Map<string, MatrixNode>();
  for (const node of nodes) nodeByKey.set(node.key, node);

  const formePresenti = FORMA_ORDER.filter((forma) =>
    nodes.some((node) => !node.missing && node.forma === forma),
  );
  const relazioniPresenti: EdgeType[] = [];
  for (const edge of edges) {
    if (!relazioniPresenti.includes(edge.type)) relazioniPresenti.push(edge.type);
  }

  const PAD = 40;
  const graphTop = 208;

  const graphWidth = nodes.length
    ? Math.max(GRAPH_NODE_W, ...nodes.map((node) => node.x + GRAPH_NODE_W))
    : GRAPH_NODE_W;
  const graphHeight = nodes.length
    ? Math.max(...nodes.map((node) => node.y)) + GRAPH_NODE_H
    : 0;

  const legendWidth =
    Math.max(formePresenti.length, relazioniPresenti.length, 1) * 150;
  const width = Math.max(560, graphWidth, legendWidth) + PAD * 2;
  const height = graphTop + graphHeight + PAD;

  const code = pickCode(cantiere, "N/D");
  const generato = new Date().toLocaleString("it-IT");

  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
  );

  // â”€â”€ Cartiglio
  parts.push(
    `<text x="${PAD}" y="34" font-size="22" font-weight="bold" fill="#0f172a">HARRIS MATRIX</text>`,
    `<text x="${PAD}" y="56" font-size="12" fill="#334155">Cantiere ${escapeXml(code)} &#8226; ${escapeXml(modeLabel(mode))}</text>`,
    `<text x="${PAD}" y="74" font-size="12" fill="#334155">US: ${usList.length} &#8226; Relazioni: ${edges.length} &#8226; ${escapeXml(generato)}</text>`,
  );

  // â”€â”€ Legenda FORME US
  parts.push(
    `<text x="${PAD}" y="104" font-size="12" font-weight="bold" fill="#0f172a">FORME US</text>`,
  );
  formePresenti.forEach((forma, index) => {
    const x = PAD + index * 150;
    parts.push(
      `<rect x="${x}" y="114" width="14" height="14" rx="3" fill="${formaFill(forma)}" stroke="#0f172a" stroke-width="1"/>`,
      `<text x="${x + 20}" y="125" font-size="11" fill="#334155">${escapeXml(formaLabel(forma))}</text>`,
    );
  });
  if (formePresenti.length === 0) {
    parts.push(`<text x="${PAD}" y="125" font-size="11" fill="#64748b">nessuna</text>`);
  }

  // â”€â”€ Legenda RELAZIONI
  parts.push(
    `<text x="${PAD}" y="156" font-size="12" font-weight="bold" fill="#0f172a">RELAZIONI</text>`,
  );
  relazioniPresenti.forEach((type, index) => {
    const x = PAD + index * 150;
    const dash = type === "equivalenza" ? ` stroke-dasharray="4 3"` : "";
    parts.push(
      `<line x1="${x}" y1="171" x2="${x + 26}" y2="171" stroke="${edgeStroke(type)}" stroke-width="2.4"${dash}/>`,
      `<text x="${x + 32}" y="175" font-size="11" fill="#334155">${escapeXml(edgeLabel(type))}</text>`,
    );
  });
  if (relazioniPresenti.length === 0) {
    parts.push(`<text x="${PAD}" y="175" font-size="11" fill="#64748b">nessuna</text>`);
  }

  parts.push(
    `<line x1="${PAD}" y1="${graphTop - 16}" x2="${width - PAD}" y2="${graphTop - 16}" stroke="#e2e8f0" stroke-width="1"/>`,
  );

  if (nodes.length === 0) {
    parts.push(
      `<text x="${PAD}" y="${graphTop + 8}" font-size="13" fill="#64748b">Nessuna US disponibile.</text>`,
      `</svg>`,
    );
    return parts.join("\n");
  }

  const ox = PAD;
  const oy = graphTop;

  // â”€â”€ Archi
  for (const edge of edges) {
    const a = nodeByKey.get(edge.from);
    const b = nodeByKey.get(edge.to);
    if (!a || !b) continue;

    const stroke = edgeStroke(edge.type);
    const upper = a.y <= b.y ? a : b;
    const lower = a.y <= b.y ? b : a;
    const x1 = ox + upper.x + GRAPH_NODE_W / 2;
    const y1 = oy + upper.y + GRAPH_NODE_H;
    const x2 = ox + lower.x + GRAPH_NODE_W / 2;
    const y2 = oy + lower.y;

    if (edge.directed) {
      const midY = (y1 + y2) / 2;
      parts.push(
        `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x1.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.6" marker-end="url(#arrow)"/>`,
      );
    } else {
      parts.push(
        `<line x1="${(ox + a.x + GRAPH_NODE_W / 2).toFixed(1)}" y1="${(oy + a.y + GRAPH_NODE_H / 2).toFixed(1)}" x2="${(ox + b.x + GRAPH_NODE_W / 2).toFixed(1)}" y2="${(oy + b.y + GRAPH_NODE_H / 2).toFixed(1)}" stroke="${stroke}" stroke-width="1.4" stroke-dasharray="4 3"/>`,
      );
    }
  }

  // â”€â”€ Nodi
  for (const node of nodes) {
    const x = ox + node.x;
    const y = oy + node.y;
    const fill = node.missing ? "#f1f5f9" : formaFill(node.forma);
    const dash = node.missing ? ` stroke-dasharray="4 3"` : "";
    parts.push(
      `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${GRAPH_NODE_W}" height="${GRAPH_NODE_H}" rx="6" fill="${fill}" stroke="#0f172a" stroke-width="1.2"${dash}/>` +
        `<text x="${(x + GRAPH_NODE_W / 2).toFixed(1)}" y="${(y + GRAPH_NODE_H / 2 + 4).toFixed(1)}" font-size="12" font-weight="bold" text-anchor="middle" fill="#0f172a">${escapeXml(node.label)}</text></g>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
