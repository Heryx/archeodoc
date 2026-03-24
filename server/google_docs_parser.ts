import { google, docs_v1 } from "googleapis";
import { getAuthorizedClient } from "./google_auth";
import { extractDocId } from "./google_docs";

export interface USData {
  numero: number;
  tipo?: string;
  definizione?: string;
  descrizione?: string;
  colore?: string;
  consistenza?: string;
  inclusi?: string;
  misure?: string;
  quota?: string;
  settore?: string;
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
  fotografie?: string;
  criteriDistinzione?: string;
  naturaAzione?: string;
  agenteFormazione?: string;
  durataFormazione?: string;
  modoFormazione?: string;
  componentiInorganici?: string;
  componentiOrganici?: string;
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
  interpretazioneEstesa?: string;
  elementiDatanti?: string;
  datazioneAssoluta?: string;
  periodoFase?: string;
  riferimentiTabelleMateriali?: string;
  datiQuantitativiReperti?: string;
  campionature?: string;
  flottazione?: string;
  flottazioneSecchi?: string;
  setacciatura?: string;
  setacciaturaSecchi?: string;
  affidabilitaStratigrafica?: string;
  motivazioneAffidabilita?: string;
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
  colore: "colore",
  consistenza: "consistenza",
  inclusi: "inclusi",
  misure: "misure",
  quota: "quota",
  settore: "settore",
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
  "interpretazione estesa": "interpretazioneEstesa",
  "elementi datanti": "elementiDatanti",
  "datazione assoluta": "datazioneAssoluta",
  "periodo fase": "periodoFase",
  "riferimenti schede materiali": "riferimentiTabelleMateriali",
  "dati quantitativi reperti": "datiQuantitativiReperti",
  campionature: "campionature",
  flottazione: "flottazione",
  "flottazione n secchi": "flottazioneSecchi",
  setacciatura: "setacciatura",
  "setacciatura n secchi": "setacciaturaSecchi",
  "affidabilita stratigrafica": "affidabilitaStratigrafica",
  "affidabilita motivazione": "motivazioneAffidabilita",
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
    .replace(/[\u0300-\u036f]/g, "")
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

function parseGiornataHeading(text: string): string | null {
  const normalized = normalizeKey(text);
  if (!normalized.includes("giornata")) return null;

  const iso = parseItalianDateToIso(text);
  return iso || null;
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

  (target as unknown as Record<string, unknown>)[mapped] = normalizedValue;
  return true;
}

function assignGiornataField(target: GiornataData, key: string, value: string): boolean {
  const cleaned = value.trim();

  if (key === "meteo") {
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

  for (const node of content) {
    const paragraph = node.paragraph;
    if (!paragraph) continue;

    const style = paragraph.paragraphStyle?.namedStyleType || "";
    const text = paragraphText(paragraph);
    if (!text) continue;

    if (style === "HEADING_2") {
      const parsedDate = parseGiornataHeading(text);
      if (!parsedDate) {
        currentUS = null;
        continue;
      }

      currentGiornata = {
        data: parsedDate,
        us: [],
      };
      out.push(currentGiornata);
      currentUS = null;
      continue;
    }

    if (style === "HEADING_3" && currentGiornata) {
      const usNumber = parseUsHeading(text);
      if (!usNumber) {
        currentUS = null;
        continue;
      }

      currentUS = {
        numero: usNumber,
        __rawLines: [],
      };
      currentGiornata.us.push(currentUS);
      continue;
    }

    if (!currentGiornata) {
      continue;
    }

    const kv = extractKeyValue(paragraph);

    if (currentUS) {
      currentUS.__rawLines.push(text);
      if (!kv) continue;
      assignUsField(currentUS, kv.key, kv.value);
      continue;
    }

    if (kv) {
      assignGiornataField(currentGiornata, kv.key, kv.value);
    }
  }

  for (const giornata of out) {
    for (const us of giornata.us) {
      const mutable = us as USData & { __rawLines?: string[] };
      mutable.campi_da_inferire = computeMissingFields(mutable);
      mutable.rawText = (mutable.__rawLines || []).join("\n").trim();
      delete mutable.__rawLines;
    }
  }

  return out;
}
