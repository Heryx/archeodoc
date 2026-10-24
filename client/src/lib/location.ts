import { useHashLocation } from "wouter/use-hash-location";

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

  // With hash routing, ignore query params before "#" (e.g. /?panel=x#/path)
  // to avoid stale panel states.
  if (rawHash) return "";

  const fromSearch = (window.location.search || "").replace(/^\?/, "");
  if (fromSearch) return fromSearch;

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

// Costruisce l'href per aprire un pannello laterale (es. ?panel=thesaurus) sopra la pagina
// corrente, preservando path e query esistenti. Vedi AppShell in App.tsx per il consumo.
export function buildPanelHref(location: string, panel: string): string {
  const cleanPath = extractPathFromLocation(location);
  const search = extractSearchFromLocation(location);
  const next = new URLSearchParams(search);
  next.set("panel", panel);
  const query = next.toString();
  return `#${cleanPath}${query ? `?${query}` : ""}`;
}

// Link "apri scheda" (es. ?openUsId=3) che ricorda la pagina di partenza: chi apre la scheda
// da un'altra pagina (Matrix, grafo, relazioni...) ci torna alla chiusura, vedi readReturnTo().
// Il valore è codificato due volte perché extractSearchFromLocation() decodifica l'hash.
// `returnPath` (es. "/cantiere/1/documentazioni?openDocId=5") sostituisce la pagina corrente
// quando questa da sola non basterebbe a ritrovare lo stato di partenza.
export function withReturnTo(href: string, returnPath?: string): string {
  if (typeof window === "undefined") return href;
  const current = returnPath ?? (window.location.hash || "").replace(/^#/, "");
  if (!current) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}returnTo=${encodeURIComponent(encodeURIComponent(current))}`;
}

// Pagina a cui tornare, se il link di apertura ne indicava una (solo percorsi interni all'app).
export function readReturnTo(search: string): string | null {
  const raw = new URLSearchParams(search).get("returnTo");
  if (!raw) return null;
  const value = safeDecode(raw);
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

// Hash router hook that exposes only the path to wouter route-matching.
// Query params in hash (e.g. #/cantiere/1/giornata/3?panel=qc) stay available
// through extractSearchFromLocation(), but do not pollute route params like :gid.
export function useHashPathLocation() {
  const [rawLocation, navigate] = useHashLocation();
  const cleanPath = extractPathFromLocation(rawLocation);
  return [cleanPath, navigate] as [string, (path: string, ...args: any[]) => any];
}
