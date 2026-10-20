/**
 * Prontuario archeologico per la compilazione delle schede US (standard ICCD 2021).
 * Contenuto trascritto da "prontuario_schede_us.xlsx" fornito dall'utente: vocabolario
 * controllato e note tecniche per uniformare la terminologia usata nelle schede US/USM
 * e nell'elenco US. Puramente informativo: non vincola i valori salvati nel database,
 * viene mostrato come guida di consultazione nella pagina Thesaurus.
 */

export type ProntuarioEntry = {
  /** Prima colonna della tabella (voce/campo/categoria di riferimento). */
  voce: string;
  /** Seconda colonna (termine standard consigliato). */
  termine: string;
  /** Terza colonna (definizione, uso o descrizione). */
  descrizione: string;
  /** Quarta colonna (nota tecnica, significato archeologico o esempio pratico). */
  nota: string;
};

export type ProntuarioSubsection = {
  titolo: string;
  /** Intestazioni delle 4 colonne come nel file originale. */
  colonne: [string, string, string, string];
  voci: ProntuarioEntry[];
};

export type ProntuarioSezione = {
  key: string;
  titolo: string;
  introduzione: string;
  utilizzoCampo: string;
  schedaRiferimento: string;
  sottosezioni: ProntuarioSubsection[];
};

export const PRONTUARIO_TITOLO = "Prontuario archeologico per la compilazione delle schede US";
export const PRONTUARIO_SOTTOTITOLO = "Standard ICCD 2021";
export const PRONTUARIO_INTRODUZIONE =
  "Strumento di riferimento rapido per archeologi sul campo e in laboratorio, per uniformare il vocabolario scientifico usato nella redazione delle schede di Unita Stratigrafica (US e USM) secondo le normative ICCD.";

