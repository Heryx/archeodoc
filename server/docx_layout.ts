import JSZip from "jszip";

// Informazioni di impaginazione che mammoth non espone: formattazione definita negli stili,
// dimensioni delle immagini, larghezza delle colonne delle tabelle e della pagina.

export type StyleInfo = {
  id: string;
  name: string;
  basedOn?: string;
  bold?: boolean;
  size?: number; // pt
  caps?: boolean;
  outline?: number; // 0 = livello 1
  jc?: string;
};

export type DocxLayout = {
  styles: Map<string, StyleInfo>;
  defaultSize: number;
  pageTextTwips: number;
  // Extent (EMU) delle immagini "drawing", nell'ordine del documento
  imageExtentsEmu: number[];
  // Larghezze delle colonne (twips) di ogni tabella, in pre-ordine
  tableGrids: number[][];
};

const attr = (xml: string, tag: string, name = "w:val"): string | null => {
  const m = new RegExp(`<${tag}\\b([^>]*)/?>`).exec(xml);
  if (!m) return null;
  const a = new RegExp(`${name}="([^"]*)"`).exec(m[1]);
  return a ? a[1] : "";
};

const flag = (xml: string, tag: string): boolean | undefined => {
  const v = attr(xml, tag);
  if (v === null) return undefined;
  return !(v === "0" || v === "false");
};

function parseStyles(xml: string): { raw: Map<string, StyleInfo>; defaultSize: number; defaultParaId: string | null } {
  const raw = new Map<string, StyleInfo>();
  let defaultParaId: string | null = null;
  const docDefaults = /<w:docDefaults>([\s\S]*?)<\/w:docDefaults>/.exec(xml)?.[1] || "";
  const ddSz = Number(attr(docDefaults, "w:sz"));
  let defaultSize = ddSz > 0 ? ddSz / 2 : 11;

  for (const m of Array.from(xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g))) {
    const head = m[1];
    const body = m[2];
    const id = /w:styleId="([^"]*)"/.exec(head)?.[1];
    if (!id) continue;
    const type = /w:type="([^"]*)"/.exec(head)?.[1];
    if (type !== "paragraph" && type !== "character") continue;
    if (type === "paragraph" && /w:default="(1|true)"/.test(head)) defaultParaId = id;
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(body)?.[1] || "";
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ""))?.[1] || "";
    const sz = Number(attr(rPr, "w:sz"));
    const outline = attr(pPr, "w:outlineLvl");
    raw.set(id, {
      id,
      name: attr(body, "w:name") || id,
      basedOn: attr(body, "w:basedOn") || undefined,
      bold: flag(rPr, "w:b"),
      caps: flag(rPr, "w:caps"),
      size: sz > 0 ? sz / 2 : undefined,
      outline: outline !== null && /^\d$/.test(outline) ? Number(outline) : undefined,
      jc: attr(pPr, "w:jc") || undefined,
    });
  }
  return { raw, defaultSize, defaultParaId };
}

// Applica l'ereditarietà (basedOn): le proprietà del figlio prevalgono
function resolveStyles(raw: Map<string, StyleInfo>): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  const resolve = (id: string, seen: Set<string>): StyleInfo | undefined => {
    const hit = out.get(id);
    if (hit) return hit;
    const own = raw.get(id);
    if (!own || seen.has(id)) return own;
    seen.add(id);
    const parent = own.basedOn ? resolve(own.basedOn, seen) : undefined;
    const merged: StyleInfo = {
      ...own,
      bold: own.bold ?? parent?.bold,
      caps: own.caps ?? parent?.caps,
      size: own.size ?? parent?.size,
      outline: own.outline ?? parent?.outline,
      jc: own.jc ?? parent?.jc,
    };
    out.set(id, merged);
    return merged;
  };
  for (const id of Array.from(raw.keys())) resolve(id, new Set());
  return out;
}

