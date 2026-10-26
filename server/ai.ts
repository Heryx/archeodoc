import type { UnitaStratigrafica, Giornata } from "@shared/schema";
import { getSetting } from "./ai_settings";
import { generateWithGemini } from "./gemini";
import { logger } from "./logger";
import { getAnthropicModel } from "./anthropic_model";

// ─── Rilevamento provider ────────────────────────────────────────────────────
// Preferisce Gemini (gratuito) se la chiave è presente, poi OpenAI, poi Claude.
// AI_PROVIDER può forzare la scelta: "gemini" | "openai" | "claude"
// IMPORTANTE: legge sempre process.env al momento della chiamata (non cached)
// in modo che reloadAIProvider() funzioni dopo il salvataggio dalle Impostazioni.

function resolveProvider(): "gemini" | "claude" | "openai" | "none" {
  const envProvider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  const hasGemini  = !!(process.env.GEMINI_API_KEY?.trim());
  const hasClaude  = !!(process.env.ANTHROPIC_API_KEY?.trim());
  const hasOpenAI  = !!(process.env.OPENAI_API_KEY?.trim());

  const forcedHasKey =
    (envProvider === "claude" && hasClaude) ||
    (envProvider === "gemini" && hasGemini) ||
    (envProvider === "openai" && hasOpenAI);

  if (envProvider && (envProvider === "claude" || envProvider === "gemini" || envProvider === "openai")) {
    if (forcedHasKey) return envProvider;
    // Provider forzato ma senza chiave: invece di disattivare del tutto l'AI
    // (che fa sparire l'assistente), si ripiega sull'auto-detect degli altri
    // provider configurati.
    logger.warn(
      `AI_PROVIDER="${envProvider}" richiesto ma la relativa chiave API non è configurata: ` +
        `ripiego sull'auto-detect.`,
    );
  }

  // Auto-detect priority: Gemini → OpenAI → Claude
  if (hasGemini) return "gemini";
  if (hasOpenAI) return "openai";
  if (hasClaude) return "claude";
  return "none";
}

export let AI_PROVIDER = resolveProvider();
export let AI_AVAILABLE = AI_PROVIDER !== "none";

/** Ricalcola il provider dopo una modifica al .env (es. dalle Impostazioni). */
export function reloadAIProvider(): { provider: typeof AI_PROVIDER; available: boolean } {
  AI_PROVIDER = resolveProvider();
  AI_AVAILABLE = AI_PROVIDER !== "none";
  return { provider: AI_PROVIDER, available: AI_AVAILABLE };
}

// ─── Campi obbligatori / raccomandati per ogni tipo di US ────────────────────
export const CAMPI_OBBLIGATORI_US: Record<string, string[]> = {
  default: [
    "codice_us",       // es. US 001
    "tipo",            // strato, struttura, tomba…
    "definizione",
    "descrizione",
    "quota (s.l.m. o da piano campagna)",
    "settore",
    "coperto_da o copre (almeno una relazione stratigrafica)",
  ],
  tomba: [
    "codice_us",       // es. T.001
    "definizione",
    "descrizione",
    "orientamento",    // N-S, E-O…
    "rito",            // inumazione, cremazione
    "quota (s.l.m. o da piano campagna)",
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
    "quota (s.l.m. o da piano campagna)",
    "settore",
    "si_lega_a o coperto_da (almeno una relazione)",
    "materiali costruttivi",
  ],
  strato: [
    "codice_us",
    "definizione",
    "descrizione",
    "quota (s.l.m. o da piano campagna)",
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

// ─── Helper: chiama l'AI con il provider attivo ───────────────────────────────
export async function callAI(prompt: string, maxTokens = 3000, systemPrompt?: string): Promise<string> {
  if (AI_PROVIDER === "gemini") {
    return generateWithGemini(prompt, systemPrompt);
  }

  if (AI_PROVIDER === "openai") {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
    });
    return response.choices[0]?.message?.content || "";
  }

  if (AI_PROVIDER === "claude") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0].type === "text" ? response.content[0].text : "";
  }

  logger.error("callAI: nessun provider AI configurato");
  throw new Error("Nessun provider AI configurato.");
}

