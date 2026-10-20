import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("sync_devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastSyncAt: text("last_sync_at"),
  createdAt: text("created_at").notNull(),
});

export type Device = typeof devices.$inferSelect;
export type InsertDevice = typeof devices.$inferInsert;

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  operation: text("operation").notNull(),
  timestamp: text("timestamp").notNull(),
  synced: integer("synced", { mode: "boolean" }).default(false),
});
