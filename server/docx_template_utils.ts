import fs from "fs";
import { BASE_US_FIELD_KEYS, checkboxGroupForKey, isCheckboxPlaceholder, type USModelField } from "@shared/us_models";

/** Rileva tutti i placeholder ({tag}) presenti in un template DOCX tramite docxtemplater. */
export async function detectTemplatePlaceholders(templatePath: string): Promise<Record<string, unknown>> {
  const PizZip = (await import("pizzip")).default;
  const Docxtemplater = (await import("docxtemplater")).default;
  const InspectModule = (await import("docxtemplater/js/inspect-module.js")).default;
  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const iModule = new InspectModule();
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "", modules: [iModule] });
  doc.compile();
  return iModule.getAllTags();
}

/** Trasforma una chiave placeholder camelCase (es. "chkArtificiale", "codiceUS") in un'etichetta leggibile. */
export function humanizeFieldKey(key: string): string {
  return (
    key
      .replace(/^chk/, "")
      // Spazio solo al confine minuscola→maiuscola, per non separare sigle come "US" o "SABAP".
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || key
  );
}

// ── Campi del modello scheda US derivati dal template ────────────────────────────

/** Placeholder che la scheda gestisce con blocchi propri (identificazione, descrizione, relazioni)
 * o che sono solo metadati di export: non diventano campi del modello. */
const TEMPLATE_KEYS_HANDLED_ELSEWHERE = new Set([
  "codiceUS", "tipo", "settore", "definizione", "descrizione", "interpretazione",
  "uguale_a", "si_lega_a", "coperto_da", "copre",
  "tagliatoDa", "taglia", "riempitoDa", "riempie",
  "gliSiAppoggia", "siAppoggia", "siAppoggiaA", "posterioreA", "anterioreA", "ugualeAStratigrafico",
  "cantiereCodice", "cantiereNome", "dataExport",
]);

/** Placeholder lunghi: nella scheda sono aree di testo. */
const TEXTAREA_KEYS = new Set([
  "osservazioni", "modoFormazioneOrigine", "materialiRinvenuti", "campioni", "datiQuantitativiReperti",
  "sequenzaFisica", "criteriDistinzione", "danneggiatoDa", "altroScavo",
]);

/** Etichette dei campi di testo, come compaiono sulla scheda cartacea. */
const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  nCatalogoGenerale: "N. catalogo generale",
  nCatalogoInternazionale: "N. catalogo internazionale",
  soprintendenza: "Soprintendenza",
  localita: "Località",
  anno: "Anno",
  area: "Area",
  saggio: "Saggio",
  quadrati: "Quadrato/i",
  quotaSml: "Quote s.l.m.",
  quotaSlm: "Quote s.l.m.",
  quoteSlm: "Quote s.l.m.",
  piante: "Piante",
  sezioni: "Sezioni",
  prospetti: "Prospetti",
  haFoto: "Foto",
  tabelleMaterialiRa: "Tabelle materiali RA",
  tabelleMaterialiN: "Tabelle materiali N",
  criteriDistinzione: "Criteri di distinzione",
  altroInorganico: "Altri componenti inorganici",
  altroOrganico: "Altri componenti organici",
  danneggiatoDa: "L'unità stratigrafica è danneggiata da",
  altroScavo: "Altro (osservazioni)",
  datiQuantitativiReperti: "Dati quantitativi dei reperti",
  campionatureN: "Campionature (n.)",
  periodoFase: "Periodo o fase",
  responsabileSabap: "Responsabile SABAP-UMB",
  responsabileArcheosistemi: "Responsabile Archeosistemi",
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Testo del documento, un paragrafo per riga: i `{placeholder}` spezzati su più run tornano interi. */
async function readTemplateText(templatePath: string): Promise<string> {
  const PizZip = (await import("pizzip")).default;
  const zip = new PizZip(fs.readFileSync(templatePath));
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((p) =>
      decodeXmlEntities(
        p
          .replace(/<w:tab\/>/g, " ")
          .replace(/<w:br\/>/g, " ")
          .replace(/<(?!w:t[ >])[^>]*>/g, "")
          .replace(/<w:t[^>]*>/g, "")
          .replace(/<\/w:t>/g, ""),
      ),
    )
    .join("\n");
}

/** Etichetta del checkbox: il testo che nel template segue il placeholder (`{chkOsso} osso` → "Osso"). */
function checkboxLabelsFromText(text: string): Map<string, string> {
  const labels = new Map<string, string>();
  const re = /\{(chk[A-Z]\w*)\}([^{\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (labels.has(m[1])) continue;
    const label = m[2].replace(/\s+/g, " ").trim().replace(/[:\s]+$/, "");
    if (label) labels.set(m[1], label.charAt(0).toUpperCase() + label.slice(1));
  }
  return labels;
}

/**
 * Campi che la scheda deve mostrare per un template: uno per ogni placeholder, nell'ordine in cui
 * compaiono nel documento. I `chkXxx` diventano checkbox (con l'etichetta scritta nel template),
 * gli altri campi di testo. Restano fuori solo i placeholder già gestiti dai blocchi fissi della scheda.
 */
export async function buildModelFieldsFromTemplate(templatePath: string): Promise<{
  fields: USModelField[];
  placeholders: string[];
}> {
  const tags = await detectTemplatePlaceholders(templatePath);
  const text = await readTemplateText(templatePath);
  const position = (key: string) => {
    const at = text.indexOf(`{${key}}`);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const placeholders = Object.keys(tags).sort((a, b) => position(a) - position(b));
  const checkboxLabels = checkboxLabelsFromText(text);

  const fields: USModelField[] = [];
  for (const key of placeholders) {
    if (TEMPLATE_KEYS_HANDLED_ELSEWHERE.has(key) || BASE_US_FIELD_KEYS.has(key)) continue;
    if (isCheckboxPlaceholder(key)) {
      fields.push({
        key,
        label: checkboxLabels.get(key) ?? humanizeFieldKey(key),
        type: "checkbox",
        group: checkboxGroupForKey(key),
      });
      continue;
    }
    fields.push({
      key,
      label: TEMPLATE_FIELD_LABELS[key] ?? humanizeFieldKey(key),
      type: TEXTAREA_KEYS.has(key) ? "textarea" : "text",
    });
  }
  return { fields, placeholders };
}
