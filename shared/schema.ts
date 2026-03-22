import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cantiere / Progetto
export const cantieri = sqliteTable("cantieri", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codice: text("codice").notNull().unique(),
  nome: text("nome").notNull(),
  committente: text("committente"),
  localita: text("localita").notNull(),
  dataInizio: text("data_inizio"),
  dataFine: text("data_fine"),
  responsabile: text("responsabile"),
  note: text("note"),
  usModelKey: text("us_model_key").default("base-us"),
  createdAt: text("created_at").notNull(),
});

export const insertCantiereSchema = createInsertSchema(cantieri).omit({ id: true, createdAt: true });
export type InsertCantiere = z.infer<typeof insertCantiereSchema>;
export type Cantiere = typeof cantieri.$inferSelect;

// Giornata di Scavo
export const giornate = sqliteTable("giornate", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  data: text("data").notNull(),
  operatori: text("operatori"),
  condMeteo: text("cond_meteo"),
  settore: text("settore"),
  note: text("note"),
  qcStatus: text("qc_status").default("pending"),
  qcReport: text("qc_report"),
  aiReportText: text("ai_report_text"),
  createdAt: text("created_at").notNull(),
});

export const insertGiornataSchema = createInsertSchema(giornate).omit({ id: true, createdAt: true });
export type InsertGiornata = z.infer<typeof insertGiornataSchema>;
export type Giornata = typeof giornate.$inferSelect;

// Unita Stratigrafica (US)
export const unitaStratigrafiche = sqliteTable("unita_stratigrafiche", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  giornataId: integer("giornata_id"),
  codiceUS: text("codice_us").notNull(),
  tipo: text("tipo"),
  definizione: text("definizione"),
  descrizione: text("descrizione"),
  interpretazione: text("interpretazione"),
  quota: real("quota"),
  settore: text("settore"),
  coperto_da: text("coperto_da"),
  copre: text("copre"),
  si_lega_a: text("si_lega_a"),
  uguale_a: text("uguale_a"),
  periodoIniziale: text("periodo_iniziale"),
  periodoFinale: text("periodo_finale"),
  materialiRinvenuti: text("materiali_rinvenuti"),
  campioni: text("campioni"),
  haFoto: integer("ha_foto").default(0),
  haDisegno: integer("ha_disegno").default(0),
  haGps: integer("ha_gps").default(0),
  geomCentroide: text("geom_centroide"),
  geomPerimetro: text("geom_perimetro"),
  srid: integer("srid").default(4326),
  qcStatus: text("qc_status").default("pending"),
  qcProblemi: text("qc_problemi"),
  schedaAiGenerata: text("scheda_ai_generata"),
  schedaModelKey: text("scheda_model_key").default("base-us"),
  schedaData: text("scheda_data"),
  createdAt: text("created_at").notNull(),
});

export const insertUSSchema = createInsertSchema(unitaStratigrafiche).omit({ id: true, createdAt: true });
export type InsertUS = z.infer<typeof insertUSSchema>;
export type UnitaStratigrafica = typeof unitaStratigrafiche.$inferSelect;

// SAS (Saggio / Settore)
export const sasRecords = sqliteTable("sas_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  codice: text("codice").notNull(),
  nome: text("nome"),
  descrizione: text("descrizione"),
  data: text("data"),
  createdAt: text("created_at").notNull(),
});

export const insertSasSchema = createInsertSchema(sasRecords).omit({ id: true, createdAt: true });
export type InsertSas = z.infer<typeof insertSasSchema>;
export type SasRecord = typeof sasRecords.$inferSelect;

// RA (Reperto Archeologico)
export const raRecords = sqliteTable("ra_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  usId: integer("us_id"),
  codice: text("codice").notNull(),
  tipo: text("tipo"),
  descrizione: text("descrizione"),
  data: text("data"),
  createdAt: text("created_at").notNull(),
});

export const insertRaSchema = createInsertSchema(raRecords).omit({ id: true, createdAt: true });
export type InsertRa = z.infer<typeof insertRaSchema>;
export type RaRecord = typeof raRecords.$inferSelect;

// File allegati
export const allegati = sqliteTable("allegati", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  giornataId: integer("giornata_id"),
  usId: integer("us_id"),
  tipo: text("tipo").notNull(),
  nomeFile: text("nome_file").notNull(),
  percorso: text("percorso").notNull(),
  mimeType: text("mime_type"),
  dimensione: integer("dimensione"),
  dataRilievo: text("data_rilievo"),
  operatore: text("operatore"),
  descrizione: text("descrizione"),
  coordX: real("coord_x"),
  coordY: real("coord_y"),
  quota: real("quota"),
  descrizionAi: text("descrizione_ai"),
  createdAt: text("created_at").notNull(),
});

export const insertAllegatoSchema = createInsertSchema(allegati).omit({ id: true, createdAt: true });
export type InsertAllegato = z.infer<typeof insertAllegatoSchema>;
export type Allegato = typeof allegati.$inferSelect;

// Log QC
export const qcLogs = sqliteTable("qc_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  giornataId: integer("giornata_id"),
  usId: integer("us_id"),
  livello: text("livello").notNull(),
  categoria: text("categoria").notNull(),
  messaggio: text("messaggio").notNull(),
  campoInteressato: text("campo_interessato"),
  createdAt: text("created_at").notNull(),
});

export const insertQcLogSchema = createInsertSchema(qcLogs).omit({ id: true, createdAt: true });
export type InsertQcLog = z.infer<typeof insertQcLogSchema>;
export type QcLog = typeof qcLogs.$inferSelect;
