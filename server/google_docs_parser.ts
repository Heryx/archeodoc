import { google, docs_v1 } from "googleapis";
import { getAuthorizedClient } from "./google_auth";
import { extractDocId } from "./google_docs";

export interface USData {
  numero: number;
  tipo?: string;
  definizione?: string;
  descrizione?: string;
  localita?: string;
  anno?: string;
  colore?: string;
  consistenza?: string;
  inclusi?: string;
  misure?: string;
  quota?: string;
  quotaPianoCampagna?: string;
  settore?: string;
  saggio?: string;
  quadrati?: string;
  periodoIniziale?: string;
  periodoFinale?: string;
  materialiRinvenuti?: string;
  campioni?: string;
  naturaUs?: string;
  nCatalogoGenerale?: string;
  nCatalogoInternazionale?: string;
  areaEdificioStruttura?: string;
  ambienteUnitaFunzionale?: string;
  piante?: string;
  sezioni?: string;
  prospetti?: string;
  fotografie?: string;
  criteriDistinzione?: string;
  naturaAzione?: string;
  agenteFormazione?: string;
  durataFormazione?: string;
  modoFormazione?: string;
  componentiInorganici?: string;
  componentiOrganici?: string;
  densitaMaterialeInorganici?: "fitta" | "media" | "rada" | string;
  densitaMaterialeOrganici?: "fitta" | "media" | "rada" | string;
  componentiArtificiali?: string;
  stratoConfigurazioneSuperficie?: string;
  stratoSpessoreVariazioni?: string;
  stratoDefinizioneConfine?: string;
  stratoMorfologiaInclusi?: string;
  strutturaOrientamento?: string;
  strutturaTecnicaCostruttiva?: string;
  strutturaMaterialiLegante?: string;
  strutturaMessaInOpera?: string;
  strutturaTracceLavorazione?: string;
  negativaFormaContorno?: string;
  negativaProfiloPareti?: string;
  negativaTipoStacco?: string;
  negativaProfiloFondo?: string;
  coperto_da?: number[];
  copre?: number[];
  riempie?: number[];
  riempita_da?: number[];
  taglia?: number[];
  tagliata_da?: number[];
  si_appoggia_a?: number[];
  gli_si_appoggia?: number[];
  si_lega_a?: number[];
  uguale_a?: number[];
  posteriore_a?: number[];
  anteriore_a?: number[];
  statoConservazioneValutazione?: string;
  statoConservazioneModificazioni?: string;
  statoConservazionePercentuale?: string;
  osservazioniMetodoScavo?: string;
  metodoScavo?: "integrale" | "parziale" | "asportata_con_altri" | string;
  interpretazioneEstesa?: string;
  elementiDatanti?: string;
  datazioneAssoluta?: string;
  periodoFase?: string;
  epoca?: string;
  riferimentiTabelleMateriali?: string;
  datiQuantitativiReperti?: string;
  campionature?: string;
  flottazione?: string;
  flottazioneSecchi?: string;
  setacciatura?: string;
  setacciaturaSecchi?: string;
  affidabilitaStratigrafica?: string;
  motivazioneAffidabilita?: string;
  responsabileSABAPUMB?: string;
  responsabileScavo?: string;
  direttoreScientifico?: string;
  responsabileSettore?: string;
  compilatoreScheda?: string;
  dataCompilazione?: string;
  interpretazione?: string;
  note?: string;
  campi_da_inferire?: string[];
  rawText?: string;
}

export interface GiornataData {
  data: string;
  meteo?: string;
  operai?: number;
  // Nuovi campi estratti dal formato giornale di scavo
  personale?: string[];       // nomi raw da "Personale presente:"
  oraInizio?: string;
  oraFine?: string;
  attivitaSvolta?: string;    // testo narrativo libero
  tipoScavo?: "manuale" | "meccanico" | "misto" | null; // null = non deducibile
  us: USData[];
}

type Paragraph = docs_v1.Schema$Paragraph;

type KeyValue = {
  key: string;
  value: string;
  highConfidence: boolean;
};

const US_MISSING_FIELDS: Array<keyof USData> = [
  "tipo",
  "definizione",
  "colore",
  "consistenza",
  "misure",
  "naturaUs",
  "criteriDistinzione",
  "naturaAzione",
  "agenteFormazione",
  "durataFormazione",
  "componentiInorganici",
  "componentiOrganici",
  "componentiArtificiali",
  "statoConservazioneValutazione",
  "elementiDatanti",
  "affidabilitaStratigrafica",
  "interpretazione",
];

