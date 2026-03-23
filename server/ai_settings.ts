import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getWorkspaceRoot } from "./projects";

// DB globale per le impostazioni AI (non per progetto)
const GLOBAL_SETTINGS_DB_PATH = () => path.join(getWorkspaceRoot(), "ai_settings.sqlite");

let cachedDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (cachedDb) return cachedDb;
  const dbPath = GLOBAL_SETTINGS_DB_PATH();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  cachedDb = new Database(dbPath);
  cachedDb.pragma("journal_mode = WAL");
  ensureTable(cachedDb);
  return cachedDb;
}

function ensureTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      label TEXT,
      description TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM ai_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO ai_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

export function getAllSettings(): Array<{ key: string; value: string; label: string | null; description: string | null; updatedAt: string | null }> {
  const db = getDb();
  return db.prepare("SELECT key, value, label, description, updated_at as updatedAt FROM ai_settings").all() as any[];
}

function upsertSettingMeta(key: string, label: string, description: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE ai_settings SET label = ?, description = ? WHERE key = ?
  `).run(label, description, key);
}

// Usa process.cwd() per puntare a server/defaults sia in dev che in prod
const DEFAULTS_DIR = path.resolve(process.cwd(), "server", "defaults");

const DEFAULT_KEYS: Array<{ key: string; label: string; description: string; file: string }> = [
  {
    key: "system_prompt",
    label: "Prompt di sistema",
    description: "Personalità e istruzioni generali dell'assistente AI",
    file: "system_prompt.md",
  },
  {
    key: "scheda_us_template",
    label: "Template scheda US",
    description: "Istruzioni per l'analisi e compilazione delle schede US",
    file: "scheda_us_template.md",
  },
  {
    key: "giornale_format",
    label: "Formato giornale",
    description: "Istruzioni per la generazione del testo del giornale di cantiere",
    file: "giornale_format.md",
  },
];

export function seedDefaultSettings(): void {
  for (const { key, label, description, file } of DEFAULT_KEYS) {
    const existing = getSetting(key);
    if (!existing) {
      const filePath = path.join(DEFAULTS_DIR, file);
      const value = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").trim() : "";
      setSetting(key, value);
    }
    // Aggiorna sempre label e description
    upsertSettingMeta(key, label, description);
  }
}

export function resetToDefault(key: string): boolean {
  const def = DEFAULT_KEYS.find((d) => d.key === key);
  if (!def) return false;
  const filePath = path.join(DEFAULTS_DIR, def.file);
  if (!fs.existsSync(filePath)) return false;
  const value = fs.readFileSync(filePath, "utf-8").trim();
  setSetting(key, value);
  return true;
}
