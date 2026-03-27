const US_PREFIXES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "US", aliases: ["US", "U.S."] },
  { canonical: "USM", aliases: ["USM"] },
  { canonical: "USR", aliases: ["USR"] },
  { canonical: "USS", aliases: ["USS"] },
  { canonical: "UVS", aliases: ["UVS"] },
  { canonical: "UT", aliases: ["UT"] },
  { canonical: "SAS", aliases: ["SAS"] },
  { canonical: "F", aliases: ["F"] },
  { canonical: "T", aliases: ["T"] },
  { canonical: "SB", aliases: ["SB"] },
  { canonical: "SF", aliases: ["SF"] },
];

function sanitizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizePrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeNumericSuffix(value: string): string {
  const numeric = value.replace(/^0+/, "");
  return numeric || "0";
}

export function normalizeUSCode(value: unknown): string {
  const raw = sanitizeCode(String(value ?? ""));
  if (!raw) return "";

  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  if (/^\d+$/.test(compact)) {
    return `US ${normalizeNumericSuffix(compact)}`;
  }

  for (const prefix of US_PREFIXES) {
    const aliases = prefix.aliases.map((item) => normalizePrefix(item));
    const matchedAlias = aliases.find((alias) => compact.startsWith(alias));
    if (!matchedAlias) continue;

    const rest = compact.slice(matchedAlias.length);
    if (!rest) return prefix.canonical;
    if (/^\d+$/.test(rest)) return `${prefix.canonical} ${normalizeNumericSuffix(rest)}`;
    return `${prefix.canonical} ${rest}`;
  }

  return compact;
}

export function usCodeKey(value: unknown): string {
  const normalized = normalizeUSCode(value).replace(/[^A-Z0-9]/g, "");
  if (!normalized) return "";

  if (/^\d+$/.test(normalized)) {
    return `US${normalizeNumericSuffix(normalized)}`;
  }

  for (const prefix of US_PREFIXES) {
    const canonical = prefix.canonical;
    if (!normalized.startsWith(canonical)) continue;
    const rest = normalized.slice(canonical.length);
    if (!rest) return canonical;
    if (/^\d+$/.test(rest)) return `${canonical}${normalizeNumericSuffix(rest)}`;
    return `${canonical}${rest}`;
  }

  return normalized;
}

export function areSameUSCode(a: unknown, b: unknown): boolean {
  const left = usCodeKey(a);
  const right = usCodeKey(b);
  if (!left || !right) return false;
  return left === right;
}
