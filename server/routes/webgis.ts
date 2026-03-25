import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { IStorage } from "../storage.js";

const upload = multer({ dest: path.join(process.cwd(), "uploads", "tmp") });

function parseCid(req: Request): number | null {
  const n = Number(req.params.cid);
  return isNaN(n) ? null : n;
}

function parseId(req: Request): number | null {
  const n = Number(req.params.id);
  return isNaN(n) ? null : n;
}

export function registerWebgisRoutes(app: Express, storage: IStorage) {
  // GET /api/cantieri/:cid/webgis/features
  // Restituisce GeoJSON FeatureCollection con tutte le geometrie del cantiere
  app.get("/api/cantieri/:cid/webgis/features", (req: Request, res: Response) => {
    const cid = parseCid(req);
    if (!cid) return res.status(400).json({ error: "cantiere_id non valido" });

    try {
      const geometries = storage.getUsGeometries(cid);
      const features = geometries.map((g) => ({
        type: "Feature" as const,
        id: g.id,
        geometry: JSON.parse(g.geometryGeojson),
        properties: {
          id: g.id,
          us_id: g.usId ?? null,
          codice_us: g.codiceUs ?? null,
          tipo: g.tipoUs ?? null,
          qc_status: g.qcStatus ?? null,
          geom_type: g.geomType,
          label: g.label ?? null,
          colore: g.colore ?? null,
          has_allegati: (g.allegatiCount ?? 0) > 0,
          gpkg_source: g.gpkgSource ?? null,
        },
      }));

      return res.json({
        type: "FeatureCollection",
        features,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/cantieri/:cid/webgis/features
  app.post("/api/cantieri/:cid/webgis/features", (req: Request, res: Response) => {
    const cid = parseCid(req);
    if (!cid) return res.status(400).json({ error: "cantiere_id non valido" });

    const { geometry, geom_type, us_id, label, colore, note, gpkg_source, gpkg_table, gpkg_fid } = req.body;
    if (!geometry || !geom_type) {
      return res.status(400).json({ error: "geometry e geom_type sono obbligatori" });
    }

    try {
      const geomStr = typeof geometry === "string" ? geometry : JSON.stringify(geometry);
      const created = storage.createUsGeometry({
        cantiereId: cid,
        usId: us_id ? Number(us_id) : null,
        geomType: geom_type,
        geometryGeojson: geomStr,
        label: label ?? null,
        colore: colore ?? null,
        note: note ?? null,
        gpkgSource: gpkg_source ?? null,
        gpkgTable: gpkg_table ?? null,
        gpkgFid: gpkg_fid ? Number(gpkg_fid) : null,
      });
      return res.status(201).json(created);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/webgis/features/:id
  app.patch("/api/webgis/features/:id", (req: Request, res: Response) => {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: "id non valido" });

    const { geometry, us_id, label, colore, note } = req.body;
    const updates: Record<string, any> = {};
    if (geometry !== undefined) {
      updates.geometryGeojson = typeof geometry === "string" ? geometry : JSON.stringify(geometry);
    }
    if (us_id !== undefined) updates.usId = us_id === null ? null : Number(us_id);
    if (label !== undefined) updates.label = label;
    if (colore !== undefined) updates.colore = colore;
    if (note !== undefined) updates.note = note;

    try {
      const updated = storage.updateUsGeometry(id, updates);
      if (!updated) return res.status(404).json({ error: "Geometria non trovata" });
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/webgis/features/:id
  app.delete("/api/webgis/features/:id", (req: Request, res: Response) => {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: "id non valido" });

    try {
      const ok = storage.deleteUsGeometry(id);
      if (!ok) return res.status(404).json({ error: "Geometria non trovata" });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/cantieri/:cid/webgis/import-gpkg
  app.post(
    "/api/cantieri/:cid/webgis/import-gpkg",
    upload.single("file"),
    async (req: Request, res: Response) => {
      const cid = parseCid(req);
      if (!cid) return res.status(400).json({ error: "cantiere_id non valido" });
      if (!req.file) return res.status(400).json({ error: "Nessun file caricato" });

      const tmpPath = req.file.path;
      try {
        // Lazy import per non rompere il build se la dipendenza non c'è
        const { parseGeopackageTables, readGeopackageTable } = await import("../geopackage_reader.js");
        const tableName: string | undefined = req.body.tableName || undefined;

        const tables = parseGeopackageTables(tmpPath);
        const targetTable = tableName
          ? tables.find((t: any) => t.tableName === tableName)
          : tables.find((t: any) => t.geometryColumn !== null);

        if (!targetTable) {
          return res.status(400).json({ error: "Nessun layer geometrico trovato nel GeoPackage" });
        }

        const features = readGeopackageTable(tmpPath, targetTable.tableName);
        let imported = 0;
        const warnings: string[] = [];

        for (const feature of features) {
          if (!feature.geometry) { warnings.push(`Feature senza geometria saltata`); continue; }
          try {
            const geomType = (feature.geometry.type as string).toLowerCase().replace("multi", "");
            storage.createUsGeometry({
              cantiereId: cid,
              usId: null,
              geomType: geomType,
              geometryGeojson: JSON.stringify(feature.geometry),
              gpkgSource: req.file!.originalname,
              gpkgTable: targetTable.tableName,
              gpkgFid: feature.properties?.fid ? Number(feature.properties.fid) : null,
              label: null,
              colore: null,
              note: null,
            });
            imported++;
          } catch (e: any) {
            warnings.push(`Errore su feature: ${e.message}`);
          }
        }

        return res.json({ imported, warnings, table: targetTable.tableName });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }
  );
}
