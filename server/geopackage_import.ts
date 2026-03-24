import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import wkx from "wkx";
import type { IStorage } from "./storage";
import type { USThesaurusConfig } from "@shared/us_thesaurus";
import { normalizeUsDefinizioneWithVocabulary, normalizeUsTipoWithVocabulary } from "@shared/us_thesaurus";

type GpkgGeometryColumn = {
  table_name: string;
  column_name: string;
  srs_id: number | null;
};

type GpkgContentRow = {
  table_name: string;
  data_type: string;
};

type GpkgTableInfo = {
  tableName: string;
  dataType: string;
};

type ColumnMap = {
  codiceUS?: string;
  tipo?: string;
  definizione?: string;
  descrizione?: string;
  interpretazione?: string;
  quota?: string;
  settore?: string;
  copertoDa?: string;
  copre?: string;
  siLegaA?: string;
  ugualeA?: string;
  periodoIniziale?: string;
  periodoFinale?: string;
  materiali?: string;
  campioni?: string;
};

type GenericRow = Record<string, unknown>;

export type GeoPackageFieldMap = Partial<Record<keyof ColumnMap, string>>;

export type GeoPackagePreviewInput = {
  fileBuffer: Buffer;
  originalName: string;
};

export type GeoPackagePreviewTable = {
  tableName: string;
  dataType: string;
  rowCount: number;
  columns: string[];
  geometryColumn: string | null;
  srid: number | null;
  autoMap: ColumnMap;
  sampleRows: Array<Record<string, string | null>>;
  style: {
    styleName: string | null;
    hasQml: boolean;
    hasSld: boolean;
  } | null;
};

export type GeoPackagePreviewResult = {
  sourceFileName: string;
  tables: GeoPackagePreviewTable[];
  warnings: string[];
};

export type GeoPackageWebMapPreviewInput = {
  fileBuffer: Buffer;
  originalName: string;
  tableName?: string | null;
  limit?: number;
};

export type GeoPackageWebMapPreviewResult = {
  sourceFileName: string;
  tableName: string;
  tables: Array<{
    tableName: string;
    dataType: string;
    rowCount: number;
    geometryColumn: string | null;
    srid: number | null;
  }>;
  featureCollection: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: any;
      properties: Record<string, unknown>;
    }>;
  };
  styleHint: {
    strokeColor: string;
    fillColor: string;
    fillOpacity: number;
    weight: number;
  };
  warnings: string[];
};

export type GeoPackageImportInput = {
  storage: IStorage;
  cantiereId: number;
  giornataId?: number | null;
  fileBuffer: Buffer;
  originalName: string;
  usThesaurus?: USThesaurusConfig;
  tableName?: string | null;
  fieldMap?: GeoPackageFieldMap;
  importUnknownColumns?: boolean;
};

export type GeoPackageImportResult = {
  sourceFileName: string;
  tableName?: string | null;
  tablesScanned: number;
  tablesImported: string[];
  rowsScanned: number;
  created: number;
  skippedWithoutCode: number;
  skippedDuplicateCode: number;
  warnings: string[];
};

const COLUMN_CANDIDATES = {
  codiceUS: [
    "codice_us",
    "codiceus",
    "codice",
    "us_code",
    "uscodice",
    "us_id",
    "usid",
    "id_us",
    "idus",
    "us",
  ],
  tipo: ["tipo", "us_tipo", "tipologia", "type"],
  definizione: ["definizione", "definition", "definizione_us"],
  descrizione: ["descrizione", "description", "desc", "note", "descrizione_us"],
  interpretazione: ["interpretazione", "interpretation", "lettura", "interpretazione_us"],
  quota: ["quota", "quota_m", "elevazione", "elevation", "z", "altitudine"],
  settore: ["settore", "sector", "area", "trincea", "saggio"],
  copertoDa: ["coperto_da", "copertoda", "covered_by", "sotto", "under_us"],
  copre: ["copre", "covers", "sopra", "over_us"],
  siLegaA: ["si_lega_a", "silegaa", "lega_a", "related_to", "adiacente_a"],
  ugualeA: ["uguale_a", "ugualea", "equal_to", "same_as"],
  periodoIniziale: ["periodo_iniziale", "periodoiniziale", "datazione_inizio", "period_start"],
  periodoFinale: ["periodo_finale", "periodofinale", "datazione_fine", "period_end"],
  materiali: ["materiali_rinvenuti", "materiali", "finds", "reperti"],
  campioni: ["campioni", "samples", "prelievi"],
} as const;

