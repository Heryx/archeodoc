import fs from "fs";
import path from "path";
import type { Express } from "express";
import type multer from "multer";
import type Database from "better-sqlite3";
import { previewGeoPackageWebMap } from "../geopackage_import";
import { parseShp, parseDbf, combineShp } from "../shapefile_parse";
import { parseWorldFile, readImageDimensions, computeRasterBoundsWgs84 } from "../raster_georef";
import type { WithProject } from "./types";
import {
  detectGeometryType,
  deleteWebMapLayer,
  ensureWebMapTables,
  getLayerFeatureCollection,
  getWebMapLayer,
  getWebMapLayerByDisplayName,
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

  app.post(
    "/api/cantieri/:cid/webmap/import-project",
    gpkgUpload.array("files", 1000),
    withProject(async (ctx, req, res) => {
      const cid = Number(req.params.cid);
      const cantiere = ctx.storage.getCantiere(cid);
      if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (files.length === 0) {
        return res.status(400).json({ error: "Nessun file ricevuto. Seleziona la cartella del progetto QGIS." });
      }

      const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
      const decodeOriginalName = (name: string) => {
        try {
          return decodeURIComponent(name);
        } catch {
          return name;
        }
      };
      const byPath = new Map<string, Express.Multer.File>();
      for (const file of files) {
        byPath.set(normalize(decodeOriginalName(file.originalname)), file);
      }

      const manifestEntry = Array.from(byPath.entries()).find(([path]) =>
        path.endsWith("archeodoc/manifest.json"),
      );
      if (!manifestEntry) {
        return res.status(400).json({
          error:
            "Nessun manifest.json trovato nella cartella selezionata. Esegui prima 'Verifica progetto ArcheoDoc' dal plugin QGIS.",
        });
      }
      const [manifestPath, manifestFile] = manifestEntry;
      const projectRoot = manifestPath.slice(0, manifestPath.length - "archeodoc/manifest.json".length);

      let manifest: { layers?: Array<Record<string, unknown>> };
      try {
        manifest = JSON.parse(manifestFile.buffer.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "manifest.json non leggibile (JSON non valido)." });
      }

      const reportPath = Array.from(byPath.keys()).find((path) => path.endsWith("archeodoc/report.json"));
      let checkReport: { errorCount?: number; warningCount?: number } | null = null;
      if (reportPath) {
        try {
          checkReport = JSON.parse(byPath.get(reportPath)!.buffer.toString("utf8"));
        } catch {
          checkReport = null;
        }
      }

      const db = getSqliteDb(ctx.storage);
      ensureWebMapTables(db);

      const imported: Array<{ name: string; format: string; featureCount: number }> = [];
      const skipped: Array<{ name: string; format: string; reason: string }> = [];

      const RASTER_FORMATS = new Set(["png", "jpg", "jpeg"]);

      try {
      for (const entry of manifest.layers || []) {
        const name = String(entry.name ?? entry.path ?? "layer");
        const format = String(entry.format ?? "");
        const relPath = String(entry.path ?? "");

        if (format === "tif" || format === "tiff") {
          skipped.push({
            name,
            format,
            reason:
              "I GeoTIFF non sono ancora supportati (richiede una decodifica non implementata). In QGIS puoi esportare il raster come PNG georeferenziato (Esporta > Salva con nome, formato PNG, spunta 'Crea file world') e rilanciare il check.",
          });
          continue;
        }

        if (format !== "gpkg" && format !== "geojson" && format !== "shp" && !RASTER_FORMATS.has(format)) {
          skipped.push({ name, format, reason: "Formato non ancora supportato dall'import cartella (usa il caricamento manuale)." });
          continue;
        }

        const resolvedPath = normalize(`${projectRoot}${relPath}`);

        if (RASTER_FORMATS.has(format)) {
          try {
            const imageFile = byPath.get(resolvedPath) || byPath.get(normalize(relPath));
            if (!imageFile) {
              skipped.push({ name, format, reason: `File immagine non trovato tra quelli caricati (atteso: "${resolvedPath}").` });
              continue;
            }
            const worldFileRelPath = typeof entry.worldFilePath === "string" ? entry.worldFilePath : null;
            if (!worldFileRelPath) {
              skipped.push({ name, format, reason: "Raster non georeferenziato: manca il world file (.pgw/.jgw/.wld)." });
              continue;
            }
            const resolvedWorldPath = normalize(`${projectRoot}${worldFileRelPath}`);
            const worldFile = byPath.get(resolvedWorldPath) || byPath.get(normalize(worldFileRelPath));
            if (!worldFile) {
              skipped.push({ name, format, reason: `World file indicato dal manifest non trovato tra i file caricati (atteso: "${resolvedWorldPath}").` });
              continue;
            }

            const dimensions = readImageDimensions(imageFile.buffer, format);
            if (!dimensions) {
              skipped.push({ name, format, reason: "Impossibile leggere le dimensioni dell'immagine (file corrotto o non valido)." });
              continue;
            }
            const worldFileParams = parseWorldFile(worldFile.buffer.toString("utf8"));
            if (!worldFileParams) {
              skipped.push({ name, format, reason: "World file non leggibile (attese 6 righe numeriche)." });
              continue;
            }

            const sourceCrs = typeof entry.crs === "string" ? entry.crs : null;
            const bounds = await computeRasterBoundsWgs84(dimensions.width, dimensions.height, worldFileParams, sourceCrs);
            if ("error" in bounds) {
              skipped.push({ name, format, reason: bounds.error });
              continue;
            }

            const decodedImageName = decodeOriginalName(imageFile.originalname);
            const safeFileName = (decodedImageName.split("/").pop() || `raster-${Date.now()}.${format}`).replace(
              /[^a-zA-Z0-9._-]/g,
              "_",
            );
            const rasterDir = path.join(ctx.project.mediaDir, "webmap_rasters", String(cid));
            fs.mkdirSync(rasterDir, { recursive: true });
            const rasterFileName = `${Date.now()}_${safeFileName}`;
            fs.writeFileSync(path.join(rasterDir, rasterFileName), imageFile.buffer);
            const rasterRelativePath = `webmap_rasters/${cid}/${rasterFileName}`;

            // Un layer con lo stesso nome nello stesso cantiere viene aggiornato, non duplicato:
            // altrimenti ogni "Importa cartella progetto" ripetuto crea copie infinite.
            const existingLayer = getWebMapLayerByDisplayName(db, cid, name);
            if (existingLayer?.kind === "raster" && existingLayer.rasterPath) {
              const oldAbsolutePath = path.resolve(ctx.project.mediaDir, existingLayer.rasterPath);
              const mediaRoot = path.resolve(ctx.project.mediaDir);
              if (
                (oldAbsolutePath === mediaRoot || oldAbsolutePath.startsWith(`${mediaRoot}${path.sep}`)) &&
                fs.existsSync(oldAbsolutePath)
              ) {
                try {
                  fs.unlinkSync(oldAbsolutePath);
                } catch {
                  // non bloccare l'aggiornamento se il vecchio file non e' rimovibile
                }
              }
            }

            upsertWebMapLayer(db, {
              cantiereId: cid,
              tableName: existingLayer?.tableName || toLayerTableName(),
              displayName: name,
              sourceFileName: decodedImageName,
              sourceFormat: format as "png" | "jpg" | "jpeg",
              sridOriginal: 4326,
              featureCount: 0,
              geometryType: null,
              styleJson: null,
              kind: "raster",
              rasterPath: rasterRelativePath,
              rasterBounds: bounds,
            });
            imported.push({ name, format, featureCount: 0 });
          } catch (error: any) {
            console.error("[webmap/import-project] errore import raster", name, error);
            skipped.push({ name, format, reason: error?.message || "Import raster fallito" });
          }
          continue;
        }

        const file = byPath.get(resolvedPath) || byPath.get(normalize(relPath));
        if (!file) {
          skipped.push({ name, format, reason: `File non trovato tra quelli caricati (atteso: "${resolvedPath}").` });
          continue;
        }
        const decodedFileName = decodeOriginalName(file.originalname);

        try {
          let features: Array<{ type: "Feature"; geometry: any; properties: Record<string, unknown> }> = [];
          let sridOriginal: number | null = null;
          let styleJson: string | null = null;

          if (format === "gpkg") {
            const preview = await previewGeoPackageWebMap({
              fileBuffer: file.buffer,
              originalName: decodedFileName.split("/").pop() || decodedFileName,
              limit: 20000,
            });
            features = preview.featureCollection.features;
            sridOriginal = preview.tables.find((table) => table.tableName === preview.tableName)?.srid ?? null;
            styleJson = JSON.stringify(preview.styleHint);
          } else if (format === "shp") {
            const basePath = resolvedPath.replace(/\.shp$/i, "");
            const dbfFile = byPath.get(`${basePath}.dbf`);
            const prjFile = byPath.get(`${basePath}.prj`);
            const cpgFile = byPath.get(`${basePath}.cpg`);
            if (!dbfFile) {
              skipped.push({ name, format, reason: `Manca il file .dbf abbinato allo shapefile (atteso: "${basePath}.dbf").` });
              continue;
            }
            const shpResult = await parseShp(file.buffer, prjFile ? prjFile.buffer.toString("utf8") : undefined);
            const dbfResult = parseDbf(dbfFile.buffer, cpgFile ? cpgFile.buffer.toString("utf8") : undefined);
            const collection = combineShp(shpResult, dbfResult);
            features = collection.features as typeof features;
            sridOriginal = 4326;
          } else {
            const parsed = JSON.parse(file.buffer.toString("utf8"));
            features = parsed?.type === "FeatureCollection" ? parsed.features || [] : parsed?.type === "Feature" ? [parsed] : [];
            sridOriginal = 4326;
          }

          const geometryType = detectGeometryType(features);
          // Un layer con lo stesso nome nello stesso cantiere viene aggiornato, non duplicato.
          const existingLayer = getWebMapLayerByDisplayName(db, cid, name);
          const layer = upsertWebMapLayer(db, {
            cantiereId: cid,
            tableName: existingLayer?.tableName || toLayerTableName(),
            displayName: name,
            sourceFileName: decodedFileName,
            sourceFormat: format as "gpkg" | "geojson" | "shp",
            sridOriginal,
            featureCount: features.length,
            geometryType,
            styleJson,
          });
          saveLayerFeatures(db, layer.tableName, features);
          imported.push({ name, format, featureCount: features.length });
        } catch (error: any) {
          console.error("[webmap/import-project] errore import layer", name, error);
          skipped.push({ name, format, reason: error?.message || "Import fallito" });
        }
      }
      } catch (error: any) {
        console.error("[webmap/import-project] errore imprevisto", error);
        return res.status(500).json({
          error: error?.message || "Errore imprevisto durante l'import della cartella",
          imported,
          skipped,
        });
      }

      return res.json({ imported, skipped, checkReport });
    }),
  );

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

  app.get("/api/cantieri/:cid/webmap/layers/:id/raster", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const db = getSqliteDb(ctx.storage);
    const layer = getWebMapLayer(db, Number(req.params.id));
    if (!layer || layer.cantiereId !== cid) return res.status(404).json({ error: "Layer non trovato" });
    if (layer.kind !== "raster" || !layer.rasterPath) return res.status(404).json({ error: "Layer non raster" });

    const absolutePath = path.resolve(ctx.project.mediaDir, layer.rasterPath);
    const mediaRoot = path.resolve(ctx.project.mediaDir);
    if (absolutePath !== mediaRoot && !absolutePath.startsWith(`${mediaRoot}${path.sep}`)) {
      return res.status(400).json({ error: "Percorso raster non valido" });
    }
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "File raster non trovato" });

    const contentType =
      layer.sourceFormat === "png" ? "image/png" : layer.sourceFormat === "jpeg" ? "image/jpeg" : "image/jpeg";
    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
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

    if (layer.kind === "raster" && layer.rasterPath) {
      const absolutePath = path.resolve(ctx.project.mediaDir, layer.rasterPath);
      const mediaRoot = path.resolve(ctx.project.mediaDir);
      if (absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`)) {
        try {
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        } catch {
          // non bloccare la cancellazione del layer se il file non e' rimovibile
        }
      }
    }

    const ok = deleteWebMapLayer(db, id);
    if (!ok) return res.status(404).json({ error: "Layer non trovato" });
    return res.json({ ok: true });
  }));
}
