export type ReviewFieldSpec = { key: string; label: string; type: string; options?: string[] };

function fieldSpecLine(f: ReviewFieldSpec): string {
  const options = f.options?.length ? ` {opzioni: ${f.options.map((o) => JSON.stringify(o)).join(" | ")}}` : "";
  return `- ${f.key} — ${f.label} [${f.type}]${options}`;
}

type PresetInput = {
  /** Prompt di sistema e istruzioni preimpostate dall'utente (Impostazioni AI). */
  schedaTemplate?: string;
  /** Indicazioni del progetto lette da ai_config/ (contesto, schede, stile). */
  guidelines?: string;
};

function presetBlock({ schedaTemplate, guidelines }: PresetInput): string {
  const parts: string[] = [];
  if (guidelines?.trim()) {
    parts.push(`INDICAZIONI DEL PROGETTO (da rispettare):\n${guidelines.trim()}`);
  }
  if (schedaTemplate?.trim()) {
    parts.push(
      "ISTRUZIONI PREIMPOSTATE PER LE SCHEDE US (da rispettare per contenuto, terminologia e convenzioni; " +
        "il formato di risposta resta quello indicato più sotto):\n" +
        schedaTemplate.trim(),
    );
  }
  return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}

/**
 * Revisione dell'intera scheda US: errori di scrittura, miglioramento del testo, discordanze tra
 * i campi e nei rapporti stratigrafici. L'AI propone, non applica: ogni proposta è una modifica
 * completa di un campo, che l'utente può accettare, correggere a mano o rilanciare.
 */
export function buildUsReviewPrompt(input: PresetInput & {
  scheda: string;
  vicini: string;
  controlli: string;
  fields: ReviewFieldSpec[];
  istruzioni?: string;
  maxProposals: number;
}): string {
  const fieldLines = input.fields.map((f) => `- ${f.key} — ${f.label} [${f.type}]`).join("\n");
  const userBlock = input.istruzioni?.trim()
    ? `\nINDICAZIONI AGGIUNTIVE DELL'UTENTE PER QUESTA ANALISI (hanno la precedenza sul resto, ma non autorizzano a inventare dati):\n${input.istruzioni.trim()}\n`
    : "";

  return `
Sei un revisore esperto di schede di unità stratigrafica (US) di scavo archeologico italiano.
Analizza TUTTA la scheda qui sotto e proponi modifiche. Non applichi nulla: l'utente decide.
${presetBlock(input)}${userBlock}
COSA CONTROLLARE
1) Grammatica, ortografia, punteggiatura, maiuscole, refusi, frasi spezzate o ambigue (category "grammatica").
2) Miglioramento del testo: riscrivi descrizione, interpretazione, definizione e gli altri testi liberi in modo più chiaro e con terminologia stratigrafica corretta, SENZA cambiare i fatti né aggiungere dati che non ci sono (category "miglioramento").
3) Discordanze tra i campi: tipo / definizione / descrizione / interpretazione in contrasto; materiali, colore, consistenza o misure citati nella descrizione ma assenti o diversi nei campi (o viceversa); caselle di spunta non coerenti con il testo; periodi o datazione incoerenti con i rapporti; quote impossibili (category "coerenza").
4) Rapporti stratigrafici: contraddizioni logiche (una US che copre e insieme è coperta dalla stessa US, rapporti incompatibili con il tipo, ad es. un taglio descritto come strato), rapporti citati nel testo ma non nei campi o viceversa, rapporti inversi mancanti. Tieni conto dei CONTROLLI AUTOMATICI già eseguiti (category "rapporti").
5) Informazioni importanti mancanti: segnalale come "findings", NON proporre valori inventati (category "completezza").

REGOLE OBBLIGATORIE
- Rispondi SOLO con JSON valido, nessun testo fuori dal JSON.
- Non inventare nulla: ogni valore proposto deve derivare dai dati della scheda. Se per correggere serve un dato che non c'è, fai un "finding" e non una proposta.
- Una sola proposta per campo. Se un campo è già corretto non proporlo. Niente modifiche solo cosmetiche o di gusto.
- "newValue" è il valore COMPLETO del campo dopo la modifica (non un frammento, non un diff). Per i testi liberi riscrivi tutto il testo mantenendo ciò che è corretto.
- Campi [checkbox]: "newValue" è "true" oppure "false".
- Campi [select]: "newValue" è UNA delle opzioni indicate, scritta identica. Campi [multiselect]: "newValue" è un array JSON di opzioni indicate, es. ["Ceramica","Metalli"]; includi tutte quelle che restano valide, non solo le nuove.
- Campi dei rapporti (copre, coperto_da, taglia, tagliatoDa, riempie, riempitoDa, siAppoggiaA, gliSiAppoggia, si_lega_a, uguale_a, posterioreA, anterioreA): "newValue" è l'elenco completo dei codici US separati da virgola, usando solo codici esistenti nel cantiere. Proponi posterioreA/anterioreA solo se sono vuoti e deducibili dai rapporti fisici.
- Usa SOLO le chiavi elencate in CAMPI MODIFICABILI. Non toccare mai il codice US.
- "reason" in una frase, in italiano, dice cosa è stato corretto e perché.
- "severity": "alta" (errore o contraddizione), "media" (miglioramento utile), "bassa" (dettaglio).
- Al massimo ${input.maxProposals} proposte, le più importanti per prime.

FORMATO DI RISPOSTA
{
  "summary": "valutazione complessiva della scheda in 2-3 frasi",
  "proposals": [
    { "field": "<chiave>", "newValue": "<valore completo>", "category": "grammatica" | "miglioramento" | "coerenza" | "rapporti", "severity": "alta" | "media" | "bassa", "reason": "<motivo>" }
  ],
  "findings": [
    { "category": "coerenza" | "rapporti" | "completezza", "severity": "alta" | "media" | "bassa", "message": "<segnalazione>", "field": "<chiave opzionale>" }
  ]
}

CAMPI MODIFICABILI:
${fieldLines}

SCHEDA US (chiave — etichetta: valore):
${input.scheda}

US COLLEGATE (codice | tipo | definizione):
${input.vicini || "(nessuna US collegata)"}

CONTROLLI AUTOMATICI SUI RAPPORTI:
${input.controlli || "(nessuna anomalia rilevata)"}
  `.trim();
}

