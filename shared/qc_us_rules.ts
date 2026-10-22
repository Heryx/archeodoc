// Registro configurabile delle regole di Controllo Qualità per le schede US.
// Ogni regola ha un livello di default (errore/avviso/info) che l'utente può
// riclassificare o disattivare dalle Impostazioni. Alcune regole espongono anche
// soglie numeriche modificabili.

export type QcLevel = "error" | "warning" | "info";
/** Livello scelto dall'utente per una regola: uno dei livelli oppure "off" per disattivarla. */
export type QcRuleLevel = QcLevel | "off";

export type QcThresholdDef = {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  /** Unità mostrata accanto al campo (es. "m", "caratteri"). */
  suffix?: string;
};

export type QcRuleDef = {
  id: string;
  label: string;
  description: string;
  categoria: "completezza" | "coerenza" | "nomenclatura" | "associazione";
  defaultLevel: QcLevel;
  thresholds?: QcThresholdDef[];
};

export const QC_US_RULES: QcRuleDef[] = [
  {
    id: "da_rivedere",
    label: "US da rivedere",
    description: "La scheda è stata importata automaticamente dall'elenco US ed è contrassegnata come «da rivedere e completare».",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "tipo_mancante",
    label: "Tipo non compilato",
    description: "Il campo «tipo» dell'US non è valorizzato.",
    categoria: "completezza",
    defaultLevel: "error",
  },
  {
    id: "descrizione_breve",
    label: "Descrizione assente o troppo breve",
    description: "La descrizione è vuota oppure più corta della lunghezza minima indicata.",
    categoria: "completezza",
    defaultLevel: "error",
    thresholds: [
      { key: "descrizione_min", label: "Lunghezza minima descrizione", default: 20, min: 0, max: 500, step: 5, suffix: "caratteri" },
    ],
  },
  {
    id: "definizione_mancante",
    label: "Definizione non compilata",
    description: "Il campo «definizione» dell'US non è valorizzato.",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "quota_mancante",
    label: "Quota non rilevata",
    description: "Non è indicata né la quota s.l.m. né quella da piano campagna.",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "settore_mancante",
    label: "Settore non indicato",
    description: "Il campo «settore» dell'US non è valorizzato.",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "codice_formato",
    label: "Formato codice US non conforme",
    description: "Il codice non rispetta il formato atteso (es. 001, US 001, T.001, SB 001).",
    categoria: "nomenclatura",
    defaultLevel: "warning",
  },
  {
    id: "codice_prefisso_incoerente",
    label: "Prefisso codice incoerente con il tipo",
    description: "Il prefisso scritto nel codice non corrisponde al tipo (es. tomba con prefisso US, o prefisso T su uno strato).",
    categoria: "nomenclatura",
    defaultLevel: "info",
  },
  {
    id: "foto_mancante",
    label: "Nessuna fotografia allegata",
    description: "All'US non è associata alcuna fotografia.",
    categoria: "associazione",
    defaultLevel: "warning",
  },
  {
    id: "disegno_mancante",
    label: "Nessun disegno/planimetria allegata",
    description: "All'US non è associato alcun disegno o planimetria (escluse le interfacce).",
    categoria: "associazione",
    defaultLevel: "info",
  },
  {
    id: "tomba_periodo_mancante",
    label: "Tomba senza periodo/datazione",
    description: "Per un'US di tipo tomba non è indicato il periodo iniziale o la datazione.",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "tomba_interpretazione_mancante",
    label: "Tomba senza interpretazione",
    description: "Per un'US di tipo tomba il campo «interpretazione» non è valorizzato.",
    categoria: "completezza",
    defaultLevel: "warning",
  },
  {
    id: "definizione_generica",
    label: "Definizione troppo generica",
    description: "La definizione è più corta della soglia indicata o contiene una formula generica (es. «nd», «da definire»).",
    categoria: "completezza",
    defaultLevel: "warning",
    thresholds: [
      { key: "definizione_generica_min", label: "Lunghezza minima definizione", default: 5, min: 0, max: 100, step: 1, suffix: "caratteri" },
    ],
  },
  {
    id: "interpretazione_generica",
    label: "Interpretazione troppo generica",
    description: "L'interpretazione è più corta della soglia indicata o contiene una formula generica.",
    categoria: "completezza",
    defaultLevel: "info",
    thresholds: [
      { key: "interpretazione_generica_min", label: "Lunghezza minima interpretazione", default: 5, min: 0, max: 100, step: 1, suffix: "caratteri" },
    ],
  },
  {
    id: "quota_slm_range",
    label: "Quota s.l.m. fuori range",
    description: "La quota s.l.m. è al di fuori dell'intervallo plausibile impostato.",
    categoria: "coerenza",
    defaultLevel: "warning",
    thresholds: [
      { key: "quota_slm_max", label: "Quota s.l.m. massima", default: 2000, min: -1000, max: 9000, step: 50, suffix: "m" },
      { key: "quota_slm_min", label: "Quota s.l.m. minima", default: -100, min: -1000, max: 9000, step: 50, suffix: "m" },
    ],
  },
  {
    id: "quota_pc_range",
    label: "Quota da piano campagna fuori range",
    description: "La quota da piano campagna è al di fuori dell'intervallo plausibile impostato.",
    categoria: "coerenza",
    defaultLevel: "warning",
    thresholds: [
      { key: "quota_pc_max", label: "Quota da p.c. massima", default: 50, min: -200, max: 500, step: 5, suffix: "m" },
      { key: "quota_pc_min", label: "Quota da p.c. minima", default: -30, min: -200, max: 500, step: 5, suffix: "m" },
    ],
  },
  {
    id: "rel_autoriferimento",
    label: "Relazione con auto-riferimento",
    description: "Un campo di relazione stratigrafica contiene il codice dell'US stessa.",
    categoria: "coerenza",
    defaultLevel: "warning",
  },
  {
    id: "rel_target_mancante",
    label: "Relazione verso US inesistente",
    description: "Un campo di relazione fa riferimento a un'US non presente nel cantiere.",
    categoria: "coerenza",
    defaultLevel: "warning",
  },
  {
    id: "rel_ciclo",
    label: "Ciclo nei rapporti stratigrafici",
    description:
      "Due o più US si contraddicono: seguendo i rapporti (copre, taglia, riempie, si appoggia, posteriore a) si torna alla stessa US.",
    categoria: "coerenza",
    defaultLevel: "error",
  },
  {
    id: "rel_inversa_mancante",
    label: "Relazione inversa mancante",
    description: "Una relazione stratigrafica non ha la corrispondente relazione inversa sull'US collegata.",
    categoria: "coerenza",
    defaultLevel: "info",
  },
];

