function queryFromRaw(value: string): string {
  const index = value.indexOf("?");
  if (index < 0) return "";
  return value.slice(index + 1);
}

function pathFromRaw(value: string): string {
  const index = value.indexOf("?");
  if (index < 0) return value;
  return value.slice(0, index);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "/";
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

// Read query params reliably with hash routing (#/path?x=1) and normal routing.
export function extractSearchFromLocation(location: string): string {
  if (typeof window !== "undefined") {
    const fromSearch = (window.location.search || "").replace(/^\?/, "");
    if (fromSearch) return fromSearch;
  }

  const fromLocation = queryFromRaw(location || "");
  if (fromLocation) return fromLocation;

  const decodedLocation = safeDecode(location || "");
  const fromDecodedLocation = queryFromRaw(decodedLocation);
  if (fromDecodedLocation) return fromDecodedLocation;

  if (typeof window === "undefined") return "";

  const rawHash = (window.location.hash || "").replace(/^#/, "");
  const decodedHash = safeDecode(rawHash);

  const fromDecodedHash = queryFromRaw(decodedHash);
  if (fromDecodedHash) return fromDecodedHash;

  const fromRawHash = queryFromRaw(rawHash);
  if (fromRawHash) return fromRawHash;

  return "";
}

// Read path reliably with hash routing (#/path?x=1), including encoded `?` (`%3F`).
export function extractPathFromLocation(location: string): string {
  const decodedLocation = safeDecode(location || "");
  const fromDecodedLocation = pathFromRaw(decodedLocation).replace(/^#/, "");
  if (fromDecodedLocation) return normalizePath(fromDecodedLocation);

  const fromLocation = pathFromRaw(location || "").replace(/^#/, "");
  if (fromLocation) return normalizePath(fromLocation);

  if (typeof window === "undefined") return "/";

  const rawHash = (window.location.hash || "").replace(/^#/, "");
  const decodedHash = safeDecode(rawHash);

  const fromDecodedHash = pathFromRaw(decodedHash).replace(/^#/, "");
  if (fromDecodedHash) return normalizePath(fromDecodedHash);

  const fromRawHash = pathFromRaw(rawHash).replace(/^#/, "");
  if (fromRawHash) return normalizePath(fromRawHash);

  return normalizePath(window.location.pathname || "/");
}