/** Rilancio di una singola proposta: l'utente chiede di rifarla con un'indicazione sua. */
export function buildUsProposalRevisePrompt(input: PresetInput & {
  codiceUS: string;
  field: ReviewFieldSpec;
  currentValue: string;
  proposedValue: string;
  reason?: string;
  userPrompt: string;
  contesto: string;
}): string {
  const isRelation = /^(copre|coperto_da|taglia|tagliatoDa|riempie|riempitoDa|siAppoggiaA|gliSiAppoggia|si_lega_a|uguale_a|posterioreA|anterioreA)$/.test(
    input.field.key,
  );
  const typeRule =
    input.field.type === "checkbox"
      ? '"newValue" è "true" oppure "false".'
      : input.field.type === "select"
        ? '"newValue" è UNA delle opzioni indicate, scritta identica.'
        : input.field.type === "multiselect"
          ? '"newValue" è un array JSON di opzioni tra quelle indicate.'
          : isRelation
        ? '"newValue" è l\'elenco completo dei codici US separati da virgola, solo codici esistenti.'
        : '"newValue" è il testo completo del campo dopo la modifica.';

  return `
Sei un revisore esperto di schede di unità stratigrafica (US) di scavo archeologico italiano.
Devi rifare UNA proposta di modifica per un campo della scheda ${input.codiceUS}, seguendo l'indicazione dell'utente.
${presetBlock(input)}
REGOLE
- Rispondi SOLO con JSON valido: { "newValue": "...", "reason": "<una frase>" }.
- ${typeRule}
- Non inventare dati che non compaiono nella scheda o nell'indicazione dell'utente.
- Mantieni ciò che nel testo attuale è corretto; applica l'indicazione dell'utente, che ha la precedenza sulla proposta precedente.

CAMPO: ${fieldSpecLine(input.field).slice(2)}
VALORE ATTUALE NELLA SCHEDA:
"""
${input.currentValue || "(vuoto)"}
"""
PROPOSTA PRECEDENTE${input.reason ? ` (motivo: ${input.reason})` : ""}:
"""
${input.proposedValue || "(vuota)"}
"""
INDICAZIONE DELL'UTENTE:
${input.userPrompt.trim()}

CONTESTO DELLA SCHEDA:
${input.contesto}
  `.trim();
}
