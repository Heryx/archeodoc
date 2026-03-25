import { google } from "googleapis";
import { getAuthorizedClient } from "./google_auth";

/** Estrae l'ID documento dall'URL di Google Docs */
export function extractDocId(url: string): string {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("URL Google Docs non valido. Formato atteso: https://docs.google.com/document/d/ID/...");
  return match[1];
}

/** Restituisce il testo completo del documento (concatenazione di tutti i paragrafi) */
export async function getDocumentText(docIdOrUrl: string): Promise<{ title: string; text: string; sections: Record<string, string> }> {
  const docId = docIdOrUrl.includes("docs.google.com") ? extractDocId(docIdOrUrl) : docIdOrUrl;
  const auth = getAuthorizedClient();
  const docs = google.docs({ version: "v1", auth });
  const doc = await docs.documents.get({ documentId: docId });

  const title = doc.data.title || "Documento senza titolo";
  const content = doc.data.body?.content || [];

  let fullText = "";
  const sections: Record<string, string> = {};
  let currentHeading = "_intro";

  for (const elem of content) {
    if (!elem.paragraph) continue;
    const style = elem.paragraph.paragraphStyle?.namedStyleType || "";
    const lineText = elem.paragraph.elements
      ?.map(e => e.textRun?.content || "")
      .join("") || "";
    const trimmed = lineText.trim();
    if (!trimmed) continue;

    if (style.startsWith("HEADING")) {
      currentHeading = trimmed.toLowerCase().replace(/\s+/g, "_");
      sections[currentHeading] = "";
    } else {
      sections[currentHeading] = (sections[currentHeading] || "") + trimmed + "\n";
    }
    fullText += trimmed + "\n";
  }

  return { title, text: fullText.trim(), sections };
}

/** Cerca una corrispondenza strutturata tra le sezioni del doc e i campi US */
export function mapSectionsToUS(sections: Record<string, string>): Record<string, string> {
  const mappings: Record<string, string[]> = {
    codiceUS:        ["codice_us", "codice us", "us", "numero us"],
    tipo:            ["tipo"],
    definizione:     ["definizione"],
    descrizione:     ["descrizione", "descrizione stratigrafica"],
    interpretazione: ["interpretazione"],
    quota:           ["quota", "quota altimetrica", "quota slm", "quota s.l.m."],
    quotaPianoCampagna: ["quota piano campagna", "quota da piano campagna", "quota p.c.", "quota pc"],
    settore:         ["settore", "area"],
    saggio:          ["saggio"],
    quadrati:        ["quadrati", "quadrato"],
    localita:        ["localita", "località"],
    anno:            ["anno"],
    prospetti:       ["prospetti", "prospetto"],
    coperto_da:      ["coperto_da", "coperto da", "stratigraficamente coperto"],
    copre:           ["copre", "copre stratigraficamente"],
    si_lega_a:       ["si_lega_a", "si lega a"],
    periodoIniziale: ["periodo iniziale", "periodo_iniziale", "datazione iniziale"],
    periodoFinale:   ["periodo finale", "periodo_finale", "datazione finale"],
    materialiRinvenuti: ["materiali", "materiali rinvenuti", "reperti"],
    campioni:        ["campioni", "campioni prelevati"],
    epoca:           ["epoca"],
    metodoScavo:     ["metodo scavo", "osservazioni metodo scavo"],
    densitaMaterialeInorganici: ["densita materiale inorganici", "densita materiale inorganico"],
    densitaMaterialeOrganici: ["densita materiale organici", "densita materiale organico"],
  };

  const result: Record<string, string> = {};
  const sectionKeys = Object.keys(sections);

  for (const [field, aliases] of Object.entries(mappings)) {
    for (const alias of aliases) {
      const found = sectionKeys.find(k => k.includes(alias.replace(/\s+/g, "_")) || k.includes(alias));
      if (found && sections[found]?.trim()) {
        result[field] = sections[found].trim();
        break;
      }
    }
  }
  return result;
}

/** Cerca corrispondenza per campi giornata */
export function mapSectionsToGiornata(sections: Record<string, string>): Record<string, string> {
  const mappings: Record<string, string[]> = {
    data:      ["data", "date"],
    operatori: ["operatori", "archeologi", "personale"],
    settore:   ["settore", "area"],
    condMeteo: ["meteo", "condizioni_meteo", "condizioni meteo", "tempo"],
    note:      ["note", "note_operative", "note operative", "attività", "attivita", "descrizione"],
  };

  const result: Record<string, string> = {};
  const sectionKeys = Object.keys(sections);

  for (const [field, aliases] of Object.entries(mappings)) {
    for (const alias of aliases) {
      const found = sectionKeys.find(k => k.includes(alias.replace(/\s+/g, "_")) || k.includes(alias));
      if (found && sections[found]?.trim()) {
        result[field] = sections[found].trim();
        break;
      }
    }
  }
  return result;
}