const US_TEXT_FIELD_ALIASES: Record<string, keyof USData> = {
  tipo: "tipo",
  definizione: "definizione",
  descrizione: "descrizione",
  localita: "localita",
  anno: "anno",
  colore: "colore",
  consistenza: "consistenza",
  inclusi: "inclusi",
  misure: "misure",
  quota: "quota",
  "quota slm": "quota",
  "quota s l m": "quota",
  "quota da piano campagna": "quotaPianoCampagna",
  "quota piano campagna": "quotaPianoCampagna",
  "quota dal piano di campagna": "quotaPianoCampagna",
  "quota p c": "quotaPianoCampagna",
  "quota pc": "quotaPianoCampagna",
  settore: "settore",
  saggio: "saggio",
  quadrati: "quadrati",
  "periodo iniziale": "periodoIniziale",
  "periodo finale": "periodoFinale",
  "materiali rinvenuti": "materialiRinvenuti",
  campioni: "campioni",
  "natura us": "naturaUs",
  "natura us nat art": "naturaUs",
  "natura us nat art naturale artificiale": "naturaUs",
  "n catalogo generale": "nCatalogoGenerale",
  "n catalogo internazionale": "nCatalogoInternazionale",
  area: "areaEdificioStruttura",
  "area edificio struttura": "areaEdificioStruttura",
  "settore ambiente": "ambienteUnitaFunzionale",
  ambiente: "ambienteUnitaFunzionale",
  piante: "piante",
  sezioni: "sezioni",
  prospetti: "prospetti",
  foto: "fotografie",
  fotografie: "fotografie",
  "foto f d dg": "fotografie",
  "criteri distinzione": "criteriDistinzione",
  "criteri di distinzione": "criteriDistinzione",
  "modo di formazione": "modoFormazione",
  "modo formazione": "modoFormazione",
  "natura dell azione": "naturaAzione",
  "modo di formazione natura dell azione": "naturaAzione",
  "agente di formazione": "agenteFormazione",
  "agente formazione": "agenteFormazione",
  "modo di formazione agente": "agenteFormazione",
  "durata formazione": "durataFormazione",
  "modo di formazione durata": "durataFormazione",
  "componenti geologici": "componentiInorganici",
  "componenti inorganici": "componentiInorganici",
  "componenti organici": "componentiOrganici",
  "densita materiale inorganici": "densitaMaterialeInorganici",
  "densita materiale inorganico": "densitaMaterialeInorganici",
  "densita del materiale inorganici": "densitaMaterialeInorganici",
  "densita del materiale inorganico": "densitaMaterialeInorganici",
  "densita materiale organici": "densitaMaterialeOrganici",
  "densita materiale organico": "densitaMaterialeOrganici",
  "densita del materiale organici": "densitaMaterialeOrganici",
  "densita del materiale organico": "densitaMaterialeOrganici",
  "componenti artificiali": "componentiArtificiali",
  "descrizione strato configurazione superficie": "stratoConfigurazioneSuperficie",
  "descrizione strato spessore e variazioni": "stratoSpessoreVariazioni",
  "descrizione strato definizione confine inferiore": "stratoDefinizioneConfine",
  "descrizione strato morfologia inclusi": "stratoMorfologiaInclusi",
  "descrizione struttura orientamento": "strutturaOrientamento",
  "descrizione struttura tecnica costruttiva": "strutturaTecnicaCostruttiva",
  "descrizione struttura materiali e legante": "strutturaMaterialiLegante",
  "descrizione struttura sistema di messa in opera": "strutturaMessaInOpera",
  "descrizione struttura tracce di lavorazione": "strutturaTracceLavorazione",
  "descrizione us negativa forma contorno": "negativaFormaContorno",
  "descrizione us negativa profilo pareti": "negativaProfiloPareti",
  "descrizione us negativa stacco parete riempimento": "negativaTipoStacco",
  "descrizione us negativa profilo fondo": "negativaProfiloFondo",
  "stato conservazione valutazione": "statoConservazioneValutazione",
  "stato conservazione modificazioni": "statoConservazioneModificazioni",
  "stato conservazione conservato per circa": "statoConservazionePercentuale",
  "stato conservazione conservato per circa percentuale": "statoConservazionePercentuale",
  "osservazioni sul metodo di scavo": "osservazioniMetodoScavo",
  "metodo di scavo": "metodoScavo",
  "metodo scavo": "metodoScavo",
  "interpretazione estesa": "interpretazioneEstesa",
  "elementi datanti": "elementiDatanti",
  "datazione assoluta": "datazioneAssoluta",
  "periodo fase": "periodoFase",
  epoca: "epoca",
  "riferimenti schede materiali": "riferimentiTabelleMateriali",
  "dati quantitativi reperti": "datiQuantitativiReperti",
  campionature: "campionature",
  flottazione: "flottazione",
  "flottazione n secchi": "flottazioneSecchi",
  setacciatura: "setacciatura",
  "setacciatura n secchi": "setacciaturaSecchi",
  "affidabilita stratigrafica": "affidabilitaStratigrafica",
  "affidabilita motivazione": "motivazioneAffidabilita",
  "responsabile sabap umb": "responsabileSABAPUMB",
  "responsabile archeosistemi": "responsabileScavo",
  "responsabile scavo": "responsabileScavo",
  "direttore scientifico": "direttoreScientifico",
  "responsabile del settore": "responsabileSettore",
  compilatore: "compilatoreScheda",
  "data compilazione": "dataCompilazione",
  interpretazione: "interpretazione",
  note: "note",
};