// ─── Helper: estrai JSON dalla risposta ──────────────────────────────────────
function parseJsonResponse(raw: string): Record<string, unknown> {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Risposta AI non in formato JSON");
  return JSON.parse(jsonMatch[0]);
}

// ─── Match semantico placeholder → campo esistente (per "Elenco US") ──────────
export type AIFieldMatch = { key: string; label: string; confidence: "alta" | "media" | "bassa" };

/**
 * Per ciascun placeholder candidato, chiede all'AI se corrisponde per significato (anche
 * sinonimi) a uno dei campi noti — a differenza del confronto per stringhe (deterministico,
 * vedi field_similarity.ts), qui si intende catturare casi come "note" ↔ "osservazioni".
 */
export async function matchFieldsWithAI(
  candidates: string[],
  knownFields: { key: string; label: string }[],
): Promise<Record<string, AIFieldMatch | null>> {
  if (!AI_AVAILABLE) {
    throw new Error("Nessun provider AI configurato.");
  }
  if (candidates.length === 0) return {};

  const fieldsList = knownFields.map((f) => `- ${f.key} (${f.label})`).join("\n");
  const candidatesList = candidates.map((c) => `- ${c}`).join("\n");

  const prompt = `Sei un assistente che aiuta a evitare campi duplicati in un archivio di scavo archeologico.
Di seguito una lista di CAMPI GIA' ESISTENTI (chiave e descrizione):
${fieldsList}

E una lista di NUOVI PLACEHOLDER trovati in un template, di cui non è ancora chiaro se corrispondano
a uno dei campi esistenti (anche come sinonimo o forma abbreviata) oppure siano concettualmente nuovi:
${candidatesList}

Per ciascun placeholder, indica se corrisponde per SIGNIFICATO (non solo somiglianza testuale) a uno
dei campi esistenti. Rispondi SOLO con un oggetto JSON, senza altro testo, con questa forma:
{"matches": {"<placeholder>": {"key": "<chiave campo esistente>", "confidence": "alta|media|bassa"} | null, ...}}
Usa null se nessun campo esistente corrisponde davvero per significato.`;

  const raw = await callAI(prompt, 2000, "Rispondi sempre e solo con JSON valido, nessun testo extra.");
  const parsed = parseJsonResponse(raw) as { matches?: Record<string, { key: string; confidence?: string } | null> };
  const matches = parsed.matches && typeof parsed.matches === "object" ? parsed.matches : {};

  const knownByKey = new Map(knownFields.map((f) => [f.key, f]));
  const out: Record<string, AIFieldMatch | null> = {};
  for (const candidate of candidates) {
    const raw = matches[candidate];
    if (!raw || typeof raw !== "object" || !raw.key) {
      out[candidate] = null;
      continue;
    }
    const known = knownByKey.get(raw.key);
    if (!known) {
      out[candidate] = null;
      continue;
    }
    const confidence = raw.confidence === "alta" || raw.confidence === "bassa" ? raw.confidence : "media";
    out[candidate] = { key: known.key, label: known.label, confidence };
  }
  return out;
}

export async function inferMissingFields(
  usRawText: string,
  presentFields: Record<string, unknown>,
  missingFields: string[],
): Promise<Record<string, string | null>> {
  if (!Array.isArray(missingFields) || missingFields.length === 0) return {};
  if (!AI_AVAILABLE) {
    return Object.fromEntries(missingFields.map((field) => [field, null]));
  }

  const compactMissing = missingFields.filter((field) => typeof field === "string" && field.trim());
  if (compactMissing.length === 0) return {};

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
  } catch {
    // keep fallback prompt
  }

  const prompt = `Inferisci solo i campi mancanti di una scheda US.

DATI GIA ESTRATTI:
${JSON.stringify(presentFields, null, 2)}

CAMPI MANCANTI:
${JSON.stringify(compactMissing)}

TESTO ORIGINALE US:
\"\"\"
${usRawText || "(vuoto)"}
\"\"\"

REGOLE:
1. Restituisci solo i campi richiesti.
2. Se un campo non e deducibile, metti valore null.
3. Non inventare codici stratigrafici.
4. Usa frasi concise.

Rispondi SOLO con JSON:
{
  \"fields\": {
    \"nome_campo\": \"valore o null\"
  }
}`;

  try {
    const raw = await callAI(prompt, 900, systemPrompt);
    const parsed = parseJsonResponse(raw);
    const fieldsCandidate =
      parsed && typeof parsed.fields === "object" && parsed.fields !== null
        ? (parsed.fields as Record<string, unknown>)
        : {};

    const out: Record<string, string | null> = {};
    for (const field of compactMissing) {
      const rawValue = fieldsCandidate[field];
      if (rawValue == null) {
        out[field] = null;
        continue;
      }
      const asString = String(rawValue).trim();
      out[field] = asString.length > 0 ? asString : null;
    }
    return out;
  } catch (error) {
    logger.warn("inferMissingFields fallita", {
      message: error instanceof Error ? error.message : String(error),
    });
    return Object.fromEntries(compactMissing.map((field) => [field, null]));
  }
}

