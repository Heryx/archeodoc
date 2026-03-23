import Anthropic from "@anthropic-ai/sdk";
import type { UnitaStratigrafica, Giornata, Allegato } from "@shared/schema";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-5";

// ─── Campi obbligatori / raccomandati per ogni tipo di US ────────────────────
export const CAMPI_OBBLIGATORI_US: Record<string, string[]> = {
  default: [
    "codice_us",       // es. US 001
    "tipo",            // strato, struttura, tomba…
    "definizione",
    "descrizione",
    "quota",
    "settore",
    "coperto_da o copre (almeno una relazione stratigrafica)",
  ],
  tomba: [
    "codice_us",       // es. T.001
    "definizione",
    "descrizione",
    "orientamento",    // N-S, E-O…
    "rito",            // inumazione, cremazione
    "quota",
    "settore",
    "interpretazione",
    "periodo_iniziale",
    "materiali_rinvenuti",
  ],
  struttura: [
    "codice_us",
    "tipo",
    "definizione",
    "descrizione",
    "quota",
    "settore",
    "si_lega_a o coperto_da (almeno una relazione)",
    "materiali costruttivi",
  ],
  strato: [
    "codice_us",
    "definizione",
    "descrizione",
    "quota",
    "settore",
    "coperto_da",
    "copre",
  ],
};

export const CAMPI_OBBLIGATORI_GIORNATA = [
  "data",
  "operatori (almeno un nome)",
  "settore",
  "note operative (attività svolte)",
  "condizioni meteo",
];

