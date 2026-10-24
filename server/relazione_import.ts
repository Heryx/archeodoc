import mammoth from "mammoth";
import type { UnitaStratigrafica } from "@shared/schema";
import { calcolaSettimaneProgetto } from "@shared/weekUtils";
import { RELAZIONE_TEXT_WIDTH_PX } from "@shared/relazione_layout";
import { usKey, usLabel } from "./relazione_generate";
import type { PmNode } from "./relazione_export";
import { buildLayoutTransform, layoutStyleMap, readDocxLayout } from "./docx_layout";

// widthPct: larghezza originale nel Word, in % del testo (null se non nota)
export type ImportedImage = { buffer: Buffer; ext: "png" | "jpg" | "gif" | "webp"; widthPct: number | null };

export type DocxToPmResult = {
  doc: PmNode;
  images: ImportedImage[];
  avvisi: string[];
};

// ─── HTML (output di mammoth) -> albero minimale ──────────────────────────────

type HNode = { tag: string; attrs: Record<string, string>; children: HNode[]; text?: string };

const VOID_TAGS = new Set(["br", "img", "hr"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of Array.from(raw.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g))) out[m[1].toLowerCase()] = decodeEntities(m[2]);
  return out;
}

export function parseHtml(html: string): HNode {
  const root: HNode = { tag: "#root", attrs: {}, children: [] };
  const stack: HNode[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[5] != null) {
      top.children.push({ tag: "#text", attrs: {}, children: [], text: decodeEntities(m[5]) });
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) {
        // chiusura: risale fino al tag corrispondente, se aperto
        const at = stack.map((n) => n.tag).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else {
        const node: HNode = { tag, attrs: parseAttrs(m[3] || ""), children: [] };
        top.children.push(node);
        if (!VOID_TAGS.has(tag) && !m[4]) stack.push(node);
      }
    }
  }
  return root;
}

// ─── Albero -> ProseMirror ────────────────────────────────────────────────────

type Mark = { type: string; attrs?: Record<string, any> };
type Inline = PmNode & { index?: number }; // type "__img" = segnaposto di un'immagine

const INLINE_MARKS: Record<string, Mark> = {
  strong: { type: "bold" },
  b: { type: "bold" },
  em: { type: "italic" },
  i: { type: "italic" },
  u: { type: "underline" },
  s: { type: "strike" },
  strike: { type: "strike" },
  del: { type: "strike" },
  sup: { type: "superscript" },
  sub: { type: "subscript" },
};

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "hr", "div"]);

function inlineOf(nodes: HNode[], marks: Mark[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.tag === "#text") {
      if (n.text) out.push({ type: "text", text: n.text, ...(marks.length ? { marks } : {}) });
    } else if (n.tag === "br") {
      out.push({ type: "hardBreak" });
    } else if (n.tag === "img") {
      const m = /^__img:(\d+)$/.exec(n.attrs.src || "");
      if (m) out.push({ type: "__img", index: Number(m[1]) });
    } else if (n.tag === "a") {
      const href = n.attrs.href;
      const next = href && !href.startsWith("#") ? [...marks, { type: "link", attrs: { href } }] : marks;
      out.push(...inlineOf(n.children, next));
    } else if (INLINE_MARKS[n.tag]) {
      const mk = INLINE_MARKS[n.tag];
      out.push(...inlineOf(n.children, marks.some((x) => x.type === mk.type) ? marks : [...marks, mk]));
    } else {
      out.push(...inlineOf(n.children, marks));
    }
  }
  return out;
}

// Unisce testi adiacenti con gli stessi mark e toglie gli spazi a inizio/fine paragrafo
function tidyInline(items: PmNode[]): PmNode[] {
  const merged: PmNode[] = [];
  for (const it of items) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === "text" && it.type === "text" && JSON.stringify(prev.marks || []) === JSON.stringify(it.marks || [])) {
      prev.text = (prev.text || "") + (it.text || "");
    } else {
      merged.push({ ...it });
    }
  }
  while (merged[0]?.type === "hardBreak") merged.shift();
  while (merged[merged.length - 1]?.type === "hardBreak") merged.pop();
  if (merged[0]?.type === "text") merged[0].text = (merged[0].text || "").replace(/^\s+/, "");
  const last = merged[merged.length - 1];
  if (last?.type === "text") last.text = (last.text || "").replace(/\s+$/, "");
  return merged.filter((x) => x.type !== "text" || !!x.text);
}