export async function readDocxLayout(buffer: Buffer): Promise<DocxLayout> {
  const empty: DocxLayout = { styles: new Map(), defaultSize: 11, pageTextTwips: 9026, imageExtentsEmu: [], tableGrids: [] };
  try {
    const zip = await JSZip.loadAsync(buffer);
    const read = async (name: string) => (await zip.file(name)?.async("string")) || "";
    const documentXml = await read("word/document.xml");
    const stylesXml = await read("word/styles.xml");

    const parsed = stylesXml ? parseStyles(stylesXml) : { raw: new Map<string, StyleInfo>(), defaultSize: 11, defaultParaId: null };
    const styles = resolveStyles(parsed.raw);
    const defaultSize = (parsed.defaultParaId ? styles.get(parsed.defaultParaId)?.size : undefined) ?? parsed.defaultSize;

    // Larghezza del testo: ultima sezione del documento
    let pageTextTwips = 9026;
    const sects = Array.from(documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g));
    const lastSect = sects[sects.length - 1]?.[0];
    if (lastSect) {
      const w = Number(attr(lastSect, "w:pgSz", "w:w"));
      const l = Number(attr(lastSect, "w:pgMar", "w:left"));
      const r = Number(attr(lastSect, "w:pgMar", "w:right"));
      if (w > 0 && w - l - r > 2000) pageTextTwips = w - l - r;
    }

    const imageExtentsEmu: number[] = [];
    for (const d of Array.from(documentXml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g))) {
      if (!d[0].includes("<a:blip")) continue;
      const cx = Number(attr(d[0], "wp:extent", "cx"));
      imageExtentsEmu.push(cx > 0 ? cx : 0);
    }

    const tableGrids: number[][] = [];
    const parts = documentXml.split(/<w:tbl[ >]/);
    for (let i = 1; i < parts.length; i++) {
      const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(parts[i])?.[1] || "";
      tableGrids.push(Array.from(grid.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)).map((g) => Number(g[1])));
    }

    return { styles, defaultSize, pageTextTwips, imageExtentsEmu, tableGrids };
  } catch {
    return empty;
  }
}

// ─── Riconoscimento di titoli e allineamenti (trasformazione del documento di mammoth) ──

type El = any;

const HEADING_NAME_RE = /^(?:heading|titolo)\s*([1-9])$/i;

function headingFromStyleNames(layout: DocxLayout, styleId: string | null, styleName: string | null): number | null {
  const names: string[] = [];
  if (styleName) names.push(styleName);
  const seen = new Set<string>();
  let id: string | undefined = styleId || undefined;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = layout.styles.get(id);
    if (!s) break;
    names.push(s.name);
    id = s.basedOn;
  }
  for (const raw of names) {
    const n = raw.trim();
    const m = HEADING_NAME_RE.exec(n);
    if (m) return Number(m[1]);
    if (/^(title|titolo)$/i.test(n)) return 1;
    if (/^(subtitle|sottotitolo)$/i.test(n)) return 2;
  }
  return null;
}

const textOf = (el: El): string => (el.type === "text" ? String(el.value || "") : (el.children || []).map(textOf).join(""));

type Run = { chars: number; bold: boolean; size: number; caps: boolean };

function runsOf(layout: DocxLayout, para: El, paraStyle: StyleInfo | undefined): Run[] {
  const out: Run[] = [];
  const visit = (el: El) => {
    if (el.type === "run") {
      const chars = (el.children || []).map(textOf).join("").trim().length;
      if (chars > 0) {
        const rs = el.styleId ? layout.styles.get(el.styleId) : undefined;
        out.push({
          chars,
          bold: !!el.isBold || !!rs?.bold || !!paraStyle?.bold,
          size: Number(el.fontSize) || rs?.size || paraStyle?.size || layout.defaultSize,
          caps: !!el.isAllCaps || !!rs?.caps || !!paraStyle?.caps,
        });
      }
      return;
    }
    (el.children || []).forEach(visit);
  };
  visit(para);
  return out;
}

type Cand = { el: El; size: number; bold: boolean; caps: boolean; depth: number };

const NUM_PREFIX = /^(\d+(?:\.\d+)*)[.)]?\s+\S/;

const ALIGNS: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

export const LAYOUT_STYLE_KINDS = ["p", "h1", "h2", "h3", "h4"] as const;
export const LAYOUT_STYLE_ALIGNS = ["left", "center", "right", "justify"] as const;

// Regole per lo styleMap di mammoth: i nomi sintetici assegnati dalla trasformazione diventano
// tag HTML con una classe di allineamento ("al-center", ...)
export function layoutStyleMap(): string[] {
  const rules: string[] = [];
  for (const kind of LAYOUT_STYLE_KINDS) {
    const tag = kind === "p" ? "p" : kind;
    for (const al of LAYOUT_STYLE_ALIGNS) {
      rules.push(`p[style-name='__${kind}_${al}'] => ${tag}${al === "left" ? "" : `.al-${al}`}:fresh`);
    }
  }
  return rules;
}

export type TransformStats = { images: number; headings: number; styled: number };

