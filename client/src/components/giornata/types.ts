export const meteOptions = [
  { value: "soleggiato", label: "Soleggiato" },
  { value: "nuvoloso", label: "Nuvoloso" },
  { value: "pioggia", label: "Pioggia" },
];

export type GiornataForm = {
  data: string;
  operatori: string;
  condMeteo: string;
  settore: string;
  note: string;
};

export type GiornataDeleteImpact = {
  usCollegateCount: number;
  allegatiCount: number;
  qcLogsCount: number;
};

export type GoogleSyncPreviewItem = {
  key: string;
  giornataData: string;
  codiceUS: string;
  usNumero: number;
  status: "new" | "existing";
  missingFields: string[];
  deterministic: Record<string, string | null>;
  ai: Record<string, string | null>;
  proposed: {
    tipo: string | null;
    definizione: string | null;
    descrizione: string | null;
    interpretazione: string | null;
    quota: string | null;
    settore: string | null;
    coperto_da: string | null;
    copre: string | null;
    si_lega_a: string | null;
    uguale_a: string | null;
    periodoIniziale: string | null;
    periodoFinale: string | null;
    materialiRinvenuti: string | null;
    campioni: string | null;
    schedaData: Record<string, string>;
  };
  existing?: {
    id: number;
    tipo: string | null;
    definizione: string | null;
    descrizione: string | null;
    interpretazione: string | null;
    quota: string | null;
    settore: string | null;
    coperto_da: string | null;
    copre: string | null;
    si_lega_a: string | null;
    uguale_a: string | null;
    periodoIniziale: string | null;
    periodoFinale: string | null;
    materialiRinvenuti: string | null;
    campioni: string | null;
    giornataId: number | null;
    schedaData: Record<string, string>;
  };
  rawText: string;
};

export type GoogleSyncPreview = {
  docId: string;
  giornate: number;
  usTotali: number;
  items: GoogleSyncPreviewItem[];
  warnings: string[];
};

export type GoogleSyncDecisionState = {
  action: "confirm" | "skip" | "edit";
  overrides: {
    tipo?: string | null;
    definizione?: string | null;
    descrizione?: string | null;
    interpretazione?: string | null;
    quota?: string | null;
    settore?: string | null;
    coperto_da?: string | null;
    copre?: string | null;
    si_lega_a?: string | null;
    uguale_a?: string | null;
    periodoIniziale?: string | null;
    periodoFinale?: string | null;
    materialiRinvenuti?: string | null;
    campioni?: string | null;
    schedaData?: Record<string, string | null>;
  };
};

export type GoogleSyncApplyReport = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
};

export const emptyForm: GiornataForm = {
  data: new Date().toISOString().split("T")[0],
  operatori: "",
  condMeteo: "",
  settore: "",
  note: "",
};

export function parseOperatori(operatoriRaw: string | null | undefined): string {
  if (!operatoriRaw) return "";
  try {
    const parsed = JSON.parse(operatoriRaw);
    if (Array.isArray(parsed)) return parsed.join(", ");
  } catch {
    // fallback a stringa grezza
  }
  return operatoriRaw;
}

export function operatoriToPayload(value: string): string | null {
  const cleaned = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

export function googleFieldLabel(key: string): string {
  const map: Record<string, string> = {
    tipo: "Tipo",
    definizione: "Definizione",
    descrizione: "Descrizione",
    interpretazione: "Interpretazione",
    quota: "Quota",
    settore: "Settore",
    coperto_da: "Coperto da",
    copre: "Copre",
    si_lega_a: "Si lega a",
    uguale_a: "Uguale a",
    periodoIniziale: "Periodo iniziale",
    periodoFinale: "Periodo finale",
    materialiRinvenuti: "Materiali rinvenuti",
    campioni: "Campioni",
    naturaUs: "Natura US",
    nCatalogoGenerale: "N. catalogo generale",
    nCatalogoInternazionale: "N. catalogo internazionale",
    areaEdificioStruttura: "Area",
    ambienteUnitaFunzionale: "Settore/Ambiente",
    piante: "Piante",
    sezioni: "Sezioni",
    fotografie: "Foto (F/D/DG)",
    criteriDistinzione: "Criteri di distinzione",
    naturaAzione: "Modo formazione - natura azione",
    agenteFormazione: "Modo formazione - agente",
    durataFormazione: "Modo formazione - durata",
    modoFormazione: "Modo formazione - nota",
    componentiInorganici: "Componenti geologici",
    componentiOrganici: "Componenti organici",
    componentiArtificiali: "Componenti artificiali",
    riempie: "Riempie",
    riempitoDa: "Riempita da",
    taglia: "Taglia",
    tagliatoDa: "Tagliata da",
    siAppoggiaA: "Si appoggia a",
    gliSiAppoggia: "Gli si appoggia",
    ugualeAStratigrafico: "Uguale a / Si lega a",
    posterioreA: "Posteriore a",
    anterioreA: "Anteriore a",
    colore: "Colore",
    consistenza: "Consistenza",
    inclusi: "Inclusi",
    misure: "Misure",
    stratoConfigurazioneSuperficie: "Strato - configurazione superficie",
    stratoSpessoreVariazioni: "Strato - spessore/variazioni",
    stratoDefinizioneConfine: "Strato - definizione confine",
    stratoMorfologiaInclusi: "Strato - morfologia inclusi",
    strutturaOrientamento: "Struttura - orientamento",
    strutturaTecnicaCostruttiva: "Struttura - tecnica costruttiva",
    strutturaMaterialiLegante: "Struttura - materiali/legante",
    strutturaMessaInOpera: "Struttura - messa in opera",
    strutturaTracceLavorazione: "Struttura - tracce lavorazione",
    negativaFormaContorno: "US negativa - forma contorno",
    negativaProfiloPareti: "US negativa - profilo pareti",
    negativaTipoStacco: "US negativa - tipo stacco",
    negativaProfiloFondo: "US negativa - profilo fondo",
    statoConservazioneValutazione: "Stato conservazione - valutazione",
    statoConservazioneModificazioni: "Stato conservazione - modificazioni",
    statoConservazionePercentuale: "Stato conservazione - percentuale",
    osservazioniMetodoScavo: "Osservazioni metodo scavo",
    interpretazioneEstesa: "Interpretazione estesa",
    elementiDatanti: "Elementi datanti",
    datazioneAssoluta: "Datazione assoluta",
    periodoFase: "Periodo/Fase",
    riferimentiTabelleMateriali: "Riferimenti schede materiali",
    datiQuantitativiReperti: "Dati quantitativi reperti",
    campionature: "Campionature",
    flottazione: "Flottazione",
    flottazioneSecchi: "Flottazione - n. secchi",
    setacciatura: "Setacciatura",
    setacciaturaSecchi: "Setacciatura - n. secchi",
    affidabilitaStratigrafica: "Affidabilita stratigrafica",
    motivazioneAffidabilita: "Motivazione affidabilita",
    direttoreScientifico: "Direttore scientifico",
    responsabileSettore: "Responsabile settore",
    compilatoreScheda: "Compilatore",
    dataCompilazione: "Data compilazione",
    note: "Note",
  };
  return map[key] || key;
}