const plain = (nodes: PmNode[]): string => nodes.map((n) => (n.type === "text" ? n.text || "" : n.type === "hardBreak" ? " " : plain(n.content || []))).join("");

type Ctx = {
  images: ImportedImage[];
  avvisi: string[];
  // immagini trovate dentro tabelle: vengono messe dopo la tabella
  hoisted: PmNode[] | null;
  // larghezze delle colonne (twips) per tabella, in pre-ordine; null se non affidabili
  tableGrids: number[][] | null;
  tableCounter: number;
  pageTextTwips: number;
};

function imageNode(index: number, ctx: Ctx): PmNode | null {
  const img = ctx.images[index];
  if (!img) return null;
  return {
    type: "projectImage",
    attrs: { name: `__img:${index}`, src: "", didascalia: "", widthPct: img.widthPct ?? 60, align: "center" },
  };
}

const alignOf = (n: HNode): string | null => {
  const m = /\bal-(center|right|justify)\b/.exec(n.attrs.class || "");
  return m ? m[1] : null;
};

// Un paragrafo con immagini inline diventa: testo prima, immagine, testo dopo
function paragraphBlocks(inline: Inline[], ctx: Ctx, type: "paragraph" | "heading" = "paragraph", attrs?: Record<string, any>): PmNode[] {
  const out: PmNode[] = [];
  let run: PmNode[] = [];
  const flush = () => {
    const content = tidyInline(run);
    run = [];
    if (content.length === 0) return;
    if (!plain(content).trim() && !content.some((c) => c.type === "hardBreak")) return;
    out.push({ type, ...(attrs ? { attrs } : {}), content });
  };
  for (const it of inline) {
    if (it.type === "__img") {
      flush();
      const node = imageNode(it.index ?? -1, ctx);
      if (node) (ctx.hoisted ?? out).push(node);
    } else {
      run.push(it as PmNode);
    }
  }
  flush();
  return out;
}

function listNode(n: HNode, ctx: Ctx): PmNode {
  const items: PmNode[] = [];
  for (const li of n.children.filter((c) => c.tag === "li")) {
    const inlineKids = li.children.filter((c) => !(c.tag === "ul" || c.tag === "ol"));
    const nested = li.children.filter((c) => c.tag === "ul" || c.tag === "ol");
    const content: PmNode[] = [];
    // Dentro un li mammoth mette il testo diretto o in <p>
    const hasP = inlineKids.some((c) => c.tag === "p");
    if (hasP) {
      for (const k of inlineKids) {
        if (k.tag === "p") content.push(...paragraphBlocks(inlineOf(k.children, []), ctx));
      }
    } else {
      content.push(...paragraphBlocks(inlineOf(inlineKids, []), ctx));
    }
    if (content.length === 0) content.push({ type: "paragraph" });
    for (const nl of nested) content.push(listNode(nl, ctx));
    items.push({ type: "listItem", content });
  }
  return { type: n.tag === "ol" ? "orderedList" : "bulletList", content: items };
}

function tableNode(n: HNode, ctx: Ctx): PmNode | null {
  const rowsSrc: HNode[] = [];
  const collect = (nodes: HNode[]) => {
    for (const c of nodes) {
      if (c.tag === "tr") rowsSrc.push(c);
      else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") collect(c.children);
    }
  };
  collect(n.children);

  // Larghezza delle colonne dal Word, riportata ai px del foglio dell'editor
  const grid = ctx.tableGrids?.[ctx.tableCounter] ?? null;
  ctx.tableCounter++;
  const colPx = grid && grid.length && grid.every((w) => w > 0)
    ? grid.map((w) => Math.max(30, Math.round((w / ctx.pageTextTwips) * RELAZIONE_TEXT_WIDTH_PX)))
    : null;
  const total = colPx ? colPx.reduce((a, b) => a + b, 0) : 0;
  const scale = colPx && total > RELAZIONE_TEXT_WIDTH_PX ? RELAZIONE_TEXT_WIDTH_PX / total : 1;
  const occupied: number[] = [];

  const rows: PmNode[] = [];
  for (const tr of rowsSrc) {
    const cells: PmNode[] = [];
    let col = 0;
    for (const td of tr.children.filter((c) => c.tag === "td" || c.tag === "th")) {
      const content = blocksOf(td.children, ctx);
      const attrs: Record<string, any> = {};
      const colspan = Math.max(Number(td.attrs.colspan) || 1, 1);
      const rowspan = Math.max(Number(td.attrs.rowspan) || 1, 1);
      if (colspan > 1) attrs.colspan = colspan;
      if (rowspan > 1) attrs.rowspan = rowspan;
      while ((occupied[col] || 0) > 0) col++;
      if (colPx && col + colspan <= colPx.length) {
        attrs.colwidth = colPx.slice(col, col + colspan).map((w) => Math.max(30, Math.round(w * scale)));
      }
      if (rowspan > 1) for (let c = col; c < col + colspan; c++) occupied[c] = rowspan;
      col += colspan;
      cells.push({
        type: td.tag === "th" ? "tableHeader" : "tableCell",
        ...(Object.keys(attrs).length ? { attrs } : {}),
        content: content.length ? content : [{ type: "paragraph" }],
      });
    }
    for (let c = 0; c < occupied.length; c++) if ((occupied[c] || 0) > 0) occupied[c]--;
    if (cells.length) rows.push({ type: "tableRow", content: cells });
  }
  return rows.length ? { type: "table", content: rows } : null;
}

