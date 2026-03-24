export type USModelFieldType = "text" | "textarea" | "date" | "select" | "multiselect";

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
export const ARCHEOSISTEMI_US_MODEL_KEY = "archeosistemi-us";

// Campi presenti nel form base della scheda US.
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
  description: "Scheda US estesa (impostazione ICCD 2021) con sequenza fisica e stratigrafica separate.",
  fields: [
    { key: "enteResponsabile", label: "Ente responsabile", type: "text", required: true, locked: true },
    { key: "annoScheda", label: "Anno", type: "text", required: true, locked: true },
    { key: "nCatalogoGenerale", label: "N. catalogo generale", type: "text", locked: true },
    { key: "nCatalogoInternazionale", label: "N. catalogo internazionale", type: "text", locked: true },
    { key: "ufficioMicTutela", label: "Ufficio MiC competente per tutela", type: "text", locked: true },
    {
      key: "identificativoRiferimento",
      label: "Identificativo saggio/edificio/struttura di riferimento",
      type: "text",
      locked: true,
    },
    { key: "localitaRiferimento", label: "Localita", type: "text", locked: true },
    { key: "area", label: "Area", type: "text", locked: true },
    { key: "saggio", label: "Saggio", type: "text", locked: true },
    {
      key: "ambienteUnitaFunzionale",
      label: "Settore/Ambiente",
      type: "text",
      locked: true,
      help: "Distingui settore (es. lettera) e ambiente funzionale (es. Aula Sud).",
    },
    { key: "posizione", label: "Posizione", type: "text", locked: true },
    { key: "quadrati", label: "Quadrato/i", type: "text", locked: true },

    {
      key: "naturaUs",
      label: "Natura US (NAT/ART)",
      type: "select",
      required: true,
      locked: true,
      options: ["NAT - Naturale", "ART - Artificiale"],
      help: "Indica l'agente principale che ha prodotto l'US.",
    },

    { key: "quotaNaturale", label: "Quote - naturale", type: "text", locked: true },
    { key: "quotaArtificiale", label: "Quote - artificiale", type: "text", locked: true },
    { key: "quotaPositiva", label: "Quote - positiva", type: "text", locked: true },
    { key: "quotaNegativa", label: "Quote - negativa", type: "text", locked: true },

    {
      key: "piante",
      label: "Piante",
      type: "text",
      locked: true,
      help: "Inserisci i riferimenti dei disegni (es. AQUD08P.01).",
    },
    {
      key: "sezioni",
      label: "Sezioni",
      type: "text",
      locked: true,
      help: "Inserisci i riferimenti delle sezioni (es. AQUD08S.02).",
    },
    {
      key: "fotografie",
      label: "Foto (F/D/DG)",
      type: "text",
      locked: true,
      help: "Indica tipo e numero: F (stampa), D (diapositiva), DG (digitale).",
    },

    {
      key: "criteriDistinzione",
      label: "Criteri di distinzione",
      type: "textarea",
      locked: true,
      help: "Spiega perche questa US e distinta da quelle adiacenti.",
    },

    {
      key: "naturaAzione",
      label: "Modo di formazione - natura dell'azione",
      type: "select",
      locked: true,
      options: [
        "Deposizione per sedimentazione",
        "Riporto",
        "Costruzione",
        "Crollo",
        "Scavo intenzionale",
        "Erosione",
        "Altro",
      ],
    },
    {
      key: "agenteFormazione",
      label: "Modo di formazione - agente",
      type: "select",
      locked: true,
      options: ["Naturale", "Antropico", "Misto", "Non determinato"],
    },
    {
      key: "durataFormazione",
      label: "Modo di formazione - durata",
      type: "select",
      locked: true,
      options: ["Simultaneo", "Protratto", "Non determinato"],
    },
    {
      key: "modoFormazione",
      label: "Modo di formazione - nota sintetica",
      type: "textarea",
      locked: true,
    },

    {
      key: "componentiInorganici",
      label: "Componenti geologici",
      type: "textarea",
      locked: true,
      help: "Matrice: argilla, sabbia, limo, ghiaia, ciottoli, pietre non lavorate.",
    },
    {
      key: "componentiOrganici",
      label: "Componenti organici",
      type: "textarea",
      locked: true,
      help: "Resti vegetali, carboni, ossa, semi, conchiglie, legno.",
    },
    {
      key: "componentiArtificiali",
      label: "Componenti artificiali",
      type: "textarea",
      locked: true,
      help: "Per i reperti usa soprattutto riferimenti alle schede materiali (sigla/ID), con stima quantita e dimensione.",
    },
    { key: "consistenza", label: "Consistenza", type: "text", locked: true },
    { key: "colore", label: "Colore", type: "text", locked: true },
    { key: "misure", label: "Misure", type: "text", locked: true },

    {
      key: "stratoConfigurazioneSuperficie",
      label: "Descrizione strato - configurazione superficie",
      type: "select",
      locked: true,
      options: ["Orizzontale", "Ondulata", "Inclinata", "Irregolare"],
    },
    {
      key: "stratoSpessoreVariazioni",
      label: "Descrizione strato - spessore e variazioni",
      type: "text",
      locked: true,
    },
    {
      key: "stratoDefinizioneConfine",
      label: "Descrizione strato - definizione confine inferiore",
      type: "select",
      locked: true,
      options: ["Netto", "Abbastanza netto", "Graduale", "Diffuso"],
    },
    {
      key: "stratoMorfologiaInclusi",
      label: "Descrizione strato - morfologia inclusi",
      type: "select",
      locked: true,
      options: ["Spigolo vivo", "Arrotondato", "Fluitato", "Misto"],
    },

    { key: "strutturaOrientamento", label: "Descrizione struttura - orientamento", type: "text", locked: true },
    {
      key: "strutturaTecnicaCostruttiva",
      label: "Descrizione struttura - tecnica costruttiva",
      type: "text",
      locked: true,
    },
    {
      key: "strutturaMaterialiLegante",
      label: "Descrizione struttura - materiali e legante",
      type: "text",
      locked: true,
    },
    {
      key: "strutturaMessaInOpera",
      label: "Descrizione struttura - sistema di messa in opera",
      type: "text",
      locked: true,
    },
    {
      key: "strutturaTracceLavorazione",
      label: "Descrizione struttura - tracce di lavorazione",
      type: "text",
      locked: true,
    },

    {
      key: "negativaFormaContorno",
      label: "Descrizione US negativa - forma contorno",
      type: "select",
      locked: true,
      options: ["Regolare", "Irregolare"],
    },
    {
      key: "negativaProfiloPareti",
      label: "Descrizione US negativa - profilo pareti",
      type: "select",
      locked: true,
      options: ["Rettilineo", "Convesso", "Concavo", "Misto"],
    },
    {
      key: "negativaTipoStacco",
      label: "Descrizione US negativa - stacco parete/riempimento",
      type: "select",
      locked: true,
      options: ["Netto", "Graduale"],
    },
    {
      key: "negativaProfiloFondo",
      label: "Descrizione US negativa - profilo fondo",
      type: "select",
      locked: true,
      options: ["Piatto", "Concavo", "In declivio", "Irregolare"],
    },

    { key: "taglia", label: "Sequenza fisica - taglia", type: "text", locked: true },
    { key: "tagliatoDa", label: "Sequenza fisica - tagliata da", type: "text", locked: true },
    { key: "riempie", label: "Sequenza fisica - riempie", type: "text", locked: true },
    { key: "riempitoDa", label: "Sequenza fisica - riempita da", type: "text", locked: true },
    { key: "siAppoggiaA", label: "Sequenza fisica - si appoggia a", type: "text", locked: true },
    { key: "gliSiAppoggia", label: "Sequenza fisica - gli si appoggia", type: "text", locked: true },
    {
      key: "ugualeAStratigrafico",
      label: "Sequenza fisica - uguale a / si lega a",
      type: "text",
      locked: true,
      help: "Usa questo campo per relazioni di equivalenza contemporanea.",
    },

    {
      key: "posterioreA",
      label: "Sequenza stratigrafica - posteriore a",
      type: "text",
      locked: true,
      help: "Registra solo le relazioni essenziali per la Harris Matrix.",
    },
    {
      key: "anterioreA",
      label: "Sequenza stratigrafica - anteriore a",
      type: "text",
      locked: true,
      help: "Registra solo le relazioni essenziali per la Harris Matrix.",
    },

    {
      key: "statoConservazione",
      label: "Stato di conservazione - valutazione",
      type: "select",
      locked: true,
      options: ["Ottimo", "Buono", "Discreto", "Mediocre", "Cattivo", "Pessimo"],
    },
    {
      key: "danneggiatoDa",
      label: "Stato di conservazione - modificazioni",
      type: "textarea",
      locked: true,
      help: "Tagliato da, sconvolto da, rimaneggiato da, alterato da, danneggiato da, mancante di.",
    },
    {
      key: "statoConservazionePercentuale",
      label: "Stato di conservazione - conservato per circa (%)",
      type: "text",
      locked: true,
    },

    {
      key: "osservazioniMetodoScavo",
      label: "Osservazioni sul metodo di scavo",
      type: "textarea",
      locked: true,
    },
    {
      key: "interpretazioneEstesa",
      label: "Interpretazione estesa",
      type: "textarea",
      locked: true,
      help: "Funzione, pertinenza a fase/periodo, modificazioni d'uso e motivazioni.",
    },
    {
      key: "elementiDatanti",
      label: "Elementi datanti (TPQ/TAQ)",
      type: "textarea",
      locked: true,
      help: "Indica anche se gli elementi sono residui o intrusivi.",
    },
    { key: "datazioneAssoluta", label: "Datazione assoluta (a.C./d.C.)", type: "text", locked: true },
    { key: "periodoFase", label: "Periodo/Fase", type: "text", locked: true },

    {
      key: "riferimentiTabelleMateriali",
      label: "Riferimenti schede materiali",
      type: "textarea",
      locked: true,
      help: "Inserisci ID/sigla delle schede materiali collegate. Nessuna scheda materiali viene generata qui automaticamente.",
    },
    {
      key: "datiQuantitativiReperti",
      label: "Dati quantitativi reperti (sintesi)",
      type: "textarea",
      locked: true,
      help: "Usa una sintesi e rimanda alle schede materiali per il dettaglio analitico.",
    },
    {
      key: "campionatureN",
      label: "Campionature",
      type: "textarea",
      locked: true,
      help: "Tipo campione e sigla.",
    },
    {
      key: "flottazioneTipo",
      label: "Flottazione",
      type: "select",
      locked: true,
      options: ["Non effettuata", "Integrale", "Parziale"],
    },
    { key: "flottazioneSecchi", label: "Flottazione - n. secchi", type: "text", locked: true },
    {
      key: "setacciaturaTipo",
      label: "Setacciatura",
      type: "select",
      locked: true,
      options: ["Non effettuata", "Integrale", "Parziale"],
    },
    { key: "setacciaturaSecchi", label: "Setacciatura - n. secchi", type: "text", locked: true },

    {
      key: "affidabilitaStratigrafica",
      label: "Affidabilita stratigrafica",
      type: "select",
      locked: true,
      options: ["Ottima", "Buona", "Media", "Scarsa", "Nulla"],
    },
    { key: "motivazioneAffidabilita", label: "Affidabilita - motivazione", type: "textarea", locked: true },

    { key: "direttoreScientifico", label: "Direttore scientifico", type: "text", locked: true },
    { key: "responsabileSettore", label: "Responsabile del settore", type: "text", locked: true },
    { key: "compilatoreScheda", label: "Compilatore", type: "text", locked: true },
    { key: "dataCompilazione", label: "Data compilazione", type: "date", locked: true },

    // Campi legacy mantenuti per compatibilita con vecchie compilazioni.
    { key: "prospetti", label: "Prospetti (legacy)", type: "text", locked: true },
    { key: "datazione", label: "Datazione (legacy)", type: "text", locked: true },
    { key: "fase", label: "Fase (legacy)", type: "text", locked: true },
    { key: "attivita", label: "Attivita (legacy)", type: "text", locked: true },
    {
      key: "responsabileScientificoIndagini",
      label: "Responsabile scientifico delle indagini (legacy)",
      type: "text",
      locked: true,
    },
    { key: "dataRilevamentoCampo", label: "Data rilevamento sul campo (legacy)", type: "date", locked: true },
    {
      key: "responsabileCompilazioneCampo",
      label: "Responsabile compilazione sul campo (legacy)",
      type: "text",
      locked: true,
    },
    { key: "dataRielaborazione", label: "Data rielaborazione (legacy)", type: "date", locked: true },
    { key: "responsabileRielaborazione", label: "Responsabile rielaborazione (legacy)", type: "text", locked: true },
  ],
};

