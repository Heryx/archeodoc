import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getProjectCodeSettings, getWorkspaceRoot, type ProjectDefinition } from "./projects";
import {
  resolveQcUsConfig,
  type QcUsConfig,
  type QcUsConfigInput,
} from "@shared/qc_us_rules";

// DB globale per le impostazioni di Controllo Qualità (non per progetto),
// allineato al modello di ai_settings.
const GLOBAL_QC_DB_PATH = () => path.join(getWorkspaceRoot(), "qc_settings.sqlite");

const CONFIG_KEY = "us_rules";

let cachedDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (cachedDb) return cachedDb;
  const dbPath = GLOBAL_QC_DB_PATH();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  cachedDb = new Database(dbPath);
  cachedDb.pragma("journal_mode = WAL");
  cachedDb.exec(`
    CREATE TABLE IF NOT EXISTS qc_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return cachedDb;
}

export function getQcUsConfig(): QcUsConfig {
  const db = getDb();
  const row = db.prepare("SELECT value FROM qc_settings WHERE key = ?").get(CONFIG_KEY) as
    | { value: string }
    | undefined;
  if (!row) return resolveQcUsConfig(null);
  try {
    return resolveQcUsConfig(JSON.parse(row.value) as QcUsConfigInput);
  } catch {
    return resolveQcUsConfig(null);
  }
}

/** Configurazione QC globale con gli override del progetto (segnalazione prefissi incoerenti). */
export function getQcUsConfigForProject(project: ProjectDefinition): QcUsConfig {
  const config = getQcUsConfig();
  if (!getProjectCodeSettings(project).flagPrefixMismatch) {
    return { ...config, levels: { ...config.levels, codice_prefisso_incoerente: "off" } };
  }
  return config;
}

export function setQcUsConfig(input: QcUsConfigInput): QcUsConfig {
  const resolved = resolveQcUsConfig(input);
  const db = getDb();
  db.prepare(`
    INSERT INTO qc_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(CONFIG_KEY, JSON.stringify(resolved));
  return resolved;
}

export function resetQcUsConfig(): QcUsConfig {
  const db = getDb();
  db.prepare("DELETE FROM qc_settings WHERE key = ?").run(CONFIG_KEY);
  return resolveQcUsConfig(null);
}