function blocksOf(nodes: HNode[], ctx: Ctx): PmNode[] {
  const out: PmNode[] = [];
  let loose: HNode[] = [];
  const flushLoose = () => {
    if (loose.length) out.push(...paragraphBlocks(inlineOf(loose, []), ctx));
    loose = [];
  };
  for (const n of nodes) {
    if (n.tag === "#text" || !BLOCK_TAGS.has(n.tag)) {
      loose.push(n);
      continue;
    }
    flushLoose();
    switch (n.tag) {
      case "p": {
        const al = alignOf(n);
        out.push(...paragraphBlocks(inlineOf(n.children, []), ctx, "paragraph", al ? { textAlign: al } : undefined));
        break;
      }
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        const level = Math.min(Number(n.tag[1]), 4);
        const al = alignOf(n);
        out.push(...paragraphBlocks(inlineOf(n.children, []), ctx, "heading", { level, ...(al ? { textAlign: al } : {}) }));
        break;
      }
      case "ul": case "ol":
        out.push(listNode(n, ctx));
        break;
      case "table": {
        const outer = ctx.hoisted;
        ctx.hoisted = [];
        const t = tableNode(n, ctx);
        const moved = ctx.hoisted;
        ctx.hoisted = outer;
        if (t) out.push(t);
        out.push(...moved);
        break;
      }
      case "blockquote": {
        const inner = blocksOf(n.children, ctx);
        if (inner.length) out.push({ type: "blockquote", content: inner });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      default:
        out.push(...blocksOf(n.children, ctx));
    }
  }
  flushLoose();
  return out;
}

// "Figura 3 – Pianta di fase": il paragrafo subito dopo un'immagine diventa la sua didascalia
const CAPTION_RE = /^(fig\.?|figura|tav\.?|tavola|foto|immagine)\s*\d+/i;

function attachCaptions(blocks: PmNode[]): PmNode[] {
  const out: PmNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out.push(b);
    const next = blocks[i + 1];
    if (b.type === "projectImage" && next?.type === "paragraph") {
      const text = plain(next.content || []).trim();
      if (CAPTION_RE.test(text) && text.length <= 300) {
        b.attrs = { ...b.attrs, didascalia: text };
        i++;
      }
    }
  }
  return out;
}

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Titolo'] => h1:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Titolo 1'] => h1:fresh",
  "p[style-name='Titolo 2'] => h2:fresh",
  "p[style-name='Titolo 3'] => h3:fresh",
  "p[style-name='Titolo 4'] => h4:fresh",
  "u => u",
];

