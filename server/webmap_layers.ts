import type Database from "better-sqlite3";

export type WebMapLayerRecord = {
  id: number;
  cantiereId: number;
  tableName: string;
  displayName: string;
  sourceFileName: string;
  sourceFormat: "gpkg" | "geojson" | "kml" | "csv";
  sridOriginal: number | null;
  featureCount: number;
  geometryType: string | null;
  styleJson: string | null;
  visible: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
};

type WebMapLayerRow = {
  id: number;
  cantiere_id: number;
  table_name: string;
  display_name: string;
  source_file_name: string;
  source_format: string;
  srid_original: number | null;
  feature_count: number;
  geometry_type: string | null;
  style_json: string | null;
  visible: number;
  z_index: number;
  created_at: string;
  updated_at: string;
};

function rowToLayer(row: WebMapLayerRow): WebMapLayerRecord {
  return {
    id: row.id,
    cantiereId: row.cantiere_id,
    tableName: row.table_name,
    displayName: row.display_name,
    sourceFileName: row.source_file_name,
    sourceFormat: row.source_format as WebMapLayerRecord["sourceFormat"],
    sridOriginal: row.srid_original,
    featureCount: row.feature_count,
    geometryType: row.geometry_type,
    styleJson: row.style_json,
    visible: row.visible === 1,
    zIndex: row.z_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureWebMapTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webmap_layers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id      INTEGER NOT NULL,
      table_name       TEXT    NOT NULL UNIQUE,
      display_name     TEXT    NOT NULL,
      source_file_name TEXT    NOT NULL DEFAULT '',
      source_format    TEXT    NOT NULL DEFAULT 'gpkg',
      srid_original    INTEGER,
      feature_count    INTEGER NOT NULL DEFAULT 0,
      geometry_type    TEXT,
      style_json       TEXT,
      visible          INTEGER NOT NULL DEFAULT 1,
      z_index          INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webmap_features (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      layer_table_name TEXT    NOT NULL,
      geojson          TEXT    NOT NULL,
      props            TEXT    NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_webmap_layers_cantiere
      ON webmap_layers(cantiere_id);

    CREATE INDEX IF NOT EXISTS idx_webmap_features_layer
      ON webmap_features(layer_table_name);
  `);
}

export function getWebMapLayers(db: Database.Database, cantiereId: number): WebMapLayerRecord[] {
  const rows = db
    .prepare("SELECT * FROM webmap_layers WHERE cantiere_id = ? ORDER BY z_index ASC, id ASC")
    .all(cantiereId) as WebMapLayerRow[];
  return rows.map(rowToLayer);
}

export function getWebMapLayer(db: Database.Database, id: number): WebMapLayerRecord | null {
  const row = db.prepare("SELECT * FROM webmap_layers WHERE id = ?").get(id) as WebMapLayerRow | undefined;
  return row ? rowToLayer(row) : null;
}

export function getWebMapLayerByTableName(db: Database.Database, tableName: string): WebMapLayerRecord | null {
  const row = db
    .prepare("SELECT * FROM webmap_layers WHERE table_name = ?")
    .get(tableName) as WebMapLayerRow | undefined;
  return row ? rowToLayer(row) : null;
}

export function upsertWebMapLayer(
  db: Database.Database,
  data: {
    cantiereId: number;
    tableName: string;
    displayName: string;
    sourceFileName: string;
    sourceFormat: WebMapLayerRecord["sourceFormat"];
    sridOriginal: number | null;
    featureCount: number;
    geometryType: string | null;
    styleJson: string | null;
    visible?: boolean;
    zIndex?: number;
  },
): WebMapLayerRecord {
  const existing = getWebMapLayerByTableName(db, data.tableName);
  if (existing) {
    db.prepare(`
      UPDATE webmap_layers SET
        display_name = ?,
        source_file_name = ?,
        source_format = ?,
        srid_original = ?,
        feature_count = ?,
        geometry_type = ?,
        style_json = ?,
        visible = ?,
        z_index = ?,
        updated_at = datetime('now')
      WHERE table_name = ?
    `).run(
      data.displayName,
      data.sourceFileName,
      data.sourceFormat,
      data.sridOriginal,
      data.featureCount,
      data.geometryType,
      data.styleJson,
      data.visible === false ? 0 : 1,
      data.zIndex ?? existing.zIndex,
      data.tableName,
    );
    return getWebMapLayerByTableName(db, data.tableName)!;
  }

  const maxZ = (
    db
      .prepare("SELECT MAX(z_index) as m FROM webmap_layers WHERE cantiere_id = ?")
      .get(data.cantiereId) as { m: number | null }
  ).m ?? -1;

  const result = db.prepare(`
    INSERT INTO webmap_layers (
      cantiere_id, table_name, display_name, source_file_name, source_format,
      srid_original, feature_count, geometry_type, style_json, visible, z_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.cantiereId,
    data.tableName,
    data.displayName,
    data.sourceFileName,
    data.sourceFormat,
    data.sridOriginal,
    data.featureCount,
    data.geometryType,
    data.styleJson,
    data.visible === false ? 0 : 1,
    data.zIndex ?? maxZ + 1,
  );

  return getWebMapLayer(db, Number(result.lastInsertRowid))!;
}

export function updateLayerVisibility(db: Database.Database, id: number, visible: boolean) {
  db.prepare("UPDATE webmap_layers SET visible = ?, updated_at = datetime('now') WHERE id = ?")
    .run(visible ? 1 : 0, id);
}

export function updateLayerStyle(db: Database.Database, id: number, styleJson: string) {
  db.prepare("UPDATE webmap_layers SET style_json = ?, updated_at = datetime('now') WHERE id = ?")
    .run(styleJson, id);
}

export function updateLayerZIndex(db: Database.Database, id: number, zIndex: number) {
  db.prepare("UPDATE webmap_layers SET z_index = ?, updated_at = datetime('now') WHERE id = ?")
    .run(zIndex, id);
}

export function deleteWebMapLayer(db: Database.Database, id: number): boolean {
  const layer = getWebMapLayer(db, id);
  if (!layer) return false;
  db.prepare("DELETE FROM webmap_features WHERE layer_table_name = ?").run(layer.tableName);
  db.prepare("DELETE FROM webmap_layers WHERE id = ?").run(id);
  return true;
}

export function saveLayerFeatures(
  db: Database.Database,
  tableName: string,
  features: Array<{ geometry: unknown; properties: Record<string, unknown> }>,
) {
  const remove = db.prepare("DELETE FROM webmap_features WHERE layer_table_name = ?");
  const insert = db.prepare(
    "INSERT INTO webmap_features (layer_table_name, geojson, props) VALUES (?, ?, ?)",
  );

  const tx = db.transaction(() => {
    remove.run(tableName);
    for (const feature of features) {
      insert.run(
        tableName,
        JSON.stringify(feature.geometry ?? null),
        JSON.stringify(feature.properties ?? {}),
      );
    }
  });
  tx();
}

export function getLayerFeatureCollection(
  db: Database.Database,
  tableName: string,
  limit = 5000,
): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: any;
    properties: Record<string, unknown>;
  }>;
} {
  const rows = db
    .prepare("SELECT geojson, props FROM webmap_features WHERE layer_table_name = ? LIMIT ?")
    .all(tableName, Math.max(1, limit)) as Array<{ geojson: string; props: string }>;

  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: JSON.parse(row.geojson),
      properties: JSON.parse(row.props || "{}"),
    })),
  };
}

export function detectGeometryType(features: Array<{ geometry: { type?: string } | null }>): string | null {
  const types = new Set(
    features
      .map((feature) => feature.geometry?.type)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (types.size === 0) return null;
  if (types.size === 1) return Array.from(types)[0];
  return "Mixed";
}
