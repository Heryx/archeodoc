import type { Express } from "express";
import type multer from "multer";
import type Database from "better-sqlite3";
import { previewGeoPackageWebMap } from "../geopackage_import";
import type { WithProject } from "./types";
import {
  detectGeometryType,
  deleteWebMapLayer,
  ensureWebMapTables,
  getLayerFeatureCollection,
  getWebMapLayer,
  getWebMapLayers,
  saveLayerFeatures,
  updateLayerStyle,
  updateLayerVisibility,
  updateLayerZIndex,
  upsertWebMapLayer,
} from "../webmap_layers";

function getSqliteDb(storage: unknown): Database.Database {
  const sqlite = (storage as { sqlite?: Database.Database })?.sqlite;
  if (!sqlite || typeof sqlite.prepare !== "function") {
    throw new Error("Storage sqlite non disponibile");
  }
  return sqlite;
}

function toLayerTableName() {
  return `layer_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function registerWebMapRoutes(
  app: Express,
  helpers: {
    withProject: WithProject;
    gpkgUpload: multer.Multer;
  },
) {
  const { withProject, gpkgUpload } = helpers;

  app.get("/api/cantieri/:cid/webmap/layers", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const db = getSqliteDb(ctx.storage);
    ensureWebMapTables(db);
    res.json(getWebMapLayers(db, cid));
  }));

  app.post("/api/cantieri/:cid/webmap/layers", gpkgUpload.single("file"), withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "File mancante" });

    const db = getSqliteDb(ctx.storage);
    ensureWebMapTables(db);

    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    const displayName =
      typeof req.body?.displayName === "string" && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : file.originalname.replace(/\.[^.]+$/, "");
    const tableName = toLayerTableName();

    try {
      let features: Array<{
        type: "Feature";
        geometry: any;
        properties: Record<string, unknown>;
      }> = [];
      let sridOriginal: number | null = null;
      let styleJson: string | null = null;
      const warnings: string[] = [];

      if (ext === "gpkg") {
        const preview = await previewGeoPackageWebMap({
          fileBuffer: file.buffer,
          originalName: file.originalname,
          limit: 5000,
          tableName: typeof req.body?.tableName === "string" ? req.body.tableName.trim() : undefined,
        });
        features = preview.featureCollection.features;
        sridOriginal = preview.tables.find((table) => table.tableName === preview.tableName)?.srid ?? null;
        styleJson = JSON.stringify(preview.styleHint);
        warnings.push(...(preview.warnings || []));
      } else if (ext === "geojson" || ext === "json") {
        const parsed = JSON.parse(file.buffer.toString("utf8"));
        if (parsed?.type === "FeatureCollection") {
          features = Array.isArray(parsed.features) ? parsed.features : [];
        } else if (parsed?.type === "Feature") {
          features = [parsed];
        } else {
          return res.status(400).json({ error: "GeoJSON non valido" });
        }
        sridOriginal = 4326;
      } else {
        return res.status(400).json({ error: `Formato .${ext || "?"} non supportato. Usa .gpkg o .geojson` });
      }

      const geometryType = detectGeometryType(features);
      const layer = upsertWebMapLayer(db, {
        cantiereId: cid,
        tableName,
        displayName,
        sourceFileName: file.originalname,
        sourceFormat: ext === "gpkg" ? "gpkg" : "geojson",
        sridOriginal,
        featureCount: features.length,
        geometryType,
        styleJson,
      });

      saveLayerFeatures(db, tableName, features);
      return res.json({ layer, warnings });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Import layer fallito" });
    }
  }));

  app.get("/api/cantieri/:cid/webmap/layers/:id/geojson", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const db = getSqliteDb(ctx.storage);
    const layer = getWebMapLayer(db, Number(req.params.id));
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });

    const limitRaw = Number(req.query.limit ?? 5000);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 5000;
    return res.json(getLayerFeatureCollection(db, layer.tableName, limit));
  }));

  app.patch("/api/cantieri/:cid/webmap/layers/:id/visibility", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const db = getSqliteDb(ctx.storage);
    const id = Number(req.params.id);
    const layer = getWebMapLayer(db, id);
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });

    if (typeof req.body?.visible !== "boolean") {
      return res.status(400).json({ error: "visible (boolean) obbligatorio" });
    }
    updateLayerVisibility(db, id, req.body.visible);
    return res.json({ ok: true });
  }));

  app.patch("/api/cantieri/:cid/webmap/layers/:id/style", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const db = getSqliteDb(ctx.storage);
    const id = Number(req.params.id);
    const layer = getWebMapLayer(db, id);
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });

    const styleJson = req.body?.styleJson;
    if (typeof styleJson !== "string") {
      return res.status(400).json({ error: "styleJson (string) obbligatorio" });
    }
    updateLayerStyle(db, id, styleJson);
    return res.json({ ok: true });
  }));

  app.patch("/api/cantieri/:cid/webmap/layers/:id/zindex", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const db = getSqliteDb(ctx.storage);
    const id = Number(req.params.id);
    const layer = getWebMapLayer(db, id);
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });

    const zIndex = Number(req.body?.zIndex);
    if (!Number.isFinite(zIndex)) {
      return res.status(400).json({ error: "zIndex (number) obbligatorio" });
    }
    updateLayerZIndex(db, id, Math.trunc(zIndex));
    return res.json({ ok: true });
  }));

  app.delete("/api/cantieri/:cid/webmap/layers/:id", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const db = getSqliteDb(ctx.storage);
    const id = Number(req.params.id);
    const layer = getWebMapLayer(db, id);
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });

    const ok = deleteWebMapLayer(db, id);
    if (!ok) return res.status(404).json({ error: "Layer non trovato" });
    return res.json({ ok: true });
  }));
}
