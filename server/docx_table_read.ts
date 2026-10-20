import { readDocumentXml, splitCellTexts, splitRows, splitTables } from "./docx_xml_utils";

/** Trova nel testo di una cella il primo tag {#nome} o {/nome} (marcatore di loop docxtemplater). */
function findLoopMarker(cellText: string): { marker: "#" | "/"; tagName: string } | null {
  const m = cellText.match(/\{(#|\/)([a-zA-Z0-9_]+)\}/);
  if (!m) return null;
  return { marker: m[1] as "#" | "/", tagName: m[2] };
}

/** Estrae la prima chiave placeholder "dati" di una cella, ignorando l'eventuale marcatore di loop indicato. */
function extractDataKey(cellText: string, tagName: string): string | null {
  const re = /\{(#|\/)?([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cellText)) !== null) {
    const marker = m[1];
    const name = m[2];
    if ((marker === "#" || marker === "/") && name === tagName) continue;
    return name;
  }
  return null;
}

export type TemplateLoopColumns = {
  /** Nome del tag di loop così come scritto nel template (es. "us", "US"...). */
  tagName: string;
  /** Numero di righe (header) che precedono il blocco di loop nella stessa tabella. */
  headerRowCount: number;
  /** Numero di righe fisiche di tabella che compongono un singolo record (di solito 1). */
  rowsPerRecord: number;
  /** Chiave campo per ogni colonna di ciascuna riga del record (null se la cella è solo un marcatore di loop). */
  columnKeys: (string | null)[][];
};

/**
 * Analizza un template DOCX "Elenco US" e individua il blocco di righe di tabella
 * delimitato dai tag di loop docxtemplater {#tag} ... {/tag} (nome libero, tipicamente
 * "us"), restituendo l'ordine delle colonne per ciascuna riga del record e quante righe
 * di intestazione lo precedono. Supporta record su più righe fisiche di tabella.
 */
export async function extractTemplateLoopColumns(templatePath: string): Promise<TemplateLoopColumns | null> {
  const xml = await readDocumentXml(templatePath);
  const tables = splitTables(xml);

  for (const tableXml of tables) {
    const rows = splitRows(tableXml);
    for (let i = 0; i < rows.length; i += 1) {
      const cellsOpen = splitCellTexts(rows[i]);
      const openMarker = cellsOpen.map(findLoopMarker).find((m) => m?.marker === "#");
      if (!openMarker) continue;
      const tagName = openMarker.tagName;

      // Cerca la riga di chiusura corrispondente (stesso nome di tag), da i in avanti.
      let closeIndex = -1;
      for (let j = i; j < rows.length; j += 1) {
        const cellsClose = splitCellTexts(rows[j]);
        if (cellsClose.some((c) => findLoopMarker(c)?.marker === "/" && findLoopMarker(c)?.tagName === tagName)) {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex === -1) continue;

      const columnKeys: (string | null)[][] = [];
      for (let k = i; k <= closeIndex; k += 1) {
        columnKeys.push(splitCellTexts(rows[k]).map((cellText) => extractDataKey(cellText, tagName)));
      }

      return { tagName, headerRowCount: i, rowsPerRecord: closeIndex - i + 1, columnKeys };
    }
  }

  return null;
}

/**
 * Legge le righe dati di un DOCX "elenco" compilato dall'utente (stessa struttura
 * di tabella del template, ma con valori reali al posto dei placeholder) e le
 * raggruppa per record secondo `rowsPerRecord`. Sceglie la tabella la cui prima riga
 * dati ha lo stesso numero di celle della prima riga del record nel template.
 */
export async function extractTableDataRows(
  docxPath: string,
  headerRowCount: number,
  rowsPerRecord: number,
  columnCountFirstRow: number,
): Promise<string[][][]> {
  const xml = await readDocumentXml(docxPath);
  const tables = splitTables(xml);
  if (!tables.length) return [];

  let bestRows: string[] | null = null;
  let bestScore = -1;
  for (const tableXml of tables) {
    const rows = splitRows(tableXml);
    const score = rows.filter((r) => splitCellTexts(r).length === columnCountFirstRow).length;
    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }
  if (!bestRows) return [];

  const dataRows = bestRows.slice(headerRowCount).map((r) => splitCellTexts(r).map((c) => c.trim()));

  const records: string[][][] = [];
  for (let i = 0; i + rowsPerRecord <= dataRows.length; i += rowsPerRecord) {
    const chunk = dataRows.slice(i, i + rowsPerRecord);
    if (chunk.some((row) => row.some((c) => c.length > 0))) {
      records.push(chunk);
    }
  }
  return records;
}
