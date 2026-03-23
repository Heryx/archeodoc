import { google } from "googleapis";
import fs from "fs";
import path from "path";

const SCOPES = ["https://www.googleapis.com/auth/documents.readonly"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

export function getCredentialsPath() { return CREDENTIALS_PATH; }
export function getTokenPath() { return TOKEN_PATH; }
export function hasCredentials() { return fs.existsSync(CREDENTIALS_PATH); }
export function hasToken() { return fs.existsSync(TOKEN_PATH); }

export function createOAuth2Client() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("credentials.json non trovato. Scaricalo dal progetto Google Cloud e salvalo nella cartella di ArcheoDoc.");
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0] || "http://localhost:5000/api/google/callback");
}

export function getAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens), "utf-8");
}

export function getAuthorizedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("Non autenticato con Google. Vai nelle Impostazioni e collega il tuo account Google.");
  }
  const client = createOAuth2Client();
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  client.setCredentials(tokens);
  // Auto-refresh: salva il nuovo token se refreshato
  client.on("tokens", (newTokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }), "utf-8");
  });
  return client;
}

export function revokeToken(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}