export const ARCHEOSISTEMI_US_MODEL: USModelDefinition = {
  key: ARCHEOSISTEMI_US_MODEL_KEY,
  name: "Archeosistemi US",
  source: "base",
  locked: true,
  description: "Scheda US Archeosistemi con campi specifici del modello AR/S.",
  fields: [
    { key: "enteCompilatore", label: "Ente compilatore", type: "text", required: true, locked: true },
    { key: "nCatalogoGenerale", label: "N. catalogo generale", type: "text", locked: true },
    { key: "nCatalogoInternazionale", label: "N. catalogo internazionale", type: "text", locked: true },
    { key: "soprintendenza", label: "Soprintendenza", type: "text", locked: true },
    { key: "localita", label: "Localita", type: "text", locked: true },
    { key: "anno", label: "Anno", type: "text", locked: true },
    { key: "area", label: "Area", type: "text", locked: true },
    { key: "saggio", label: "Saggio", type: "text", locked: true },
    { key: "settori", label: "Settore/i", type: "text", locked: true },
    { key: "quadrati", label: "Quadrati/i", type: "text", locked: true },
    { key: "quoteSlm", label: "Quote s.l.m.", type: "text", locked: true },
    { key: "ambiente", label: "Ambiente", type: "text", locked: true },
    { key: "piante", label: "Piante", type: "text", locked: true },
    { key: "sezioni", label: "Sezioni", type: "text", locked: true },
    { key: "prospetti", label: "Prospetti", type: "text", locked: true },
    { key: "fotografie", label: "Foto", type: "text", locked: true },
    { key: "tabelleMateriali", label: "Tabelle materiali", type: "text", locked: true },

    {
      key: "naturaUs",
      label: "Natura US (N/ART)",
      type: "select",
      required: true,
      locked: true,
      options: ["N - Naturale", "ART - Artificiale"],
    },

    { key: "definizionePosizione", label: "Definizione e posizione", type: "textarea", locked: true },
    { key: "criteriDistinzione", label: "Criteri di distinzione", type: "textarea", locked: true },
    {
      key: "modoFormazioneOrigine",
      label: "Modo di formazione - origine",
      type: "select",
      locked: true,
      options: ["Artificiale", "Naturale"],
    },
    { key: "modoFormazione", label: "Modo di formazione - nota", type: "textarea", locked: true },

    {
      key: "componentiInorganici",
      label: "Componenti inorganici",
      type: "multiselect",
      locked: true,
      options: [
        "Materiale da costruzione",
        "Ceramica",
        "Metalli",
        "Vetro",
        "Ciottoli",
        "Ghiaia",
        "Altro",
      ],
    },
    { key: "componentiInorganiciAltro", label: "Componenti inorganici - altro", type: "text", locked: true },
    {
      key: "densitaInorganici",
      label: "Densita materiale inorganici",
      type: "select",
      locked: true,
      options: ["Fitta", "Media", "Rada"],
    },

    {
      key: "componentiOrganici",
      label: "Componenti organici",
      type: "multiselect",
      locked: true,
      options: ["Reperti faunistici", "Osso", "Corno", "Semi", "Frutti", "Carboni", "Legno", "Tessuti", "Altro"],
    },
    { key: "componentiOrganiciAltro", label: "Componenti organici - altro", type: "text", locked: true },
    {
      key: "densitaOrganici",
      label: "Densita materiale organici",
      type: "select",
      locked: true,
      options: ["Fitta", "Media", "Rada"],
    },

    { key: "consistenza", label: "Consistenza", type: "text", locked: true },
    { key: "colore", label: "Colore", type: "text", locked: true },
    { key: "misure", label: "Misure", type: "text", locked: true },
    {
      key: "statoConservazione",
      label: "Stato di conservazione",
      type: "select",
      locked: true,
      options: ["Intatto", "Buono", "Discreto", "Mediocre", "Pessimo"],
    },
    { key: "danneggiatoDa", label: "L'unita e stata danneggiata da", type: "text", locked: true },
    { key: "descrizioneEstesaArcheosistemi", label: "Descrizione estesa", type: "textarea", locked: true },

    {
      key: "metodoScavo",
      label: "Osservazioni metodo di scavo",
      type: "multiselect",
      locked: true,
      options: [
        "Unita scavata integralmente",
        "Unita scavata parzialmente",
        "Corrisponde ad altra unita in altro punto",
        "Asportata insieme ad altri strati",
      ],
    },
    { key: "metodoScavoAltro", label: "Metodo scavo - altro", type: "text", locked: true },
    { key: "interpretazioneEstesa", label: "Interpretazione", type: "textarea", locked: true },

    { key: "elementiDatanti", label: "Elementi datanti", type: "textarea", locked: true },
    {
      key: "elementiDatantiFonte",
      label: "Elementi datanti - fonte",
      type: "multiselect",
      locked: true,
      options: ["Sequenza stratigrafica", "Reperti diagnostici"],
    },
    { key: "datazione", label: "Datazione", type: "text", locked: true },
    { key: "periodoFase", label: "Periodo o fase", type: "text", locked: true },
    { key: "epoca", label: "Epoca", type: "text", locked: true },
    { key: "datiQuantitativiReperti", label: "Dati quantitativi dei reperti", type: "textarea", locked: true },
    { key: "campionatureN", label: "Campionature", type: "textarea", locked: true },
    {
      key: "flottazioneTipo",
      label: "Flottazione",
      type: "select",
      locked: true,
      options: ["Non effettuata", "Di tutta l'unita", "Parziale"],
    },
    { key: "flottazioneSecchi", label: "Flottazione - n.", type: "text", locked: true },
    {
      key: "setacciaturaTipo",
      label: "Setacciatura",
      type: "select",
      locked: true,
      options: ["Non effettuata", "Di tutta l'unita", "Parziale"],
    },
    { key: "setacciaturaSecchi", label: "Setacciatura - n.", type: "text", locked: true },

    {
      key: "affidabilitaStratigrafica",
      label: "Affidabilita stratigrafica",
      type: "select",
      locked: true,
      options: ["Nessuna", "Modesta", "Buona"],
    },
    { key: "responsabileSabap", label: "Responsabile SABAP-UMB", type: "text", locked: true },
    { key: "responsabileArcheosistemi", label: "Responsabile Archeosistemi", type: "text", locked: true },
    { key: "dataCompilazione", label: "Data compilazione", type: "date", locked: true },
  ],
};
export const BUILTIN_US_MODELS: USModelDefinition[] = [BASE_US_MODEL, ICCD_US_2021_MODEL, ARCHEOSISTEMI_US_MODEL];

export function isBuiltinUSModelKey(modelKey: string): boolean {
  return BUILTIN_US_MODELS.some((model) => model.key === modelKey);
}

export function getBuiltinUSModel(modelKey: string): USModelDefinition | undefined {
  return BUILTIN_US_MODELS.find((model) => model.key === modelKey);
}


