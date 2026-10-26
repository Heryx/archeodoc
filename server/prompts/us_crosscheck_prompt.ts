export type CrosscheckFieldSpec = { key: string; label: string; hint: string };

/**
 * Prompt per estrarre, da documentazione esterna alla scheda US (schede materiali, antropologia,
 * campioni...), i dati utili a verificare/completare le schede US già esistenti.
 */
export function buildUSCrosscheckPrompt(input: {
  testo: string;
  fields: CrosscheckFieldSpec[];
  note?: string;
}): string {
  const fieldLines = input.fields.map((f) => `- ${f.key} — ${f.label}: ${f.hint}`).join("\n");
  const noteBlock = input.note?.trim()
    ? `\nIndicazioni dell'utente sul documento: ${input.note.trim()}\n`
    : "";

  return `
Sei un assistente specializzato in documentazione archeologica italiana.
Il testo seguente è un estratto di documentazione di scavo (ad esempio schede/tabelle dei materiali, dei reperti osteologici, dei campioni). NON è una scheda US.
Il tuo compito è individuare, per ciascuna US citata, le informazioni che servirebbero a completare o verificare la relativa scheda US.
${noteBlock}
Formato output obbligatorio — SOLO JSON valido, nessun testo fuori:
{
  "us": [
    {
      "codiceUS": "<codice come scritto nel documento, es. 101 o US 101>",
      "campi": {
        "nomeCampo": {
          "value": <string | boolean | number>,
          "confidence": "alta" | "media" | "bassa",
          "source": "<breve citazione o riferimento (max 15 parole)>",
          "pagina": <numero di pagina da [[Pagina N]] in cui compare>
        }
      }
    }
  ]
}

Regole OBBLIGATORIE:
1) NON INVENTARE: includi solo ciò che è scritto nel testo. Nessuna deduzione o ipotesi.
2) Attribuisci i dati alla US corretta. In una tabella con colonna US/SU/Unità, ogni riga riguarda la US indicata in quella riga. Se non è chiaro a quale US appartiene un dato, omettilo.
3) Per le componenti (checkbox compFauna, compOsso, ecc.) usa true solo se nel testo compaiono reperti di quel tipo in quella US. Non usare mai false.
4) Per "datiQuantitativiReperti" scrivi una sintesi breve e quantitativa se i numeri sono nel testo (es. "Fauna: 3 denti di ovicaprino, 2 frammenti di costa"). Non sommare né stimare quantità non scritte.
5) Un reperto che non rientra in nessun checkbox (es. industria litica, malacofauna) va descritto in datiQuantitativiReperti e, se opportuno, nel campo "Altro" pertinente.
6) Usa solo i campi elencati qui sotto. Ometti i campi senza informazioni; ometti le US senza alcun dato utile.
7) Il testo è diviso con marcatori [[Pagina N]]: indica sempre la pagina in "pagina".

Campi ammessi in "campi":
${fieldLines}

TESTO:
"""
${input.testo}
"""
  `.trim();
}