const IMAGE_TYPES: Record<string, ImportedImage["ext"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function docxToPm(buffer: Buffer): Promise<DocxToPmResult> {
  const images: ImportedImage[] = [];
  const avvisi: string[] = [];
  let skipped = 0;

  const layout = await readDocxLayout(buffer);
  const { transform, stats } = buildLayoutTransform(layout);
  // Larghezza originale delle immagini: usata solo se i conteggi tornano con quelli del file
  let imageExtents: number[] | null = null;

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [...layoutStyleMap(), ...STYLE_MAP],
      transformDocument: (root: any) => {
        const out = transform(root);
        imageExtents = stats.images === layout.imageExtentsEmu.length ? layout.imageExtentsEmu : null;
        return out;
      },
      convertImage: mammoth.images.imgElement(async (image) => {
        const ext = IMAGE_TYPES[String(image.contentType || "").toLowerCase()];
        if (!ext) {
          skipped++;
          return { src: "" };
        }
        const data = await image.readAsBuffer();
        const tag = /^__i:(\d+)$/.exec(String((image as { altText?: string }).altText || ""));
        const emu = tag && imageExtents ? imageExtents[Number(tag[1])] : 0;
        const pct = emu > 0 ? Math.round((emu / 635 / layout.pageTextTwips) * 100) : null;
        images.push({ buffer: data, ext, widthPct: pct ? Math.min(100, Math.max(10, pct)) : null });
        return { src: `__img:${images.length - 1}`, alt: "" };
      }),
    },
  );
  if (skipped) avvisi.push(`${skipped} immagin${skipped === 1 ? "e" : "i"} in formato non supportato (EMF/WMF o altro) non importat${skipped === 1 ? "a" : "e"}: reinseriscile dall'editor.`);

  const tree = parseHtml(result.value);
  const htmlTables = (result.value.match(/<table\b/g) || []).length;
  const ctx: Ctx = {
    images,
    avvisi,
    hoisted: null,
    tableGrids: htmlTables === layout.tableGrids.length ? layout.tableGrids : null,
    tableCounter: 0,
    pageTextTwips: layout.pageTextTwips,
  };
  const content = attachCaptions(blocksOf(tree.children, ctx));
  return { doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, images, avvisi };
}

// ─── Collegamento automatico delle US ─────────────────────────────────────────

export type UsCollegata = { id: number; label: string; occorrenze: number };
export type UsNonTrovata = { testo: string; occorrenze: number };

export function buildUsIndex(usList: UnitaStratigrafica[]): Map<string, UnitaStratigrafica> {
  const index = new Map<string, UnitaStratigrafica>();
  for (const u of usList) {
    const key = usKey(u.codiceUS, u.tipo);
    if (key) index.set(key, u);
  }
  return index;
}

// "US 101", "T.12", "UUSS 101, 102 e 103", "US 12/13". Il numero dopo la lista eredita il prefisso.
const US_RE = /\b(UUSS|USS|US|T|SB|SF)\b\.?\s?(\d{1,4})\b((?:\s*(?:,|\/|\be\b|\bed\b)\s*\d{1,4}\b)*)/gi;
const TAIL_RE = /\d{1,4}/g;

function prefixOf(raw: string): string {
  const up = raw.toUpperCase();
  return up === "UUSS" || up === "USS" ? "US" : up;
}

function linkText(
  node: PmNode,
  index: Map<string, UnitaStratigrafica>,
  exclude: Set<number>,
  found: Map<number, UsCollegata>,
  missing: Map<string, UsNonTrovata>,
): PmNode[] {
  const text = node.text || "";
  const marks = node.marks || [];
  const out: PmNode[] = [];
  let cursor = 0;
  const push = (t: string, extra?: Mark) => {
    if (!t) return;
    const m = extra ? [...marks, extra] : marks;
    out.push({ type: "text", text: t, ...(m.length ? { marks: m } : {}) });
  };
  const link = (us: UnitaStratigrafica): Mark | undefined => {
    const hit = found.get(us.id) ?? { id: us.id, label: usLabel(us), occorrenze: 0 };
    hit.occorrenze++;
    found.set(us.id, hit);
    return exclude.has(us.id) ? undefined : { type: "usLink", attrs: { usId: us.id } };
  };

  US_RE.lastIndex = 0;
  for (let m = US_RE.exec(text); m; m = US_RE.exec(text)) {
    const prefix = prefixOf(m[1]);
    // Il numero iniziale è sempre una citazione; quelli in coda solo se esistono davvero
    const first = index.get(`${prefix}:${Number(m[2])}`);
    const headEnd = m.index + m[1].length + (m[0].slice(m[1].length).match(/^\.?\s?\d{1,4}/)?.[0].length ?? 0);

    if (!first) {
      const label = text.slice(m.index, headEnd);
      const miss = missing.get(label) ?? { testo: label, occorrenze: 0 };
      miss.occorrenze++;
      missing.set(label, miss);
    } else {
      push(text.slice(cursor, m.index));
      push(text.slice(m.index, headEnd), link(first));
      cursor = headEnd;
    }

    const tail = m[3] || "";
    if (tail) {
      const tailStart = m.index + m[0].length - tail.length;
      for (const t of Array.from(tail.matchAll(TAIL_RE))) {
        const pos = tailStart + (t.index ?? 0);
        const us = index.get(`${prefix}:${Number(t[0])}`);
        if (!us || pos < cursor) continue;
        push(text.slice(cursor, pos));
        push(t[0], link(us));
        cursor = pos + t[0].length;
      }
    }
  }
  if (cursor === 0) return [node];
  push(text.slice(cursor));
  return out;
}