function normalizeColumnName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeIdentifier(identifier: string): string {
  return identifier.replace(/"/g, '""');
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(tableName) as { 1: number } | undefined;
  return !!row;
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseRelationValues(raw: unknown): string[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((entry) => toNullableString(entry))
      .filter((entry): entry is string => !!entry);
  }

  const rawText = toNullableString(raw);
  if (!rawText) return [];

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => toNullableString(entry))
        .filter((entry): entry is string => !!entry);
    }
  } catch {
    // fallback split
  }

  return rawText
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeUsCode(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedCodeKey(value: string): string {
  return normalizeUsCode(value).toUpperCase();
}

function relationFieldValue(raw: unknown): string | null {
  const values = parseRelationValues(raw);
  if (values.length === 0) return null;

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(value);
  }

  return deduped.length > 0 ? JSON.stringify(deduped) : null;
}

function pickColumn(columns: string[], candidates: readonly string[]): string | undefined {
  const normalized = new Map<string, string>();
  for (const column of columns) {
    normalized.set(normalizeColumnName(column), column);
  }

  for (const candidate of candidates) {
    const found = normalized.get(normalizeColumnName(candidate));
    if (found) return found;
  }

  return undefined;
}

function buildColumnMap(columns: string[]): ColumnMap {
  return {
    codiceUS: pickColumn(columns, COLUMN_CANDIDATES.codiceUS),
    tipo: pickColumn(columns, COLUMN_CANDIDATES.tipo),
    definizione: pickColumn(columns, COLUMN_CANDIDATES.definizione),
    descrizione: pickColumn(columns, COLUMN_CANDIDATES.descrizione),
    interpretazione: pickColumn(columns, COLUMN_CANDIDATES.interpretazione),
    quota: pickColumn(columns, COLUMN_CANDIDATES.quota),
    settore: pickColumn(columns, COLUMN_CANDIDATES.settore),
    copertoDa: pickColumn(columns, COLUMN_CANDIDATES.copertoDa),
    copre: pickColumn(columns, COLUMN_CANDIDATES.copre),
    siLegaA: pickColumn(columns, COLUMN_CANDIDATES.siLegaA),
    ugualeA: pickColumn(columns, COLUMN_CANDIDATES.ugualeA),
    periodoIniziale: pickColumn(columns, COLUMN_CANDIDATES.periodoIniziale),
    periodoFinale: pickColumn(columns, COLUMN_CANDIDATES.periodoFinale),
    materiali: pickColumn(columns, COLUMN_CANDIDATES.materiali),
    campioni: pickColumn(columns, COLUMN_CANDIDATES.campioni),
  };
}

function buildEffectiveColumnMap(columns: string[], fieldMap?: GeoPackageFieldMap): ColumnMap {
  const autoMap = buildColumnMap(columns);
  if (!fieldMap) return autoMap;

  const allowed = new Set(columns);
  const next: ColumnMap = { ...autoMap };
  for (const [key, value] of Object.entries(fieldMap) as Array<[keyof ColumnMap, string]>) {
    const cleaned = typeof value === "string" ? value.trim() : "";
    if (!cleaned) continue;
    if (!allowed.has(cleaned)) continue;
    next[key] = cleaned;
  }

  return next;
}

