import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, convertInchesToTwip,
  VerticalAlignTable, ImageRun,
} from "docx";
import fs from "fs";
import path from "path";
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
        pr([t("ArcheoDoc", { bold: true, size: 28, color: COLOR_WHITE })], AlignmentType.CENTER),
        pr([t("Scheda US",  { size: 16, color: COLOR_WHITE, italic: true })], AlignmentType.CENTER),
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
    lv("Quota s.l.m. (m)", us.quota != null ? String(us.quota) : null),
    lv("Quota da piano campagna (m)", us.quotaPianoCampagna != null ? String(us.quotaPianoCampagna) : null, 2),
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
    secHdr("Responsabile scavo"),
  ]}));
  rows.push(new TableRow({ children: [
    chk([
      { label: "nessuna", checked: us.affidabilitaStratigrafica === "nessuna" },
      { label: "modesta", checked: us.affidabilitaStratigrafica === "modesta" },
      { label: "buona",   checked: us.affidabilitaStratigrafica === "buona"   },
    ]),
    val(us.responsabileSabap,   undefined, 2),
    val(us.responsabileScavo,   undefined, 2),
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

// ─── Builder scheda US — Modello Esteso ArcheoDoc (2 pagine) ─────────────────────
// Ritorna due oggetti Table (pagina 1 e pagina 2) da inserire in sections separate.
function buildSchedaEstesaUSTables(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): { tabella1: Table; tabella2: Table } {

  // ── Helper locali ────────────────────────────────────────────────────────────
  // Cella header dark (sfondo blu, testo bianco bold centrato)
  const H = (label: string, colSpan?: number): TableCell =>
    cell(
      [pr([t(label, { bold: true, size: SIZE_LABEL, color: COLOR_WHITE })], AlignmentType.CENTER)],
      { bg: COLOR_HEADER_BG, colSpan },
    );

  // Cella campo libero (bordi leggeri, testo normale)
  const F = (value: string | null | undefined, colSpan?: number, minRows = 1): TableCell => {
    const lines = (value || "").split("\n");
    const pars: Paragraph[] = lines.map((line) => pr([t(line || " ")]));
    while (pars.length < minRows) pars.push(pr([t(" ")]));
    return cell(pars, { colSpan, borders: "light" });
  };

  // Cella etichetta (sfondo azzurro, testo scuro small)
  const L = (label: string, colSpan?: number): TableCell =>
    cell(
      [pr([t(label, { bold: true, size: SIZE_SMALL, color: "1A2E4A" })])],
      { bg: COLOR_SECTION_BG, colSpan },
    );

  // Cella inline "Label: valore" (bordi leggeri)
  const LV = (label: string, value: string | null | undefined, colSpan?: number): TableCell =>
    cell(
      [pr([t(label + ": ", { bold: true, size: SIZE_SMALL }), t(value || "")])],
      { colSpan, borders: "light" },
    );

  // Cella vuota (bordi leggeri)
  const E = (colSpan?: number): TableCell =>
    cell([pr([t(" ")])], { colSpan, borders: "light" });

  // ── PAGINA 1 — 6 colonne logiche ─────────────────────────────────────────────
  // Scegliamo 6 colonne fisse per tutte le righe della tabella 1.
  // Ogni riga deve sommare esattamente a 6.
  const p1: TableRow[] = [];

  // Header: [AR/S 1col] [titolo 3col] [Ministero 2col]
  p1.push(new TableRow({ tableHeader: true, children: [
    cell([
      pr([t("ArcheoDoc", { bold: true, size: 28, color: COLOR_WHITE })], AlignmentType.CENTER),
      pr([t("Scheda US Estesa", { size: 14, color: COLOR_WHITE, italic: true })], AlignmentType.CENTER),
    ], { bg: COLOR_HEADER_BG, colSpan: 1 }),
    cell([
      pr([t("SCHEDA DI UNITÀ STRATIGRAFICA (US)", { bold: true, size: 22, color: COLOR_WHITE })], AlignmentType.CENTER),
    ], { bg: COLOR_HEADER_BG, colSpan: 3 }),
    cell([
      pr([t("MINISTERO DELLA CULTURA",     { bold: true, size: 14, color: COLOR_WHITE })]),
      pr([t("ISTITUTO CENTRALE PER IL CATALOGO E LA DOCUMENTAZIONE", { size: 12, color: COLOR_WHITE })]),
      pr([t("SOPRINTENDENZA",               { size: 13, color: COLOR_WHITE, italic: true })]),
    ], { bg: COLOR_HEADER_BG, colSpan: 2 }),
  ]}));

  // US | N.CAT.GEN | N.CAT.INT  (1+2+3=6)
  p1.push(new TableRow({ children: [
    LV("US", us.codiceUS),
    LV("N. CATALOGO GENERALE", us.nCatalogoGenerale, 2),
    LV("N. CATALOGO INTERNAZIONALE", us.nCatalogoInternazionale, 3),
  ]}));

  // SOPRINTENDENZA (riga sotto header, a piena larghezza)
  p1.push(new TableRow({ children: [
    LV("SOPRINTENDENZA", us.soprintendenza, 6),
  ]}));

  // LOCALITÀ | ANNO | AREA | SAGGIO | SETTORE/I | QUADRATI/I  (2+1+1+1+1=6)
  p1.push(new TableRow({ children: [
    LV("LOCALITÀ", us.localita || cantiere?.localita, 2),
    LV("ANNO",     us.anno || cantiere?.dataInizio?.slice(0, 4)),
    LV("AREA",     us.area),
    cell([
      pr([t("SAGGIO",   { bold: true, size: SIZE_SMALL })]),
      pr([t(us.saggio || " ")]),
      pr([t("AMBIENTE", { bold: true, size: SIZE_SMALL })]),
    ], { borders: "light" }),
    LV("SETTORE/I", us.settore),
  ]}));

  // QUADRATI/I | QUOTE SLM | UNITÀ STRATIGRAFICA  (2+2+2=6)
  p1.push(new TableRow({ children: [
    LV("QUADRATI/I", us.quadrati, 2),
    LV("QUOTE s.l.m.", us.quoteSlm || (us.quota != null ? String(us.quota) : null), 2),
    LV("UNITÀ STRATIGRAFICA", us.codiceUS, 2),
  ]}));

  // PIANTE | SEZIONI | PROSPETTI | FOTO | RA | N  (2+1+1+1+1=6... uso 2+2+1+1=6)
  p1.push(new TableRow({ children: [
    cell([pr([t("PIANTE",    { bold: true, size: SIZE_SMALL })]), pr([t(us.piante    || " ")])], { borders: "light", colSpan: 2 }),
    cell([pr([t("SEZIONI",   { bold: true, size: SIZE_SMALL })]), pr([t(us.sezioni   || " ")])], { borders: "light" }),
    cell([pr([t("PROSPETTI", { bold: true, size: SIZE_SMALL })]), pr([t(us.prospetti || " ")])], { borders: "light" }),
    cell([pr([t("FOTO",      { bold: true, size: SIZE_SMALL })]), pr([t(us.haFoto ? String(us.haFoto) : " ")])], { borders: "light" }),
    cell([
      pr([t("TAB. MATERIALI", { bold: true, size: SIZE_SMALL })]),
      pr([t("RA: " + (us.tabelleMaterialiRa || "___"))]),
      pr([t("N: "  + (us.tabelleMaterialiN  || "___"))]),
    ], { borders: "light" }),
  ]}));

  // DEFINIZIONE E POSIZIONE  (6)
  p1.push(new TableRow({ children: [H("DEFINIZIONE E POSIZIONE", 6)] }));
  p1.push(new TableRow({ children: [F(us.definizione, 6, 3)] }));

  // CRITERI DI DISTINZIONE  (6)
  p1.push(new TableRow({ children: [H("CRITERI DI DISTINZIONE", 6)] }));
  p1.push(new TableRow({ children: [F(us.criteriDistinzione, 6, 3)] }));

  // MODO DI FORMAZIONE  (6)
  p1.push(new TableRow({ children: [H("MODO DI FORMAZIONE", 6)] }));
  p1.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.modoFormazione === "artificiale" ? "☑" : "☐"} artificiale    `),
        t(`${us.modoFormazione === "naturale"     ? "☑" : "☐"} naturale`),
      ]),
    ], { colSpan: 6, borders: "light" }),
  ]}));

  // COMPONENTI header: [label 1] [INORGANICI 3] [ORGANICI 2]  (1+3+2=6)
  p1.push(new TableRow({ children: [
    H("COMPONENTI"),
    H("INORGANICI", 3),
    H("ORGANICI",   2),
  ]}));

  // Materiali presenti: [etichetta 1] [inorganici 3] [organici 2]
  p1.push(new TableRow({ children: [
    L("Materiali presenti"),
    cell([
      pr([t(`${us.compMaterialeCostruzione ? "☑" : "☐"} Materiale da costruzione`)]),
      pr([t(`${us.compCeramica             ? "☑" : "☐"} Ceramica`)]),
      pr([t(`${us.compMetalli              ? "☑" : "☐"} Metalli`)]),
      pr([t(`${us.compVetro               ? "☑" : "☐"} Vetro`)]),
      pr([t(`Materiali non lavorati  ${us.compCiottoli ? "☑" : "☐"} ciottoli  ${us.compGhiaia ? "☑" : "☐"} ghiaia`)]),
      pr([t(`Altro: ${us.compAltroInorganico || "_______________"}`)]),
    ], { colSpan: 3, borders: "light" }),
    cell([
      pr([t(`${us.compFauna ? "☑" : "☐"} Fauna`)]),
      pr([t(`Reperti faunistici  ${us.compOsso ? "☑" : "☐"} osso  ${us.compCorno ? "☑" : "☐"} corno`)]),
      pr([t(`Resti botanici  ${us.compSemi ? "☑" : "☐"} semi  ${us.compFrutti ? "☑" : "☐"} frutti`)]),
      pr([t(`Mat. organici vari  ${us.compCarboni ? "☑" : "☐"} carboni  ${us.compLegno ? "☑" : "☐"} legno  ${us.compTessuti ? "☑" : "☐"} tessuti`)]),
      pr([t(`Altro: ${us.compAltroOrganico || "_______________"}`)]),
    ], { colSpan: 2, borders: "light" }),
  ]}));

  // Densità: [etichetta 1] [inorganici 3] [organici 2]
  p1.push(new TableRow({ children: [
    L("Densità del materiale"),
    cell([pr([
      t(`${us.densitaInorganici === "fitta" ? "☑" : "☐"} fitta  `),
      t(`${us.densitaInorganici === "media" ? "☑" : "☐"} media  `),
      t(`${us.densitaInorganici === "rada"  ? "☑" : "☐"} rada`),
    ])], { colSpan: 3, borders: "light" }),
    cell([pr([
      t(`${us.densitaOrganici === "fitta" ? "☑" : "☐"} fitta  `),
      t(`${us.densitaOrganici === "media" ? "☑" : "☐"} media  `),
      t(`${us.densitaOrganici === "rada"  ? "☑" : "☐"} rada`),
    ])], { colSpan: 2, borders: "light" }),
  ]}));

  // CONSISTENZA | COLORE | MISURE  (2+2+2=6)
  p1.push(new TableRow({ children: [H("CONSISTENZA", 2), H("COLORE", 2), H("MISURE", 2)] }));
  p1.push(new TableRow({ children: [F(us.consistenza, 2, 2), F(us.colore, 2, 2), F(us.misure, 2, 2)] }));

  // STATO DI CONSERVAZIONE  (6)
  p1.push(new TableRow({ children: [H("STATO DI CONSERVAZIONE", 6)] }));
  p1.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.statoConservazione === "Intatto"  ? "☑" : "☐"} Intatto  `),
        t(`${us.statoConservazione === "Buono"    ? "☑" : "☐"} Buono  `),
        t(`${us.statoConservazione === "Discreto" ? "☑" : "☐"} Discreto  `),
        t(`${us.statoConservazione === "Mediocre" ? "☑" : "☐"} Mediocre  `),
        t(`${us.statoConservazione === "Pessimo"  ? "☑" : "☐"} Pessimo`),
      ]),
      pr([t("L'unità è stata danneggiata da: ", { bold: true }), t(us.danneggiatoDa || "__________________________")]),
    ], { colSpan: 6, borders: "light" }),
  ]}));

  // DESCRIZIONE  (6)
  p1.push(new TableRow({ children: [H("DESCRIZIONE", 6)] }));
  p1.push(new TableRow({ children: [F(us.descrizione, 6, 6)] }));

  // SEQUENZA FISICA — 6 colonne
  // Colonna "Posteriore a" e "Anteriore a" a destra come etichette verticali (celle singole)
  p1.push(new TableRow({ children: [H("Uguale a", 2), H("Si lega a", 2), H("POSTERIORE A", 2)] }));
  p1.push(new TableRow({ children: [F(us.uguale_a, 2, 2), F(us.si_lega_a, 2, 2), F(us.posterioreA, 2, 2)] }));

  p1.push(new TableRow({ children: [H("Gli si appoggia", 3), H("Si appoggia", 3)] }));
  p1.push(new TableRow({ children: [F(us.gliSiAppoggia, 3, 2), F(us.siAppoggia, 3, 2)] }));

  p1.push(new TableRow({ children: [H("Coperto da", 2), H("Copre", 2), H("ANTERIORE A", 2)] }));
  p1.push(new TableRow({ children: [F(us.coperto_da, 2, 2), F(us.copre, 2, 2), F(us.anterioreA, 2, 2)] }));

  p1.push(new TableRow({ children: [H("Tagliato da", 3), H("Taglia", 3)] }));
  p1.push(new TableRow({ children: [F(us.tagliatoDa, 3, 2), F(us.taglia, 3, 2)] }));

  p1.push(new TableRow({ children: [H("Riempito da", 3), H("Riempie", 3)] }));
  p1.push(new TableRow({ children: [F(us.riempitoDa, 3, 2), F(us.riempie, 3, 2)] }));

  const tabella1 = new Table({ rows: p1, width: { size: 100, type: WidthType.PERCENTAGE } });

  // ── PAGINA 2 — 6 colonne logiche ─────────────────────────────────────────────
  const p2: TableRow[] = [];

  // OSSERVAZIONI  (6)
  p2.push(new TableRow({ children: [H("OSSERVAZIONI", 6)] }));
  p2.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.scavataIntegralmente ? "☑" : "☐"} L'unità è stata scavata integralmente    `),
        t(`${us.scavataParzialmente  ? "☑" : "☐"} parzialmente`),
      ]),
      pr([t(`${us.corrispondeAltraUnita ? "☑" : "☐"} L'unità corrisponde ad un'altra unità che si trova in altro punto dello scavo`)]),
      ...(us.corrispondeAltraUnita ? [pr([t(`  → ${us.corrispondeAltraUnita}`, { size: SIZE_SMALL, italic: true })])] : []),
      pr([t(`${us.asportataConAltriStrati ? "☑" : "☐"} L'unità è stata asportata insieme ad altri strati`)]),
      pr([
        t(`${us.altroScavo ? "☑" : "☐"} Altro: `),
        t(us.altroScavo || "_________________________________"),
      ]),
    ], { colSpan: 6, borders: "light" }),
  ]}));

  // INTERPRETAZIONE  (6)
  p2.push(new TableRow({ children: [H("INTERPRETAZIONE", 6)] }));
  p2.push(new TableRow({ children: [F(us.interpretazione, 6, 10)] }));

  // ELEMENTI DATANTI  (6)
  p2.push(new TableRow({ children: [H("ELEMENTI DATANTI", 6)] }));
  p2.push(new TableRow({ children: [
    cell([
      pr([
        t(`${us.elementiDatanti === "Sequenza stratigrafica" ? "☑" : "☐"} Sequenza stratigrafica    `),
        t(`${us.elementiDatanti === "Reperti diagnostici"     ? "☑" : "☐"} Reperti diagnostici`),
      ]),
    ], { colSpan: 6, borders: "light" }),
  ]}));

  // DATAZIONE | PERIODO O FASE  (3+3=6)
  p2.push(new TableRow({ children: [H("DATAZIONE", 3), H("PERIODO O FASE", 3)] }));
  p2.push(new TableRow({ children: [
    F(us.datazione, 3, 2),
    F(us.periodoFase || [us.periodoIniziale, us.periodoFinale].filter(Boolean).join(" – ") || null, 3, 2),
  ]}));
  // EPOCA riga separata  (6)
  p2.push(new TableRow({ children: [LV("Epoca", us.epoca, 6)] }));

  // DATI QUANTITATIVI DEI REPERTI  (6)
  p2.push(new TableRow({ children: [H("DATI QUANTITATIVI DEI REPERTI", 6)] }));
  p2.push(new TableRow({ children: [F(us.datiQuantitativiReperti || us.materialiRinvenuti, 6, 4)] }));

  // CAMPIONATURE | FLOTTAZIONE | SETACCIATURA  (2+2+2=6)
  p2.push(new TableRow({ children: [H("CAMPIONATURE", 2), H("FLOTTAZIONE", 2), H("SETACCIATURA", 2)] }));
  p2.push(new TableRow({ children: [
    cell([pr([t("n. ", { bold: true }), t(us.campionatureN || us.campioni || "____")])], { colSpan: 2, borders: "light" }),
    cell([pr([
      t(`${us.flottazioneTipo === "di tutta l'unità" ? "☑" : "☐"} di tutta l'unità    `),
      t(`${us.flottazioneTipo === "parziale" ? "☑" : "☐"} parziale`),
    ])], { colSpan: 2, borders: "light" }),
    cell([pr([
      t(`${us.setacciaturaTipo === "di tutta l'unità" ? "☑" : "☐"} di tutta l'unità    `),
      t(`${us.setacciaturaTipo === "parziale" ? "☑" : "☐"} parziale`),
    ])], { colSpan: 2, borders: "light" }),
  ]}));

  // AFFIDABILITÀ STRATIGRAFICA | RESPONSABILE SABAP-UMB | RESPONSABILE SCAVO  (2+2+2=6)
  p2.push(new TableRow({ children: [H("AFFIDABILITÀ STRATIGRAFICA", 2), H("RESPONSABILE SABAP-UMB", 2), H("RESPONSABILE SCAVO", 2)] }));
  p2.push(new TableRow({ children: [
    cell([pr([
      t(`${us.affidabilitaStratigrafica === "nessuna" ? "☑" : "☐"} nessuna  `),
      t(`${us.affidabilitaStratigrafica === "modesta" ? "☑" : "☐"} modesta  `),
      t(`${us.affidabilitaStratigrafica === "buona"   ? "☑" : "☐"} buona`),
    ])], { colSpan: 2, borders: "light" }),
    F(us.responsabileSabap,   2, 2),
    F(us.responsabileScavo,   2, 2),
  ]}));

  // Footer  (6)
  p2.push(new TableRow({ children: [
    cell([
      pr(
        [t(`Documento generato il ${new Date().toLocaleDateString("it-IT")} — ArcheoDoc`, { size: 14, color: "999999", italic: true })],
        AlignmentType.RIGHT,
      ),
    ], { colSpan: 6, borders: "none" }),
  ]}));

  const tabella2 = new Table({ rows: p2, width: { size: 100, type: WidthType.PERCENTAGE } });

  return { tabella1, tabella2 };
}