export type LinkReport = { collegate: UsCollegata[]; nonTrovate: UsNonTrovata[] };

export function linkUs(doc: PmNode, index: Map<string, UnitaStratigrafica>, exclude: Set<number> = new Set()): { doc: PmNode; report: LinkReport } {
  const found = new Map<number, UsCollegata>();
  const missing = new Map<string, UsNonTrovata>();
  const visit = (node: PmNode): PmNode => {
    if (node.type === "text") return node;
    if (!node.content) return node;
    const content: PmNode[] = [];
    for (const child of node.content) {
      // I testi già collegati (link web) non si toccano
      if (child.type === "text" && child.text && !(child.marks || []).some((m) => m.type === "link")) {
        content.push(...linkText(child, index, exclude, found, missing));
      } else {
        content.push(visit(child));
      }
    }
    return { ...node, content };
  };
  const linked = visit(doc);
  return {
    doc: linked,
    report: {
      collegate: Array.from(found.values()).sort((a, b) => a.label.localeCompare(b.label, "it", { numeric: true })),
      nonTrovate: Array.from(missing.values()).sort((a, b) => b.occorrenze - a.occorrenze),
    },
  };
}

// ─── Titolo, tipo e periodo suggeriti ─────────────────────────────────────────

export type MetaSuggerita = {
  titolo: string;
  tipo: "libero" | "giornaliera" | "settimanale" | "mensile" | "fine_scavo";
  dataInizio: string | null;
  dataFine: string | null;
  fonteDate: string | null;
};

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MESI_RE = MESI.join("|");

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const monthIndex = (name: string) => MESI.indexOf(name.toLowerCase()) + 1;
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