function getRowValue(row: GenericRow, columnName?: string): unknown {
  if (!columnName) return undefined;
  return row[columnName];
}

function listGeoPackageTables(db: Database.Database): GpkgTableInfo[] {
  if (hasTable(db, "gpkg_contents")) {
    const rows = db
      .prepare("SELECT table_name, data_type FROM gpkg_contents WHERE data_type IN ('features', 'attributes')")
      .all() as GpkgContentRow[];

    return rows.map((row) => ({
      tableName: row.table_name,
      dataType: row.data_type,
    }));
  }

  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'gpkg_%'")
    .all() as Array<{ name: string }>;

  return rows.map((row) => ({ tableName: row.name, dataType: "unknown" }));
}

function listGeometryColumns(db: Database.Database): Map<string, { columnName: string; srid: number | null }> {
  const map = new Map<string, { columnName: string; srid: number | null }>();

  if (!hasTable(db, "gpkg_geometry_columns")) return map;

  const rows = db
    .prepare("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns")
    .all() as GpkgGeometryColumn[];

  for (const row of rows) {
    map.set(row.table_name, {
      columnName: row.column_name,
      srid: row.srs_id ?? null,
    });
  }

  return map;
}

function readTableColumns(db: Database.Database, tableName: string): string[] {
  const pragmaRows = db
    .prepare(`PRAGMA table_info("${escapeIdentifier(tableName)}")`)
    .all() as Array<{ name: string }>;
  return pragmaRows.map((row) => row.name);
}

function serializePreviewValue(value: unknown): string | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return `<BLOB ${value.length} bytes>`;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const encoded = JSON.stringify(value);
    if (!encoded) return null;
    return encoded.length > 300 ? `${encoded.slice(0, 300)}...` : encoded;
  } catch {
    return String(value);
  }
}

function readLayerStyle(
  db: Database.Database,
  tableName: string,
): { styleName: string | null; hasQml: boolean; hasSld: boolean; qml: string | null; sld: string | null } | null {
  if (!hasTable(db, "layer_styles")) return null;

  const columns = readTableColumns(db, "layer_styles");
  const normalized = new Map(columns.map((column) => [normalizeColumnName(column), column]));

  const tableColumn =
    normalized.get("ftablename") ||
    normalized.get("tablename") ||
    normalized.get("layername");
  if (!tableColumn) return null;

  const styleNameColumn =
    normalized.get("stylename") ||
    normalized.get("name");
  const qmlColumn =
    normalized.get("styleqml") ||
    normalized.get("qml");
  const sldColumn =
    normalized.get("stylesld") ||
    normalized.get("sld");

  const row = db
    .prepare(`SELECT * FROM "layer_styles" WHERE "${escapeIdentifier(tableColumn)}" = ? LIMIT 1`)
    .get(tableName) as Record<string, unknown> | undefined;
  if (!row) return null;

  const styleName = styleNameColumn ? toNullableString(row[styleNameColumn]) : null;
  const qml = qmlColumn ? toNullableString(row[qmlColumn]) : null;
  const sld = sldColumn ? toNullableString(row[sldColumn]) : null;

  return {
    styleName,
    hasQml: !!qml,
    hasSld: !!sld,
    qml,
    sld,
  };
}

function gpkgEnvelopeBytes(flags: number): number {
  const envelopeIndicator = (flags >> 1) & 0x07;
  if (envelopeIndicator === 0) return 0;
  if (envelopeIndicator === 1) return 32;
  if (envelopeIndicator === 2 || envelopeIndicator === 3) return 48;
  if (envelopeIndicator === 4) return 64;
  return 0;
}