// ─── Deduzione obiettivo giornata dal testo narrativo ───────────────────────
export async function inferGiornataObiettivo(attivitaSvolta: string): Promise<string | null> {
  if (!attivitaSvolta?.trim()) return null;
  if (!AI_AVAILABLE) return null;

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  try { systemPrompt = getSetting("system_prompt") || systemPrompt; } catch { /* keep fallback */ }

  const prompt = `Leggi il seguente resoconto di una giornata di scavo archeologico e restituisci in 3-6 parole l'obiettivo principale della giornata (es. "pulizia superficiale settore nord", "scavo stratigrafico US 12", "rilievo fotogrammetrico", "documentazione tombe", ecc.).

TESTO:
"""
${attivitaSvolta.slice(0, 1500)}
"""

Rispondi SOLO con JSON: {"obiettivo": "..."}`;

  try {
    const raw = await callAI(prompt, 120, systemPrompt);
    const parsed = parseJsonResponse(raw);
    const val = parsed?.obiettivo;
    if (typeof val === "string" && val.trim()) return val.trim();
    return null;
  } catch {
    return null;
  }
}

// ─── Analisi e formattazione testo US ────────────────────────────────────────
export async function analizzaTestoUS(
  us: UnitaStratigrafica,
): Promise<{ schedaFormattata: string; campiMancanti: string[]; note: string }> {
  const tipo = us.tipo || "default";
  const campiAttesi = CAMPI_OBBLIGATORI_US[tipo] || CAMPI_OBBLIGATORI_US.default;

  const datiUS = `
CODICE US: ${us.codiceUS || "NON INSERITO"}
TIPO: ${us.tipo || "NON INSERITO"}
DEFINIZIONE: ${us.definizione || "NON INSERITA"}
DESCRIZIONE: ${us.descrizione || "NON INSERITA"}
INTERPRETAZIONE: ${us.interpretazione || "NON INSERITA"}
QUOTA S.L.M.: ${us.quota != null ? us.quota + " m" : "NON INSERITA"}
QUOTA DA PIANO CAMPAGNA: ${us.quotaPianoCampagna != null ? us.quotaPianoCampagna + " m" : "NON INSERITA"}
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

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  let schedaTemplate = "";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
    schedaTemplate = getSetting("scheda_us_template") || schedaTemplate;
  } catch (e) {
    console.warn("Impossibile leggere impostazioni AI dal DB, uso defaults:", e);
  }

  const prompt = `${schedaTemplate ? schedaTemplate + "\n\n" : ""}Analizza i dati di questa Unità Stratigrafica.

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
    const raw = await callAI(prompt, 3000, systemPrompt);
    const result = parseJsonResponse(raw);
    return {
      campiMancanti: Array.isArray(result.campiMancanti) ? (result.campiMancanti as string[]) : [],
      schedaFormattata: (result.schedaFormattata as string) || "",
      note: (result.note as string) || "",
    };
  } catch (err) {
    console.error("Errore analisi AI testo US:", err);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("analizzaTestoUS fallita", { err: msg });
    throw new Error(`Impossibile analizzare la scheda US con l'AI. Causa: ${msg}`);
  }
}

