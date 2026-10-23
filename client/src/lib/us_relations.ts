// Rapporti di una US: valori letti dalle colonne della US, con ripiego su schedaData.

export type RelationKind = "fisico" | "stratigrafico";

export type RelationDef = {
  /** chiave della colonna (e della voce in schedaData) */
  key: string;
  label: string;
  kind: RelationKind;
};

/**
 * Rapporti fisici: come le unita' sono in contatto (copre, taglia, riempie, si appoggia, si lega, uguale).
 * Rapporti stratigrafici: ordine temporale (posteriore a / anteriore a).
 */
export const RELATION_DEFS: RelationDef[] = [
  { key: "copre", label: "Copre", kind: "fisico" },
  { key: "coperto_da", label: "Coperto da", kind: "fisico" },
  { key: "taglia", label: "Taglia", kind: "fisico" },
  { key: "tagliatoDa", label: "Tagliato da", kind: "fisico" },
  { key: "riempie", label: "Riempie", kind: "fisico" },
  { key: "riempitoDa", label: "Riempito da", kind: "fisico" },
  { key: "siAppoggia", label: "Si appoggia a", kind: "fisico" },
  { key: "gliSiAppoggia", label: "Gli si appoggia", kind: "fisico" },
  { key: "si_lega_a", label: "Si lega a", kind: "fisico" },
  { key: "uguale_a", label: "Uguale a", kind: "fisico" },
  { key: "posterioreA", label: "Posteriore a", kind: "stratigrafico" },
  { key: "anterioreA", label: "Anteriore a", kind: "stratigrafico" },
];

// Alcune schede salvano in schedaData nomi diversi dalle colonne
const SCHEDA_ALIASES: Record<string, string[]> = {
  siAppoggia: ["siAppoggia", "siAppoggiaA"],
  uguale_a: ["uguale_a", "ugualeAStratigrafico"],
};

export function splitRelationCodes(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,;|\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseSchedaData(us: any): Record<string, unknown> {
  try {
    const sd = typeof us?.schedaData === "string" ? JSON.parse(us.schedaData || "{}") : us?.schedaData;
    return sd && typeof sd === "object" ? sd : {};
  } catch {
    return {};
  }
}

export type USRelationEntry = RelationDef & { codes: string[] };

/** Rapporti compilati, con i codici distinti (un codice = un rapporto). */
export function getUSRelations(us: any): USRelationEntry[] {
  const sd = parseSchedaData(us);
  const out: USRelationEntry[] = [];
  for (const def of RELATION_DEFS) {
    const seen = new Set<string>();
    const codes: string[] = [];
    const sources = [us?.[def.key], ...(SCHEDA_ALIASES[def.key] ?? [def.key]).map((k) => sd[k])];
    for (const src of sources) {
      for (const code of splitRelationCodes(src)) {
        const norm = code.toUpperCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        codes.push(code);
      }
    }
    if (codes.length) out.push({ ...def, codes });
  }
  return out;
}

export function countUSRelations(us: any): { fisici: number; stratigrafici: number; totale: number } {
  let fisici = 0;
  let stratigrafici = 0;
  for (const rel of getUSRelations(us)) {
    if (rel.kind === "fisico") fisici += rel.codes.length;
    else stratigrafici += rel.codes.length;
  }
  return { fisici, stratigrafici, totale: fisici + stratigrafici };
}
