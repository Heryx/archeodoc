export type USModelFieldType = "text" | "textarea" | "date" | "select";

export type USModelField = {
  key: string;
  label: string;
  type: USModelFieldType;
  required?: boolean;
  locked?: boolean;
  options?: string[];
  help?: string;
};

export type USModelDefinition = {
  key: string;
  name: string;
  source: "base" | "ministeriale" | "custom";
  locked: boolean;
  description?: string;
  fields: USModelField[];
};

export const BASE_US_MODEL_KEY = "base-us";
export const ICCD_US_2021_MODEL_KEY = "iccd-us-2021";

// Campi gia presenti nel form US "base" dell'app.
export const BASE_US_FIELD_KEYS = new Set<string>([
  "codiceUS",
  "tipo",
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "settore",
  "giornataId",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "periodoIniziale",
  "periodoFinale",
  "materialiRinvenuti",
  "campioni",
]);

export const BASE_US_MODEL: USModelDefinition = {
  key: BASE_US_MODEL_KEY,
  name: "US base ArcheoDoc",
  source: "base",
  locked: true,
  description: "Modello semplificato per compilazione US.",
  fields: [],
};

export const ICCD_US_2021_MODEL: USModelDefinition = {
  key: ICCD_US_2021_MODEL_KEY,
  name: "ICCD US 2021",
  source: "ministeriale",
  locked: true,
  description: "Scheda US per rilevamento sul campo (impostazione ICCD, 2021).",
  fields: [
    { key: "enteResponsabile", label: "ENTE RESPONSABILE", type: "text", required: true, locked: true },
    { key: "annoScheda", label: "ANNO", type: "text", required: true, locked: true },
    { key: "ufficioMicTutela", label: "UFFICIO MiC COMPETENTE PER TUTELA", type: "text", locked: true },
    {
      key: "identificativoRiferimento",
      label: "IDENTIFICATIVO DEL SAGGIO/EDIFICIO/STRUTTURA/DEPOSIZIONE FUNERARIA DI RIFERIMENTO",
      type: "text",
      locked: true,
    },
    { key: "localitaRiferimento", label: "LOCALITA", type: "text", locked: true },
    { key: "areaEdificioStruttura", label: "AREA/EDIFICIO/STRUTTURA", type: "text", locked: true },
    { key: "saggio", label: "SAGGIO", type: "text", locked: true },
    { key: "ambienteUnitaFunzionale", label: "AMBIENTE/UNITA FUNZIONALE", type: "text", locked: true },
    { key: "posizione", label: "POSIZIONE", type: "text", locked: true },
    { key: "quadrati", label: "QUADRATO/I", type: "text", locked: true },
    { key: "quotaNaturale", label: "QUOTE - NATURALE", type: "text", locked: true },
    { key: "quotaArtificiale", label: "QUOTE - ARTIFICIALE", type: "text", locked: true },
    { key: "quotaPositiva", label: "QUOTE - POSITIVA", type: "text", locked: true },
    { key: "quotaNegativa", label: "QUOTE - NEGATIVA", type: "text", locked: true },
    { key: "piante", label: "PIANTE", type: "text", locked: true },
    { key: "prospetti", label: "PROSPETTI", type: "text", locked: true },
    { key: "sezioni", label: "SEZIONI", type: "text", locked: true },
    { key: "fotografie", label: "FOTOGRAFIE", type: "text", locked: true },
    { key: "riferimentiTabelleMateriali", label: "RIFERIMENTI TABELLE MATERIALI", type: "text", locked: true },
    { key: "criteriDistinzione", label: "CRITERI DI DISTINZIONE", type: "textarea", locked: true },
    {
      key: "modoFormazione",
      label: "MODO DI FORMAZIONE",
      type: "select",
      locked: true,
      options: ["Naturale", "Artificiale", "Misto", "Non determinato"],
    },
    { key: "componentiInorganici", label: "COMPONENTI - INORGANICI", type: "textarea", locked: true },
    { key: "componentiOrganici", label: "COMPONENTI - ORGANICI", type: "textarea", locked: true },
    { key: "consistenza", label: "CONSISTENZA", type: "text", locked: true },
    { key: "colore", label: "COLORE", type: "text", locked: true },
    { key: "misure", label: "MISURE", type: "text", locked: true },
    { key: "statoConservazione", label: "STATO DI CONSERVAZIONE", type: "text", locked: true },
    { key: "posterioreA", label: "SEQUENZA STRATIGRAFICA - POSTERIORE A", type: "text", locked: true },
    { key: "gliSiAppoggia", label: "SEQUENZA STRATIGRAFICA - GLI SI APPOGGIA", type: "text", locked: true },
    { key: "siAppoggiaA", label: "SEQUENZA STRATIGRAFICA - SI APPOGGIA A", type: "text", locked: true },
    { key: "anterioreA", label: "SEQUENZA STRATIGRAFICA - ANTERIORE A", type: "text", locked: true },
    { key: "tagliatoDa", label: "SEQUENZA STRATIGRAFICA - TAGLIATO DA", type: "text", locked: true },
    { key: "taglia", label: "SEQUENZA STRATIGRAFICA - TAGLIA", type: "text", locked: true },
    { key: "riempitoDa", label: "SEQUENZA STRATIGRAFICA - RIEMPITO DA", type: "text", locked: true },
    { key: "riempie", label: "SEQUENZA STRATIGRAFICA - RIEMPIE", type: "text", locked: true },
    { key: "osservazioni", label: "OSSERVAZIONI", type: "textarea", locked: true },
    { key: "datazione", label: "DATAZIONE", type: "text", locked: true },
    { key: "fase", label: "FASE", type: "text", locked: true },
    { key: "attivita", label: "ATTIVITA", type: "text", locked: true },
    { key: "elementiDatanti", label: "ELEMENTI DATANTI", type: "textarea", locked: true },
    { key: "datiQuantitativiReperti", label: "DATI QUANTITATIVI DEI REPERTI", type: "textarea", locked: true },
    { key: "campionature", label: "CAMPIONATURE", type: "textarea", locked: true },
    { key: "flottazione", label: "FLOTTAZIONE", type: "text", locked: true },
    { key: "setacciatura", label: "SETACCIATURA", type: "text", locked: true },
    {
      key: "affidabilitaStratigrafica",
      label: "AFFIDABILITA STRATIGRAFICA",
      type: "select",
      locked: true,
      options: ["Alta", "Media", "Bassa", "Non determinata"],
    },
    {
      key: "responsabileScientificoIndagini",
      label: "RESPONSABILE SCIENTIFICO DELLE INDAGINI",
      type: "text",
      locked: true,
    },
    { key: "dataRilevamentoCampo", label: "DATA RILEVAMENTO SUL CAMPO", type: "date", locked: true },
    {
      key: "responsabileCompilazioneCampo",
      label: "RESPONSABILE COMPILAZIONE SUL CAMPO",
      type: "text",
      locked: true,
    },
    { key: "dataRielaborazione", label: "DATA RIELABORAZIONE", type: "date", locked: true },
    { key: "responsabileRielaborazione", label: "RESPONSABILE RIELABORAZIONE", type: "text", locked: true },
  ],
};

export const BUILTIN_US_MODELS: USModelDefinition[] = [BASE_US_MODEL, ICCD_US_2021_MODEL];

export function isBuiltinUSModelKey(modelKey: string): boolean {
  return BUILTIN_US_MODELS.some((m) => m.key === modelKey);
}

export function getBuiltinUSModel(modelKey: string): USModelDefinition | undefined {
  return BUILTIN_US_MODELS.find((m) => m.key === modelKey);
}