// ─── EXPORT: Scheda US ───────────────────────────────────────────────────────────
export async function exportSchedaUSDocx(
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
  _schedaAiFormattata: string,
  _campiMancanti: string[],
  _noteAi: string,
  modelKey?: string,
): Promise<Buffer> {
  const isExtended = modelKey === "extended-us";

  const margins = {
    top:    convertInchesToTwip(0.6),
    bottom: convertInchesToTwip(0.6),
    left:   convertInchesToTwip(0.7),
    right:  convertInchesToTwip(0.7),
  };

  let sections;
  if (isExtended) {
    const { tabella1, tabella2 } = buildSchedaEstesaUSTables(us, cantiere);
    sections = [
      { properties: { page: { margin: margins } }, children: [tabella1] },
      { properties: { page: { margin: margins } }, children: [tabella2] },
    ];
  } else {
    sections = [{ properties: { page: { margin: margins } }, children: [buildSchedaUSTable(us, cantiere)] }];
  }

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Scheda US ${us.codiceUS}`,
    description: `Scheda stratigrafica ${us.codiceUS} — ${cantiere?.nome || ""}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
    sections,
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── EXPORT: Scheda US da template DOCX caricato dall'utente ─────────────────────
// Il template deve contenere placeholder {codiceUS}, {descrizione}, ecc.
// con la sintassi docxtemplater (parentesi graffe singole).
function buildUSTemplateFields(us: UnitaStratigrafica, cantiere: Cantiere | undefined): Record<string, unknown> {
  const bool = (v: unknown) => (v ? "☑" : "☐");
  const str = (v: unknown) => (v != null ? String(v) : "");

  return {
    // Identificazione
    codiceUS:                   str(us.codiceUS),
    nCatalogoGenerale:          str(us.nCatalogoGenerale),
    nCatalogoInternazionale:    str(us.nCatalogoInternazionale),
    soprintendenza:             str(us.soprintendenza),
    saggio:                     str(us.saggio),
    quadrati:                   str(us.quadrati),
    quoteSlm:                   str(us.quoteSlm || (us.quota != null ? String(us.quota) : "")),
    tabelleMaterialiRa:         str(us.tabelleMaterialiRa),
    tabelleMaterialiN:          str(us.tabelleMaterialiN),
    haFoto:                     us.haFoto ? String(us.haFoto) : "",
    localita:                   str(us.localita || cantiere?.localita),
    anno:                       str(us.anno || cantiere?.dataInizio?.slice(0, 4)),
    area:                       str(us.area),
    settore:                    str(us.settore),
    quota:                      us.quota != null ? String(us.quota) : "",
    quotaPianoCampagna:         us.quotaPianoCampagna != null ? String(us.quotaPianoCampagna) : "",
    piante:                     str(us.piante),
    sezioni:                    str(us.sezioni),
    prospetti:                  str(us.prospetti),
    cantiereCodice:             str(cantiere?.codice),
    cantiereNome:               str(cantiere?.nome),
    // Descrizione testuale
    tipo:                       str(us.tipo),
    definizione:                str(us.definizione),
    criteriDistinzione:         str(us.criteriDistinzione),
    descrizione:                str(us.descrizione),
    interpretazione:            str(us.interpretazione),
    // Modo formazione
    modoFormazione:             str(us.modoFormazione),
    chkArtificiale:             bool(us.modoFormazione === "artificiale"),
    chkNaturale:                bool(us.modoFormazione === "naturale"),
    modoFormazioneOrigine:      str(us.modoFormazioneOrigine),
    // Componenti inorganici
    chkMaterialeCostruzione:    bool(us.compMaterialeCostruzione),
    chkCeramica:                bool(us.compCeramica),
    chkMetalli:                 bool(us.compMetalli),
    chkVetro:                   bool(us.compVetro),
    chkCiottoli:                bool(us.compCiottoli),
    chkGhiaia:                  bool(us.compGhiaia),
    altroInorganico:            str(us.compAltroInorganico),
    densitaInorganici:          str(us.densitaInorganici),
    chkDensitaInorgFitta:       bool(us.densitaInorganici === "fitta"),
    chkDensitaInorgMedia:       bool(us.densitaInorganici === "media"),
    chkDensitaInorgRada:        bool(us.densitaInorganici === "rada"),
    // Componenti organici
    chkFauna:                   bool(us.compFauna),
    chkOsso:                    bool(us.compOsso),
    chkCorno:                   bool(us.compCorno),
    chkSemi:                    bool(us.compSemi),
    chkFrutti:                  bool(us.compFrutti),
    chkCarboni:                 bool(us.compCarboni),
    chkLegno:                   bool(us.compLegno),
    chkTessuti:                 bool(us.compTessuti),
    altroOrganico:              str(us.compAltroOrganico),
    densitaOrganici:            str(us.densitaOrganici),
    chkDensitaOrgFitta:         bool(us.densitaOrganici === "fitta"),
    chkDensitaOrgMedia:         bool(us.densitaOrganici === "media"),
    chkDensitaOrgRada:          bool(us.densitaOrganici === "rada"),
    // Fisici
    consistenza:                str(us.consistenza),
    colore:                     str(us.colore),
    misure:                     str(us.misure),
    // Stato conservazione
    statoConservazione:         str(us.statoConservazione),
    chkIntatto:                 bool(us.statoConservazione === "Intatto"),
    chkBuono:                   bool(us.statoConservazione === "Buono"),
    chkDiscreto:                bool(us.statoConservazione === "Discreto"),
    chkMediocre:                bool(us.statoConservazione === "Mediocre"),
    chkPessimo:                 bool(us.statoConservazione === "Pessimo"),
    danneggiatoDa:              str(us.danneggiatoDa),
    // Relazioni stratigrafiche
    uguale_a:                   str(us.uguale_a),
    si_lega_a:                  str(us.si_lega_a),
    gliSiAppoggia:              str(us.gliSiAppoggia),
    siAppoggia:                 str(us.siAppoggia),
    coperto_da:                 str(us.coperto_da),
    copre:                      str(us.copre),
    tagliatoDa:                 str(us.tagliatoDa),
    taglia:                     str(us.taglia),
    riempitoDa:                 str(us.riempitoDa),
    riempie:                    str(us.riempie),
    sequenzaFisica:             str(us.sequenzaFisica),
    // Osservazioni scavo
    chkScavataIntegralmente:    bool(us.scavataIntegralmente),
    chkScavataParzialmente:     bool(us.scavataParzialmente),
    corrispondeAltraUnita:      str(us.corrispondeAltraUnita),
    chkCorrispondeAltraUnita:   bool(us.corrispondeAltraUnita),
    chkAsportataConAltriStrati: bool(us.asportataConAltriStrati),
    chkAltroScavo:              bool(!!us.altroScavo),
    altroScavo:                 str(us.altroScavo),
    // Relazioni stratigrafiche aggiuntive
    posterioreA:                str(us.posterioreA),
    anterioreA:                 str(us.anterioreA),
    // Datazione
    elementiDatanti:            str(us.elementiDatanti),
    chkSequenzaStratigrafica:   bool(us.elementiDatanti === "Sequenza stratigrafica"),
    chkRepertiDiagnostici:      bool(us.elementiDatanti === "Reperti diagnostici"),
    datazione:                  str(us.datazione),
    epoca:                      str(us.epoca),
    periodoFase:                str(us.periodoFase || [us.periodoIniziale, us.periodoFinale].filter(Boolean).join(" – ")),
    periodoIniziale:            str(us.periodoIniziale),
    periodoFinale:              str(us.periodoFinale),
    // Quantitativi
    datiQuantitativiReperti:    str(us.datiQuantitativiReperti || us.materialiRinvenuti),
    materialiRinvenuti:         str(us.materialiRinvenuti),
    campionatureN:              str(us.campionatureN || us.campioni),
    flottazioneTipo:            str(us.flottazioneTipo),
    chkFlottazioneTutta:        bool(us.flottazioneTipo === "di tutta l'unità"),
    chkFlottazioneParziale:     bool(us.flottazioneTipo === "parziale"),
    setacciaturaTipo:           str(us.setacciaturaTipo),
    chkSetacciaturaTutta:       bool(us.setacciaturaTipo === "di tutta l'unità"),
    chkSetacciaturaParziale:    bool(us.setacciaturaTipo === "parziale"),
    // Affidabilità e responsabili
    affidabilitaStratigrafica:  str(us.affidabilitaStratigrafica),
    chkAffidNessuna:            bool(us.affidabilitaStratigrafica === "nessuna"),
    chkAffidModesta:            bool(us.affidabilitaStratigrafica === "modesta"),
    chkAffidBuona:              bool(us.affidabilitaStratigrafica === "buona"),
    responsabileSabap:          str(us.responsabileSabap),
    responsabileScavo:          str(us.responsabileScavo),
    // Meta
    dataExport:                 new Date().toLocaleDateString("it-IT"),
  };
}

/** Elenco delle chiavi placeholder note per le colonne fisse di una US (per suggerimenti campi). */
export function getUSTemplateFieldKeys(): string[] {
  return Object.keys(buildUSTemplateFields({} as UnitaStratigrafica, undefined));
}

/** Placeholder di intestazione (fuori dal loop) relativi al cantiere, con alias per i nomi più
 * comuni: {cantiere}/{cantiereNome}, {commessa}/{cantiereCodice}, ecc. */
export function buildCantiereTemplateFields(cantiere: Cantiere | undefined): Record<string, string> {
  const s = (v: unknown) => (v != null ? String(v) : "");
  const nome = s(cantiere?.nome);
  const codice = s(cantiere?.codice);
  return {
    cantiere: nome,
    cantiereNome: nome,
    nomeCantiere: nome,
    cantiereCodice: codice,
    codiceCantiere: codice,
    commessa: codice,
    nCommessa: codice,
    numeroCommessa: codice,
    commessaN: codice,
    committente: s(cantiere?.committente),
    localita: s(cantiere?.localita),
    localitaCantiere: s(cantiere?.localita),
    responsabile: s(cantiere?.responsabile),
    dataInizio: s(cantiere?.dataInizio),
    dataFine: s(cantiere?.dataFine),
    annoCantiere: s(cantiere?.dataInizio?.slice(0, 4)),
  };
}

/** Chiavi note dei placeholder di intestazione cantiere (per l'analisi del template). */
export function getCantiereTemplateFieldKeys(): string[] {
  return Object.keys(buildCantiereTemplateFields(undefined));
}

/** Campi "flat" di una US: colonne fisse note + campi custom salvati in schedaData (modello attivo). */
export function buildUSFlatFields(us: UnitaStratigrafica, cantiere: Cantiere | undefined): Record<string, unknown> {
  let extra: Record<string, unknown> = {};
  try {
    extra = us.schedaData ? JSON.parse(us.schedaData) : {};
  } catch {
    extra = {};
  }
  return { ...buildUSTemplateFields(us, cantiere), ...extra };
}

export async function exportSchedaUSDocxFromTemplate(
  templatePath: string,
  us: UnitaStratigrafica,
  cantiere: Cantiere | undefined,
): Promise<Buffer> {
  const PizZip = (await import("pizzip")).default;
  const Docxtemplater = (await import("docxtemplater")).default;

  const content = await import("fs").then((fs) => fs.promises.readFile(templatePath));
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  doc.render(buildUSTemplateFields(us, cantiere));

  const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  return Buffer.from(out);
}

// ─── EXPORT: Elenco US (tabella) da template DOCX caricato dall'utente ───────────
// Il template deve contenere una tabella con una riga dati delimitata dai tag di loop
// {#us} (prima cella) ... {/us} (ultima cella), con placeholder nelle celle intermedie
// (stessi campi disponibili per le schede singole, più i campi custom del modello US attivo).
export async function exportElencoUSDocxFromTemplate(
  templatePath: string,
  usList: UnitaStratigrafica[],
  cantiere: Cantiere | undefined,
): Promise<Buffer> {
  const PizZip = (await import("pizzip")).default;
  const Docxtemplater = (await import("docxtemplater")).default;
  const { extractTemplateLoopColumns } = await import("./docx_table_read");

  const loopColumns = await extractTemplateLoopColumns(templatePath);
  if (!loopColumns) {
    throw new Error("Il template elenco US non contiene un blocco di tabella con i tag {#tag}...{/tag}");
  }

  const content = await import("fs").then((fs) => fs.promises.readFile(templatePath));
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  const rows = usList.map((us) => buildUSFlatFields(us, cantiere));

  doc.render({
    [loopColumns.tagName]: rows,
    ...buildCantiereTemplateFields(cantiere),
    dataExport: new Date().toLocaleDateString("it-IT"),
    totaleUS: rows.length,
  });

  const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  return Buffer.from(out);
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

export async function exportReportSettimanaleDocx(input: {
  cantiere: Cantiere | undefined;
  weekStart: string;
  weekEnd: string;
  entries: Array<{
    giornata: Giornata;
    reportFormattato: string;
    campiMancanti: string[];
  }>;
}): Promise<Buffer> {
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
      children: [new TextRun({ text: "GIORNALE DI SCAVO SETTIMANALE", bold: true, size: 32, font: FONT, allCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: input.cantiere?.nome || "-", size: 24, font: FONT, color: "6B5B45" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${input.cantiere?.localita || ""} - ${input.cantiere?.codice || ""}`,
          size: 20,
          font: FONT,
          italics: true,
          color: "8B7355",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Settimana: ${input.weekStart} - ${input.weekEnd}`,
          size: 20,
          font: FONT,
          bold: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
    }),
    sep(),
  ];

  for (const entry of input.entries) {
    let operatori = "-";
    try {
      const ops = JSON.parse(entry.giornata.operatori || "[]");
      operatori = Array.isArray(ops) && ops.length > 0 ? ops.join(", ") : entry.giornata.operatori || "-";
    } catch {
      operatori = entry.giornata.operatori || "-";
    }

    children.push(
      mp(`Giornata ${entry.giornata.data}`, true, 24, "2C4A7C"),
      mp(`Operatori: ${operatori}`),
      mp(`Condizioni meteo: ${entry.giornata.condMeteo || "-"}`),
      mp(`Settore: ${entry.giornata.settore || "-"}`),
    );

    if (entry.campiMancanti.length > 0) {
      children.push(mp("Campi mancanti", true, 20, "C0392B"));
      for (const campo of entry.campiMancanti) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "- ", bold: true, color: "C0392B", size: SIZE_NORMAL, font: FONT }),
              new TextRun({ text: campo, size: SIZE_NORMAL, color: "C0392B", font: FONT }),
            ],
            spacing: { after: 60 },
          }),
        );
      }
    }

    children.push(mp("Diario", true, 20));
    for (const line of String(entry.reportFormattato || "").split("\n")) {
      const isHdr = line.match(/^[A-Z][A-Z\s]+:?\s*$/) || line.match(/^\d+\./);
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line || " ", bold: !!isHdr, size: isHdr ? 22 : SIZE_NORMAL, font: FONT })],
          spacing: { after: isHdr ? 100 : 60 },
        }),
      );
    }

    children.push(sep());
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Documento generato il ${new Date().toLocaleDateString("it-IT")} - ArcheoDoc`,
          size: 14,
          color: "999999",
          italics: true,
          font: FONT,
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    }),
  );

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Giornale settimanale ${input.weekStart} - ${input.weekEnd}`,
    description: `Report settimanale di scavo ${input.weekStart} - ${input.weekEnd}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.2),
            right: convertInchesToTwip(1.2),
          },
        },
      },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── Report settimanale personalizzato (modello custom) ──────────────────────

// ─── Compilazione placeholder in testo ───────────────────────────────────────
export function fillPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const k = key.trim();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : `{${k}}`;
  });
}

function parseCsvOrJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map(String);
  } catch { /* ignore */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function exportReportSettimanaleCustomDocx(input: {
  cantiere: Cantiere | undefined;
  weekStart: string;
  weekEnd: string;
  weekNumber?: number;
  testo_ai: string;
  entries: Array<{ giornata: Giornata; usSchede?: UnitaStratigrafica[] }>;
  imgDir?: string;
  templatesDir?: string;
}): Promise<Buffer> {
  const c = input.cantiere;
  const nome_commessa = c?.nome || "-";
  const luogo = c?.localita || "-";
  const data_inizio_wk = input.weekStart;
  const data_fine_wk = input.weekEnd;
  const data_relazione = new Date().toLocaleDateString("it-IT");
  const wNum = input.weekNumber ? `W${input.weekNumber}` : input.weekStart;

  // Raccoglie personale unico dalla settimana
  const tuttiScavatori = new Set<string>();
  const tuttiArcheologi = new Set<string>();
  let archeologoCoordinatore = c?.responsabile || "-";
  let direttoreScavo = "-";
  let topografo = "-";
  const obiettiviUnici = new Set<string>();
  for (const { giornata } of input.entries) {
    parseCsvOrJson(giornata.scavatori || giornata.operatori).forEach((o) => tuttiScavatori.add(o));
    parseCsvOrJson(giornata.archeologi).forEach((o) => tuttiArcheologi.add(o));
    if (giornata.archeologoCoordinatore) archeologoCoordinatore = giornata.archeologoCoordinatore;
    if (giornata.direttoreScavo) direttoreScavo = giornata.direttoreScavo;
    if (giornata.topografo) topografo = giornata.topografo;
    if (giornata.obiettivo) obiettiviUnici.add(giornata.obiettivo.trim());
  }
  const scavatoriStr = Array.from(tuttiScavatori).join(", ") || "-";
  const archeologiStr = Array.from(tuttiArcheologi).join(", ") || "-";
  const obiettivoStr = Array.from(obiettiviUnici).join(", ") || "-";

  // Estrai provincia da localita (es. "Grottaminarda (AV)" → "AV")
  const provinciaMatch = (c?.localita || "").match(/\(([A-Z]{2})\)\s*$/);
  const provincia = provinciaMatch ? provinciaMatch[1] : (c?.localita || "-");

  // Variabili placeholder disponibili per tutti i tipi di template
  const placeholderVars: Record<string, string> = {
    // Cantiere
    nome_commessa,
    codice_cantiere: c?.codice || "-",
    luogo,
    provincia,
    committente: c?.committente || "-",
    responsabile: c?.responsabile || "-",
    direttore_scavo: direttoreScavo !== "-" ? direttoreScavo : archeologoCoordinatore,
    responsabile_sabap: "-",
    responsabile_scavo: c?.responsabile || "-",
    // Date settimana
    data_inizio_wk,
    data_fine_wk,
    data_relazione,
    settimana: `${input.weekStart} – ${input.weekEnd}`,
    // Personale
    archeologo_coordinatore: archeologoCoordinatore,
    archeologi: archeologiStr,
    scavatori: scavatoriStr,
    topografo,
    escavatore: "-",
    obiettivo: obiettivoStr,
    // Testo AI
    dettaglio_attivita: input.testo_ai || "",
    // Alias per compatibilità con template che usano nomi diversi
    nome_archeologo_coord: archeologoCoordinatore,
    nome_archeologi: archeologiStr,
    nome_topografo: topografo,
    nome_ditta: c?.committente || "-",
    nome_scavatori: scavatoriStr,
    nome_direttore: direttoreScavo !== "-" ? direttoreScavo : archeologoCoordinatore,
  };

  // ── Cerca template report_settimanale nella cartella templates ───────────────
  if (input.templatesDir && fs.existsSync(input.templatesDir)) {
    const indexPath = path.join(input.templatesDir, "_index.json");
    let idx: Record<string, { uso?: string }> = {};
    try { idx = JSON.parse(fs.readFileSync(indexPath, "utf-8")); } catch { /* no index */ }
    const templateFile = fs.readdirSync(input.templatesDir)
      .filter((f) => /\.(docx|md|txt)$/i.test(f))
      .find((f) => idx[f]?.uso === "report_settimanale");

    if (templateFile) {
      const templatePath = path.join(input.templatesDir, templateFile);

      // ── DOCX template: usa docxtemplater per compilare i placeholder ──────
      if (/\.docx$/i.test(templateFile)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const PizZip = require("pizzip") as typeof import("pizzip");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Docxtemplater = require("docxtemplater") as typeof import("docxtemplater");
        const content = fs.readFileSync(templatePath, "binary");
        const rawTemplateText = content as string;
        // Se il template ha {{dettaglio_attivita}}, il testo AI va lì — non serve appendice separata
        const templateHasDettaglio = rawTemplateText.includes("dettaglio_attivita");
        const zip = new PizZip(content);
        const docTpl = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
        docTpl.render(placeholderVars);
        const renderedZip = docTpl.getZip();

        // Aggiunge appendice dettagliata solo se il template non la gestisce già tramite {{dettaglio_attivita}}
        if (!templateHasDettaglio) {
          const appendiceXml = buildAppendiceXml(input.entries, input.weekStart, input.weekEnd);
          if (appendiceXml) {
            let docXml: string = renderedZip.files["word/document.xml"].asText();
            if (docXml.includes("</w:body>")) {
              docXml = docXml.replace("</w:body>", appendiceXml + "</w:body>");
              renderedZip.file("word/document.xml", docXml);
            }
          }
        }

        return Buffer.from(renderedZip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
      }

      // ── MD / TXT template: parsing testuale ───────────────────────────────
      const templateText = fs.readFileSync(templatePath, "utf-8");
      const compilato = fillPlaceholders(templateText, placeholderVars);
      const righe = compilato.split("\n");
      const pageMarginT = {
        top: convertInchesToTwip(1),
        bottom: convertInchesToTwip(1),
        left: convertInchesToTwip(1.2),
        right: convertInchesToTwip(1.2),
      };
      const children: Paragraph[] = righe.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("### ")) return new Paragraph({ children: [new TextRun({ text: trimmed.slice(4), bold: true, size: 20, font: FONT })], spacing: { before: 200, after: 80 } });
        if (trimmed.startsWith("## ")) return new Paragraph({ children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 24, font: FONT })], spacing: { before: 240, after: 100 } });
        if (trimmed.startsWith("# ")) return new Paragraph({ children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 32, font: FONT, color: COLOR_HEADER_BG })], spacing: { before: 300, after: 120 } });
        if (trimmed.startsWith("---")) return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "C8B89A" } }, spacing: { after: 120 }, text: "" });
        return new Paragraph({ children: [new TextRun({ text: line || " ", size: SIZE_NORMAL, font: FONT })], spacing: { after: 80 } });
      });
      const docT = new Document({
        creator: "ArcheoDoc",
        title: `Report settimanale ${input.weekStart} - ${input.weekEnd}`,
        styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
        sections: [{ properties: { page: { margin: pageMarginT } }, children }],
      });
      return Buffer.from(await Packer.toBuffer(docT));
    }
  }

  // Load area image from imgDir if available (img_area = first image found)
  let imgAreaBuffer: Buffer | null = null;
  let imgAreaExt: "png" | "jpg" | "gif" | "bmp" = "png";
  if (input.imgDir && fs.existsSync(input.imgDir)) {
    const imgFiles = fs.readdirSync(input.imgDir)
      .filter((f) => /\.(png|jpg|jpeg|gif)$/i.test(f))
      .sort();
    if (imgFiles.length > 0) {
      const imgPath = path.join(input.imgDir, imgFiles[0]);
      imgAreaBuffer = fs.readFileSync(imgPath);
      const ext = path.extname(imgFiles[0]).toLowerCase().replace(".", "");
      imgAreaExt = (ext === "jpeg" ? "jpg" : ext) as typeof imgAreaExt;
    }
  }

  const mp = (text: string, bold = false, size = SIZE_NORMAL, color?: string): Paragraph =>
    new Paragraph({
      children: [new TextRun({ text, bold, size, font: FONT, color })],
      spacing: { after: 80 },
    });

  const field = (label: string, value: string): Paragraph =>
    new Paragraph({
      children: [
        new TextRun({ text: label, bold: true, size: SIZE_NORMAL, font: FONT }),
        new TextRun({ text: `\t${value}`, size: SIZE_NORMAL, font: FONT }),
      ],
      spacing: { after: 80 },
      tabStops: [{ type: "left" as any, position: 2400 }],
    });

  const sep = (): Paragraph => new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "C8B89A" } },
    spacing: { after: 120 },
    text: "",
  });

  // ── Pagina 1: copertina ────────────────────────────────────────────────────
  const page1: Paragraph[] = [
    // Committente in alto a destra
    new Paragraph({
      children: [new TextRun({ text: c?.committente || "", bold: true, size: 24, font: FONT, color: COLOR_HEADER_BG })],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 80 },
    }),

    // Nome commessa + luogo (provincia)
    new Paragraph({
      children: [new TextRun({ text: nome_commessa, bold: true, size: 36, font: FONT, color: COLOR_HEADER_BG })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: luogo, size: 24, font: FONT, italics: true, color: "555555" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),

    sep(),

    // Titolo report
    new Paragraph({
      children: [new TextRun({ text: "ESECUZIONE INDAGINI ARCHEOLOGICHE", bold: true, size: 28, font: FONT, allCaps: true, color: COLOR_HEADER_BG })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `REPORT DELLE ATTIVITÀ: ${data_inizio_wk} – ${data_fine_wk}`, bold: true, size: 24, font: FONT, color: "444444" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),

    // Immagine area (se disponibile)
    ...(imgAreaBuffer
      ? [new Paragraph({
          children: [new ImageRun({
            data: imgAreaBuffer,
            transformation: { width: 500, height: 320 },
            type: imgAreaExt,
          })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })]
      : [new Paragraph({ text: "[immagine area di scavo]", spacing: { after: 200 } })]),
  ];

  // ── Pagina 2: testo ────────────────────────────────────────────────────────
  const page2: Paragraph[] = [
    mp(`Dal giorno ${data_inizio_wk} al giorno ${data_fine_wk}, presso ${luogo} si proseguono le attività di scavo archeologico del cantiere ${nome_commessa}.`, false, SIZE_NORMAL),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    field("Archeologo coordinatore:", archeologoCoordinatore),
    field("Archeologi:", archeologiStr),
    field("Scavatori:", scavatoriStr),
    field("Topografo:", topografo),
    field("Escavatore:", "-"),
    new Paragraph({ text: "", spacing: { after: 80 } }),

    field("Obiettivo:", obiettivoStr),
    field("Criticità:", "-"),
    field("Attività eseguite:", "-"),
    new Paragraph({ text: "", spacing: { after: 120 } }),

    sep(),

    new Paragraph({
      children: [new TextRun({ text: `SETTIMANA ${wNum} – ${data_inizio_wk} – ${data_fine_wk}`, bold: true, size: 22, font: FONT })],
      spacing: { after: 160 },
    }),

    // Testo AI generato
    ...String(input.testo_ai || "").split("\n").map((line) =>
      new Paragraph({
        children: [new TextRun({ text: line || " ", size: SIZE_NORMAL, font: FONT })],
        spacing: { after: 100 },
      })
    ),

    new Paragraph({ text: "", spacing: { after: 200 } }),
    mp("Figura 1 – …", false, SIZE_SMALL, "888888"),
    new Paragraph({ text: "", spacing: { after: 200 } }),

    sep(),

    new Paragraph({
      children: [new TextRun({ text: "PROGRAMMAZIONE:", bold: true, size: SIZE_NORMAL, font: FONT })],
      spacing: { after: 80 },
    }),
    mp("Le attività previste per la prossima settimana …"),
    new Paragraph({ text: "", spacing: { after: 300 } }),

    new Paragraph({
      children: [new TextRun({ text: `${luogo}, ${data_relazione}`, size: SIZE_NORMAL, font: FONT })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "L'Archeologo Responsabile", bold: true, size: SIZE_NORMAL, font: FONT })],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 40 },
    }),
    new Paragraph({ text: "", spacing: { before: 300 } }),
    new Paragraph({
      children: [new TextRun({ text: `Documento generato il ${data_relazione} - ArcheoDoc`, size: 14, color: "999999", italics: true, font: FONT })],
      alignment: AlignmentType.RIGHT,
    }),
  ];

  const pageMargin = {
    top: convertInchesToTwip(1),
    bottom: convertInchesToTwip(1),
    left: convertInchesToTwip(1.2),
    right: convertInchesToTwip(1.2),
  };

  // ── Pagina 3: documentazione dettagliata per giornata ─────────────────────
  const page3: Paragraph[] = buildAppendiceDocx(input.entries, input.weekStart, input.weekEnd);

  const doc = new Document({
    creator: "ArcheoDoc",
    title: `Report settimanale ${input.weekStart} - ${input.weekEnd}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_NORMAL } } } },
    sections: [
      { properties: { page: { margin: pageMargin } }, children: page1 },
      { properties: { page: { margin: pageMargin } }, children: page2 },
      ...(page3.length > 0 ? [{ properties: { page: { margin: pageMargin } }, children: page3 }] : []),
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── Appendice: documentazione dettagliata per giornata ───────────────────────

function buildAppendiceDocx(
  entries: Array<{ giornata: Giornata; usSchede?: UnitaStratigrafica[] }>,
  weekStart: string,
  weekEnd: string,
): Paragraph[] {
  if (!entries || entries.length === 0) return [];

  const result: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "DOCUMENTAZIONE DETTAGLIATA", bold: true, size: 28, font: FONT, color: COLOR_HEADER_BG, allCaps: true })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${weekStart} – ${weekEnd}`, size: SIZE_NORMAL, font: FONT, italics: true, color: "666666" })],
      spacing: { after: 240 },
    }),
  ];

  for (const { giornata, usSchede } of entries) {
    // Intestazione giornata
    result.push(
      new Paragraph({
        children: [new TextRun({ text: `> ${giornata.data}`, bold: true, size: 22, font: FONT, color: COLOR_HEADER_BG })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "C8B89A" } },
      }),
    );

    const addField = (label: string, value: string | null | undefined) => {
      if (!value) return;
      result.push(new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: SIZE_NORMAL, font: FONT }),
          new TextRun({ text: value, size: SIZE_NORMAL, font: FONT }),
        ],
        spacing: { after: 60 },
      }));
    };

    addField("Settore", giornata.settore);
    addField("Meteo", giornata.condMeteo);
    addField("Tipo scavo", giornata.tipoScavo);
    addField("Obiettivo", giornata.obiettivo);

    const attivita = giornata.attivitaSvolta || giornata.note;
    if (attivita) {
      result.push(new Paragraph({
        children: [new TextRun({ text: "Attività svolta: ", bold: true, size: SIZE_NORMAL, font: FONT })],
        spacing: { after: 40 },
      }));
      for (const line of attivita.split("\n")) {
        result.push(new Paragraph({
          children: [new TextRun({ text: line || " ", size: SIZE_NORMAL, font: FONT })],
          spacing: { after: 40 },
          indent: { left: 360 },
        }));
      }
    }

    // US documentate
    if (usSchede && usSchede.length > 0) {
      result.push(new Paragraph({
        children: [new TextRun({ text: `Unità stratigrafiche documentate (${usSchede.length})`, bold: true, size: SIZE_NORMAL, font: FONT, color: COLOR_SECTION_BG.replace("D9E2F3", "2C4A7C") })],
        spacing: { before: 120, after: 60 },
      }));

      const rows = usSchede.map((us) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: us.codiceUS, bold: true, size: SIZE_SMALL, font: FONT })], spacing: { after: 0 } })],
              borders: bLight(),
              width: { size: 10, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: us.tipo || "-", size: SIZE_SMALL, font: FONT })], spacing: { after: 0 } })],
              borders: bLight(),
              width: { size: 15, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: us.definizione || "-", size: SIZE_SMALL, font: FONT })], spacing: { after: 0 } })],
              borders: bLight(),
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: us.interpretazione || us.descrizione || "-", size: SIZE_SMALL, font: FONT })], spacing: { after: 0 } })],
              borders: bLight(),
              width: { size: 50, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      );

      result.push(new Table({
        rows: [
          new TableRow({
            tableHeader: true,
            children: ["US", "Tipo", "Definizione", "Interpretazione / Descrizione"].map((h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: SIZE_SMALL, font: FONT, color: COLOR_WHITE })], spacing: { after: 0 } })],
                borders: bSolid(),
                shading: { type: ShadingType.SOLID, color: COLOR_HEADER_BG },
              }),
            ),
          }),
          ...rows,
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }) as unknown as Paragraph);
    }

    result.push(new Paragraph({ text: "", spacing: { after: 120 } }));
  }

  return result;
}

// ─── Appendice XML per injection in template DOCX custom ─────────────────────

function buildAppendiceXml(
  entries: Array<{ giornata: Giornata; usSchede?: UnitaStratigrafica[] }>,
  weekStart: string,
  weekEnd: string,
): string {
  if (!entries || entries.length === 0) return "";

  const esc = (s: string) =>
    (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // rimuove caratteri di controllo illegali in XML

  const para = (text: string, bold = false, size = 18, color = "000000") =>
    `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:color w:val="${color}"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

  const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  let xml = pageBreak;
  xml += para("DOCUMENTAZIONE DETTAGLIATA", true, 28, "2C4A7C");
  xml += para(`${weekStart} - ${weekEnd}`, false, 16, "666666");

  for (const { giornata, usSchede } of entries) {
    xml += para(`> ${esc(String(giornata.data || ""))}`, true, 22, "2C4A7C");

    if (giornata.settore) xml += para(`Settore: ${esc(giornata.settore)}`, false, 18);
    if (giornata.condMeteo) xml += para(`Meteo: ${esc(giornata.condMeteo)}`, false, 18);
    if (giornata.tipoScavo) xml += para(`Tipo scavo: ${esc(giornata.tipoScavo)}`, false, 18);
    if (giornata.obiettivo) xml += para(`Obiettivo: ${esc(giornata.obiettivo)}`, false, 18);

    const attivita = giornata.attivitaSvolta || giornata.note;
    if (attivita) {
      xml += para("Attività svolta:", true, 18);
      for (const line of attivita.split("\n")) {
        xml += para(`    ${esc(line || " ")}`, false, 18);
      }
    }

    if (usSchede && usSchede.length > 0) {
      xml += para(`Unità stratigrafiche documentate (${usSchede.length}):`, true, 18, "2C4A7C");
      for (const us of usSchede) {
        const desc = us.interpretazione || us.descrizione || "";
        xml += para(`  US ${esc(us.codiceUS)}${us.tipo ? ` – ${esc(us.tipo)}` : ""}${us.definizione ? ` | ${esc(us.definizione)}` : ""}${desc ? ` → ${esc(desc)}` : ""}`, false, 16, "333333");
      }
    }

    xml += `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr></w:p>`;
  }

  return xml;
}
