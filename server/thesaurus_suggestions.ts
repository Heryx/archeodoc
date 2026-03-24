import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import type { UnitaStratigrafica } from "@shared/schema";
import { getStorageForProject } from "./projects";

const TOP_LEVEL_US_FIELD_MAP: Record<string, keyof UnitaStratigrafica> = {
  codiceUS: "codiceUS",
  tipo: "tipo",
  definizione: "definizione",
  descrizione: "descrizione",
  interpretazione: "interpretazione",
  settore: "settore",
  periodoIniziale: "periodoIniziale",
  periodoFinale: "periodoFinale",
  materialiRinvenuti: "materialiRinvenuti",
  campioni: "campioni",
};

// Mappa pragmatica campo US -> codici tipologici di un eventuale thesaurus interno SQLite.
const LEGACY_THESAURUS_CODE_BY_FIELD: Record<string, string[]> = {
  definizione: ["2.3", "2.4"],
  naturaus: ["2.9"],
  natura: ["2.9"],
  agente: ["2.9"],
  metododiscavo: ["2.8"],
  statodiconservazione: ["2.12"],
  statoconservazione: ["2.12"],
  consistenza: ["2.11"],
  mododiformazione: ["2.10"],
  modoformazione: ["2.10"],
  componentiorganici: ["2.14"],
  organici: ["2.14"],
  componentiinorganici: ["2.15"],
  inorganici: ["2.15"],
  componentigeologici: ["2.15"],
  geologici: ["2.15"],
  componentiartificiali: ["2.15"],
  artificiali: ["2.15"],
  campioni: ["2.13"],
  settore: ["2.1"],
  colore: ["201.201"],
  documentazione: ["2.19"],
  direttoreus: ["2.17"],
  responsabileus: ["2.18"],
  compilatore: ["2.16"],
  schedatore: ["2.16"],
};

type SqliteSuggestionInput = {
  fileBuffer: Buffer;
  fieldKey: string;
  tableName?: string;
  columnName?: string;
  limit?: number;
};