export const PRONTUARIO_SEZIONI: ProntuarioSezione[] = [
  {
    key: "strati",
    titolo: "US positive — Strati e depositi (terreno)",
    introduzione: "Vocabolario vincolato e controllato per la descrizione dei terreni.",
    utilizzoCampo: "Descrizione fisica della terra e dei componenti.",
    schedaRiferimento: "Scheda US (unita positiva)",
    sottosezioni: [
      {
        titolo: "1. Consistenza e colore (parametri pedologici)",
        colonne: ["Voce scheda", "Termine standard", "Definizione / uso", "Note tecniche ICCD"],
        voci: [
          { voce: "Consistenza", termine: "Non coerente", descrizione: "Particelle completamente sciolte (sabbie asciutte, ghiaie fini)", nota: "Utilizzare solo questi 5 termini standard per la consistenza" },
          { voce: "Consistenza", termine: "Friabile", descrizione: "Si sbriciola facilmente sotto una leggera pressione delle dita", nota: "Utilizzare solo questi 5 termini standard per la consistenza" },
          { voce: "Consistenza", termine: "Compatto", descrizione: "Coeso, richiede uno sforzo moderato o uno strumento per essere scavato", nota: "Utilizzare solo questi 5 termini standard per la consistenza" },
          { voce: "Consistenza", termine: "Duro", descrizione: "Molto resistente, richiede piccone o mazzetta per la rottura", nota: "Utilizzare solo questi 5 termini standard per la consistenza" },
          { voce: "Consistenza", termine: "Plastico", descrizione: "Terreno argilloso umido, modellabile senza rompersi", nota: "Utilizzare solo questi 5 termini standard per la consistenza" },
          { voce: "Colore", termine: "Codici Munsell", descrizione: "Es. 10YR 4/3 (Brown)", nota: "Misurare preferibilmente a umidita standard ed annotare variazioni cromatiche" },
        ],
      },
      {
        titolo: "2. Definizione dei confini (contatto inferiore)",
        colonne: ["Voce scheda", "Termine standard", "Spessore fascia di transizione", "Significato archeologico"],
        voci: [
          { voce: "Confini", termine: "Netto", descrizione: "Fascia di transizione < 0.5 cm", nota: "Passaggio immediato tra azioni stratigrafiche distinte" },
          { voce: "Confini", termine: "Abbastanza netto", descrizione: "Fascia di transizione tra 0.5 e 2.5 cm", nota: "Passaggio ben definito tra depositi" },
          { voce: "Confini", termine: "Graduale", descrizione: "Fascia di transizione tra 2.5 e 6 cm", nota: "Transizione lenta, possibile interscambio o erosione" },
          { voce: "Confini", termine: "Diffuso", descrizione: "Fascia di transizione tra 6 e 13 cm", nota: "Difficile distinzione fisica immediata" },
          { voce: "Confini", termine: "Molto diffuso", descrizione: "Fascia di transizione > 13 cm", nota: "Lenta diagenesi o rimescolamento naturale/antropico" },
        ],
      },
      {
        titolo: "3. Struttura, morfologia dei componenti e drenaggio",
        colonne: ["Proprieta US", "Termini standard consigliati", "Descrizione ed effetti", "Significato di formazione"],
        voci: [
          { voce: "Struttura suolo", termine: "A grumi, granulare, a blocchi, prismatica, colonnare, lamellare", descrizione: "Aggregazione spaziale delle particelle di terreno", nota: "Aiuta a identificare processi pedogenetici ed evolutivi" },
          { voce: "Morfologia componenti", termine: "Arrotondati, Fluitati", descrizione: "Superfici usurate o smussate dall'acqua", nota: "Indicano trasporto idrico, ruscellamento o dilavamento (giacitura secondaria)" },
          { voce: "Morfologia componenti", termine: "A spigolo vivo, Fratture vive", descrizione: "Superfici non usurate e taglienti", nota: "Distruzione violenta e immediata, deposizione in situ (giacitura primaria)" },
          { voce: "Drenaggio esterno", termine: "Nullo, Medio, Rapido, Molto rapido", descrizione: "Capacita di evacuazione superficiale delle acque", nota: "Pendenza e impermeabilita dello strato" },
          { voce: "Drenaggio interno", termine: "Nullo, Molto lento, Medio, Rapido, Molto rapido", descrizione: "Capacita di percolazione attraverso lo spessore", nota: "Presenza di falde o livelli impermeabili nel deposito" },
        ],
      },
    ],
  },
  {
    key: "strutture",
    titolo: "US positive — Opere murarie e strutture",
    introduzione: "Terminologia per opere murarie (USM), tecniche costruttive, malte e laterizi.",
    utilizzoCampo: "Descrizione di muri, fondazioni e paramenti.",
    schedaRiferimento: "Scheda USM / US (strutture)",
    sottosezioni: [
      {
        titolo: "1. Tipologia e materiali costruttivi (modello USM 2021)",
        colonne: ["Categoria", "Termine standard / dettaglio", "Caratteristiche da descrivere", "Uso nella compilazione"],
        voci: [
          { voce: "Tipologia struttura", termine: "Lignea, litica, in argilla cruda, laterizia, cementizia, mista", descrizione: "Natura principale del materiale strutturale", nota: "Da indicare nel campo Definizione o Tecnica costruttiva" },
          { voce: "Laterizi (mattoni)", termine: "Crudi, Cotti, Cotti al sole, Semifusi", descrizione: "Grado di cottura dei componenti laterizi", nota: "Compilare le apposite caselle del modello USM 2021" },
          { voce: "Laterizi (forma)", termine: "Triangolari, Quadrati, Rettangolari, Spezzoni, Circolari", descrizione: "Forma geometrica del laterizio impiegato", nota: "Fornisce informazioni sul modulo e sulla produzione" },
          { voce: "Elementi litici", termine: "Tufo, Calcare, Arenaria, Marmo, ecc.", descrizione: "Natura mineralogica delle pietre", nota: "Da descrivere accuratamente (es. pietre sbozzate, squadrate, bugnate)" },
          { voce: "Lavorazione pietra", termine: "Sfaldati, Spaccati, Sbozzati, Squadrati, Spianati, Bugnati", descrizione: "Trattamento superficiale dei conci di pietra", nota: "Indica l'uso di scalpello, sega o martellina" },
          { voce: "Legante (malte)", termine: "Calce, Pozzolana, Sabbia, Elementi organici", descrizione: "Componenti della miscela legante", nota: "Descrivere consistenza, colore della malta e dimensioni degli inclusi" },
          { voce: "Finiture paramento", termine: "A filo, Arretrata, Coprente, Lisciatura (piana/concava), Stilatura", descrizione: "Trattamento dei giunti e della faccia a vista", nota: "Es. stilatura doppia o stilatura dei giunti di malta" },
        ],
      },
    ],
  },
  {
    key: "tagli",
    titolo: "US negative — Interfacce e superfici di asporto",
    introduzione: "Le US negative non hanno volume ne reperti: rappresentano esclusivamente superfici di taglio o usura.",
    utilizzoCampo: "Descrizione geometrica e morfologia dei tagli.",
    schedaRiferimento: "Scheda US (unita negativa)",
    sottosezioni: [
      {
        titolo: "1. Vocabolario per il campo \"Definizione\" di US negative",
        colonne: ["Definizione standard", "Oggetto del taglio", "Caratteristiche fisiche", "Esempio archeologico"],
        voci: [
          { voce: "Taglio di fossa", termine: "Fossa per rifiuti, per derrate, buca di palo", descrizione: "Asporto di terreno intenzionale", nota: "Taglio della fossa US 14 (T14)" },
          { voce: "Taglio di tomba", termine: "Fossa funeraria per inumazione o cremazione", descrizione: "Profilo rettangolare o sub-rettangolare", nota: "Taglio della tomba sannitica di IV sec. a.C." },
          { voce: "Sbancamento", termine: "Grandi rimozioni di terreno per terrazzamenti o fondazioni", descrizione: "Superficie ad ampia estensione", nota: "Sbancamento dell'area Nord per la costruzione del muro" },
          { voce: "Rasatura", termine: "Cimatura intenzionale o crollo di un muro", descrizione: "Interfaccia negativa che taglia le USM", nota: "Superficie di rasatura del paramento murario USM 5" },
          { voce: "Usura", termine: "Effetto del calpestio o passaggio di carri", descrizione: "Superficie consumata ed erosa casualmente", nota: "Usura stradale o piano di calpestio battuto" },
          { voce: "Trincea / fossato", termine: "Canale difensivo, di conduttura o spoliazione", descrizione: "Sviluppo prevalentemente longitudinale", nota: "Trincea di spoliazione delle fondazioni romane" },
          { voce: "Apertura", termine: "Varchi di porte, finestre o passaggi", descrizione: "Interruzione localizzata in una struttura USM", nota: "Apertura della porta nel muro occidentale" },
        ],
      },
      {
        titolo: "2. Parametri geometrici per la descrizione del taglio",
        colonne: ["Elemento da descrivere", "Terminologia standard consigliata", "Descrizione geometrica", "Note metriche obbligatorie"],
        voci: [
          { voce: "Contorno superiore", termine: "Rettangolare, Ovale, Irregolare", descrizione: "Definisce la sagoma planimetrica del taglio", nota: "Specificare se gli angoli sono NETTI o ARROTONDATI" },
          { voce: "Margini", termine: "Regolari, Irregolari", descrizione: "Definisce la linea di bordo del taglio", nota: "Fornire l'orientamento generale dell'asse maggiore" },
          { voce: "Profilo pareti", termine: "Rettilineo, Convesso, Concavo, A profilo interrotto", descrizione: "Definisce la sezione verticale del taglio", nota: "Fornire il tipo di stacco col margine superiore (netto, graduale, ecc.)" },
          { voce: "Profilo fondo", termine: "Piatto, Concavo, In declivio, Irregolare, Ad angolo acuto", descrizione: "Definisce la base del taglio", nota: "Specificare se in declivio e in quale direzione pende" },
          { voce: "Pendenza pareti", termine: "Verticale, Inclinata", descrizione: "Inclinazione rispetto all'asse orizzontale", nota: "Es. pareti verticali, pareti svasate verso l'alto" },
          { voce: "Misure (metri)", termine: "Misure massime e minime registrate", descrizione: "Lunghezza, larghezza e profondita max/min", nota: "Le misure vanno sempre espresse in METRI (es. 2.13 x 0.65 m)" },
        ],
      },
    ],
  },
  {
    key: "relazioni",
    titolo: "Relazioni stratigrafiche",
    introduzione: "La corretta sequenza stratigrafica depura i rapporti fisici superflui per ricavare i nessi cronologici diretti.",
    utilizzoCampo: "Costruzione del Matrix di Harris ed eliminazione delle ridondanze.",
    schedaRiferimento: "Sequenza stratigrafica (errata corrige)",
    sottosezioni: [
      {
        titolo: "1. Rapporti stratigrafici sulla scheda US (errata corrige ICCD)",
        colonne: ["Campo scheda US", "Definizione logica", "Rapporto temporale", "Esempio pratico (Matrix)"],
        voci: [
          { voce: "Posteriore a (X)", termine: "Termine POST: l'unita in esame si e formata DOPO l'unita X", descrizione: "L'US in esame e piu RECENTE di X", nota: "Se l'US 3 copre l'US 4, nella scheda di 3 si scrive 'Posteriore a 4'" },
          { voce: "Anteriore a (Y)", termine: "Termine ANTE: l'unita in esame si e formata PRIMA dell'unita Y", descrizione: "L'US in esame e piu ANTICA di Y", nota: "Se l'US 3 e coperta dall'US 2, nella scheda di 3 si scrive 'Anteriore a 2'" },
          { voce: "Criterio di semplificazione", termine: "Scartare i rapporti fisici ridondanti o indiretti", descrizione: "Mostra solo i nessi cronologici DIRETTI", nota: "Se 1 copre 2 e 2 copre 3, nella scheda di 3 si scrive solo 'Posteriore a 2' (non 1)" },
          { voce: "Reciprocita obbligatoria", termine: "Ogni rapporto espresso su una scheda deve essere simmetrico", descrizione: "Consistenza della banca dati", nota: "Se nella scheda 3 indico 'taglia 1', nella scheda 1 devo segnare 'tagliato da 3'" },
        ],
      },
      {
        titolo: "2. Relazioni fisiche standard e contatti",
        colonne: ["Relazione fisica", "Relazione reciproca", "Tipo di US coinvolte", "Applicazione tipica"],
        voci: [
          { voce: "Uguale a (1 = 2)", termine: "Uguale a (2 = 1)", descrizione: "Parti separate dello stesso strato", nota: "Lembi dello stesso strato interrotti da una fossa" },
          { voce: "Si lega a", termine: "Si lega a", descrizione: "Strutture murarie contemporanee", nota: "Muri in ammorsatura costruiti nello stesso momento" },
          { voce: "Gli si appoggia", termine: "Si appoggia a", descrizione: "Muro successivo che poggia su uno esistente", nota: "Relazione cronologica tra paramenti murari" },
          { voce: "Coperto da", termine: "Copre", descrizione: "Strato superiore su strato inferiore", nota: "Deposizione regolare di strati di terreno" },
          { voce: "Tagliato da", termine: "Taglia", descrizione: "Fossa (negativa) che interseca uno strato (positivo)", nota: "Lo scavo di una tomba o di una buca di palo" },
          { voce: "Riempito da", termine: "Riempie", descrizione: "Terra (positiva) che colma una fossa (negativa)", nota: "Il riempimento della tomba rispetto alla fossa" },
        ],
      },
    ],
  },
];
