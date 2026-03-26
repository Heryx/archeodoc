import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
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
  googleFolderId: text("google_folder_id"),
  googleDocId: text("google_doc_id"),
  lastSyncAt: text("last_sync_at"),
  lastSyncReport: text("last_sync_report"),
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
  quotaPianoCampagna: real("quota_piano_campagna"),
  settore: text("settore"),
  coperto_da: text("coperto_da"),
  copre: text("copre"),
  si_lega_a: text("si_lega_a"),
  uguale_a: text("uguale_a"),
  periodoIniziale: text("periodo_iniziale"),
  periodoFinale: text("periodo_finale"),
  materialiRinvenuti: text("materiali_rinvenuti"),
  campioni: text("campioni"),
  nCatalogoGenerale: text("n_catalogo_generale"),
  nCatalogoInternazionale: text("n_catalogo_internazionale"),
  localita: text("localita"),
  anno: text("anno"),
  area: text("area"),
  piante: text("piante"),
  sezioni: text("sezioni"),
  prospetti: text("prospetti"),
  criteriDistinzione: text("criteri_distinzione"),
  modoFormazione: text("modo_formazione"),
  modoFormazioneOrigine: text("modo_formazione_origine"),
  compMaterialeCostruzione: integer("comp_materiale_costruzione", { mode: "boolean" }).default(false),
  compCeramica: integer("comp_ceramica", { mode: "boolean" }).default(false),
  compMetalli: integer("comp_metalli", { mode: "boolean" }).default(false),
  compVetro: integer("comp_vetro", { mode: "boolean" }).default(false),
  compCiottoli: integer("comp_ciottoli", { mode: "boolean" }).default(false),
  compGhiaia: integer("comp_ghiaia", { mode: "boolean" }).default(false),
  compAltroInorganico: text("comp_altro_inorganico"),
  densitaInorganici: text("densita_inorganici"),
  compFauna: integer("comp_fauna", { mode: "boolean" }).default(false),
  compOsso: integer("comp_osso", { mode: "boolean" }).default(false),
  compCorno: integer("comp_corno", { mode: "boolean" }).default(false),
  compSemi: integer("comp_semi", { mode: "boolean" }).default(false),
  compFrutti: integer("comp_frutti", { mode: "boolean" }).default(false),
  compCarboni: integer("comp_carboni", { mode: "boolean" }).default(false),
  compLegno: integer("comp_legno", { mode: "boolean" }).default(false),
  compTessuti: integer("comp_tessuti", { mode: "boolean" }).default(false),
  compAltroOrganico: text("comp_altro_organico"),
  densitaOrganici: text("densita_organici"),
  consistenza: text("consistenza"),
  colore: text("colore"),
  misure: text("misure"),
  statoConservazione: text("stato_conservazione"),
  danneggiatoDa: text("danneggiato_da"),
  gliSiAppoggia: text("gli_si_appoggia"),
  siAppoggia: text("si_appoggia"),
  tagliatoDa: text("tagliato_da"),
  taglia: text("taglia"),
  riempitoDa: text("riempito_da"),
  riempie: text("riempie"),
  sequenzaFisica: text("sequenza_fisica"),
  scavataIntegralmente: integer("scavata_integralmente", { mode: "boolean" }).default(false),
  scavataParzialmente: integer("scavata_parzialmente", { mode: "boolean" }).default(false),
  corrispondeAltraUnita: text("corrisponde_altra_unita"),
  asportataConAltriStrati: integer("asportata_con_altri_strati", { mode: "boolean" }).default(false),
  altroScavo: text("altro_scavo"),
  elementiDatanti: text("elementi_datanti"),
  elementiDatantiFonte: text("elementi_datanti_fonte"),
  epoca: text("epoca"),
  datazione: text("datazione"),
  periodoFase: text("periodo_fase"),
  datiQuantitativiReperti: text("dati_quantitativi_reperti"),
  campionatureN: text("campionature_n"),
  flottazioneTipo: text("flottazione_tipo"),
  setacciaturaTipo: text("setacciatura_tipo"),
  affidabilitaStratigrafica: text("affidabilita_stratigrafica"),
  responsabileSabap: text("responsabile_sabap"),
  responsabileArcheosistemi: text("responsabile_archeosistemi"),
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
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
  createdAt: text("created_at").notNull(),
});

export const insertQcLogSchema = createInsertSchema(qcLogs).omit({ id: true, createdAt: true });
export type InsertQcLog = z.infer<typeof insertQcLogSchema>;
export type QcLog = typeof qcLogs.$inferSelect;

// Snapshot WebMap / planimetrie salvate
export const mapSnapshots = sqliteTable("map_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cantiereId: integer("cantiere_id").notNull(),
  titolo: text("titolo").notNull(),
  didascalia: text("didascalia"),
  tags: text("tags"),
  percorso: text("percorso").notNull(),
  mimeType: text("mime_type"),
  width: integer("width"),
  height: integer("height"),
  bounds: text("bounds"),
  center: text("center"),
  zoom: real("zoom"),
  bearing: real("bearing"),
  pitch: real("pitch"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertMapSnapshotSchema = createInsertSchema(mapSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMapSnapshot = z.infer<typeof insertMapSnapshotSchema>;
export type MapSnapshot = typeof mapSnapshots.$inferSelect;

// Impostazioni AI (prompt personalizzabili)
export const aiSettings = sqliteTable("ai_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  label: text("label"),
  description: text("description"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type AiSetting = typeof aiSettings.$inferSelect;