function extractDates(text: string): string[] {
  const found: string[] = [];
  for (const m of Array.from(text.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g))) {
    const d = iso(fullYear(m[3]), Number(m[2]), Number(m[1]));
    if (d) found.push(d);
  }
  for (const m of Array.from(text.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:°|º)?\\s+(${MESI_RE})\\s+(\\d{4})\\b`, "gi")))) {
    const d = iso(Number(m[3]), monthIndex(m[2]), Number(m[1]));
    if (d) found.push(d);
  }
  return found;
}

function rangeFromText(text: string): [string, string] | null {
  // "dal 12 al 18 maggio 2025", "dal 4 all'10 maggio 2025", "dal 28 aprile al 4 maggio 2025", "12-18 maggio 2025"
  const m = new RegExp(
    `(?:dal\\s+|\\b)(\\d{1,2})(?:\\s+(${MESI_RE}))?(?:\\s+(\\d{4}))?\\s*(?:\\s+al\\s+|\\s+all['’]\\s*|\\s*[-–—]\\s*)(\\d{1,2})\\s+(${MESI_RE})\\s+(\\d{4})`,
    "i",
  ).exec(text);
  if (!m) return null;
  const y2 = Number(m[6]);
  const m2 = monthIndex(m[5]);
  const m1 = m[2] ? monthIndex(m[2]) : m2;
  const y1 = m[3] ? Number(m[3]) : m1 > m2 ? y2 - 1 : y2;
  const a = iso(y1, m1, Number(m[1]));
  const b = iso(y2, m2, Number(m[4]));
  return a && b && a <= b ? [a, b] : null;
}

function monthRange(text: string): [string, string] | null {
  const m = new RegExp(`\\b(${MESI_RE})\\s+(\\d{4})\\b`, "i").exec(text);
  if (!m) return null;
  const y = Number(m[2]);
  const mo = monthIndex(m[1]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const a = iso(y, mo, 1);
  const b = iso(y, mo, last);
  return a && b ? [a, b] : null;
}

export function suggerisciMeta(input: {
  fileName: string;
  doc: PmNode;
  giornate: { id: number; data: string }[];
}): MetaSuggerita {
  const base = input.fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  const blocks = input.doc.content || [];
  const firstHeading = blocks.find((b) => b.type === "heading");
  const titolo = (firstHeading ? plain(firstHeading.content || []).trim() : "") || base || "Relazione importata";

  const full = plain(blocks.flatMap((b) => b.content || [])).replace(/\s+/g, " ");
  const head = `${base} ${titolo} ${full.slice(0, 3000)}`;
  const intro = `${base} ${titolo} ${full.slice(0, 400)}`.toLowerCase();

  let tipo: MetaSuggerita["tipo"] = "libero";
  if (/settiman/.test(intro) || /\bw\d+\b/.test(intro)) tipo = "settimanale";
  else if (/mensil/.test(intro)) tipo = "mensile";
  else if (/finale|conclusiv|fine scavo/.test(intro)) tipo = "fine_scavo";
  else if (/giornalier|giornata/.test(intro)) tipo = "giornaliera";

  let dataInizio: string | null = null;
  let dataFine: string | null = null;
  let fonteDate: string | null = null;

  const range = rangeFromText(head);
  const dates = extractDates(head).sort();
  if (range) {
    [dataInizio, dataFine] = range;
    fonteDate = "intervallo indicato nel testo";
  } else if (dates.length) {
    dataInizio = dates[0];
    dataFine = dates[dates.length - 1];
    fonteDate = dates.length === 1 ? "data indicata nel testo" : "date indicate nel testo";
  } else if (tipo === "settimanale") {
    const wm = /(?:settimana\s*(?:n\.?|n°|numero)?\s*|\bw)(\d{1,3})\b/i.exec(head);
    const week = wm ? calcolaSettimaneProgetto(input.giornate).find((w) => w.weekNumber === Number(wm[1])) : null;
    if (week) {
      dataInizio = week.dataInizio;
      dataFine = week.dataFine;
      fonteDate = `settimana W${week.weekNumber} del giornale`;
    }
  } else if (tipo === "mensile") {
    const mr = monthRange(head);
    if (mr) {
      [dataInizio, dataFine] = mr;
      fonteDate = "mese indicato nel testo";
    }
  }
  if (!dataInizio && tipo === "fine_scavo") {
    const days = input.giornate.map((g) => g.data).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (days.length) {
      dataInizio = days[0];
      dataFine = days[days.length - 1];
      fonteDate = "tutte le giornate del giornale";
    }
  }
  if (dataInizio && dataFine === dataInizio && tipo === "libero") tipo = "giornaliera";
  return { titolo, tipo, dataInizio, dataFine, fonteDate };
}

// ─── Statistiche per l'anteprima ──────────────────────────────────────────────

export function statistiche(doc: PmNode, nImmagini: number) {
  let paragrafi = 0, titoli = 0, tabelle = 0;
  const visit = (n: PmNode) => {
    if (n.type === "paragraph") paragrafi++;
    else if (n.type === "heading") titoli++;
    else if (n.type === "table") tabelle++;
    (n.content || []).forEach(visit);
  };
  visit(doc);
  const testo = plain((doc.content || []).flatMap((b) => collectInline(b)));
  return { paragrafi, titoli, tabelle, immagini: nImmagini, parole: testo.split(/\s+/).filter(Boolean).length };
}

function collectInline(n: PmNode): PmNode[] {
  if (n.type === "text" || n.type === "hardBreak") return [n];
  return (n.content || []).flatMap(collectInline);
}

export function anteprimaTesto(doc: PmNode, max = 1800): string {
  const lines: string[] = [];
  for (const b of doc.content || []) {
    const t = b.type === "table"
      ? (b.content || []).map((row) => (row.content || []).map((c) => plain(collectInline(c)).trim()).join(" | ")).join("\n")
      : plain(collectInline(b)).trim();
    if (b.type === "projectImage") lines.push("[immagine]");
    else if (t) lines.push(b.type === "heading" ? `# ${t}` : t);
    if (lines.join("\n").length > max) break;
  }
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Sostituisce i segnaposto delle immagini con i file effettivamente salvati
export function bindImages(doc: PmNode, names: (string | null)[]): PmNode {
  const visit = (n: PmNode): PmNode | null => {
    if (n.type === "projectImage") {
      const idx = Number(String(n.attrs?.name || "").replace("__img:", ""));
      const name = names[idx];
      return name ? { ...n, attrs: { ...n.attrs, name, src: `/api/project/img/${encodeURIComponent(name)}` } } : null;
    }
    if (!n.content) return n;
    return { ...n, content: n.content.map(visit).filter((x): x is PmNode => !!x) };
  };
  return visit(doc) ?? doc;
}
