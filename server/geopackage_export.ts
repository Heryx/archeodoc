import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import wkx from "wkx";

type GeoJsonFeature = {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties?: Record<string, unknown>;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

function sanitizeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 80) || "webmap-sketches";
}

function geometryToGpkgBlob(geometry: NonNullable<GeoJsonFeature["geometry"]>, srid = 4326): Buffer {
  const wkb = (wkx as any).Geometry.parseGeoJSON(geometry).toWkb() as Buffer;
  const header = Buffer.alloc(8);
  header[0] = 0x47; // G
  header[1] = 0x50; // P
  header[2] = 0x00; // version
  header[3] = 0x01; // little-endian, envelope=0
  header.writeInt32LE(srid, 4);
  return Buffer.concat([header, wkb]);
}

function detectGeometryTypeName(features: GeoJsonFeature[]): string {
  const typeSet = new Set<string>();
  for (const feature of features) {
    const type = feature.geometry?.type;
    if (!type) continue;
    if (type.includes("Point")) typeSet.add("POINT");
    else if (type.includes("LineString")) typeSet.add("LINESTRING");
    else if (type.includes("Polygon")) typeSet.add("POLYGON");
    else typeSet.add("GEOMETRY");
  }
  if (typeSet.size !== 1) return "GEOMETRY";
  return Array.from(typeSet)[0] || "GEOMETRY";
}

export function exportSketchesToGeoPackage(input: {
  outputDir: string;
  cantiereId: number;
  title: string;
  featureCollection: GeoJsonFeatureCollection;
}) {
  const { outputDir, cantiereId, title, featureCollection } = input;
  const filteredFeatures = (featureCollection.features || []).filter((feature) => !!feature.geometry);
  if (filteredFeatures.length === 0) {
    throw new Error("Nessuna geometria valida da esportare");
  }

  const slug = sanitizeSlug(title);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${slug}.gpkg`;
  const tableName = "webmap_sketches";
  const geometryColumn = "geom";
  const relativePath = path.posix.join("_webmap_sketches", String(cantiereId), fileName);
  const absolutePath = path.join(outputDir, "_webmap_sketches", String(cantiereId), fileName);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { force: true });

  const db = new Database(absolutePath);
  try {
    db.exec(`
      PRAGMA application_id = 1196437808;
      PRAGMA user_version = 10300;
      PRAGMA foreign_keys = ON;

      CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
      );

      CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT UNIQUE,
        description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        min_x DOUBLE,
        min_y DOUBLE,
        max_x DOUBLE,
        max_y DOUBLE,
        srs_id INTEGER,
        CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
      );

      CREATE TABLE gpkg_geometry_columns (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL,
        m TINYINT NOT NULL,
        PRIMARY KEY (table_name, column_name),
        CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
        CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
      );
    `);

    const insertSrs = db.prepare(
      "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertSrs.run("Undefined Cartesian SRS", -1, "NONE", -1, "undefined", "undefined Cartesian coordinate reference system");
    insertSrs.run("Undefined Geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic coordinate reference system");
    insertSrs.run(
      "WGS 84 geodetic",
      4326,
      "EPSG",
      4326,
      "GEOGCS[\"WGS 84\",DATUM[\"World Geodetic System 1984\",SPHEROID[\"WGS 84\",6378137,298.257223563]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433]]",
      "longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid",
    );

    db.exec(`
      CREATE TABLE "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        "${geometryColumn}" BLOB NOT NULL,
        geom_type TEXT,
        properties_json TEXT
      );
    `);

    const geometryTypeName = detectGeometryTypeName(filteredFeatures);
    db.prepare(
      "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id) VALUES (?, 'features', ?, ?, 4326)",
    ).run(tableName, tableName, `WebMap sketches export: ${title}`);
    db.prepare(
      "INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?, ?, ?, 4326, 0, 0)",
    ).run(tableName, geometryColumn, geometryTypeName);

    const insertFeature = db.prepare(
      `INSERT INTO "${tableName}" ("${geometryColumn}", geom_type, properties_json) VALUES (?, ?, ?)`,
    );

    const insertMany = db.transaction((features: GeoJsonFeature[]) => {
      for (const feature of features) {
        if (!feature.geometry) continue;
        const blob = geometryToGpkgBlob(feature.geometry, 4326);
        const geomType = feature.geometry.type || null;
        const propertiesJson = feature.properties ? JSON.stringify(feature.properties) : null;
        insertFeature.run(blob, geomType, propertiesJson);
      }
    });
    insertMany(filteredFeatures);

    return {
      fileName,
      relativePath,
      absolutePath,
      featureCount: filteredFeatures.length,
      tableName,
    };
  } finally {
    db.close();
  }
}