const US_RELATION_FIELD_ALIASES: Record<string, keyof USData> = {
  copre: "copre",
  "coperto da": "coperto_da",
  "e coperta da": "coperto_da",
  riempie: "riempie",
  "riempito da": "riempita_da",
  "riempita da": "riempita_da",
  taglia: "taglia",
  "tagliata da": "tagliata_da",
  "e tagliata da": "tagliata_da",
  "si appoggia a": "si_appoggia_a",
  "gli si appoggia": "gli_si_appoggia",
  "si lega a": "si_lega_a",
  "uguale a": "uguale_a",
  "posteriore a": "posteriore_a",
  "anteriore a": "anteriore_a",
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function paragraphText(paragraph: Paragraph): string {
  return (
    paragraph.elements
      ?.map((element) => element.textRun?.content || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim() || ""
  );
}

function extractKeyValue(paragraph: Paragraph): KeyValue | null {
  const text = paragraphText(paragraph);
  if (!text) return null;

  const colonIndex = text.indexOf(":");
  if (colonIndex <= 0) return null;

  const keyPart = text.slice(0, colonIndex).trim();
  const valuePart = text.slice(colonIndex + 1).trim();
  if (!keyPart) return null;

  let cursor = 0;
  let hasBoldBeforeColon = false;
  for (const element of paragraph.elements || []) {
    const chunk = element.textRun?.content || "";
    if (!chunk) continue;

    const start = cursor;
    const end = cursor + chunk.length;
    const overlapsKey = start < colonIndex && end > 0;

    if (overlapsKey && element.textRun?.textStyle?.bold) {
      hasBoldBeforeColon = true;
      break;
    }

    cursor = end;
  }

  return {
    key: normalizeKey(keyPart),
    value: valuePart,
    highConfidence: hasBoldBeforeColon,
  };
}

function parseRelationNumbers(value: string): number[] {
  const matches = value.match(/\d+/g) || [];
  const out: number[] = [];
  const seen = new Set<number>();

  for (const m of matches) {
    const n = Number(m);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }

  return out;
}

function canonicalizeNaturaUs(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized.includes("nat") || normalized.includes("naturale")) {
    return "NAT - Naturale";
  }
  if (normalized.includes("art") || normalized.includes("artificiale") || normalized.includes("antrop")) {
    return "ART - Artificiale";
  }
  return value.trim();
}

function canonicalizeDensity(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized.includes("fitt")) return "fitta";
  if (normalized.includes("medi")) return "media";
  if (normalized.includes("rad")) return "rada";
  return value.trim();
}

function canonicalizeMetodoScavo(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized.includes("integral")) return "integrale";
  if (normalized.includes("parzial")) return "parziale";
  if (normalized.includes("asport")) return "asportata_con_altri";
  return value.trim();
}

