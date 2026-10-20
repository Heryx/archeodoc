/** Confronto deterministico (nessun LLM) tra un nome di placeholder e un elenco di campi noti,
 * per suggerire eventuali duplicati concettuali (es. "descr" vs "descrizione"). */

export type FieldCandidate = { key: string; label: string };
export type SimilarFieldMatch = { key: string; label: string; score: number };

const COMBINING_MARK_MIN = 0x0300;
const COMBINING_MARK_MAX = 0x036f;

function normalizeForCompare(s: string): string {
  const decomposed = s.normalize("NFD");
  let stripped = "";
  for (const ch of decomposed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= COMBINING_MARK_MIN && code <= COMBINING_MARK_MAX) continue;
    stripped += ch;
  }
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shortLen = Math.min(a.length, b.length);
  const longLen = Math.max(a.length, b.length);
  const lengthRatio = shortLen / longLen;

  // Confronti per sottostringa hanno senso solo con stringhe non troppo corte,
  // altrimenti quasi tutto "contiene" quasi tutto (falsi positivi).
  if (shortLen >= 3) {
    if (a.startsWith(b) || b.startsWith(a)) {
      // Abbreviazione tipica (es. "descr" di "descrizione"): segnale forte anche se corta.
      return 0.5 + 0.5 * lengthRatio;
    }
    if (a.includes(b) || b.includes(a)) {
      return 0.4 + 0.3 * lengthRatio;
    }
  }

  const dist = levenshtein(a, b);
  return longLen === 0 ? 0 : 1 - dist / longLen;
}

const MIN_SCORE = 0.6;

/** Trova, tra i campi noti, quello più simile (per chiave o etichetta) al candidato dato. */
export function findSimilarField(candidate: string, known: FieldCandidate[]): SimilarFieldMatch | null {
  const normCandidate = normalizeForCompare(candidate);
  if (!normCandidate) return null;

  let best: SimilarFieldMatch | null = null;
  for (const field of known) {
    for (const text of [field.key, field.label]) {
      const normKnown = normalizeForCompare(text);
      if (!normKnown) continue;
      const score = similarityScore(normCandidate, normKnown);
      if (score >= MIN_SCORE && (!best || score > best.score)) {
        best = { key: field.key, label: field.label, score };
      }
    }
  }
  return best;
}