export const QC_US_RULE_IDS = QC_US_RULES.map((r) => r.id);

/** Configurazione così come inviata dal client / salvata su disco (parziale). */
export type QcUsConfigInput = {
  levels?: Partial<Record<string, QcRuleLevel>>;
  thresholds?: Partial<Record<string, number>>;
};

/** Configurazione completa risolta con tutti i default applicati. */
export type QcUsConfig = {
  levels: Record<string, QcRuleLevel>;
  thresholds: Record<string, number>;
};

const VALID_LEVELS: QcRuleLevel[] = ["error", "warning", "info", "off"];

export function defaultQcUsConfig(): QcUsConfig {
  const levels: Record<string, QcRuleLevel> = {};
  const thresholds: Record<string, number> = {};
  for (const rule of QC_US_RULES) {
    levels[rule.id] = rule.defaultLevel;
    for (const th of rule.thresholds ?? []) {
      thresholds[th.key] = th.default;
    }
  }
  return { levels, thresholds };
}

/** Fonde una configurazione parziale con i default, scartando valori non validi. */
export function resolveQcUsConfig(input: QcUsConfigInput | null | undefined): QcUsConfig {
  const base = defaultQcUsConfig();
  if (!input || typeof input !== "object") return base;

  if (input.levels && typeof input.levels === "object") {
    for (const rule of QC_US_RULES) {
      const raw = input.levels[rule.id];
      if (raw && VALID_LEVELS.includes(raw)) {
        base.levels[rule.id] = raw;
      }
    }
  }

  if (input.thresholds && typeof input.thresholds === "object") {
    for (const rule of QC_US_RULES) {
      for (const th of rule.thresholds ?? []) {
        const raw = input.thresholds[th.key];
        if (typeof raw === "number" && Number.isFinite(raw)) {
          const clamped = Math.min(
            th.max ?? Number.POSITIVE_INFINITY,
            Math.max(th.min ?? Number.NEGATIVE_INFINITY, raw),
          );
          base.thresholds[th.key] = clamped;
        }
      }
    }
  }

  return base;
}