// Restituisce la trasformazione per `transformDocument` e, a fine conversione, le statistiche
export function buildLayoutTransform(layout: DocxLayout) {
  const stats: TransformStats = { images: 0, headings: 0, styled: 0 };

  const transform = (root: El): El => {
    // 1. Raccolta dei paragrafi fuori da tabelle ed elenchi
    const bodyParas: { el: El; text: string; style?: StyleInfo; runs: Run[] }[] = [];
    const collect = (el: El, inTable: boolean) => {
      if (el.type === "paragraph" && !inTable) {
        const text = textOf(el).trim();
        if (text) {
          const style = el.styleId ? layout.styles.get(el.styleId) : undefined;
          bodyParas.push({ el, text, style, runs: runsOf(layout, el, style) });
        }
      }
      const nextIn = inTable || el.type === "table";
      (el.children || []).forEach((c: El) => collect(c, nextIn));
    };
    collect(root, false);

    // 2. Corpo del testo = dimensione più usata (per numero di caratteri)
    const weight = new Map<number, number>();
    for (const p of bodyParas) for (const r of p.runs) weight.set(r.size, (weight.get(r.size) || 0) + r.chars);
    let bodySize = layout.defaultSize;
    let best = 0;
    weight.forEach((w, size) => { if (w > best) { best = w; bodySize = size; } });

    // 3. Titoli: prima per stile/livello esplicito, poi per aspetto (grassetto, dimensione, numerazione)
    const kinds = new Map<El, string>();
    let styledHeadings = 0;
    for (const p of bodyParas) {
      const lvl = headingFromStyleNames(layout, p.el.styleId, p.el.styleName)
        ?? (p.style?.outline !== undefined ? p.style.outline + 1 : null);
      if (lvl && lvl <= 9 && !p.el.numbering) {
        kinds.set(p.el, `h${Math.min(lvl, 4)}`);
        styledHeadings++;
      }
    }

    const cands: Cand[] = [];
    for (const p of bodyParas) {
      if (kinds.has(p.el) || p.el.numbering) continue;
      if (p.el.styleName && /list|elenco|caption|didascalia|quote|citazione/i.test(String(p.el.styleName))) continue;
      const len = p.text.length;
      if (len > 150 || p.runs.length === 0) continue;
      if (/[;,:]$/.test(p.text)) continue;
      if (/\.$/.test(p.text) && len > 40) continue;
      const chars = p.runs.reduce((n, r) => n + r.chars, 0);
      const bold = p.runs.every((r) => r.bold);
      const caps = /[A-ZÀ-Ý]{4}/.test(p.text) && p.text === p.text.toUpperCase();
      const size = p.runs.reduce((m, r) => Math.max(m, r.size), 0);
      const big = size >= bodySize + 1.5;
      if (!((bold && size >= bodySize - 0.5) || big)) continue;
      if (chars === 0) continue;
      const m = NUM_PREFIX.exec(p.text);
      cands.push({ el: p.el, size, bold, caps, depth: m ? m[1].split(".").length : 0 });
    }

    // Se quasi tutto sembra un titolo, il file usa il grassetto come enfasi: meglio non indovinare
    const usable = cands.length <= Math.max(8, bodyParas.length * 0.4);
    if (usable && cands.length) {
      const key = (c: Cand) => `${c.size}|${c.bold ? 1 : 0}|${c.depth}`;
      const keys = Array.from(new Set(cands.map(key))).sort((a, b) => {
        const [sa, ba, da] = a.split("|").map(Number);
        const [sb, bb, db] = b.split("|").map(Number);
        return sb - sa || bb - ba || da - db;
      });
      // Con titoli già in stile, quelli dedotti stanno sotto il livello più basso già usato
      const base = styledHeadings
        ? Math.max(...Array.from(kinds.values()).map((k) => Number(k[1])))
        : 0;
      for (const c of cands) kinds.set(c.el, `h${Math.min(base + keys.indexOf(key(c)) + 1, 4)}`);
    }

    // 4. Ricostruzione: nomi di stile sintetici (titolo + allineamento) e tag delle immagini
    const rebuild = (el: El): El => {
      if (el.type === "image") return { ...el, altText: `__i:${stats.images++}` };
      const copy = el.children ? { ...el, children: el.children.map(rebuild) } : el;
      if (el.type !== "paragraph") return copy;

      const kind = kinds.get(el) || "p";
      const listLike = !!el.numbering || /list|elenco/i.test(String(el.styleName || ""));
      const style = el.styleId ? layout.styles.get(el.styleId) : undefined;
      const al = ALIGNS[String(el.alignment || style?.jc || "")] || "left";
      if (kind === "p" && (al === "left" || listLike)) return copy;
      if (kind !== "p") stats.headings++;
      stats.styled++;
      const name = `__${kind}_${al}`;
      return { ...copy, styleId: name, styleName: name };
    };
    return rebuild(root);
  };

  return { transform, stats };
}
