export function buildUsExtractPrompt(text: string): string {
  return `
Sei un assistente archeologico specializzato in stratigrafia.
Analizza il testo di giornale di scavo e individua TUTTE le Unita Stratigrafiche (US) menzionate.

Restituisci SOLO JSON valido in questo formato:
{
  "us": [
    {
      "codiceUS": "US 001",
      "numeroUS": 1,
      "tipo": "strato",
      "definizione": "strato di crollo",
      "descrizione": "testo sintetico",
      "interpretazione": "testo sintetico",
      "quota": 123.45,
      "quotaPianoCampagna": -0.35,
      "settore": "A1",
      "coperto_da": "US 010",
      "copre": "US 002",
      "si_lega_a": "US 011",
      "uguale_a": "US 003",
      "periodoIniziale": "età romana",
      "periodoFinale": "tardoantico",
      "materialiRinvenuti": "ceramica, carboni",
      "campioni": "campione C1",
      "schedaData": {
        "colore": "bruno",
        "consistenza": "compatta"
      },
      "confidence": "alta",
      "source": "frase del testo da cui è stata dedotta"
    }
  ]
}

Regole obbligatorie:
1) Non inventare US non presenti nel testo.
2) Se nel testo compare solo un numero (es. "US 12"), valorizza anche "numeroUS": 12.
3) Se un campo non è deducibile, omettilo (non usare stringhe tipo "non noto").
4) "quota" è quota s.l.m.; "quotaPianoCampagna" è quota relativa al piano di campagna.
5) "schedaData" deve contenere solo coppie chiave/valore stringa.
6) "confidence" deve essere: "alta" | "media" | "bassa".
7) Rispondi SOLO con JSON, senza markdown.

TESTO:
"""
${text}
"""
  `.trim();
}