// ─── Analisi e formattazione testo US ────────────────────────────────────────
export async function analizzaTestoUS(
  us: UnitaStratigrafica,
): Promise<{ schedaFormattata: string; campiMancanti: string[]; note: string }> {
  const tipo = us.tipo || "default";
  const campiAttesi = CAMPI_OBBLIGATORI_US[tipo] || CAMPI_OBBLIGATORI_US.default;

  // Costruisci il testo dei dati esistenti
  const datiUS = `
CODICE US: ${us.codiceUS || "NON INSERITO"}
TIPO: ${us.tipo || "NON INSERITO"}
DEFINIZIONE: ${us.definizione || "NON INSERITA"}
DESCRIZIONE: ${us.descrizione || "NON INSERITA"}
INTERPRETAZIONE: ${us.interpretazione || "NON INSERITA"}
QUOTA: ${us.quota != null ? us.quota + " m s.l.m." : "NON INSERITA"}
SETTORE: ${us.settore || "NON INSERITO"}
COPERTO DA: ${us.coperto_da || "nessuna relazione"}
COPRE: ${us.copre || "nessuna relazione"}
SI LEGA A: ${us.si_lega_a || "nessuna relazione"}
UGUALE A: ${us.uguale_a || "nessuna relazione"}
PERIODO INIZIALE: ${us.periodoIniziale || "NON INSERITO"}
PERIODO FINALE: ${us.periodoFinale || "NON INSERITO"}
MATERIALI RINVENUTI: ${us.materialiRinvenuti || "nessuno"}
CAMPIONI PRELEVATI: ${us.campioni || "nessuno"}
  `.trim();

  const prompt = `Sei un archeologo specializzato in documentazione stratigrafica italiana. Analizza i dati di questa Unità Stratigrafica.

DATI INSERITI:
${datiUS}

CAMPI ATTESI PER TIPO "${tipo}":
${campiAttesi.map((c, i) => `${i + 1}. ${c}`).join("\n")}

COMPITO:
1. Identifica quali dei campi attesi sono MANCANTI o insufficienti nei dati inseriti.
   - Per "mancante" intendi: campo vuoto, "NON INSERITO", "nessuna relazione" quando richiesta, o testo troppo generico (<10 caratteri).
   - Restituisci un array JSON dei campi mancanti, es: ["quota", "settore", "relazioni stratigrafiche"]
   
2. Produci una scheda US formattata in italiano con le sezioni standard:
   - INTESTAZIONE (codice, tipo)
   - DESCRIZIONE STRATIGRAFICA (riscrivi e migliora il testo inserito mantenendo il significato, correggi eventuali errori grammaticali, usa terminologia tecnica appropriata)
   - RELAZIONI STRATIGRAFICHE
   - MATERIALI E REPERTI
   - INTERPRETAZIONE
   - NOTE

3. Fornisci un breve commento sulla qualità e completezza della scheda.

Rispondi SOLO con questo JSON (nessun testo prima o dopo):
{
  "campiMancanti": ["campo1", "campo2"],
  "schedaFormattata": "testo completo della scheda formattata...",
  "note": "breve commento sulla qualità della documentazione"
}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    // Estrai JSON anche se c'è testo attorno
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Risposta AI non in formato JSON");
    const result = JSON.parse(jsonMatch[0]);
    return {
      campiMancanti: Array.isArray(result.campiMancanti) ? result.campiMancanti : [],
      schedaFormattata: result.schedaFormattata || "",
      note: result.note || "",
    };
  } catch (err) {
    console.error("Errore analisi AI testo US:", err);
    throw new Error("Impossibile analizzare la scheda US con l'AI.");
  }
}

// ─── Analisi e formattazione report giornaliero ───────────────────────────────
export async function analizzaTestoGiornata(
  giornata: Giornata,
  usList: UnitaStratigrafica[],
  qcIssues: { livello: string; messaggio: string }[],
): Promise<{ reportFormattato: string; campiMancanti: string[]; note: string }> {
  let operatori = "NON INSERITI";
  try {
    const ops = JSON.parse(giornata.operatori || "[]");
    operatori = Array.isArray(ops) && ops.length > 0 ? ops.join(", ") : giornata.operatori || "NON INSERITI";
  } catch { operatori = giornata.operatori || "NON INSERITI"; }

  const datiGiornata = `
DATA: ${giornata.data || "NON INSERITA"}
OPERATORI: ${operatori}
CONDIZIONI METEO: ${giornata.condMeteo || "NON INSERITE"}
SETTORE: ${giornata.settore || "NON INSERITO"}
NOTE OPERATIVE: ${giornata.note || "NON INSERITE"}
  `.trim();

  const usRiassunto = usList.length > 0
    ? usList.map(us => `- ${us.codiceUS} (${us.tipo || "tipo nd"}): ${us.descrizione?.substring(0, 150) || "nessuna descrizione"}`).join("\n")
    : "Nessuna US documentata nella giornata";

  const problemiQC = qcIssues.length > 0
    ? qcIssues.map(i => `[${i.livello.toUpperCase()}] ${i.messaggio}`).join("\n")
    : "Nessuna criticità rilevata";

  const prompt = `Sei un archeologo specializzato in documentazione di scavo italiana. Analizza i dati di questa giornata di scavo.

DATI GIORNATA:
${datiGiornata}

UNITÀ STRATIGRAFICHE DOCUMENTATE:
${usRiassunto}

CRITICITÀ QC RILEVATE:
${problemiQC}

CAMPI ATTESI PER UNA GIORNATA DI SCAVO:
${CAMPI_OBBLIGATORI_GIORNATA.map((c, i) => `${i + 1}. ${c}`).join("\n")}

COMPITO:
1. Identifica quali campi attesi sono MANCANTI o insufficienti.
   Restituisci array JSON dei campi mancanti.

2. Produci un diario giornaliero di scavo formattato e professionale con le sezioni:
   - INTESTAZIONE (data, cantiere, meteo, operatori)
   - ATTIVITÀ SVOLTE (descrivi le operazioni in modo fluido e tecnico, basandoti sulle note e sulle US documentate)
   - DOCUMENTAZIONE RACCOLTA (US documentate, materiali)
   - CRITICITÀ E PROBLEMATICHE (basato sui problemi QC)
   - PROGRAMMA LAVORI SUCCESSIVI (suggerisci in base allo stato corrente)

3. Commento sulla qualità della documentazione giornaliera.

Rispondi SOLO con questo JSON (nessun testo prima o dopo):
{
  "campiMancanti": ["campo1", "campo2"],
  "reportFormattato": "testo completo del diario formattato...",
  "note": "commento qualità documentazione"
}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Risposta AI non in formato JSON");
    const result = JSON.parse(jsonMatch[0]);
    return {
      campiMancanti: Array.isArray(result.campiMancanti) ? result.campiMancanti : [],
      reportFormattato: result.reportFormattato || "",
      note: result.note || "",
    };
  } catch (err) {
    console.error("Errore analisi AI testo giornata:", err);
    throw new Error("Impossibile analizzare il report giornaliero con l'AI.");
  }
}
