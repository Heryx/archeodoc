import {
  escapeXmlText,
  extractCellText,
  readDocumentXml,
  splitCellBlocks,
  splitRows,
  splitTables,
  writeDocumentXml,
} from "./docx_xml_utils";

/** Estrae il primo `<w:rPr>...</w:rPr>` trovato tra i run di una cella (per non perdere la formattazione). */
function firstRunProperties(cellXml: string): string {
  const m = cellXml.match(/<w:r\b[^>]*>[\s\S]*?<w:rPr>[\s\S]*?<\/w:rPr>/);
  if (!m) return "";
  const rPr = m[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  return rPr ? rPr[0] : "";
}

/** Ricostruisce una cella `<w:tc>` collassando il primo paragrafo in un unico run col testo dato. */
function rebuildCellWithText(cellXml: string, newText: string): string {
  const tcPrMatch = cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  const tcPr = tcPrMatch ? tcPrMatch[0] : "";

  const pPrMatch = cellXml.match(/<w:p\b[^>]*>[\s\S]*?<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? (pPrMatch[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0] : "";

  const rPr = firstRunProperties(cellXml);
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(newText)}</w:t></w:r>`;

  return `<w:tc>${tcPr}<w:p>${pPr}${run}</w:p></w:tc>`;
}

/**
 * Riscrive, nel template DOCX salvato sul server, tutte le celle di tabella il cui testo
 * contiene esattamente `{oldKey}`, sostituendolo con `{newKey}`. Sovrascrive il file in place.
 * Non tocca nessun file dell'utente al di fuori di questo template gestito dall'app.
 */
export async function rewriteTemplatePlaceholder(
  templatePath: string,
  oldKey: string,
  newKey: string,
): Promise<{ replacedCells: number }> {
  const oldToken = `{${oldKey}}`;
  const newToken = `{${newKey}}`;

  const xml = await readDocumentXml(templatePath);
  const tables = splitTables(xml);

  let newXml = xml;
  let replacedCells = 0;

  for (const tableXml of tables) {
    const rows = splitRows(tableXml);
    for (const rowXml of rows) {
      const cellBlocks = splitCellBlocks(rowXml);
      for (const cellXml of cellBlocks) {
        const text = extractCellText(cellXml);
        if (!text.includes(oldToken)) continue;

        const newText = text.split(oldToken).join(newToken);
        const newCellXml = rebuildCellWithText(cellXml, newText);
        // Sostituzione mirata: cerchiamo ancora l'occorrenza esatta nel documento aggiornato
        // (potrebbero esserci più celle identiche, sostituiamo una alla volta man mano che le troviamo).
        if (newXml.includes(cellXml)) {
          newXml = newXml.replace(cellXml, newCellXml);
          replacedCells += 1;
        }
      }
    }
  }

  if (replacedCells === 0) {
    throw new Error(`Placeholder "${oldToken}" non trovato nel template`);
  }

  await writeDocumentXml(templatePath, newXml);
  return { replacedCells };
}

export type CellTokenEdit = {
  /** Applica l'edit solo alle celle il cui testo concatenato contiene questa stringa. */
  cellMustContain: string;
  /** Sottostringa da sostituire nel testo della cella. */
  from: string;
  /** Testo con cui sostituirla (stringa vuota = rimozione). */
  to: string;
};

/**
 * Applica una serie di sostituzioni testuali mirate alle celle di tabella del template DOCX
 * gestito dall'app (in place). Ogni cella che soddisfa `cellMustContain` viene ricostruita
 * collassando il primo paragrafo in un unico run (come `rewriteTemplatePlaceholder`), così le
 * sostituzioni funzionano anche quando un tag è spezzato su più run. Usato per riparare i
 * template "Elenco US" (spostamento del tag di chiusura del loop, rinomina placeholder).
 */
export async function applyCellTokenEdits(
  templatePath: string,
  edits: CellTokenEdit[],
): Promise<{ editedCells: number }> {
  if (edits.length === 0) return { editedCells: 0 };

  const xml = await readDocumentXml(templatePath);
  const tables = splitTables(xml);

  let newXml = xml;
  let editedCells = 0;

  for (const tableXml of tables) {
    for (const rowXml of splitRows(tableXml)) {
      for (const cellXml of splitCellBlocks(rowXml)) {
        const text = extractCellText(cellXml);
        const applicable = edits.filter((e) => text.includes(e.cellMustContain) && text.includes(e.from));
        if (applicable.length === 0) continue;

        let newText = text;
        for (const e of applicable) newText = newText.split(e.from).join(e.to);
        if (newText === text) continue;

        const newCellXml = rebuildCellWithText(cellXml, newText);
        if (newXml.includes(cellXml)) {
          newXml = newXml.replace(cellXml, newCellXml);
          editedCells += 1;
        }
      }
    }
  }

  await writeDocumentXml(templatePath, newXml);
  return { editedCells };
}
