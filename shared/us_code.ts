/** Prefissi riconosciuti nei codici US (US, Tomba, Sepoltura/Scheletro, Fossa). */
const PREFIX_RE = /^(US|T|SB|SF)\.?\s*(\d{1,4})$/i;
const BARE_RE = /^\d{1,4}$/;

export type TombaCodeStyle = "T.001" | "T 001";

/** Impostazioni di progetto per la visualizzazione e il controllo dei codici US. */
export type ProjectCodeSettings = {
  /** Come mostrare il prefisso delle tombe nell'anteprima. */
  tombaStyle: TombaCodeStyle;
  /** Segnala nel QC prefissi incoerenti con il tipo (es. tomba con "US"). */
  flagPrefixMismatch: boolean;
};

export const DEFAULT_PROJECT_CODE_SETTINGS: ProjectCodeSettings = {
  tombaStyle: "T.001",
  flagPrefixMismatch: true,
};

export function resolveProjectCodeSettings(input: unknown): ProjectCodeSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<ProjectCodeSettings>;
  return {
    tombaStyle: raw.tombaStyle === "T 001" ? "T 001" : "T.001",
    flagPrefixMismatch:
      typeof raw.flagPrefixMismatch === "boolean"
        ? raw.flagPrefixMismatch
        : DEFAULT_PROJECT_CODE_SETTINGS.flagPrefixMismatch,
  };
}

/** Prefisso atteso in base al tipo di US (null = US generica). */
export function expectedUsPrefix(tipo: string | null | undefined): "US" | "T" {
  return (tipo ?? "").trim().toLowerCase() === "tomba" ? "T" : "US";
}

export function parseUsCode(codice: string): { prefix: string | null; number: string } | null {
  const raw = (codice ?? "").trim();
  if (BARE_RE.test(raw)) return { prefix: null, number: raw };
  const m = raw.match(PREFIX_RE);
  return m ? { prefix: m[1].toUpperCase(), number: m[2] } : null;
}

/**
 * Codice per l'anteprima: se c'è già un prefisso lo rispetta, altrimenti lo
 * deduce dal tipo (Tomba -> T, il resto -> US). Codici non riconosciuti
 * restano invariati.
 */
export function formatUsCode(
  codice: string,
  tipo: string | null | undefined,
  tombaStyle: "T.001" | "T 001" = "T.001",
): string {
  const parsed = parseUsCode(codice);
  if (!parsed) return codice;
  const prefix = parsed.prefix ?? expectedUsPrefix(tipo);
  if (prefix === "T") return tombaStyle === "T.001" ? `T.${parsed.number}` : `T ${parsed.number}`;
  return `${prefix} ${parsed.number}`;
}

/** Segnala prefisso incoerente con il tipo (es. tomba con prefisso US). */
export function usPrefixMismatch(codice: string, tipo: string | null | undefined): string | null {
  const parsed = parseUsCode(codice);
  if (!parsed || !parsed.prefix) return null;
  const isTomba = (tipo ?? "").trim().toLowerCase() === "tomba";
  if (isTomba && parsed.prefix === "US") return "tomba con prefisso US";
  if (!isTomba && parsed.prefix === "T") return "prefisso T su un'US non di tipo tomba";
  return null;
}
