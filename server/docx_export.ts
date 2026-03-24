import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, convertInchesToTwip,
  VerticalAlignTable,
} from "docx";
import type { UnitaStratigrafica, Giornata, Cantiere } from "@shared/schema";

// ─── Costanti ────────────────────────────────────────────────────────────────
const COLOR_HEADER_BG  = "2C4A7C";
const COLOR_SECTION_BG = "D9E2F3";
const COLOR_WHITE      = "FFFFFF";
const COLOR_BORDER     = "2C4A7C";
const FONT             = "Arial";
const SIZE_NORMAL      = 18;   // 9pt
const SIZE_SMALL       = 16;   // 8pt
const SIZE_LABEL       = 18;   // 9pt bold
const SIZE_TITLE       = 28;   // 14pt

// ─── Bordi ───────────────────────────────────────────────────────────────────
const bSolid = (color = COLOR_BORDER) => ({
  top:    { style: BorderStyle.SINGLE, size: 4, color },
  bottom: { style: BorderStyle.SINGLE, size: 4, color },
  left:   { style: BorderStyle.SINGLE, size: 4, color },
  right:  { style: BorderStyle.SINGLE, size: 4, color },
});
const bLight = () => ({
  top:    { style: BorderStyle.SINGLE, size: 2, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "999999" },
  left:   { style: BorderStyle.SINGLE, size: 2, color: "999999" },
  right:  { style: BorderStyle.SINGLE, size: 2, color: "999999" },
});
const bNone = () => ({
  top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
});

// ─── Helpers base ─────────────────────────────────────────────────────────────
function t(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string; italic?: boolean } = {}
): TextRun {
  return new TextRun({
    text,
    bold:    opts.bold,
    italics: opts.italic,
    size:    opts.size || SIZE_NORMAL,
    font:    FONT,
    color:   opts.color,
  });
}

function pr(
  runs: TextRun[],
  align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT
): Paragraph {
  return new Paragraph({ children: runs, alignment: align, spacing: { before: 0, after: 0 } });
}