// ─── Analisi e formattazione report giornaliero ───────────────────────────────
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map(String);
  } catch { /* ignore */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function analizzaTestoGiornata(
  giornata: Giornata,
  usList: UnitaStratigrafica[],
  qcIssues: { livello: string; messaggio: string }[],
  mapSnapshotsSummary?: string,
): Promise<{ reportFormattato: string; campiMancanti: string[]; note: string }> {
  // Compatibilità: legge sia scavatori (nuovo) che operatori (legacy)
  const scavatori = parseJsonArray(giornata.scavatori).join(", ") || parseJsonArray(giornata.operatori).join(", ") || "NON INSERITI";
  const archeologi = parseJsonArray(giornata.archeologi).join(", ") || "NON INSERITI";

  const datiGiornata = `
DATA: ${giornata.data || "NON INSERITA"}
ORA INIZIO: ${giornata.oraInizio || "nd"}
ORA FINE: ${giornata.oraFine || "nd"}
ARCHEOLOGO COORDINATORE: ${giornata.archeologoCoordinatore || "NON INSERITO"}
ARCHEOLOGI: ${archeologi}
SCAVATORI: ${scavatori}
TOPOGRAFO: ${giornata.topografo || "assente"}
TIPO SCAVO: ${giornata.tipoScavo || "nd"}
ESCAVATORE: ${giornata.escavatore || "assente"}
OBIETTIVO GIORNATA: ${giornata.obiettivo || "non specificato"}
CONDIZIONI METEO: ${giornata.condMeteo || "NON INSERITE"}
SETTORE: ${giornata.settore || "NON INSERITO"}
ATTIVITÀ SVOLTA: ${giornata.attivitaSvolta || "NON INSERITA"}
NOTE OPERATIVE: ${giornata.note || "nessuna"}
  `.trim();

  const usRiassunto = usList.length > 0
    ? usList.map(us => `- ${us.codiceUS} (${us.tipo || "tipo nd"}): ${us.descrizione?.substring(0, 150) || "nessuna descrizione"}`).join("\n")
    : "Nessuna US documentata nella giornata";

  const problemiQC = qcIssues.length > 0
    ? qcIssues.map(i => `[${i.livello.toUpperCase()}] ${i.messaggio}`).join("\n")
    : "Nessuna criticità rilevata";
  const snapshotsText = mapSnapshotsSummary?.trim() || "Nessuno snapshot cartografico disponibile";

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  let giornaleFormat = "";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
    giornaleFormat = getSetting("giornale_format") || giornaleFormat;
  } catch (e) {
    console.warn("Impossibile leggere impostazioni AI dal DB, uso defaults:", e);
  }

  const prompt = `${giornaleFormat ? giornaleFormat + "\n\n" : ""}Analizza i dati di questa giornata di scavo.

DATI GIORNATA:
${datiGiornata}

UNITÀ STRATIGRAFICHE DOCUMENTATE:
${usRiassunto}

CRITICITÀ QC RILEVATE:
${problemiQC}

SNAPSHOT CARTOGRAFICI DISPONIBILI:
${snapshotsText}

CAMPI ATTESI PER UNA GIORNATA DI SCAVO:
${CAMPI_OBBLIGATORI_GIORNATA.map((c, i) => `${i + 1}. ${c}`).join("\n")}

COMPITO:
1. Identifica quali campi attesi sono MANCANTI o insufficienti.
   Restituisci array JSON dei campi mancanti.

2. Produci un diario giornaliero di scavo formattato e professionale con le sezioni:
   - INTESTAZIONE (data, cantiere, meteo, operatori)
   - ATTIVITÀ SVOLTE (descrivi le operazioni in modo fluido e tecnico, basandoti sulle note e sulle US documentate)
   - DOCUMENTAZIONE RACCOLTA (US documentate, materiali)
   - SINTESI CARTOGRAFICA (integra gli snapshot WebMap disponibili, se presenti)
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
    const raw = await callAI(prompt, 3000, systemPrompt);
    const result = parseJsonResponse(raw);
    return {
      campiMancanti: Array.isArray(result.campiMancanti) ? (result.campiMancanti as string[]) : [],
      reportFormattato: (result.reportFormattato as string) || "",
      note: (result.note as string) || "",
    };
  } catch (err) {
    console.error("Errore analisi AI testo giornata:", err);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("analizzaTestoGiornata fallita", { err: msg });
    throw new Error(`Impossibile analizzare il report giornaliero con l'AI. Causa: ${msg}`);
  }
}