function parseGpkgGeometryBlob(raw: unknown): any | null {
  if (!Buffer.isBuffer(raw)) return null;
  if (raw.length < 8) return null;

  // GeoPackageBinary: "GP" magic + version + flags + srs_id + optional envelope + WKB.
  if (raw[0] !== 0x47 || raw[1] !== 0x50) return null;

  const flags = raw[3];
  const offset = 8 + gpkgEnvelopeBytes(flags);
  if (offset >= raw.length) return null;

  try {
    const geometry = (wkx as any).Geometry.parse(raw.subarray(offset));
    return geometry?.toGeoJSON?.() || null;
  } catch {
    return null;
  }
}

function pickFirstColor(styleText: string | null | undefined): string | null {
  if (!styleText) return null;

  const hexMatch = styleText.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})/);
  if (hexMatch) {
    return `#${hexMatch[1].slice(0, 6)}`;
  }

  const rgbMatch = styleText.match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));
    const hex = [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }

  return null;
}

function defaultStyleHint(style: { qml: string | null; sld: string | null } | null) {
  const color = pickFirstColor(style?.qml) || pickFirstColor(style?.sld) || "#2563eb";
  return {
    strokeColor: color,
    fillColor: color,
    fillOpacity: 0.24,
    weight: 2,
  };
}