export type SqliteSuggestionResult = {
  values: string[];
  tableName: string;
  columnName: string;
  warnings: string[];
};

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseSchedaData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeFieldKey(value: string): string {
  return normalizeToken(value);
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function splitPotentialMultiValue(raw: string): string[] {
  // Evita lo split su virgola: in archeologia molte definizioni usano virgole descrittive.
  if (!/[;|\n\r]/.test(raw)) return [raw];
  return raw
    .split(/[;|\n\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeValues(values: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;

    for (const candidate of splitPotentialMultiValue(cleaned)) {
      const normalized = normalizeToken(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

function extractUsValue(us: UnitaStratigrafica, fieldKey: string): string | null {
  const topLevel = TOP_LEVEL_US_FIELD_MAP[fieldKey];
  if (topLevel) {
    return cleanText(us[topLevel]);
  }

  const scheda = parseSchedaData(us.schedaData);
  return cleanText(scheda[fieldKey]);
}

function candidateColumnsForField(fieldKey: string): string[] {
  const key = String(fieldKey || "").trim();
  const normalized = normalizeFieldKey(key);
  const snake = toSnakeCase(key);

  const map: Record<string, string[]> = {
    tipo: [
      "tipo",
      "unita_tipo",
      "unita_tipo_s",
      "tipo_us",
      "tipo_us_s",
      "us_tipo",
      "tipologia",
      "type",
      "context_type",
    ],
    definizione: [
      "definizione",
      "definition",
      "definizione_us",
      "d_interpretativa",
      "descrizione_breve",
      "context_def",
      "tipo_us_s",
    ],
    descrizione: ["descrizione", "description", "desc", "note", "context_desc"],
    interpretazione: ["interpretazione", "interpretation", "interpret", "lettura"],
    settore: ["settore", "sector", "area", "saggio"],
    metododiscavo: ["metodo_di_scavo", "metodo_scavo", "metodologia_scavo"],
    statodiconservazione: ["stato_di_conservazione", "stato_conservazione"],
    mododiformazione: ["modo_formazione", "formazione"],
    naturaus: ["natura_us", "natura", "agente"],
    componentiorganici: ["componenti_organici", "inclusi_organici"],
    componentiinorganici: ["componenti_inorganici", "inclusi_inorganici"],
    colore: ["colore", "color", "munsell"],
    consistenza: ["consistenza"],
    campioni: ["campioni", "campioni_usm", "tipo_campione", "tipo_camp"],
  };

  const specific = map[normalized] || [];
  return dedupeValues([key, snake, ...specific], 30).map((item) => item.toLowerCase());
}

function preferredTables(): string[] {
  return [
    "unita_stratigrafiche",
    "us",
    "us_records",
    "us_data",
    "contexts",
    "layers",
  ];
}

function escapeIdentifier(value: string): string {
  return value.replace(/"/g, '""');
}

function readTableColumns(db: Database.Database, tableName: string): string[] {
  const escaped = escapeIdentifier(tableName);
  const rows = db.prepare(`PRAGMA table_info("${escaped}")`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function pickColumn(columns: string[], fieldKey: string, explicitColumn?: string): string | null {
  if (explicitColumn) {
    const wanted = normalizeToken(explicitColumn);
    const found = columns.find((column) => normalizeToken(column) === wanted);
    return found || null;
  }

  const candidates = candidateColumnsForField(fieldKey);
  const normalizedMap = new Map<string, string>();
  for (const column of columns) {
    normalizedMap.set(normalizeToken(column), column);
  }

  for (const candidate of candidates) {
    const found = normalizedMap.get(normalizeToken(candidate));
    if (found) return found;
  }

  return null;
}

function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableSortScore(tableName: string): number {
  const normalized = normalizeToken(tableName);
  const preferred = preferredTables();
  const exactIndex = preferred.findIndex((item) => normalizeToken(item) === normalized);
  if (exactIndex >= 0) {
    return 100 - exactIndex;
  }

  if (normalized === "ustable") {
    return 95;
  }

  if (normalized.includes("thesaurussigle")) {
    return 90;
  }

  if (normalized.endsWith("toimp")) {
    return -10;
  }

  if (normalized.includes("us") || normalized.includes("context") || normalized.includes("stratig")) {
    return 50;
  }

  return 0;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(tableName) as { ok?: number } | undefined;
  return !!row?.ok;
}

function findThesaurusSigleTableName(db: Database.Database): string | null {
  const preferred = [
    "thesaurus_sigle",
    "sqlite_thesaurus_sigle",
    "legacy_thesaurus_sigle",
  ];

  for (const name of preferred) {
    if (tableExists(db, name)) return name;
  }

  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  for (const row of rows) {
    const normalized = normalizeToken(row.name);
    if (normalized.includes("thesaurus") && normalized.includes("sigle")) {
      return row.name;
    }
  }

  return null;
}

function readDistinctColumnValues(
  db: Database.Database,
  tableName: string,
  columnName: string,
  limit: number,
): string[] {
  const escapedTable = escapeIdentifier(tableName);
  const escapedColumn = escapeIdentifier(columnName);
  const sql = `SELECT DISTINCT CAST("${escapedColumn}" AS TEXT) AS value FROM "${escapedTable}" WHERE "${escapedColumn}" IS NOT NULL LIMIT ?`;
  const rows = db.prepare(sql).all(limit * 6) as Array<{ value: string | null }>;
  return dedupeValues(rows.map((row) => row.value || ""), limit);
}

function suggestFromLegacyThesaurusTable(
  db: Database.Database,
  fieldKey: string,
  limit: number,
): SqliteSuggestionResult | null {
  const thesaurusTable = findThesaurusSigleTableName(db);
  if (!thesaurusTable) return null;

  const normalized = normalizeFieldKey(fieldKey);
  const codes = LEGACY_THESAURUS_CODE_BY_FIELD[normalized];
  if (!codes || codes.length === 0) return null;

  const escapedThesaurusTable = escapeIdentifier(thesaurusTable);
  const placeholders = codes.map(() => "?").join(", ");
  const sql = `
    SELECT DISTINCT TRIM(sigla_estesa) AS value
    FROM "${escapedThesaurusTable}"
    WHERE tipologia_sigla IN (${placeholders})
      AND sigla_estesa IS NOT NULL
      AND TRIM(sigla_estesa) <> ''
      AND (
        nome_tabella IS NULL
        OR TRIM(nome_tabella) = ''
        OR LOWER(nome_tabella) LIKE '%us%'
        OR LOWER(nome_tabella) LIKE '%stratig%'
      )
    ORDER BY value
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...codes, limit * 6) as Array<{ value: string | null }>;
  const values = dedupeValues(rows.map((row) => row.value || ""), limit);
  if (values.length === 0) return null;

  return {
    values,
    tableName: thesaurusTable,
    columnName: "sigla_estesa",
    warnings: [`Suggerimenti estratti dal thesaurus SQLite (tipologie: ${codes.join(", ")})`],
  };
}

export function suggestUsVocabularyFromProjectDb(
  projectId: string,
  fieldKey: string,
  limit = 300,
): string[] {
  const storage = getStorageForProject(projectId);
  const values: string[] = [];

  for (const cantiere of storage.getCantieri()) {
    for (const us of storage.getUSList(cantiere.id)) {
      const value = extractUsValue(us, fieldKey);
      if (!value) continue;
      values.push(value);
      if (values.length >= limit * 4) break;
    }
    if (values.length >= limit * 4) break;
  }

  return dedupeValues(values, Math.max(1, limit));
}

export function suggestUsVocabularyFromSqlite(input: SqliteSuggestionInput): SqliteSuggestionResult {
  const { fileBuffer, fieldKey, tableName, columnName } = input;
  const limit = Math.max(1, Math.min(2000, Number(input.limit || 300)));

  const tempName = `archeodoc-thesaurus-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  const tempPath = path.join(os.tmpdir(), tempName);
  fs.writeFileSync(tempPath, fileBuffer);

  const warnings: string[] = [];
  let db: Database.Database | null = null;

  try {
    db = new Database(tempPath, { readonly: true, fileMustExist: true });

    const availableTables = listTables(db);
    if (availableTables.length === 0) {
      throw new Error("Il file SQLite non contiene tabelle leggibili");
    }

    if (!tableName && !columnName) {
      const thesaurusResult = suggestFromLegacyThesaurusTable(db, fieldKey, limit);
      if (thesaurusResult) {
        return thesaurusResult;
      }
    }

    let candidateTables: string[];
    if (tableName && tableName.trim()) {
      const requested = tableName.trim();
      const found = availableTables.find((item) => normalizeToken(item) === normalizeToken(requested));
      if (!found) {
        throw new Error(`Tabella '${requested}' non trovata nel file SQLite`);
      }
      candidateTables = [found];
    } else {
      candidateTables = [...availableTables].sort((a, b) => tableSortScore(b) - tableSortScore(a));
    }

    let selectedTable = "";
    let selectedColumn = "";
    let values: string[] = [];

    for (const table of candidateTables) {
      try {
        const columns = readTableColumns(db, table);
        const picked = pickColumn(columns, fieldKey, columnName);
        if (!picked) continue;

        const extracted = readDistinctColumnValues(db, table, picked, limit);
        if (extracted.length === 0) {
          warnings.push(`Nessun valore utile in ${table}.${picked}`);
          continue;
        }

        selectedTable = table;
        selectedColumn = picked;
        values = extracted;
        break;
      } catch (error: any) {
        warnings.push(`Tabella ${table} ignorata: ${error?.message || "errore lettura"}`);
      }
    }

    if (!selectedTable || !selectedColumn) {
      throw new Error(`Impossibile individuare una colonna utile per il campo '${fieldKey}' nel file SQLite`);
    }

    return {
      values,
      tableName: selectedTable,
      columnName: selectedColumn,
      warnings,
    };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }

    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup errors
    }
  }
}