function parseItalianDateToIso(value: string): string | null {
  const match = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = Number(match[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const dayP = String(day).padStart(2, "0");
  const monthP = String(month).padStart(2, "0");
  return `${year}-${monthP}-${dayP}`;
}

// Riconosce heading di giornata in due formati:
//   1. "Giornata del 20/04/2026" (vecchio formato)
//   2. "Lunedì 20/04/2026" o "Martedì 21/04/2026" ecc. (formato giornale di scavo)
function parseGiornataHeading(text: string): string | null {
  return parseItalianDateToIso(text);
}

function parseUsHeading(text: string): number | null {
  const match = text.match(/\bUS\s*([0-9]{1,5})\b/i);
  if (match) {
    const n = Number(match[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  const fallback = text.match(/([0-9]{1,5})/);
  if (!fallback) return null;

  const n = Number(fallback[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Cerca menzioni di US nel testo libero: "US 100", "US100", "u.s. 5", ecc.
function extractUsNumbersFromText(text: string): number[] {
  const re = /\bU\.?S\.?\s*(\d{1,5})\b/gi;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) matches.push(m);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// Deduce tipo scavo dal testo: null = non deducibile
function inferTipoScavo(text: string): "manuale" | "meccanico" | "misto" | null {
  const norm = normalizeKey(text);
  const hasMeccanico = /escavator|meccanico|ruspa|bulldozer|benna/.test(norm);
  const hasManurale = /piccone|manuale|cazzuola|trowel|vanga|pala\b|manualmente/.test(norm);
  if (hasMeccanico && hasManurale) return "misto";
  if (hasMeccanico) return "meccanico";
  if (hasManurale) return "manuale";
  return null;
}

// Parsing riga "Orario operativo: 07:00 – 12:30" → { oraInizio, oraFine }
function parseOrarioOperativo(value: string): { oraInizio?: string; oraFine?: string } {
  const match = value.match(/(\d{1,2})[:.h](\d{2}).*?(\d{1,2})[:.h](\d{2})/);
  if (!match) {
    // Solo ora inizio
    const single = value.match(/(\d{1,2})[:.h](\d{2})/);
    if (single) return { oraInizio: `${single[1].padStart(2, "0")}:${single[2]}` };
    return {};
  }
  return {
    oraInizio: `${match[1].padStart(2, "0")}:${match[2]}`,
    oraFine: `${match[3].padStart(2, "0")}:${match[4]}`,
  };
}

// Parsing "Personale presente: Nome1, Nome2, Nome3 (Referenti: X, Y)"
// Restituisce array di nomi puliti, escludendo il testo tra parentesi
function parsePersonale(value: string): string[] {
  const withoutParens = value.replace(/\([^)]*\)/g, "");
  return withoutParens
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function assignUsField(target: USData, key: string, value: string): boolean {
  const cleaned = value.trim();

  const relationField = US_RELATION_FIELD_ALIASES[key];
  if (relationField) {
    const relations = parseRelationNumbers(cleaned);
    (target as unknown as Record<string, unknown>)[relationField] = relations.length > 0 ? relations : undefined;
    return true;
  }

  const mapped = US_TEXT_FIELD_ALIASES[key];
  if (!mapped) {
    return false;
  }

  const normalizedValue = cleaned || undefined;
  if (!normalizedValue) {
    (target as unknown as Record<string, unknown>)[mapped] = undefined;
    return true;
  }

  if (mapped === "naturaUs") {
    target.naturaUs = canonicalizeNaturaUs(normalizedValue);
    return true;
  }

  if (mapped === "densitaMaterialeInorganici" || mapped === "densitaMaterialeOrganici") {
    (target as unknown as Record<string, unknown>)[mapped] = canonicalizeDensity(normalizedValue);
    return true;
  }

  if (mapped === "metodoScavo") {
    target.metodoScavo = canonicalizeMetodoScavo(normalizedValue);
    return true;
  }

  (target as unknown as Record<string, unknown>)[mapped] = normalizedValue;
  return true;
}

function assignGiornataField(target: GiornataData, key: string, value: string): boolean {
  const cleaned = value.trim();

  if (key === "condizioni meteo" || key === "meteo") {
    target.meteo = cleaned || undefined;
    return true;
  }

  if (key === "operai") {
    const n = Number(cleaned.match(/\d+/)?.[0] || "");
    if (Number.isInteger(n) && n >= 0) {
      target.operai = n;
      return true;
    }
  }

  if (key === "personale presente" || key === "personale") {
    target.personale = parsePersonale(value);
    return true;
  }

  if (key === "orario operativo" || key === "orario") {
    const { oraInizio, oraFine } = parseOrarioOperativo(value);
    if (oraInizio) target.oraInizio = oraInizio;
    if (oraFine) target.oraFine = oraFine;
    return true;
  }

  return false;
}

function computeMissingFields(us: USData): string[] {
  return US_MISSING_FIELDS.filter((field) => {
    const value = us[field];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "number") return false;
    return !value;
  }).map((field) => String(field));
}

export const __test = {
  normalizeKey,
  parseRelationNumbers,
  assignUsField,
  computeMissingFields,
  parseGiornataHeading,
  parsePersonale,
  parseOrarioOperativo,
  inferTipoScavo,
  extractUsNumbersFromText,
};

export async function parseJournalDocument(docIdOrUrl: string): Promise<GiornataData[]> {
  const docId = docIdOrUrl.includes("docs.google.com") ? extractDocId(docIdOrUrl) : docIdOrUrl;
  const auth = getAuthorizedClient();
  const docs = google.docs({ version: "v1", auth });
  const doc = await docs.documents.get({ documentId: docId });

  const out: GiornataData[] = [];
  const content = doc.data.body?.content || [];

  let currentGiornata: GiornataData | null = null;
  let currentUS: (USData & { __rawLines: string[] }) | null = null;
  const narrativeLines: string[] = [];

  const flushNarrative = () => {
    if (currentGiornata && narrativeLines.length > 0) {
      const text = narrativeLines.join("\n").trim();
      currentGiornata.attivitaSvolta = (currentGiornata.attivitaSvolta ? currentGiornata.attivitaSvolta + "\n" : "") + text;
      // Deduce tipo scavo dal testo narrativo se non già impostato
      if (currentGiornata.tipoScavo === undefined) {
        currentGiornata.tipoScavo = inferTipoScavo(text);
      }
    }
    narrativeLines.length = 0;
  };

  for (const node of content) {
    const paragraph = node.paragraph;
    if (!paragraph) continue;

    const style = paragraph.paragraphStyle?.namedStyleType || "";
    const text = paragraphText(paragraph);
    if (!text) continue;

    // Heading 1 o Heading 2: potrebbe essere intestazione documento o giorno
    if (style === "HEADING_1" || style === "HEADING_2") {
      const parsedDate = parseGiornataHeading(text);
      if (!parsedDate) {
        // Heading senza data: non è un giorno, skip
        continue;
      }

      flushNarrative();
      currentUS = null;
      currentGiornata = {
        data: parsedDate,
        us: [],
        tipoScavo: undefined,
      };
      out.push(currentGiornata);
      continue;
    }

    // Heading 3: US esplicita come sezione
    if (style === "HEADING_3" && currentGiornata) {
      flushNarrative();
      const usNumber = parseUsHeading(text);
      if (!usNumber) {
        currentUS = null;
        continue;
      }

      currentUS = { numero: usNumber, __rawLines: [] };
      currentGiornata.us.push(currentUS);
      continue;
    }

    if (!currentGiornata) continue;

    const kv = extractKeyValue(paragraph);

    // Dentro un blocco US esplicito (HEADING_3)
    if (currentUS) {
      currentUS.__rawLines.push(text);
      if (kv) assignUsField(currentUS, kv.key, kv.value);
      continue;
    }

    // Testo della giornata
    if (kv && assignGiornataField(currentGiornata, kv.key, kv.value)) {
      // Campo giornata riconosciuto (meteo, personale, orario)
      continue;
    }

    // Testo narrativo: accumula e cerca menzioni US inline
    narrativeLines.push(text);

    // Cerca US menzionate nel testo libero (es. "US 100", "US 101")
    const usNums = extractUsNumbersFromText(text);
    const existingNums = new Set(currentGiornata.us.map((u) => u.numero));
    for (const num of usNums) {
      if (!existingNums.has(num)) {
        existingNums.add(num);
        currentGiornata.us.push({
          numero: num,
          rawText: "",
          campi_da_inferire: [...US_MISSING_FIELDS.map(String)],
        });
      }
    }
  }

  // Flush eventuale narrativo dell'ultima giornata
  flushNarrative();

  // Post-processing: rawText e campi mancanti per ogni US
  for (const giornata of out) {
    // Aggrega il rawText delle US trovate come heading (con __rawLines)
    for (const us of giornata.us) {
      const mutable = us as USData & { __rawLines?: string[] };
      if (mutable.__rawLines) {
        mutable.rawText = mutable.__rawLines.join("\n").trim();
        delete mutable.__rawLines;
      }
      // Se US trovata inline nel testo, usa attivitaSvolta come contesto
      if (!mutable.rawText && giornata.attivitaSvolta) {
        mutable.rawText = giornata.attivitaSvolta;
      }
      mutable.campi_da_inferire = computeMissingFields(mutable);
    }

    // Tipo scavo: se ancora undefined dopo tutto il testo, imposta null (non deducibile)
    if (giornata.tipoScavo === undefined) {
      giornata.tipoScavo = null;
    }
  }

  return out;
}
