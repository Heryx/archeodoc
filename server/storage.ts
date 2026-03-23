import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc } from "drizzle-orm";
import {
  cantieri,
  giornate,
  unitaStratigrafiche,
  sasRecords,
  raRecords,
  allegati,
  qcLogs,
  type Cantiere,
  type InsertCantiere,
  type Giornata,
  type InsertGiornata,
  type UnitaStratigrafica,
  type InsertUS,
  type SasRecord,
  type InsertSas,
  type RaRecord,
  type InsertRa,
  type Allegato,
  type InsertAllegato,
  type QcLog,
  type InsertQcLog,
} from "@shared/schema";

function hasColumn(sqlite: Database.Database, tableName: string, columnName: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === columnName);
}

function ensureColumn(sqlite: Database.Database, tableName: string, columnName: string, definition: string): void {
  if (hasColumn(sqlite, tableName, columnName)) return;
  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS geometry_columns (
      f_table_name TEXT NOT NULL,
      f_geometry_column TEXT NOT NULL,
      geometry_type INTEGER NOT NULL,
      coord_dimension INTEGER NOT NULL,
      srid INTEGER NOT NULL,
      geometry_format TEXT NOT NULL,
      PRIMARY KEY (f_table_name, f_geometry_column)
    );

    CREATE TABLE IF NOT EXISTS spatial_ref_sys (
      srid INTEGER NOT NULL PRIMARY KEY,
      auth_name TEXT NOT NULL,
      auth_srid INTEGER NOT NULL,
      ref_sys_name TEXT,
      proj4text TEXT NOT NULL,
      srtext TEXT
    );

    INSERT OR IGNORE INTO spatial_ref_sys (srid, auth_name, auth_srid, ref_sys_name, proj4text, srtext) VALUES
      (4326, 'EPSG', 4326, 'WGS 84',
       '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs',
       'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'),
      (32632, 'EPSG', 32632, 'WGS 84 / UTM zone 32N',
       '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs',
       'PROJCS["WGS 84 / UTM zone 32N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]');

    CREATE TABLE IF NOT EXISTS cantieri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codice TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      committente TEXT,
      localita TEXT NOT NULL,
      data_inizio TEXT,
      data_fine TEXT,
      responsabile TEXT,
      note TEXT,
      us_model_key TEXT DEFAULT 'base-us',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS giornate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      operatori TEXT,
      cond_meteo TEXT,
      settore TEXT,
      note TEXT,
      qc_status TEXT DEFAULT 'pending',
      qc_report TEXT,
      ai_report_text TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS unita_stratigrafiche (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      giornata_id INTEGER,
      codice_us TEXT NOT NULL,
      tipo TEXT,
      definizione TEXT,
      descrizione TEXT,
      interpretazione TEXT,
      quota REAL,
      settore TEXT,
      coperto_da TEXT,
      copre TEXT,
      si_lega_a TEXT,
      uguale_a TEXT,
      periodo_iniziale TEXT,
      periodo_finale TEXT,
      materiali_rinvenuti TEXT,
      campioni TEXT,
      ha_foto INTEGER DEFAULT 0,
      ha_disegno INTEGER DEFAULT 0,
      ha_gps INTEGER DEFAULT 0,
      geom_centroide TEXT,
      geom_perimetro TEXT,
      srid INTEGER DEFAULT 4326,
      qc_status TEXT DEFAULT 'pending',
      qc_problemi TEXT,
      scheda_ai_generata TEXT,
      scheda_model_key TEXT DEFAULT 'base-us',
      scheda_data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE,
      FOREIGN KEY (giornata_id) REFERENCES giornate(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sas_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      codice TEXT NOT NULL,
      nome TEXT,
      descrizione TEXT,
      data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sas_records_cantiere_codice
      ON sas_records (cantiere_id, codice);

    CREATE TABLE IF NOT EXISTS ra_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      us_id INTEGER,
      codice TEXT NOT NULL,
      tipo TEXT,
      descrizione TEXT,
      data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE,
      FOREIGN KEY (us_id) REFERENCES unita_stratigrafiche(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ra_records_cantiere_codice
      ON ra_records (cantiere_id, codice);

    CREATE TABLE IF NOT EXISTS allegati (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      giornata_id INTEGER,
      us_id INTEGER,
      tipo TEXT NOT NULL,
      nome_file TEXT NOT NULL,
      percorso TEXT NOT NULL,
      mime_type TEXT,
      dimensione INTEGER,
      data_rilievo TEXT,
      operatore TEXT,
      descrizione TEXT,
      coord_x REAL,
      coord_y REAL,
      quota REAL,
      geom_punto TEXT,
      srid INTEGER DEFAULT 4326,
      descrizione_ai TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE,
      FOREIGN KEY (giornata_id) REFERENCES giornate(id) ON DELETE CASCADE,
      FOREIGN KEY (us_id) REFERENCES unita_stratigrafiche(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS qc_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cantiere_id INTEGER NOT NULL,
      giornata_id INTEGER,
      us_id INTEGER,
      livello TEXT NOT NULL,
      categoria TEXT NOT NULL,
      messaggio TEXT NOT NULL,
      campo_interessato TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cantiere_id) REFERENCES cantieri(id) ON DELETE CASCADE,
      FOREIGN KEY (giornata_id) REFERENCES giornate(id) ON DELETE CASCADE,
      FOREIGN KEY (us_id) REFERENCES unita_stratigrafiche(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cantieri_geo (
      id INTEGER PRIMARY KEY,
      cantiere_id INTEGER NOT NULL UNIQUE,
      geom_area TEXT,
      geom_centroide TEXT,
      srid INTEGER DEFAULT 4326,
      note_geo TEXT
    );

    INSERT OR IGNORE INTO geometry_columns (f_table_name, f_geometry_column, geometry_type, coord_dimension, srid, geometry_format)
    VALUES
      ('unita_stratigrafiche', 'geom_centroide', 1, 2, 4326, 'WKT'),
      ('unita_stratigrafiche', 'geom_perimetro', 3, 2, 4326, 'WKT'),
      ('allegati', 'geom_punto', 1, 2, 4326, 'WKT'),
      ('cantieri_geo', 'geom_area', 3, 2, 4326, 'WKT'),
      ('cantieri_geo', 'geom_centroide', 1, 2, 4326, 'WKT');
  `);

  ensureColumn(sqlite, "cantieri", "us_model_key", "us_model_key TEXT DEFAULT 'base-us'");
  ensureColumn(sqlite, "unita_stratigrafiche", "scheda_model_key", "scheda_model_key TEXT DEFAULT 'base-us'");
  ensureColumn(sqlite, "unita_stratigrafiche", "scheda_data", "scheda_data TEXT");
  ensureColumn(sqlite, "sas_records", "data", "data TEXT");
  ensureColumn(sqlite, "ra_records", "data", "data TEXT");
  ensureColumn(sqlite, "qc_logs", "dismissed", "dismissed INTEGER DEFAULT 0");
}

export interface IStorage {
  // Cantieri
  getCantieri(): Cantiere[];
  getCantiere(id: number): Cantiere | undefined;
  createCantiere(data: InsertCantiere): Cantiere;
  updateCantiere(id: number, data: Partial<InsertCantiere>): Cantiere | undefined;
  deleteCantiere(id: number): boolean;

  // Giornate
  getGiornate(cantiereId: number): Giornata[];
  getGiornata(id: number): Giornata | undefined;
  createGiornata(data: InsertGiornata): Giornata;
  updateGiornata(id: number, data: Partial<InsertGiornata>): Giornata | undefined;
  deleteGiornata(id: number): boolean;

  // US
  getUSList(cantiereId: number, giornataId?: number): UnitaStratigrafica[];
  getUS(id: number): UnitaStratigrafica | undefined;
  createUS(data: InsertUS): UnitaStratigrafica;
  updateUS(id: number, data: Partial<InsertUS>): UnitaStratigrafica | undefined;
  deleteUS(id: number): boolean;

  // SAS
  getSasRecords(cantiereId: number): SasRecord[];
  getSasRecord(id: number): SasRecord | undefined;
  createSasRecord(data: InsertSas): SasRecord;
  updateSasRecord(id: number, data: Partial<InsertSas>): SasRecord | undefined;
  deleteSasRecord(id: number): boolean;

  // RA
  getRaRecords(cantiereId: number, usId?: number): RaRecord[];
  getRaRecord(id: number): RaRecord | undefined;
  createRaRecord(data: InsertRa): RaRecord;
  updateRaRecord(id: number, data: Partial<InsertRa>): RaRecord | undefined;
  deleteRaRecord(id: number): boolean;

  // Allegati
  getAllegati(cantiereId: number, giornataId?: number, usId?: number): Allegato[];
  getAllegato(id: number): Allegato | undefined;
  createAllegato(data: InsertAllegato): Allegato;
  updateAllegato(id: number, data: Partial<InsertAllegato>): Allegato | undefined;

  // QC logs
  getQcLogs(cantiereId: number, giornataId?: number): QcLog[];
  createQcLog(data: InsertQcLog): QcLog;
  deleteQcLogsByGiornata(giornataId: number): void;
  dismissQcLog(id: number): void;
  undismissQcLog(id: number): void;
}

function now() {
  return new Date().toISOString();
}

class SQLiteStorage implements IStorage {
  private sqlite: Database.Database;
  private db: BetterSQLite3Database<Record<string, never>>;

  constructor(dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite);
    migrate(this.sqlite);
  }

  // Cantieri
  getCantieri() {
    return this.db.select().from(cantieri).all();
  }

  getCantiere(id: number) {
    return this.db.select().from(cantieri).where(eq(cantieri.id, id)).get();
  }

  createCantiere(data: InsertCantiere) {
    return this.db.insert(cantieri).values({ ...data, createdAt: now() }).returning().get();
  }

  updateCantiere(id: number, data: Partial<InsertCantiere>) {
    return this.db.update(cantieri).set(data).where(eq(cantieri.id, id)).returning().get();
  }

  deleteCantiere(id: number) {
    const existing = this.getCantiere(id);
    if (!existing) return false;

    const tx = this.sqlite.transaction(() => {
      this.db.delete(qcLogs).where(eq(qcLogs.cantiereId, id)).run();
      this.db.delete(allegati).where(eq(allegati.cantiereId, id)).run();
      this.db.delete(raRecords).where(eq(raRecords.cantiereId, id)).run();
      this.db.delete(sasRecords).where(eq(sasRecords.cantiereId, id)).run();
      this.db.delete(unitaStratigrafiche).where(eq(unitaStratigrafiche.cantiereId, id)).run();
      this.db.delete(giornate).where(eq(giornate.cantiereId, id)).run();
      this.db.delete(cantieri).where(eq(cantieri.id, id)).run();
    });
    tx();
    return true;
  }

  // Giornate
  getGiornate(cantiereId: number) {
    return this.db.select().from(giornate).where(eq(giornate.cantiereId, cantiereId)).orderBy(desc(giornate.data)).all();
  }

  getGiornata(id: number) {
    return this.db.select().from(giornate).where(eq(giornate.id, id)).get();
  }

  createGiornata(data: InsertGiornata) {
    return this.db.insert(giornate).values({ ...data, createdAt: now() }).returning().get();
  }

  updateGiornata(id: number, data: Partial<InsertGiornata>) {
    return this.db.update(giornate).set(data).where(eq(giornate.id, id)).returning().get();
  }

  deleteGiornata(id: number) {
    const existing = this.getGiornata(id);
    if (!existing) return false;

    const tx = this.sqlite.transaction(() => {
      this.db.delete(qcLogs).where(eq(qcLogs.giornataId, id)).run();
      this.db.delete(allegati).where(eq(allegati.giornataId, id)).run();
      this.db.update(unitaStratigrafiche).set({ giornataId: null }).where(eq(unitaStratigrafiche.giornataId, id)).run();
      this.db.delete(giornate).where(eq(giornate.id, id)).run();
    });
    tx();
    return true;
  }

  // US
  getUSList(cantiereId: number, giornataId?: number) {
    if (giornataId !== undefined) {
      return this.db
        .select()
        .from(unitaStratigrafiche)
        .where(and(eq(unitaStratigrafiche.cantiereId, cantiereId), eq(unitaStratigrafiche.giornataId, giornataId)))
        .all();
    }

    return this.db.select().from(unitaStratigrafiche).where(eq(unitaStratigrafiche.cantiereId, cantiereId)).all();
  }

  getUS(id: number) {
    return this.db.select().from(unitaStratigrafiche).where(eq(unitaStratigrafiche.id, id)).get();
  }

  createUS(data: InsertUS) {
    return this.db.insert(unitaStratigrafiche).values({ ...data, createdAt: now() }).returning().get();
  }

  updateUS(id: number, data: Partial<InsertUS>) {
    return this.db.update(unitaStratigrafiche).set(data).where(eq(unitaStratigrafiche.id, id)).returning().get();
  }

  deleteUS(id: number) {
    const existing = this.getUS(id);
    if (!existing) return false;

    const tx = this.sqlite.transaction(() => {
      this.db.delete(allegati).where(eq(allegati.usId, id)).run();
      this.db.update(raRecords).set({ usId: null }).where(eq(raRecords.usId, id)).run();
      this.db.delete(unitaStratigrafiche).where(eq(unitaStratigrafiche.id, id)).run();
    });
    tx();
    return true;
  }

  // SAS
  getSasRecords(cantiereId: number) {
    return this.db.select().from(sasRecords).where(eq(sasRecords.cantiereId, cantiereId)).all();
  }

  getSasRecord(id: number) {
    return this.db.select().from(sasRecords).where(eq(sasRecords.id, id)).get();
  }

  createSasRecord(data: InsertSas) {
    return this.db.insert(sasRecords).values({ ...data, createdAt: now() }).returning().get();
  }

  updateSasRecord(id: number, data: Partial<InsertSas>) {
    return this.db.update(sasRecords).set(data).where(eq(sasRecords.id, id)).returning().get();
  }

  deleteSasRecord(id: number) {
    const existing = this.getSasRecord(id);
    if (!existing) return false;
    this.db.delete(sasRecords).where(eq(sasRecords.id, id)).run();
    return true;
  }

  // RA
  getRaRecords(cantiereId: number, usId?: number) {
    if (usId !== undefined) {
      return this.db
        .select()
        .from(raRecords)
        .where(and(eq(raRecords.cantiereId, cantiereId), eq(raRecords.usId, usId)))
        .all();
    }
    return this.db.select().from(raRecords).where(eq(raRecords.cantiereId, cantiereId)).all();
  }

  getRaRecord(id: number) {
    return this.db.select().from(raRecords).where(eq(raRecords.id, id)).get();
  }

  createRaRecord(data: InsertRa) {
    return this.db.insert(raRecords).values({ ...data, createdAt: now() }).returning().get();
  }

  updateRaRecord(id: number, data: Partial<InsertRa>) {
    return this.db.update(raRecords).set(data).where(eq(raRecords.id, id)).returning().get();
  }

  deleteRaRecord(id: number) {
    const existing = this.getRaRecord(id);
    if (!existing) return false;
    this.db.delete(raRecords).where(eq(raRecords.id, id)).run();
    return true;
  }

  // Allegati
  getAllegati(cantiereId: number, giornataId?: number, usId?: number) {
    if (usId !== undefined) {
      return this.db.select().from(allegati).where(eq(allegati.usId, usId)).all();
    }

    if (giornataId !== undefined) {
      return this.db
        .select()
        .from(allegati)
        .where(and(eq(allegati.cantiereId, cantiereId), eq(allegati.giornataId, giornataId)))
        .all();
    }

    return this.db.select().from(allegati).where(eq(allegati.cantiereId, cantiereId)).all();
  }

  getAllegato(id: number) {
    return this.db.select().from(allegati).where(eq(allegati.id, id)).get();
  }

  createAllegato(data: InsertAllegato) {
    return this.db.insert(allegati).values({ ...data, createdAt: now() }).returning().get();
  }

  updateAllegato(id: number, data: Partial<InsertAllegato>) {
    return this.db.update(allegati).set(data).where(eq(allegati.id, id)).returning().get();
  }

  // QC logs
  getQcLogs(cantiereId: number, giornataId?: number) {
    if (giornataId !== undefined) {
      return this.db
        .select()
        .from(qcLogs)
        .where(and(eq(qcLogs.cantiereId, cantiereId), eq(qcLogs.giornataId, giornataId)))
        .orderBy(desc(qcLogs.createdAt))
        .all();
    }

    return this.db.select().from(qcLogs).where(eq(qcLogs.cantiereId, cantiereId)).orderBy(desc(qcLogs.createdAt)).all();
  }

  createQcLog(data: InsertQcLog) {
    return this.db.insert(qcLogs).values({ ...data, createdAt: now() }).returning().get();
  }

  deleteQcLogsByGiornata(giornataId: number) {
    this.db.delete(qcLogs).where(eq(qcLogs.giornataId, giornataId)).run();
  }

  dismissQcLog(id: number) {
    this.db.update(qcLogs).set({ dismissed: true }).where(eq(qcLogs.id, id)).run();
  }

  undismissQcLog(id: number) {
    this.db.update(qcLogs).set({ dismissed: false }).where(eq(qcLogs.id, id)).run();
  }
}

export function createStorage(dbPath: string): IStorage {
  return new SQLiteStorage(dbPath);
}
