function sanitizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function formatPrefixedCode(prefix: string, rest: string): string {
  const trimmed = rest.trim();
  if (!trimmed) return prefix;
  return `${prefix} ${trimmed}`;
}

export function normalizeUSCode(value: unknown): string {
  const raw = sanitizeCode(String(value ?? ""));
  if (!raw) return "";

  const onlyDigits = raw.match(/^\d+$/);
  if (onlyDigits) {
    return `US ${Number.parseInt(onlyDigits[0], 10)}`;
  }

  const prefixed = raw.match(/^(US|T|SB|SF)\s*\.?\s*(.+)$/i);
  if (prefixed) {
    return formatPrefixedCode(prefixed[1].toUpperCase(), prefixed[2]);
  }

  return formatPrefixedCode("US", raw);
}

export function usCodeKey(value: unknown): string {
  return normalizeUSCode(value).replace(/[^A-Z0-9]/g, "");
}
