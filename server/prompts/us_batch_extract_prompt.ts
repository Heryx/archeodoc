/**
 * Prompt per estrarre un array di US da testo libero (giornale di scavo, relazione, ecc.).
 * L'AI deve identificare i confini tra US e popolare i campi per ciascuna.
 */
export function buildUSBatchExtractPrompt(testo: string): string {
  return `
Sei un assistente specializzato in documentazione archeologica italiana (schede US).
Analizza il testo fornito — che può essere un giornale di scavo, una relazione o testo libero — e identifica tutte le Unità Stratigrafiche (US) menzionate.

Per ogni US estratta restituisci un oggetto con i campi compilabili. Il testo può essere non strutturato o diviso per giorni di scavo: raggruppa le informazioni relative alla stessa US anche se sparse nel testo.

Formato output obbligatorio — SOLO JSON valido, nessun testo fuori:
{
  "us": [
    {
      "codiceUS": "<stringa obbligatoria, es. 101 o US101>",
      "campi": {
        "nomeCampo": {
          "value": <string | number | boolean | string[]>,
          "confidence": "alta" | "media" | "bassa",
          "source": "<frase del testo da cui è stato estratto>"
        }
      }
    }
  ]
}

Regole OBBLIGATORIE — rispettale rigorosamente:
1) Includi SOLO US con codice identificabile nel testo (es. "US 101", "Strato 3", "US101", "unità 5").
2) NON INVENTARE MAI dati assenti. Includi solo campi esplicitamente deducibili dal testo.
3) NON completare, NON inferire, NON ipotizzare. Se un'informazione non è scritta nel testo, non metterla.
4) Usa confidence "bassa" se il valore è ambiguo o indiretto; "alta" solo se scritto esplicitamente.
5) Raggruppa menzioni multiple della stessa US in un unico oggetto (unisci le informazioni).
6) Per checkbox usa boolean true/false.
7) Per campi multiselect usa array di stringhe.
8) Il campo "codiceUS" deve essere la stringa esatta come appare nel testo (es. "101", "US 101").
9) Non dedurre relazioni stratigrafiche (copre, coperto_da, taglia, ecc.) a meno che non siano scritte esplicitamente.
10) Non aggiungere datazioni, periodi o interpretazioni senza menzione diretta nel testo.

Campi ammessi in "campi":
- Testo: definizione, descrizione, interpretazione, criteriDistinzione, modoFormazione, consistenza, colore, misure, statoConservazione, danneggiatoDa, datazione, epoca, periodoFase, datiQuantitativiReperti, settore, area, localita, anno, responsabileScavo
- Numerici: quota, quotaPianoCampagna
- Relazioni stratigrafiche (testo libero con codici US): coperto_da, copre, si_lega_a, uguale_a, gliSiAppoggia, siAppoggia, tagliatoDa, taglia, riempitoDa, riempie, sequenzaFisica
- Selezione: densitaInorganici ("Fitta"|"Media"|"Rada"), densitaOrganici ("Fitta"|"Media"|"Rada"), statoConservazione ("Intatto"|"Buono"|"Discreto"|"Mediocre"|"Pessimo"), flottazioneTipo ("Non effettuata"|"Di tutta l'unita"|"Parziale"), setacciaturaTipo ("Non effettuata"|"Di tutta l'unita"|"Parziale"), affidabilitaStratigrafica ("Nessuna"|"Modesta"|"Buona")
- Multiselect: componentiInorganici, componentiOrganici, metodoScavo, elementiDatantiFonte
- Checkbox: compMaterialeCostruzione, compCeramica, compMetalli, compVetro, compCiottoli, compGhiaia, compFauna, compOsso, compCorno, compSemi, compFrutti, compCarboni, compLegno, compTessuti, scavataIntegralmente, scavataParzialmente, asportataConAltriStrati

TESTO:
"""
${testo}
"""
  `.trim();
}
