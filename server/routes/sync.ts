import { Router } from "express";
import type { Request, Response } from "express";
import Database from "better-sqlite3";
import path from "path";
import { getStorageForProject, resolveProject, getWorkspaceRoot } from "../projects";
import { syncAuthMiddleware } from "../middleware/sync_auth";

const router = Router();
router.use(syncAuthMiddleware);

let _globalDb: Database.Database | null = null;

function getGlobalDb(): Database.Database {
  if (_globalDb) return _globalDb;
  const dbPath = path.join(getWorkspaceRoot(), "sync_devices.db");
  _globalDb = new Database(dbPath);
  _globalDb.exec(`
    CREATE TABLE IF NOT EXISTS sync_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_sync_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return _globalDb;
}

// Registra dispositivo
router.post("/devices/register", (req: Request, res: Response) => {
  try {
    const { deviceId, deviceName } = req.body;
    if (!deviceId || !deviceName) {
      return res.status(400).json({ error: "deviceId e deviceName richiesti" });
    }

    const db = getGlobalDb();
    db.prepare(
      "INSERT OR IGNORE INTO sync_devices (id, name, created_at) VALUES (?, ?, ?)"
    ).run(deviceId, deviceName, new Date().toISOString());
    db.prepare("UPDATE sync_devices SET name = ? WHERE id = ?").run(deviceName, deviceId);

    res.json({ success: true, deviceId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Status dispositivo
router.get("/devices/:deviceId/status", (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const db = getGlobalDb();
    const device = db.prepare("SELECT * FROM sync_devices WHERE id = ?").get(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Dispositivo non registrato" });
    }

    res.json({ device, serverTime: Date.now() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Lista dispositivi registrati
router.get("/devices", (_req: Request, res: Response) => {
  try {
    const db = getGlobalDb();
    const devices = db.prepare("SELECT * FROM sync_devices ORDER BY last_sync_at DESC").all();
    res.json({ devices });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Push: ricevi modifiche dal mobile
// Il mobile invia oggetti con id numerico (server-side) per le update
// e oggetti senza id per le create
router.post("/devices/:deviceId/push", (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { projectId, changes } = req.body;

    const project = resolveProject(projectId);
    if (!project) {
      return res.status(400).json({ error: "Progetto non trovato" });
    }

    const storage = getStorageForProject(project.id);
    const conflicts: unknown[] = [];
    const now = new Date().toISOString();
    const createdIds: { mobileId: string; serverId: number; type: string }[] = [];
    let syncedUS = 0;
    let syncedGiornate = 0;

    // US create (non hanno id server, hanno mobileId temporaneo)
    for (const usData of changes.us_created || []) {
      const { mobileId, ...insertData } = usData;
      const created = storage.createUS({
        ...insertData,
        syncedAt: now,
        deviceId,
        updatedAt: now,
      });
      if (mobileId) {
        createdIds.push({ mobileId, serverId: created.id, type: "us" });
      }
      syncedUS++;
    }

    // US aggiornate (hanno id server numerico)
    for (const usData of changes.us_updated || []) {
      const { id, ...updateData } = usData;
      const existing = storage.getUS(Number(id));
      if (!existing) {
        conflicts.push({ type: "us", id, reason: "not_found_on_server" });
        continue;
      }
      if (existing.updatedAt && usData.updatedAt && existing.updatedAt > usData.updatedAt) {
        conflicts.push({
          type: "us",
          id,
          reason: "desktop_version_newer",
          serverData: existing,
          mobileData: usData,
        });
        continue;
      }
      storage.updateUS(Number(id), { ...updateData, syncedAt: now, deviceId, updatedAt: now });
      syncedUS++;
    }

    // Giornate create
    for (const gData of changes.giornate_created || []) {
      const { mobileId, ...insertData } = gData;
      const created = storage.createGiornata({
        ...insertData,
        syncedAt: now,
        deviceId,
        updatedAt: now,
      });
      if (mobileId) {
        createdIds.push({ mobileId, serverId: created.id, type: "giornata" });
      }
      syncedGiornate++;
    }

    // Giornate aggiornate
    for (const gData of changes.giornate_updated || []) {
      const { id, ...updateData } = gData;
      const existing = storage.getGiornata(Number(id));
      if (!existing) {
        conflicts.push({ type: "giornata", id, reason: "not_found_on_server" });
        continue;
      }
      if (existing.updatedAt && gData.updatedAt && existing.updatedAt > gData.updatedAt) {
        conflicts.push({ type: "giornata", id, reason: "desktop_version_newer" });
        continue;
      }
      storage.updateGiornata(Number(id), { ...updateData, syncedAt: now, deviceId, updatedAt: now });
      syncedGiornate++;
    }

    // Aggiorna lastSyncAt del device
    getGlobalDb().prepare("UPDATE sync_devices SET last_sync_at = ? WHERE id = ?").run(now, deviceId);

    res.json({
      success: true,
      conflicts,
      createdIds,
      synced: { us: syncedUS, giornate: syncedGiornate },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Pull: invia modifiche recenti al mobile
router.get("/devices/:deviceId/pull", (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { since, projectId } = req.query as Record<string, string>;

    const db = getGlobalDb();
    const device = db.prepare("SELECT * FROM sync_devices WHERE id = ?").get(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Dispositivo non registrato" });
    }

    const project = resolveProject(projectId);
    if (!project) {
      return res.status(400).json({ error: "Progetto non trovato" });
    }

    const storage = getStorageForProject(project.id);
    const sinceDate = since ? new Date(Number(since)).toISOString() : new Date(0).toISOString();

    const allCantieri = storage.getCantieri();
    const updatedUS: unknown[] = [];
    const updatedGiornate: unknown[] = [];

    for (const cantiere of allCantieri) {
      const usList = storage.getUSList(cantiere.id);
      for (const us of usList) {
        const ts = us.updatedAt || us.createdAt;
        if (ts >= sinceDate) updatedUS.push(us);
      }

      const giornateList = storage.getGiornate(cantiere.id);
      for (const g of giornateList) {
        const ts = g.updatedAt || g.createdAt;
        if (ts >= sinceDate) updatedGiornate.push(g);
      }
    }

    res.json({
      success: true,
      timestamp: Date.now(),
      data: { us: updatedUS, giornate: updatedGiornate },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
