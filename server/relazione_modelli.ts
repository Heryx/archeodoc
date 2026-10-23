import type { Cantiere } from "@shared/schema";
import type { PmNode } from "./relazione_export";

// Modelli di elaborato: documenti-tipo con titoli, testo fisso e blocchi IA (prompt + fonti).
// Nel testo fisso si possono usare {{titolo}}, {{cantiere}}, {{codice}}, {{committente}}, {{localita}}.

export type ModelloBuiltin = { id: string; nome: string; descrizione: string; contenuto: PmNode };

const FONTI_BASE = {
  us: "nessuna", usIds: [], usSettore: "", usPeriodo: "",
  giornate: "nessuna", da: "", a: "",
  periodi: false, reperti: false, saggi: false,
};

const h = (level: number, text: string): PmNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text: string): PmNode => ({ type: "paragraph", content: [{ type: "text", text }] });

function ai(prompt: string, fonti: Partial<typeof FONTI_BASE>): PmNode {
  return {
    type: "aiBlock",
    attrs: { prompt, useAI: true, fonti: { ...FONTI_BASE, ...fonti }, stato: "vuoto" },
    content: [{ type: "paragraph" }],
  };
}

const doc = (...content: PmNode[]): PmNode => ({ type: "doc", content });

const PREMESSA = p(
  "La presente relazione illustra le attività archeologiche svolte presso {{cantiere}} ({{localita}}), commissionate da {{committente}} (codice intervento {{codice}}).",
);

export const MODELLI_BUILTIN: ModelloBuiltin[] = [
  {
    id: "builtin:scavo",
    nome: "Relazione di scavo",
    descrizione: "Premessa, metodologia, attività, sequenza stratigrafica, materiali, fasi e conclusioni.",
    contenuto: doc(
      h(1, "{{titolo}}"),
      h(2, "Premessa"),
      PREMESSA,
      h(2, "Metodologia di intervento"),
      ai("Descrivi in un paragrafo la metodologia di intervento: tipo di scavo (manuale, meccanico, sorveglianza), sistema di documentazione e personale impiegato, ricavandoli dal giornale.", { giornate: "tutte" }),
      h(2, "Svolgimento delle attività"),
      ai("Ricostruisci in ordine cronologico lo svolgimento delle attività di cantiere, raggruppando le giornate per attività o area e indicando le date.", { giornate: "documento" }),
      h(2, "Sequenza stratigrafica"),
      ai("Descrivi la sequenza stratigrafica dalla più recente alla più antica, citando le US con i rapporti fisici tra loro (copre, taglia, riempie, si lega a).", { us: "tutte", periodi: true }),
      h(2, "Materiali"),
      ai("Riassumi i materiali e i reperti rinvenuti, indicando l'US di provenienza. Se non sono presenti reperti, scrivilo in una frase.", { us: "tutte", reperti: true }),
      h(2, "Fasi e interpretazione"),
      ai("Illustra le fasi individuate, dalla più antica alla più recente, con le principali evidenze di ciascuna e l'interpretazione dove presente nelle schede.", { us: "tutte", periodi: true }),
      h(2, "Conclusioni"),
      ai("Scrivi le conclusioni in un solo paragrafo breve: esito dell'intervento, evidenze di maggiore rilievo e stato finale dell'area. Nessuna formula enfatica.", { us: "tutte", giornate: "tutte", periodi: true }),
    ),
  },
  {
    id: "builtin:periodica",
    nome: "Relazione periodica (settimanale / mensile)",
    descrizione: "Attività del periodo del documento e US documentate in quei giorni.",
    contenuto: doc(
      h(1, "{{titolo}}"),
      h(2, "Dati generali di cantiere"),
      PREMESSA,
      h(2, "Attività svolte"),
      ai("Descrivi le attività svolte nel periodo in ordine cronologico, con le date, in prosa sobria.", { giornate: "documento" }),
      h(2, "Evidenze stratigrafiche"),
      ai("Descrivi le evidenze stratigrafiche emerse nel periodo, citando le US con il codice. Se nel periodo non sono state assegnate nuove US, scrivilo.", { giornate: "documento", us: "nessuna" }),
    ),
  },
  {
    id: "builtin:sorveglianza",
    nome: "Relazione di sorveglianza archeologica",
    descrizione: "Esito della sorveglianza: attività, assenza o presenza di evidenze, conclusioni.",
    contenuto: doc(
      h(1, "{{titolo}}"),
      h(2, "Premessa"),
      PREMESSA,
      h(2, "Attività di sorveglianza"),
      ai("Descrivi le attività di sorveglianza svolte durante le opere in corso, con le date e le aree interessate.", { giornate: "tutte" }),
      h(2, "Evidenze archeologiche"),
      ai("Indica se sono emerse evidenze archeologiche; in caso affermativo descrivile citando le US, altrimenti dichiara l'assenza di evidenze.", { us: "tutte", giornate: "tutte" }),
      h(2, "Conclusioni"),
      ai("Scrivi le conclusioni della sorveglianza in 3-4 righe: esito e indicazioni per la prosecuzione dei lavori, solo se desumibili dai dati.", { us: "tutte", giornate: "tutte" }),
    ),
  },
];

// Segnaposto {{…}} sostituiti nel testo fisso al momento della creazione del documento
export function applyPlaceholders(node: PmNode, values: Record<string, string>): PmNode {
  const clone: PmNode = { ...node };
  if (typeof clone.text === "string") {
    clone.text = clone.text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in values ? values[key] : m));
  }
  if (clone.content) clone.content = clone.content.map((c) => applyPlaceholders(c, values));
  return clone;
}

export function placeholderValues(cantiere: Cantiere, titolo: string): Record<string, string> {
  return {
    titolo,
    cantiere: cantiere.nome,
    codice: cantiere.codice,
    committente: cantiere.committente || "la committenza",
    localita: cantiere.localita,
  };
}

// Un modello salvato conserva prompt e fonti dei blocchi IA ma non il testo già generato
export function clearAiBlocks(node: PmNode): PmNode {
  if (node.type === "aiBlock") {
    return { ...node, attrs: { ...node.attrs, stato: "vuoto" }, content: [{ type: "paragraph" }] };
  }
  return node.content ? { ...node, content: node.content.map(clearAiBlocks) } : node;
}

export function findBuiltin(id: string): ModelloBuiltin | undefined {
  return MODELLI_BUILTIN.find((m) => m.id === id);
}
