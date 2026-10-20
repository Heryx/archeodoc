import fs from "fs";

/** Helper di basso livello per leggere/scrivere la tabella di un .docx (XML grezzo), condivisi
 * tra lettura (docx_table_read.ts) e riscrittura mirata di un placeholder (docx_template_rewrite.ts). */

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Estrae il testo concatenato di una cella dal suo blocco XML grezzo `<w:tc>...</w:tc>`. */
export function extractCellText(cellXml: string): string {
  const matches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  return matches
    .map((m) => decodeXmlEntities(m.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, "")))
    .join("");
}

/** Blocchi XML grezzi `<w:tc>...</w:tc>` di una riga. */
export function splitCellBlocks(rowXml: string): string[] {
  return rowXml.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) || [];
}

/** Testo di ciascuna cella di una riga (scorciatoia su `splitCellBlocks` + `extractCellText`). */
export function splitCellTexts(rowXml: string): string[] {
  return splitCellBlocks(rowXml).map(extractCellText);
}

export function splitRows(tableXml: string): string[] {
  return tableXml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || [];
}

export function splitTables(documentXml: string): string[] {
  return documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
}

export async function readDocumentXml(docxPath: string): Promise<string> {
  const PizZip = (await import("pizzip")).default;
  const buf = fs.readFileSync(docxPath);
  const zip = new PizZip(buf);
  const xml = zip.file("word/document.xml")?.asText();
  if (!xml) throw new Error("Impossibile leggere il contenuto del documento .docx");
  return xml;
}

/** Sovrascrive `word/document.xml` nello stesso file .docx, lasciando invariato il resto dell'archivio. */
export async function writeDocumentXml(docxPath: string, newXml: string): Promise<void> {
  const PizZip = (await import("pizzip")).default;
  const buf = fs.readFileSync(docxPath);
  const zip = new PizZip(buf);
  zip.file("word/document.xml", newXml);
  const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(docxPath, out);
}
