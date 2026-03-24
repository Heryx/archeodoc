import { google } from "googleapis";
import fs from "fs";
import path from "path";

export const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
] as const;

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

export class GoogleInsufficientScopesError extends Error {
  missingScopes: string[];

  constructor(missingScopes: string[], message?: string) {
    super(message || "Token Google privo degli scope richiesti");
    this.name = "GoogleInsufficientScopesError";
    this.missingScopes = Array.from(new Set(missingScopes));
  }
}

function parseScopes(rawScope: unknown): string[] {
  if (Array.isArray(rawScope)) {
    return Array.from(new Set(rawScope.map((item) => String(item || "").trim()).filter(Boolean)));
  }

  const text = String(rawScope || "").trim();
  if (!text) return [];
  return Array.from(new Set(text.split(/\s+/).map((item) => item.trim()).filter(Boolean)));
}

function readTokenObject(): Record<string, unknown> | null {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function missingScopesFromGranted(grantedScopes: string[], requiredScopes: readonly string[] = GOOGLE_REQUIRED_SCOPES): string[] {
  const grantedSet = new Set(grantedScopes);
  return requiredScopes.filter((scope) => !grantedSet.has(scope));
}

function friendlyScopesErrorMessage(missingScopes: string[]): string {
  if (missingScopes.length === 0) {
    return "Permessi Google insufficienti. Disconnetti e ricollega l'account Google.";
  }

  return `Permessi Google insufficienti. Scope mancanti: ${missingScopes.join(", ")}. Disconnetti e ricollega l'account Google da Impostazioni > Google Docs.`;
}

export function getCredentialsPath() {
  return CREDENTIALS_PATH;
}

export function getTokenPath() {
  return TOKEN_PATH;
}

export function hasCredentials() {
  return fs.existsSync(CREDENTIALS_PATH);
}

export function hasToken() {
  return fs.existsSync(TOKEN_PATH);
}

export function getTokenScopes(): string[] {
  const token = readTokenObject();
  if (!token) return [];
  return parseScopes(token.scope);
}

export function getMissingRequiredScopesFromToken(): string[] {
  return missingScopesFromGranted(getTokenScopes());
}

export function assertTokenHasRequiredScopes(): void {
  const token = readTokenObject();
  if (!token) {
    throw new Error("Non autenticato con Google. Vai nelle Impostazioni e collega il tuo account Google.");
  }

  const tokenScopes = parseScopes(token.scope);
  // Alcuni token legacy possono non includere il campo scope locale.
  if (tokenScopes.length === 0) return;

  const missingScopes = missingScopesFromGranted(tokenScopes);
  if (missingScopes.length > 0) {
    throw new GoogleInsufficientScopesError(missingScopes, friendlyScopesErrorMessage(missingScopes));
  }
}

function extractGoogleApiErrorParts(error: unknown): {
  message: string;
  statusCode: number | null;
  reasons: string[];
} {
  const message = error instanceof Error ? error.message : String(error || "");
  const anyError = error as {
    code?: number;
    errors?: Array<{ reason?: string }>;
    response?: {
      status?: number;
      data?: {
        error?: {
          status?: string;
          message?: string;
          errors?: Array<{ reason?: string; message?: string }>;
        };
      };
    };
  };

  const statusCode =
    typeof anyError?.response?.status === "number"
      ? anyError.response.status
      : typeof anyError?.code === "number"
        ? anyError.code
        : null;

  const reasons = [
    ...(anyError?.errors || []).map((item) => item.reason || ""),
    ...((anyError?.response?.data?.error?.errors || []).map((item) => item.reason || "")),
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return { message, statusCode, reasons };
}

export function isGoogleInsufficientScopeError(error: unknown): boolean {
  if (error instanceof GoogleInsufficientScopesError) return true;

  const { message, reasons } = extractGoogleApiErrorParts(error);
  if (/insufficient authentication scopes/i.test(message)) return true;
  if (/insufficientpermissions/i.test(message)) return true;
  return reasons.some((reason) => /insufficient/i.test(reason));
}

export function normalizeGoogleError(
  error: unknown,
  fallbackMessage: string,
): { status: number; message: string; code?: string; missingScopes?: string[] } {
  if (error instanceof GoogleInsufficientScopesError) {
    return {
      status: 403,
      code: "google_insufficient_scopes",
      message: error.message,
      missingScopes: error.missingScopes,
    };
  }

  if (isGoogleInsufficientScopeError(error)) {
    const missingScopes = getMissingRequiredScopesFromToken();
    return {
      status: 403,
      code: "google_insufficient_scopes",
      message: friendlyScopesErrorMessage(missingScopes),
      missingScopes,
    };
  }

  const { message, statusCode } = extractGoogleApiErrorParts(error);
  return {
    status: statusCode && statusCode >= 400 && statusCode < 600 ? statusCode : 500,
    message: message || fallbackMessage,
  };
}

export function createOAuth2Client() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("credentials.json non trovato. Scaricalo dal progetto Google Cloud e salvalo nella cartella di ArcheoDoc.");
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = creds.installed || creds.web;
  const REDIRECT_URI = "http://localhost:5000/api/google/callback";
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

export function getAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    scope: Array.from(GOOGLE_REQUIRED_SCOPES),
    prompt: "consent",
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  const grantedScopes = parseScopes(tokens.scope);
  if (grantedScopes.length > 0) {
    const missingScopes = missingScopesFromGranted(grantedScopes);
    if (missingScopes.length > 0) {
      throw new GoogleInsufficientScopesError(missingScopes, friendlyScopesErrorMessage(missingScopes));
    }
  }

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens), "utf-8");
}

export function getAuthorizedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("Non autenticato con Google. Vai nelle Impostazioni e collega il tuo account Google.");
  }

  assertTokenHasRequiredScopes();

  const client = createOAuth2Client();
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const current = readTokenObject() || {};
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }), "utf-8");
  });

  return client;
}

export function revokeToken(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

export const __test = {
  parseScopes,
  missingScopesFromGranted,
};
