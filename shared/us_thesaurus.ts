export const US_TIPO_THESAURUS = [
  "strato",
  "struttura",
  "interfaccia",
  "tomba",
  "riempimento",
  "buca",
  "altro",
] as const;

export type USTipoCanonical = (typeof US_TIPO_THESAURUS)[number];
export type USThesaurusConfig = {
  tipo?: string[];
  definizione?: string[];
};

const TIPO_SYNONYMS: Record<string, USTipoCanonical> = {
  strato: "strato",
  deposito: "strato",
  layer: "strato",

  struttura: "struttura",
  muro: "struttura",
  muratura: "struttura",
  usm: "struttura",
  wall: "struttura",

  interfaccia: "interfaccia",
  taglio: "interfaccia",
  superficie: "interfaccia",
  interface: "interfaccia",

  tomba: "tomba",
  sepoltura: "tomba",
  burial: "tomba",

  riempimento: "riempimento",
  riempitura: "riempimento",
  colmatura: "riempimento",
  fill: "riempimento",

  buca: "buca",
  fossa: "buca",
  bucadipalo: "buca",
  fossadipalo: "buca",
  pit: "buca",

  altro: "altro",
  altra: "altro",
  other: "altro",
};

const DEFINIZIONI_BY_TIPO: Record<USTipoCanonical, readonly string[]> = {
  strato: [
    "strato di abbandono",
    "strato di riporto",
    "strato di crollo",
    "strato di livellamento",
    "strato di frequentazione",
    "strato di preparazione",
    "strato di humus",
    "strato naturale",
  ],
  struttura: [
    "muro in pietra",
    "muro in laterizi",
    "fondazione in pietrame",
    "pavimentazione in cocciopesto",
    "pavimentazione in battuto",
    "canaletta di drenaggio",
    "soglia in pietra",
    "struttura in elevato",
  ],
  interfaccia: [
    "interfaccia di taglio",
    "interfaccia di erosione",
    "interfaccia di crollo",
    "superficie di calpestio",
    "superficie di preparazione",
  ],
  tomba: [
    "fossa funeraria",
    "riempimento di fossa funeraria",
    "copertura di sepoltura",
    "deposizione funeraria",
  ],
  riempimento: [
    "riempimento di fossa",
    "riempimento di trincea",
    "riempimento di canaletta",
    "colmatura di taglio",
  ],
  buca: [
    "buca di palo",
    "fossa di scarico",
    "taglio di fondazione",
    "fossa di servizio",
  ],
  altro: [
    "deposito indeterminato",
    "struttura indeterminata",
    "us non classificata",
  ],
};

const DEFINIZIONE_SYNONYMS: Record<string, string> = {
  humus: "strato di humus",
  terrenovegetale: "strato di humus",
  riporto: "strato di riporto",
  crollo: "strato di crollo",
  livellamento: "strato di livellamento",
  frequentazione: "strato di frequentazione",
  preparazione: "strato di preparazione",
  natural: "strato naturale",
  naturalestrato: "strato naturale",

  muro: "muro in pietra",
  muratura: "muro in pietra",
  fondazione: "fondazione in pietrame",

  taglio: "interfaccia di taglio",
  erosione: "interfaccia di erosione",

  fossafuneraria: "fossa funeraria",
  sepoltura: "deposizione funeraria",

  riempimentofossa: "riempimento di fossa",
  riempimentotrincea: "riempimento di trincea",

  bucadipalo: "buca di palo",
  fossadipalo: "buca di palo",
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeByVocabulary(value: unknown, vocabulary?: string[]): string | null {
  if (value == null) return null;
  const raw = normalizeLabel(String(value));
  if (!raw) return null;
  if (!Array.isArray(vocabulary) || vocabulary.length === 0) return null;

  const token = normalizeToken(raw);
  const matched = vocabulary.find((item) => normalizeToken(item) === token);
  return matched || null;
}

export function normalizeUsTipo(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const token = normalizeToken(raw);
  if (!token) return null;

  const canonical = TIPO_SYNONYMS[token];
  if (canonical) return canonical;

  if (US_TIPO_THESAURUS.includes(raw.toLowerCase() as USTipoCanonical)) {
    return raw.toLowerCase();
  }

  return normalizeLabel(raw).toLowerCase();
}

export function normalizeUsTipoWithVocabulary(value: unknown, vocabulary?: string[]): string | null {
  const fromVocabulary = normalizeByVocabulary(value, vocabulary);
  if (fromVocabulary) return fromVocabulary;
  return normalizeUsTipo(value);
}

export function usDefinizioneSuggestions(tipo?: unknown, vocabulary?: string[]): string[] {
  if (Array.isArray(vocabulary) && vocabulary.length > 0) {
    return Array.from(new Set(vocabulary.map((item) => normalizeLabel(item)).filter(Boolean)));
  }

  const canonicalTipo = normalizeUsTipo(tipo) as USTipoCanonical | null;
  if (canonicalTipo && DEFINIZIONI_BY_TIPO[canonicalTipo]) {
    return [...DEFINIZIONI_BY_TIPO[canonicalTipo]];
  }

  return Array.from(
    new Set(
      Object.values(DEFINIZIONI_BY_TIPO)
        .flatMap((values) => values)
        .slice(0, 30),
    ),
  );
}

export function normalizeUsDefinizione(value: unknown, tipo?: unknown): string | null {
  if (value == null) return null;
  const raw = normalizeLabel(String(value));
  if (!raw) return null;

  const token = normalizeToken(raw);
  if (!token) return null;

  const canonicalFromAlias = DEFINIZIONE_SYNONYMS[token];
  if (canonicalFromAlias) return canonicalFromAlias;

  const suggestions = usDefinizioneSuggestions(tipo);
  const directMatch = suggestions.find((item) => normalizeToken(item) === token);
  if (directMatch) return directMatch;

  return raw;
}

export function normalizeUsDefinizioneWithVocabulary(
  value: unknown,
  tipo?: unknown,
  vocabulary?: string[],
): string | null {
  const fromVocabulary = normalizeByVocabulary(value, vocabulary);
  if (fromVocabulary) return fromVocabulary;
  return normalizeUsDefinizione(value, tipo);
}

export function normalizeUsTopLevelFields<T extends { tipo?: unknown; definizione?: unknown }>(
  payload: T,
  thesaurus?: USThesaurusConfig,
): T {
  const normalizedTipo = normalizeUsTipoWithVocabulary(payload.tipo, thesaurus?.tipo);
  const normalizedDefinizione = normalizeUsDefinizioneWithVocabulary(
    payload.definizione,
    normalizedTipo ?? payload.tipo,
    thesaurus?.definizione,
  );

  return {
    ...payload,
    tipo: normalizedTipo,
    definizione: normalizedDefinizione,
  };
}

export const __test = {
  normalizeToken,
  normalizeLabel,
  normalizeByVocabulary,
  TIPO_SYNONYMS,
  DEFINIZIONE_SYNONYMS,
};