function cell(
  content: Paragraph[],
  opts: {
    colSpan?:  number;
    rowSpan?:  number;
    bg?:       string;
    borders?:  "solid" | "light" | "none";
    vAlign?:   (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable];
  } = {}
): TableCell {
  const brd = opts.borders === "light" ? bLight()
            : opts.borders === "none"  ? bNone()
            : bSolid();
  return new TableCell({
    children:      content,
    borders:       brd,
    columnSpan:    opts.colSpan,
    rowSpan:       opts.rowSpan,
    verticalAlign: opts.vAlign || VerticalAlignTable.TOP,
    shading:       opts.bg ? { type: ShadingType.SOLID, color: opts.bg, fill: opts.bg } : undefined,
    width:         { size: 100, type: WidthType.PERCENTAGE },
    margins:       { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

// Cella con sfondo sezione (blu scuro, testo bianco, centrato)
function secHdr(label: string, colSpan?: number): TableCell {
  return cell(
    [pr([t(label, { bold: true, size: SIZE_LABEL, color: COLOR_WHITE })], AlignmentType.CENTER)],
    { bg: COLOR_HEADER_BG, colSpan }
  );
}

// Cella etichetta (sfondo azzurro, testo scuro, grassetto)
function lbl(label: string, colSpan?: number): TableCell {
  return cell(
    [pr([t(label, { bold: true, size: SIZE_LABEL, color: "1A2E4A" })]),],
    { bg: COLOR_SECTION_BG, colSpan }
  );
}

// Cella valore libero (bordi leggeri, testo normale)
function val(value: string | null | undefined, colSpan?: number, rows = 1): TableCell {
  const lines = (value || "").split("\n");
  const pars: Paragraph[] = lines.map(line => pr([t(line)]));
  for (let i = 0; i < rows - 1; i++) pars.push(pr([t(" ")]));
  return cell(pars, { colSpan, borders: "light" });
}

// Cella label + valore inline ("Label: valore")
function lv(label: string, value: string | null | undefined, colSpan?: number): TableCell {
  return cell(
    [pr([t(label + ": ", { bold: true, size: SIZE_LABEL }), t(value || "—")])],
    { colSpan, borders: "light" }
  );
}

// Cella checkboxes
function chk(items: { label: string; checked: boolean }[], colSpan?: number): TableCell {
  return cell(
    items.map(i => pr([t(`${i.checked ? "☑" : "☐"} ${i.label}`)])),
    { colSpan, borders: "light" }
  );
}

// ─── Builder tabella scheda US ────────────────────────────────────────────────────
function buildSchedaUSTable(us: UnitaStratigrafica, cantiere: Cantiere | undefined): Table {
  const rows: TableRow[] = [];

  // ── Intestazione AR/S ───────────────────────────────────────────────────────
  rows.push(new TableRow({
    tableHeader: true,
    children: [
      cell([
        pr([t("AR/S",           { bold: true, size: 36, color: COLOR_WHITE })], AlignmentType.CENTER),
        pr([t("ARCHEOSISTEMI",  { bold: true, size: 18, color: COLOR_WHITE })], AlignmentType.CENTER),
        pr([t("Soc. Coop.",     { size: 14, color: COLOR_WHITE, italic: true })], AlignmentType.CENTER),
      ], { bg: COLOR_HEADER_BG }),
      cell([
        pr([t("SCHEDA DI UNITÀ STRATIGRAFICA (US)", { bold: true, size: SIZE_TITLE, color: COLOR_WHITE })], AlignmentType.CENTER),
        pr([t(cantiere?.nome || "",                  { size: 20, color: COLOR_WHITE, italic: true  })], AlignmentType.CENTER),
        pr([t(cantiere?.localita || "",              { size: 16, color: COLOR_WHITE, italic: true  })], AlignmentType.CENTER),
      ], { bg: COLOR_HEADER_BG, colSpan: 2 }),
    ],
  }));

  // ── Identificazione ─────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    lv("US",                          us.codiceUS),
    lv("n. catalogo generale",        us.nCatalogoGenerale),
    lv("n. catalogo internazionale",  us.nCatalogoInternazionale),
  ]}));
  rows.push(new TableRow({ children: [
    lv("Cantiere",      cantiere?.codice),
    lv("Anno",          us.anno || cantiere?.dataInizio?.slice(0, 4)),
    lv("Area / Settore",us.area || us.settore),
  ]}));
  rows.push(new TableRow({ children: [
    lv("Località", us.localita || cantiere?.localita, 3),
  ]}));
  rows.push(new TableRow({ children: [
    lv("Piante",    us.piante),
    lv("Sezioni",   us.sezioni),
    lv("Prospetti", us.prospetti),
  ]}));

  // ── Definizione e posizione ─────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Definizione e posizione", 3)] }));
  rows.push(new TableRow({ children: [val(us.definizione,        3, 3)] }));

  // ── Criteri di distinzione ──────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Criteri di distinzione", 3)] }));
  rows.push(new TableRow({ children: [val(us.criteriDistinzione, 3, 3)] }));

  // ── Modo di formazione ──────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Modo di formazione", 3)] }));
  rows.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.modoFormazione === "artificiale" ? "☑" : "☐"} artificiale    `),
        t(`${us.modoFormazione === "naturale"     ? "☑" : "☐"} naturale`),
      ]),
      ...(us.modoFormazioneOrigine ? [pr([t(us.modoFormazioneOrigine, { size: SIZE_SMALL, italic: true })])] : []),
    ], { colSpan: 3, borders: "light" }),
  ]}));

  // ── Componenti ──────────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Componenti"),
    secHdr("Inorganici"),
    secHdr("Organici"),
  ]}));
  rows.push(new TableRow({ children: [
    lbl("Materiali presenti"),
    chk([
      { label: "Materiale da costruzione", checked: !!us.compMaterialeCostruzione },
      { label: "Ceramica",                 checked: !!us.compCeramica },
      { label: "Metalli",                  checked: !!us.compMetalli },
      { label: "Vetro",                    checked: !!us.compVetro },
      { label: "Ciottoli",                 checked: !!us.compCiottoli },
      { label: "Ghiaia",                   checked: !!us.compGhiaia },
      { label: us.compAltroInorganico ? `Altro: ${us.compAltroInorganico}` : "Altro: _____________", checked: !!us.compAltroInorganico },
    ]),
    chk([
      { label: "Reperti faunistici",  checked: !!us.compFauna   },
      { label: "Osso",                checked: !!us.compOsso    },
      { label: "Corno",               checked: !!us.compCorno   },
      { label: "Semi",                checked: !!us.compSemi    },
      { label: "Frutti",              checked: !!us.compFrutti  },
      { label: "Carboni",             checked: !!us.compCarboni },
      { label: "Legno",               checked: !!us.compLegno   },
      { label: "Tessuti",             checked: !!us.compTessuti },
      { label: us.compAltroOrganico ? `Altro: ${us.compAltroOrganico}` : "Altro: _____________", checked: !!us.compAltroOrganico },
    ]),
  ]}));
  rows.push(new TableRow({ children: [
    lbl("Densità del materiale"),
    chk([
      { label: "fitta", checked: us.densitaInorganici === "fitta" },
      { label: "media", checked: us.densitaInorganici === "media" },
      { label: "rada",  checked: us.densitaInorganici === "rada"  },
    ]),
    chk([
      { label: "fitta", checked: us.densitaOrganici === "fitta" },
      { label: "media", checked: us.densitaOrganici === "media" },
      { label: "rada",  checked: us.densitaOrganici === "rada"  },
    ]),
  ]}));

  // ── Consistenza | Colore | Misure ───────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Consistenza"),
    secHdr("Colore"),
    secHdr("Misure"),
  ]}));
  rows.push(new TableRow({ children: [
    val(us.consistenza, undefined, 2),
    val(us.colore,      undefined, 2),
    val(us.misure,      undefined, 2),
  ]}));

  // ── Stato di conservazione ──────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Stato di conservazione", 3)] }));
  rows.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.statoConservazione === "Intatto"  ? "☑" : "☐"} Intatto    `),
        t(`${us.statoConservazione === "Buono"    ? "☑" : "☐"} Buono    `),
        t(`${us.statoConservazione === "Discreto" ? "☑" : "☐"} Discreto    `),
        t(`${us.statoConservazione === "Mediocre" ? "☑" : "☐"} Mediocre    `),
        t(`${us.statoConservazione === "Pessimo"  ? "☑" : "☐"} Pessimo`),
      ]),
      pr([
        t("L'unità è stata danneggiata da: ", { bold: true }),
        t(us.danneggiatoDa || "_______________________________"),
      ]),
    ], { colSpan: 3, borders: "light" }),
  ]}));

  // ── Descrizione ─────────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Descrizione", 3)] }));
  rows.push(new TableRow({ children: [val(us.descrizione, 3, 4)] }));

  // ── Relazioni stratigrafiche ─────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Uguale a"),
    secHdr("Si lega a"),
    secHdr("Sequenza fisica"),
  ]}));
  rows.push(new TableRow({ children: [
    val(us.uguale_a),
    val(us.si_lega_a),
    cell(
      (us.sequenzaFisica || "").split("\n").map(l => pr([t(l)])),
      { rowSpan: 9, borders: "light" }
    ),
  ]}));
  const relPairs: [string, string | null | undefined, string, string | null | undefined][] = [
    ["Gli si appoggia", us.gliSiAppoggia, "Si appoggia",  us.siAppoggia],
    ["Coperto da",      us.coperto_da,    "Copre",        us.copre],
    ["Tagliato da",     us.tagliatoDa,   "Taglia",       us.taglia],
    ["Riempito da",     us.riempitoDa,   "Riempie",      us.riempie],
  ];
  for (const [l1, v1, l2, v2] of relPairs) {
    rows.push(new TableRow({ children: [lbl(l1), lbl(l2)] }));
    rows.push(new TableRow({ children: [val(v1), val(v2)] }));
  }

  // ── Osservazioni / modalità di scavo ────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Osservazioni", 3)] }));
  rows.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.scavataIntegralmente ? "☑" : "☐"} L'unità è stata scavata integralmente    `),
        t(`${us.scavataParzialmente  ? "☑" : "☐"} parzialmente`),
      ]),
      pr([t(`${us.corrispondeAltraUnita ? "☑" : "☐"} L'unità corrisponde ad un'altra unità che si trova in altro punto dello scavo`)]),
      ...(us.corrispondeAltraUnita ? [pr([t(`  → ${us.corrispondeAltraUnita}`, { size: SIZE_SMALL, italic: true })])] : []),
      pr([t(`${us.asportataConAltriStrati ? "☑" : "☐"} L'unità è stata asportata insieme ad altri strati`)]),
      pr([t(`Altro: ${us.altroScavo || "_________________________________________"}`)]),
    ], { colSpan: 3, borders: "light" }),
  ]}));

  // ── Interpretazione ─────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Interpretazione", 3)] }));
  rows.push(new TableRow({ children: [val(us.interpretazione, 3, 4)] }));

  // ── Elementi datanti ────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Elementi datanti", 3)] }));
  rows.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.elementiDatanti === "Sequenza stratigrafica" ? "☑" : "☐"} Sequenza stratigrafica    `),
        t(`${us.elementiDatanti === "Reperti diagnostici"     ? "☑" : "☐"} Reperti diagnostici`),
      ]),
    ], { colSpan: 3, borders: "light" }),
  ]}));

  // ── Datazione ───────────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Datazione"),
    secHdr("Periodo o fase"),
    secHdr("Epoca"),
  ]}));
  rows.push(new TableRow({ children: [
    val(us.datazione,  undefined, 2),
    val(us.periodoFase || [us.periodoIniziale, us.periodoFinale].filter(Boolean).join(" – ") || null, undefined, 2),
    val(us.epoca,      undefined, 2),
  ]}));

  // ── Dati quantitativi reperti ────────────────────────────────────────────────
  rows.push(new TableRow({ children: [secHdr("Dati quantitativi dei reperti", 3)] }));
  rows.push(new TableRow({ children: [val(us.datiQuantitativiReperti || us.materialiRinvenuti, 3, 2)] }));

  // ── Campionature ─────────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Campionature"),
    secHdr("Flottazione"),
    secHdr("Setacciatura"),
  ]}));
  rows.push(new TableRow({ children: [
    lv("n.", us.campionatureN || us.campioni),
    chk([
      { label: "di tutta l'unità", checked: us.flottazioneTipo === "di tutta l'unità" },
      { label: "parziale",         checked: us.flottazioneTipo === "parziale" },
    ]),
    chk([
      { label: "di tutta l'unità", checked: us.setacciaturaTipo === "di tutta l'unità" },
      { label: "parziale",         checked: us.setacciaturaTipo === "parziale" },
    ]),
  ]}));

  // ── Affidabilità / Responsabili ─────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    secHdr("Affidabilità stratigrafica"),
    secHdr("Responsabile SABAP-UMB"),
    secHdr("Responsabile Archeosistemi"),
  ]}));
  rows.push(new TableRow({ children: [
    chk([
      { label: "nessuna", checked: us.affidabilitaStratigrafica === "nessuna" },
      { label: "modesta", checked: us.affidabilitaStratigrafica === "modesta" },
      { label: "buona",   checked: us.affidabilitaStratigrafica === "buona"   },
    ]),
    val(us.responsabileSabap,           undefined, 2),
    val(us.responsabileArcheosistemi,   undefined, 2),
  ]}));

  // ── Footer ───────────────────────────────────────────────────────────────────
  rows.push(new TableRow({ children: [
    cell([
      pr(
        [t(`Documento generato il ${new Date().toLocaleDateString("it-IT")} — ArcheoDoc`, { size: 14, color: "999999", italic: true })],
        AlignmentType.RIGHT
      ),
    ], { colSpan: 3, borders: "none" }),
  ]}));

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── EXPORT: Scheda US ───────────────────────────────────────────────────────────
export async function exportSchedaUSDocx(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
  _schedaAiFormattata: string,
  _campiMancanti: string[],
  _noteAi: string,
): Promise<Buffer> {
  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Scheda US ${us.codiceUS}`,
    description: `Scheda stratigrafica ${us.codiceUS} — ${cantiere?.nome || ""}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.6),
            bottom: convertInchesToTwip(0.6),
            left:   convertInchesToTwip(0.7),
            right:  convertInchesToTwip(0.7),
          },
        },
      },
      children: [buildSchedaUSTable(us, cantiere)],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── EXPORT: Report Giornaliero ────────────────────────────────────────────────
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

  const mp = (text: string, bold = false, size = SIZE_NORMAL, color?: string): Paragraph =>
    new Paragraph({
      children: [new TextRun({ text, bold, size, font: FONT, color })],
      spacing: { after: 80 },
    });
  const sep = (): Paragraph => new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "C8B89A" } },
    spacing: { after: 120 },
    text: "",
  });

  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "DIARIO GIORNALIERO DI SCAVO", bold: true, size: 32, font: FONT, allCaps: true })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: cantiere?.nome || "—", size: 24, font: FONT, color: "6B5B45" })],
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${cantiere?.localita || ""} — ${cantiere?.codice || ""}`, size: 20, font: FONT, italics: true, color: "8B7355" })],
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
    }),
    sep(),
    mp("Dati della giornata", true, 22),
    mp(`Data: ${giornata.data}`),
    mp(`Operatori: ${operatori}`),
    mp(`Condizioni meteo: ${giornata.condMeteo || "—"}`),
    mp(`Settore: ${giornata.settore || "—"}`),
    mp(`Committente: ${cantiere?.committente || "—"}`),
  ];

  if (campiMancanti.length > 0) {
    children.push(sep(), mp("⚠ Campi mancanti", true, 22));
    campiMancanti.forEach(c =>
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "• ", bold: true, color: "C0392B", size: SIZE_NORMAL, font: FONT }),
          new TextRun({ text: c, size: SIZE_NORMAL, color: "C0392B", font: FONT }),
        ],
        spacing: { after: 60 },
      }))
    );
  }

  children.push(sep(), mp("Diario di scavo", true, 22));
  reportFormattato.split("\n").forEach(line => {
    const isHdr = line.match(/^[A-Z][A-Z\s]+:?\s*$/) || line.match(/^\d+\./);
    children.push(new Paragraph({
      children: [new TextRun({ text: line || " ", bold: !!isHdr, size: isHdr ? 22 : SIZE_NORMAL, font: FONT })],
      spacing: { after: isHdr ? 100 : 60 },
    }));
  });

  if (noteAi) {
    children.push(
      sep(),
      mp("Note sulla qualità della documentazione", true, 22),
      new Paragraph({
        children: [new TextRun({ text: noteAi, size: SIZE_NORMAL, font: FONT, italics: true })],
        spacing: { after: 100 },
      }),
    );
  }

  children.push(
    sep(),
    new Paragraph({
      children: [new TextRun({
        text: `Documento generato il ${new Date().toLocaleDateString("it-IT")} — ArcheoDoc`,
        size: 14, color: "999999", italics: true, font: FONT,
      })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    }),
  );

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Diario di scavo — ${giornata.data}`,
    description: `Diario giornaliero ${giornata.data} — ${cantiere?.nome || ""}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left:   convertInchesToTwip(1.2),
            right:  convertInchesToTwip(1.2),
          },
        },
      },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