// ─── Report settimanale personalizzato (modello custom) ──────────────────────

export async function generateReportSettimanaleCustom(input: {
  cantiere: import("@shared/schema").Cantiere;
  weekStart: string;
  weekEnd: string;
  entries: Array<{
    giornata: import("@shared/schema").Giornata;
    reportFormattato: string;
    usSchede?: import("@shared/schema").UnitaStratigrafica[];
  }>;
}): Promise<string> {
  if (!AI_AVAILABLE) throw new Error("Nessun provider AI configurato.");

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  try { systemPrompt = getSetting("system_prompt") || systemPrompt; } catch { /* keep default */ }

  // Raccoglie personale unico della settimana
  const tuttiScavatori = new Set<string>();
  const tuttiArcheologi = new Set<string>();
  for (const { giornata } of input.entries) {
    parseJsonArray(giornata.scavatori || giornata.operatori).forEach((o) => tuttiScavatori.add(o));
    parseJsonArray(giornata.archeologi).forEach((o) => tuttiArcheologi.add(o));
  }

  const riassuntoGiornate = input.entries.map(({ giornata, reportFormattato, usSchede }) => {
    const linee = [
      `--- ${giornata.data} ---`,
      giornata.oraInizio ? `Orario: ${giornata.oraInizio}${giornata.oraFine ? " – " + giornata.oraFine : ""}` : "",
      giornata.obiettivo ? `Obiettivo: ${giornata.obiettivo}` : "",
      giornata.tipoScavo ? `Tipo scavo: ${giornata.tipoScavo}${giornata.escavatore ? " – escavatore: " + giornata.escavatore : ""}` : "",
      giornata.condMeteo ? `Meteo: ${giornata.condMeteo}` : "",
      giornata.settore ? `Settore: ${giornata.settore}` : "",
      `\n${reportFormattato || giornata.attivitaSvolta || giornata.note || "nessuna nota"}`,
    ].filter(Boolean);

    if (usSchede && usSchede.length > 0) {
      linee.push("\nUNITÀ STRATIGRAFICHE DOCUMENTATE:");
      for (const us of usSchede) {
        const usLinee = [
          `  US ${us.codiceUS}${us.tipo ? ` (${us.tipo})` : ""}`,
          us.definizione ? `    Definizione: ${us.definizione}` : "",
          us.descrizione ? `    Descrizione: ${us.descrizione}` : "",
          us.interpretazione ? `    Interpretazione: ${us.interpretazione}` : "",
          us.epoca ? `    Epoca: ${us.epoca}` : "",
          us.datazione ? `    Datazione: ${us.datazione}` : "",
        ].filter(Boolean);
        linee.push(usLinee.join("\n"));
      }
    }

    return linee.join("\n");
  }).join("\n\n");

  // Legge il formato settimana dal DB se presente
  let weekFormat = "";
  try { weekFormat = getSetting("week_report_format") || ""; } catch { /* keep empty */ }

  const prompt = `${weekFormat ? weekFormat + "\n\n---\n\n" : ""}Stai scrivendo il corpo principale (sezione "Dettaglio delle attività") di un report settimanale di scavo.

CANTIERE: ${input.cantiere.nome}
LOCALITA': ${input.cantiere.localita}
COMMITTENTE: ${input.cantiere.committente || "nd"}
PERIODO: dal ${input.weekStart} al ${input.weekEnd}
ARCHEOLOGO COORDINATORE: ${input.entries[0]?.giornata.archeologoCoordinatore || "nd"}
ARCHEOLOGI: ${Array.from(tuttiArcheologi).join(", ") || "non specificati"}
SCAVATORI: ${Array.from(tuttiScavatori).join(", ") || "non specificati"}

DIARI GIORNALIERI (con unità stratigrafiche documentate):
${riassuntoGiornate}

Scrivi un testo fluido, tecnico e professionale che sintetizzi le attività svolte nel corso della settimana. Il testo deve:
- Essere in italiano, in terza persona, con il registro formale tipico dei report di scavo italiani
- Descrivere le operazioni giorno per giorno in modo sintetico ma preciso
- Citare esplicitamente le unità stratigrafiche documentate (es. "è stata messa in luce l'US 105, interpretata come strato di crollo...") quando disponibili
- Integrare interpretazioni stratigrafiche, datazioni e materiali significativi
- Concludere con una sintesi dello stato di avanzamento dello scavo e delle prospettive di indagine
- Non includere titoli, intestazioni o elenchi puntati — solo testo continuo
Lunghezza: 4-6 paragrafi.`;

  try {
    return await callAI(prompt, 1500, systemPrompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Impossibile generare il testo AI settimanale. Causa: ${msg}`);
  }
}

// ─── Estrazione campi giornata da testo (import DOCX) ───────────────────────

export type GiornataAIField = {
  value: string;
  confidence: "alta" | "media" | "bassa";
  source: string;
};

export type GiornataAIPreview = {
  data?: GiornataAIField;
  oraInizio?: GiornataAIField;
  oraFine?: GiornataAIField;
  settore?: GiornataAIField;
  condMeteo?: GiornataAIField;
  archeologoCoordinatore?: GiornataAIField;
  archeologi?: GiornataAIField;
  scavatori?: GiornataAIField;
  topografo?: GiornataAIField;
  escavatore?: GiornataAIField;
  tipoScavo?: GiornataAIField;
  obiettivo?: GiornataAIField;
  attivitaSvolta?: GiornataAIField;
  note?: GiornataAIField;
  campiMancanti: string[];
  testoOriginale: string;
};

export async function estraiCampiGiornataFromText(testo: string): Promise<GiornataAIPreview> {
  if (!AI_AVAILABLE) throw new Error("Nessun provider AI configurato.");
  if (!testo.trim()) throw new Error("Testo vuoto: impossibile estrarre i campi.");

  let systemPrompt = "Sei un assistente specializzato in archeologia professionale.";
  try { systemPrompt = getSetting("system_prompt") || systemPrompt; } catch { /* keep default */ }

  const prompt = `Analizza il testo seguente di un diario/giornale di scavo e estrai i campi della giornata.

TESTO:
${testo.slice(0, 8000)}

Per ogni campo trovato, indica:
- value: il valore estratto (stringa)
- confidence: "alta" se esplicitamente scritto, "media" se dedotto, "bassa" se incerto
- source: breve spiegazione di dove/come hai trovato il valore

I campi da estrarre sono:
- data: data della giornata (formato YYYY-MM-DD)
- oraInizio: ora di inizio lavori (formato HH:MM)
- oraFine: ora di fine lavori (formato HH:MM)
- settore: settore o area di scavo
- condMeteo: condizioni meteo (soleggiato, nuvoloso, variabile, pioggia, ventoso)
- archeologoCoordinatore: nome dell'archeologo coordinatore
- archeologi: archeologi presenti (nomi separati da virgola)
- scavatori: scavatori/operai presenti (nomi separati da virgola)
- topografo: nome del topografo (se presente)
- escavatore: tipo/marca di escavatore meccanico (se presente)
- tipoScavo: tipo di scavo (manuale, meccanico, misto)
- obiettivo: obiettivo della giornata
- attivitaSvolta: attività svolte durante la giornata
- note: note operative o osservazioni

Rispondi SOLO con questo JSON (nessun testo prima o dopo):
{
  "campiMancanti": ["campo1", "campo2"],
  "fields": {
    "data": { "value": "2024-03-15", "confidence": "alta", "source": "..." },
    "settore": { "value": "A1", "confidence": "media", "source": "..." }
  }
}`;

  const raw = await callAI(prompt, 2000, systemPrompt);
  const parsed = parseJsonResponse(raw);

  const fields = (parsed.fields || {}) as Record<string, { value?: string; confidence?: string; source?: string }>;
  const campiMancanti = Array.isArray(parsed.campiMancanti) ? (parsed.campiMancanti as string[]) : [];

  const GIORNATA_FIELD_KEYS = [
    "data", "oraInizio", "oraFine", "settore", "condMeteo",
    "archeologoCoordinatore", "archeologi", "scavatori", "topografo",
    "escavatore", "tipoScavo", "obiettivo", "attivitaSvolta", "note",
  ] as const;

  type GiornataFieldKey = typeof GIORNATA_FIELD_KEYS[number];

  const normalizeConf = (v: unknown): "alta" | "media" | "bassa" => {
    const s = String(v || "").toLowerCase();
    if (s === "alta" || s === "high") return "alta";
    if (s === "bassa" || s === "low") return "bassa";
    return "media";
  };

  const result: GiornataAIPreview = { campiMancanti, testoOriginale: testo };
  for (const key of GIORNATA_FIELD_KEYS) {
    const raw = fields[key];
    if (!raw || !String(raw.value || "").trim()) continue;
    result[key as GiornataFieldKey] = {
      value: String(raw.value).trim(),
      confidence: normalizeConf(raw.confidence),
      source: String(raw.source || "Deduzione automatica").trim(),
    };
  }

  return result;
}

// ─── QC relazioni stratigrafiche con AI ──────────────────────────────────────

export async function analizzaRelazioniQC(
  usList: UnitaStratigrafica[],
): Promise<string> {
  if (!AI_AVAILABLE) {
    throw new Error("Nessun provider AI configurato.");
  }

  let systemPrompt = "Sei un assistente specializzato in archeologia stratigrafica.";
  let qcRelazioniPrompt = "";
  try {
    systemPrompt = getSetting("system_prompt") || systemPrompt;
    qcRelazioniPrompt = getSetting("qc_relazioni_prompt") || "";
  } catch { /* keep defaults */ }

  // Build a compact summary of all US and their relation fields
  function parseSchedaDataAI(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }

  function codesFromRaw(raw: unknown): string {
    if (!raw) return "";
    if (Array.isArray(raw)) return raw.join(", ");
    const s = String(raw).trim();
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.join(", ");
    } catch { /* plain text */ }
    return s;
  }

  const rows = usList.map((us) => {
    const sd = parseSchedaDataAI(us.schedaData);
    return [
      `US: ${us.codiceUS}`,
      us.copre ? `  copre: ${codesFromRaw(us.copre)}` : "",
      us.coperto_da ? `  coperto_da: ${codesFromRaw(us.coperto_da)}` : "",
      sd.taglia ? `  taglia: ${codesFromRaw(sd.taglia)}` : "",
      sd.tagliatoDa ? `  tagliato_da: ${codesFromRaw(sd.tagliatoDa)}` : "",
      sd.riempie ? `  riempie: ${codesFromRaw(sd.riempie)}` : "",
      sd.riempitoDa ? `  riempita_da: ${codesFromRaw(sd.riempitoDa)}` : "",
      sd.siAppoggiaA ? `  si_appoggia_a: ${codesFromRaw(sd.siAppoggiaA)}` : "",
      sd.gliSiAppoggia ? `  gli_si_appoggia: ${codesFromRaw(sd.gliSiAppoggia)}` : "",
      us.si_lega_a ? `  si_lega_a: ${codesFromRaw(us.si_lega_a)}` : "",
      us.uguale_a ? `  uguale_a: ${codesFromRaw(us.uguale_a)}` : "",
      sd.posterioreA ? `  posteriore_a: ${codesFromRaw(sd.posterioreA)}` : "",
      sd.anterioreA ? `  anteriore_a: ${codesFromRaw(sd.anterioreA)}` : "",
    ].filter(Boolean).join("\n");
  });

  const prompt = `${qcRelazioniPrompt ? qcRelazioniPrompt + "\n\n" : ""}Analizza le seguenti relazioni stratigrafiche e individua eventuali incongruenze:\n\n${rows.join("\n\n")}`;

  try {
    const result = await callAI(prompt, 2000, systemPrompt);
    return result.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("analizzaRelazioniQC fallita", { err: msg });
    throw new Error(`Impossibile eseguire il QC AI delle relazioni. Causa: ${msg}`);
  }
}