function createTempDbFromBuffer(fileBuffer: Buffer, extension: ".gpkg" | ".sqlite" = ".gpkg") {
  const tempFileName = `archeodoc-import-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  const tempPath = path.join(os.tmpdir(), tempFileName);
  fs.writeFileSync(tempPath, fileBuffer);
  const db = new Database(tempPath, { fileMustExist: true, readonly: true });
  return {
    db,
    tempPath,
  };
}

export function previewGeoPackage(input: GeoPackagePreviewInput): GeoPackagePreviewResult {
  const { fileBuffer, originalName } = input;
  const warnings: string[] = [];
  const tablesOut: GeoPackagePreviewTable[] = [];

  const { db, tempPath } = createTempDbFromBuffer(fileBuffer, ".gpkg");

  try {
    const tables = listGeoPackageTables(db);
    const geometryColumns = listGeometryColumns(db);

    for (const table of tables) {
      const columns = readTableColumns(db, table.tableName);
      const autoMap = buildColumnMap(columns);
      const geometryInfo = geometryColumns.get(table.tableName);

      const rowCountRow = db
        .prepare(`SELECT COUNT(1) as total FROM "${escapeIdentifier(table.tableName)}"`)
        .get() as { total: number };
      const rowCount = Number(rowCountRow?.total || 0);

      const sampleRowsRaw = db
        .prepare(`SELECT * FROM "${escapeIdentifier(table.tableName)}" LIMIT 5`)
        .all() as GenericRow[];
      const sampleRows = sampleRowsRaw.map((row) =>
        Object.fromEntries(
          columns.map((column) => [column, serializePreviewValue(row[column])]),
        ),
      );

      if (!autoMap.codiceUS) {
        warnings.push(`Tabella ${table.tableName}: colonna codice US non riconosciuta automaticamente.`);
      }

      tablesOut.push({
        tableName: table.tableName,
        dataType: table.dataType,
        rowCount,
        columns,
        geometryColumn: geometryInfo?.columnName || null,
        srid: geometryInfo?.srid ?? null,
        autoMap,
        sampleRows,
        style: readLayerStyle(db, table.tableName),
      });
    }

    return {
      sourceFileName: originalName,
      tables: tablesOut,
      warnings,
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export function previewGeoPackageWebMap(input: GeoPackageWebMapPreviewInput): GeoPackageWebMapPreviewResult {
  const { fileBuffer, originalName, tableName, limit } = input;
  const warnings: string[] = [];
  const maxFeatures = Number.isFinite(limit as number)
    ? Math.max(1, Math.min(5000, Number(limit)))
    : 1200;

  const { db, tempPath } = createTempDbFromBuffer(fileBuffer, ".gpkg");

  try {
    const tables = listGeoPackageTables(db);
    const geometryColumns = listGeometryColumns(db);
    const tablesWithGeometry = tables
      .map((table) => {
        const geom = geometryColumns.get(table.tableName);
        if (!geom) return null;
        const rowCountRow = db
          .prepare(`SELECT COUNT(1) as total FROM "${escapeIdentifier(table.tableName)}"`)
          .get() as { total: number };
        return {
          tableName: table.tableName,
          dataType: table.dataType,
          rowCount: Number(rowCountRow?.total || 0),
          geometryColumn: geom.columnName,
          srid: geom.srid ?? null,
        };
      })
      .filter((table): table is NonNullable<typeof table> => !!table);

    if (tablesWithGeometry.length === 0) {
      return {
        sourceFileName: originalName,
        tableName: "",
        tables: [],
        featureCollection: { type: "FeatureCollection", features: [] },
        styleHint: defaultStyleHint(null),
        warnings: ["Nessun layer geometrico trovato nel GeoPackage."],
      };
    }

    const active =
      (tableName && tablesWithGeometry.find((table) => table.tableName === tableName)) ||
      tablesWithGeometry[0];
    const geometryColumn = active.geometryColumn;
    const columns = readTableColumns(db, active.tableName);
    const style = readLayerStyle(db, active.tableName);

    if (tableName && active.tableName !== tableName) {
      warnings.push(`Tabella '${tableName}' non trovata o senza geometria. Usata '${active.tableName}'.`);
    }

    const rows = db
      .prepare(`SELECT * FROM "${escapeIdentifier(active.tableName)}" LIMIT ${maxFeatures}`)
      .all() as GenericRow[];

    const features: Array<{ type: "Feature"; geometry: any; properties: Record<string, unknown> }> = [];
    for (const row of rows) {
      const geometry = parseGpkgGeometryBlob(row[geometryColumn]);
      if (!geometry) continue;

      const properties: Record<string, unknown> = {};
      for (const column of columns) {
        if (column === geometryColumn) continue;
        properties[column] = serializePreviewValue(row[column]);
      }

      features.push({
        type: "Feature",
        geometry,
        properties,
      });
    }

    if (features.length === 0) {
      warnings.push(`Nessuna geometria decodificabile trovata in '${active.tableName}'.`);
    }

    return {
      sourceFileName: originalName,
      tableName: active.tableName,
      tables: tablesWithGeometry,
      featureCollection: {
        type: "FeatureCollection",
        features,
      },
      styleHint: defaultStyleHint(style),
      warnings,
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export function importUSFromGeoPackage(input: GeoPackageImportInput): GeoPackageImportResult {
  const {
    storage,
    cantiereId,
    giornataId,
    fileBuffer,
    originalName,
    usThesaurus,
    tableName,
    fieldMap,
    importUnknownColumns,
  } = input;
  const warnings: string[] = [];
  const tablesImported: string[] = [];

  const existingCodes = new Set(
    storage
      .getUSList(cantiereId)
      .map((us) => normalizedCodeKey(us.codiceUS)),
  );

  const { db, tempPath } = createTempDbFromBuffer(fileBuffer, ".gpkg");

  let rowsScanned = 0;
  let created = 0;
  let skippedWithoutCode = 0;
  let skippedDuplicateCode = 0;

  try {
    const tablesAll = listGeoPackageTables(db);
    const geometryColumns = listGeometryColumns(db);
    const tables = tableName
      ? tablesAll.filter((item) => item.tableName === tableName)
      : tablesAll;

    if (tableName && tables.length === 0) {
      warnings.push(`Tabella '${tableName}' non trovata nel GeoPackage.`);
      return {
        sourceFileName: originalName,
        tableName,
        tablesScanned: 0,
        tablesImported: [],
        rowsScanned: 0,
        created: 0,
        skippedWithoutCode: 0,
        skippedDuplicateCode: 0,
        warnings,
      };
    }

    for (const table of tables) {
      const currentTableName = table.tableName;
      const columns = readTableColumns(db, currentTableName);
      const map = buildEffectiveColumnMap(columns, fieldMap);

      if (!map.codiceUS) {
        warnings.push(`Tabella ${currentTableName} ignorata: colonna codice US non trovata.`);
        continue;
      }

      const stmt = db.prepare(`SELECT * FROM "${escapeIdentifier(currentTableName)}"`);
      const rows = stmt.all() as GenericRow[];
      let tableImportedRecords = 0;

      const geometryInfo = geometryColumns.get(currentTableName);
      const usedColumns = new Set(
        Object.values(map)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      );
      if (geometryInfo?.columnName) {
        usedColumns.add(geometryInfo.columnName);
      }

      for (const row of rows) {
        rowsScanned += 1;

        const rawCode = toNullableString(getRowValue(row, map.codiceUS));
        if (!rawCode) {
          skippedWithoutCode += 1;
          continue;
        }

        const codiceUS = normalizeUsCode(rawCode);
        const codeKey = normalizedCodeKey(codiceUS);

        if (existingCodes.has(codeKey)) {
          skippedDuplicateCode += 1;
          continue;
        }

        const hasGeometry =
          !!geometryInfo && getRowValue(row, geometryInfo.columnName) != null;
        const tipoRaw = toNullableString(getRowValue(row, map.tipo));
        const tipo = normalizeUsTipoWithVocabulary(tipoRaw, usThesaurus?.tipo);
        const definizione = normalizeUsDefinizioneWithVocabulary(
          toNullableString(getRowValue(row, map.definizione)),
          tipo ?? tipoRaw,
          usThesaurus?.definizione,
        );

        let schedaData: Record<string, string> | null = null;
        if (importUnknownColumns) {
          const extra: Record<string, string> = {};
          for (const column of columns) {
            if (usedColumns.has(column)) continue;
            const serialized = serializePreviewValue(row[column]);
            if (!serialized) continue;
            extra[column] = serialized;
          }
          if (Object.keys(extra).length > 0) {
            schedaData = extra;
          }
        }

        storage.createUS({
          cantiereId,
          giornataId: giornataId ?? null,
          codiceUS,
          tipo,
          definizione,
          descrizione: toNullableString(getRowValue(row, map.descrizione)),
          interpretazione: toNullableString(getRowValue(row, map.interpretazione)),
          quota: toNullableNumber(getRowValue(row, map.quota)),
          settore: toNullableString(getRowValue(row, map.settore)),
          coperto_da: relationFieldValue(getRowValue(row, map.copertoDa)),
          copre: relationFieldValue(getRowValue(row, map.copre)),
          si_lega_a: relationFieldValue(getRowValue(row, map.siLegaA)),
          uguale_a: relationFieldValue(getRowValue(row, map.ugualeA)),
          periodoIniziale: toNullableString(getRowValue(row, map.periodoIniziale)),
          periodoFinale: toNullableString(getRowValue(row, map.periodoFinale)),
          materialiRinvenuti: toNullableString(getRowValue(row, map.materiali)),
          campioni: toNullableString(getRowValue(row, map.campioni)),
          haGps: hasGeometry ? 1 : 0,
          srid: geometryInfo?.srid ?? 4326,
          schedaData: schedaData ? JSON.stringify(schedaData) : null,
        });

        created += 1;
        tableImportedRecords += 1;
        existingCodes.add(codeKey);
      }

      if (tableImportedRecords > 0) {
        tablesImported.push(currentTableName);
      }
    }

    if (created === 0) {
      warnings.push("Nessuna US importata dal GeoPackage: controlla tabella, mappatura colonne e codici US.");
    }

    return {
      sourceFileName: originalName,
      tableName: tableName || null,
      tablesScanned: tables.length,
      tablesImported,
      rowsScanned,
      created,
      skippedWithoutCode,
      skippedDuplicateCode,
      warnings,
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors
    }

    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
