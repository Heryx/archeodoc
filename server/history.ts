import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  allegati,
  cantieri,
  documentazioni,
  giornate,
  nodiParadati,
  periodi,
  persone,
  raRecords,
  sasRecords,
  unitaStratigrafiche,
} from "@shared/schema";
import { logger } from "./logger";

/**
 * Cronologia delle modifiche: prima di ogni modifica o eliminazione di una scheda lo
 * storage salva in <progetto>/storico/<tipo>/<id>/ un file JSON con lo stato precedente.
 * Cosi' qualunque errore (anche dell'AI o di un import) si puo' annullare.
 */

export type HistoryEntityType =
  | "us"
  | "giornata"
  | "sas"
  | "ra"
  | "documentazione"
  | "periodo"
  | "persona"
  | "nodo"
  | "allegato"
  | "cantiere";

export type HistorySource = "manuale" | "ai" | "import" | "sync" | "ripristino";
export type HistoryAction = "update" | "delete";

type Row = Record<string, unknown>;

type RelatedRows = { table: string; rows: Row[] };
type RelatedLink = { table: string; column: string; ids: number[]; value: number };

type HistoryRecord = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  batchId: string;
  entityType: HistoryEntityType;
  entityId: number;
  cantiereId: number | null;
  label: string;
  action: HistoryAction;
  source: HistorySource;
  sourceLabel?: string;
  before: Row;
  /** Solo per "update": valori attuali delle sole colonne cambiate. */
  changes?: Row;
  /** Solo per "delete": righe collegate eliminate/scollegate insieme alla scheda. */
  related?: { reinsert: RelatedRows[]; relink: RelatedLink[] };
  restoredAt?: string;
};

export type HistorySummary = {
  id: string;
  entityType: HistoryEntityType;
  entityTypeLabel: string;
  entityId: number;
  cantiereId: number | null;
  label: string;
  action: HistoryAction;
  source: HistorySource;
  sourceLabel?: string;
  createdAt: string;
  updatedAt: string;
  changedFields: string[];
  relatedCount: number;
  restoredAt?: string;
};

export type HistoryField = {
  key: string;
  label: string;
  before: string;
  after: string;
  current: string;
  /** La scheda ha gia' il valore di prima: nulla da ripristinare. */
  alreadyRestored: boolean;
};

export type HistoryDetail = HistorySummary & {
  fields: HistoryField[];
  /** La scheda esiste ancora (per le eliminazioni: no). */
  exists: boolean;
};

export type HistoryRestoreResult = {
  entityType: HistoryEntityType;
  entityId: number;
  cantiereId: number | null;
  action: HistoryAction;
  restored: string[];
  /** Percorsi (relativi a media) degli allegati ricomparsi: i file vanno rimessi al loro posto. */
  attachmentPaths: string[];
};

type EntityMeta = {
  schema: SQLiteTable;
  typeLabel: string;
  label: (row: Row) => string;
};

const text = (v: unknown) => (v == null ? "" : String(v));

const ENTITIES: Record<HistoryEntityType, EntityMeta> = {
  us: { schema: unitaStratigrafiche, typeLabel: "Scheda US", label: (r) => `US ${text(r.codice_us)}` },
  giornata: { schema: giornate, typeLabel: "Giornata", label: (r) => `Giornata ${text(r.data)}` },
  sas: { schema: sasRecords, typeLabel: "Saggio (SAS)", label: (r) => `SAS ${text(r.codice)}` },
  ra: { schema: raRecords, typeLabel: "Materiale (RA)", label: (r) => `RA ${text(r.codice)}` },
  documentazione: { schema: documentazioni, typeLabel: "Elaborato", label: (r) => text(r.titolo) || "Elaborato" },
  periodo: { schema: periodi, typeLabel: "Periodo", label: (r) => text(r.nome) || "Periodo" },
  persona: { schema: persone, typeLabel: "Persona", label: (r) => text(r.nome) || "Persona" },
  nodo: { schema: nodiParadati, typeLabel: "Unità virtuale", label: (r) => text(r.nome) || text(r.uid) || "Unità virtuale" },
  allegato: { schema: allegati, typeLabel: "Allegato", label: (r) => text(r.nome_file) || "Allegato" },
  cantiere: { schema: cantieri, typeLabel: "Cantiere", label: (r) => text(r.nome) || "Cantiere" },
};

const ENTITY_TYPES = Object.keys(ENTITIES) as HistoryEntityType[];
const TYPE_BY_TABLE = new Map(ENTITY_TYPES.map((t) => [getTableName(ENTITIES[t].schema), t]));

// Colonne che cambiano da sole (QC, sincronizzazione, flag derivati): non sono modifiche dell'utente.
const VOLATILE_COLUMNS = new Set([
  "updated_at",
  "synced_at",
  "device_id",
  "qc_status",
  "qc_problemi",
  "qc_report",
  "ha_foto",
  "ha_disegno",
  "ha_gps",
]);
const JSON_COLUMNS = new Set(["scheda_data", "contenuto", "intestazione", "scavatori", "archeologi", "dati"]);

const FIELD_LABELS: Record<string, string> = {
  codice_us: "Codice US",
  coperto_da: "Coperto da",
  copre: "Copre",
  si_lega_a: "Si lega a",
  uguale_a: "Uguale a",
  gli_si_appoggia: "Gli si appoggia",
  si_appoggia: "Si appoggia a",
  tagliato_da: "Tagliato da",
  taglia: "Taglia",
  riempito_da: "Riempito da",
  riempie: "Riempie",
  posteriore_a: "Posteriore a",
  anteriore_a: "Anteriore a",
  scheda_data: "Dati della scheda",
  contenuto: "Testo",
  intestazione: "Intestazione e piè di pagina",
  attivita_svolta: "Attività svolta",
  da_rivedere: "Da rivedere",
  nome_file: "Nome file",
};

export const HISTORY_SOURCE_LABELS: Record<HistorySource, string> = {
  manuale: "Modifica manuale",
  ai: "Assistente AI",
  import: "Importazione",
  sync: "Sincronizzazione",
  ripristino: "Ripristino",
};

const COALESCE_MS = 3 * 60 * 1000;
const KEEP_VERSIONS = 60;
const KEEP_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_HARD_CAP = 300;
const KEEP_DELETED_MS = 180 * 24 * 60 * 60 * 1000;
const STAMP_RE = /^\d{8}T\d{9}Z(-\d+)?_(update|delete)_[a-z]+$/;

export function historyDirForDb(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), "storico");
}

// ── Contesto della richiesta: da dove arriva la modifica ─────────────────────────────────────

type RequestContext = { source: HistorySource; sourceLabel?: string; batchId: string; ids: string[] };

const requestContext = new AsyncLocalStorage<RequestContext>();

const SOURCE_RULES: Array<[RegExp, HistorySource]> = [
  [/\/storico\//, "ripristino"],
  [/(ai-fill|analizza-ai|crosscheck|ai-assistant|qc-relazioni-ai|ai-check|genera-testo|genera-blocco|ai-review)/, "ai"],
  [/(import|importa|giornale\/apply|geopackage|emjson|\/google\/)/, "import"],
  [/(qfield|\/sync)/, "sync"],
];

function detectSource(req: Request): { source: HistorySource; sourceLabel?: string } {
  const header = req.header("x-change-source")?.trim().toLowerCase();
  const label = req.header("x-change-label");
  let sourceLabel: string | undefined;
  if (label) {
    try { sourceLabel = decodeURIComponent(label).slice(0, 120); } catch { sourceLabel = undefined; }
  }
  if (header && header in HISTORY_SOURCE_LABELS) return { source: header as HistorySource, sourceLabel };
  for (const [re, source] of SOURCE_RULES) {
    if (re.test(req.path)) return { source, sourceLabel };
  }
  return { source: "manuale", sourceLabel };
}

/** Associa a ogni richiesta la sua origine e comunica al client (X-Storico-Ids) le versioni create. */
export function historyContextMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || req.method === "GET" || req.method === "HEAD") return next();

  const ctx: RequestContext = {
    ...detectSource(req),
    batchId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ids: [],
  };

  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: any[]) {
    if (!res.headersSent && ctx.ids.length > 0) {
      res.setHeader("X-Storico-Ids", ctx.ids.slice(0, 50).join(","));
    }
    return (writeHead as any).apply(this, args);
  } as typeof res.writeHead;

  requestContext.run(ctx, next);
}

// ── Utilita' ─────────────────────────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function canonical(column: string, value: unknown): string {
  if (value == null || value === "") return "null";
  if (JSON_COLUMNS.has(column) && typeof value === "string") {
    try { return stableStringify(JSON.parse(value)); } catch { /* testo non JSON */ }
  }
  return JSON.stringify(value);
}

function diffRows(before: Row, after: Row): Row {
  const changes: Row = {};
  for (const column of Object.keys(after)) {
    if (column === "id" || column === "created_at" || VOLATILE_COLUMNS.has(column)) continue;
    if (canonical(column, before[column]) !== canonical(column, after[column])) changes[column] = after[column] ?? null;
  }
  return changes;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type PmNode = { type?: string; text?: string; content?: PmNode[] };
const PM_BLOCKS = new Set(["paragraph", "heading", "listItem", "tableRow", "blockquote", "codeBlock"]);

function pmToText(node: PmNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(pmToText).join(node.type === "tableRow" ? "\t" : "");
  return node.type && PM_BLOCKS.has(node.type) ? `${inner}\n` : inner;
}

function prettyKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/\bus\b/gi, "US");
}

function stamp(date: Date, action: HistoryAction, source: HistorySource): string {
  return `${date.toISOString().replace(/[-:.]/g, "")}_${action}_${source}`;
}

function atomicWrite(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, file);
}

// ── Cronologia di un progetto ────────────────────────────────────────────────────────────────

export class ProjectHistory {
  constructor(
    private readonly sqlite: Database.Database,
    /** Cartella radice dello storico (null = cronologia disattivata, es. database in memoria). */
    readonly dir: string | null,
  ) {}

  /** Cartella dove finiscono i file allegati eliminati, per poterli recuperare. */
  get trashDir(): string | null {
    return this.dir ? path.join(this.dir, "_cestino") : null;
  }

  // Registrazione ------------------------------------------------------------------------------

  /** Esegue `mutate` salvando prima lo stato della scheda. Un errore dello storico non blocca mai l'operazione. */
  track<T>(type: HistoryEntityType, id: number, kind: HistoryAction, mutate: () => T): T {
    if (!this.dir) return mutate();
    const table = getTableName(ENTITIES[type].schema);
    let before: Row | undefined;
    let related: HistoryRecord["related"];
    try {
      before = this.readRow(table, id);
      if (before && kind === "delete") related = this.captureRelated(type, before);
    } catch (error) {
      this.logFailure("lettura", error);
    }

    const result = mutate();

    if (before) {
      try {
        this.record(type, before, this.readRow(table, id), related);
      } catch (error) {
        this.logFailure("scrittura", error);
      }
    }
    return result;
  }

  /** Come `track`, per codice che conosce solo il nome della tabella (gestione DB). */
  trackTable<T>(table: string, id: number, kind: HistoryAction, mutate: () => T): T {
    const type = TYPE_BY_TABLE.get(table);
    return type ? this.track(type, id, kind, mutate) : mutate();
  }

  private logFailure(step: string, error: unknown) {
    logger.error("Errore nel salvataggio della cronologia", {
      step,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private readRow(table: string, id: number): Row | undefined {
    return this.sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as Row | undefined;
  }

  private captureRelated(type: HistoryEntityType, row: Row): HistoryRecord["related"] {
    const id = Number(row.id);
    const all = (sql: string, ...params: unknown[]) => this.sqlite.prepare(sql).all(...params) as Row[];
    const reinsert: RelatedRows[] = [];
    const relink: RelatedLink[] = [];
    const link = (table: string, column: string) => {
      const ids = all(`SELECT id FROM "${table}" WHERE "${column}" = ?`, id).map((r) => Number(r.id));
      if (ids.length > 0) relink.push({ table, column, ids, value: id });
    };

    if (type === "us") {
      reinsert.push({ table: "allegati", rows: all("SELECT * FROM allegati WHERE us_id = ?", id) });
      link("ra_records", "us_id");
    } else if (type === "giornata") {
      reinsert.push({ table: "allegati", rows: all("SELECT * FROM allegati WHERE giornata_id = ?", id) });
      link("unita_stratigrafiche", "giornata_id");
    } else if (type === "documentazione") {
      reinsert.push({
        table: "documentazione_snapshots",
        rows: all("SELECT * FROM documentazione_snapshots WHERE documentazione_id = ?", id),
      });
    } else if (type === "nodo") {
      reinsert.push({
        table: "archi_paradati",
        rows: all(
          `SELECT * FROM archi_paradati WHERE cantiere_id = ?
             AND ((source_kind = 'nodo' AND source_ref = ?) OR (target_kind = 'nodo' AND target_ref = ?))`,
          row.cantiere_id,
          row.uid,
          row.uid,
        ),
      });
    }
    return { reinsert: reinsert.filter((r) => r.rows.length > 0), relink };
  }

  private record(type: HistoryEntityType, before: Row, after: Row | undefined, related: HistoryRecord["related"]) {
    const meta = ENTITIES[type];
    const entityId = Number(before.id);
    const action: HistoryAction = after ? "update" : "delete";
    const changes = after ? diffRows(before, after) : undefined;
    if (changes && Object.keys(changes).length === 0) return;

    const ctx = requestContext.getStore();
    const source = ctx?.source ?? "manuale";
    const now = new Date();
    const entityDir = path.join(this.dir!, type, String(entityId));

    // Salvataggi ripetuti (modifiche a raffica, salvataggio automatico) restano un'unica versione:
    // quella con lo stato di prima della prima modifica.
    if (action === "update") {
      const last = this.lastRecord(entityDir);
      if (last && last.record.action === "update" && !last.record.restoredAt) {
        const sameRequest = ctx && last.record.batchId === ctx.batchId;
        const quickManual =
          source === "manuale" &&
          last.record.source === "manuale" &&
          now.getTime() - Date.parse(last.record.updatedAt) < COALESCE_MS;
        if (sameRequest || quickManual) {
          const merged = diffRows(last.record.before, after!);
          if (Object.keys(merged).length === 0) {
            fs.rmSync(last.file, { force: true });
          } else {
            atomicWrite(last.file, { ...last.record, changes: merged, updatedAt: now.toISOString() });
          }
          return;
        }
      }
    }

    let name = stamp(now, action, source);
    let file = path.join(entityDir, `${name}.json`);
    for (let n = 2; fs.existsSync(file); n++) {
      name = `${stamp(now, action, source).replace("_", `-${n}_`)}`;
      file = path.join(entityDir, `${name}.json`);
    }

    const record: HistoryRecord = {
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      batchId: ctx?.batchId ?? "",
      entityType: type,
      entityId,
      cantiereId: before.cantiere_id != null ? Number(before.cantiere_id) : null,
      label: meta.label(before),
      action,
      source,
      sourceLabel: ctx?.sourceLabel,
      before,
      ...(changes ? { changes } : {}),
      ...(related ? { related } : {}),
    };
    atomicWrite(file, record);
    ctx?.ids.push(this.makeId(type, entityId, name));
    this.prune(entityDir);
  }

  // Lettura ------------------------------------------------------------------------------------

  private makeId(type: HistoryEntityType, entityId: number, name: string) {
    return `${type}~${entityId}~${name}`;
  }

  private parseId(id: string): { type: HistoryEntityType; entityId: number; name: string; file: string } | null {
    const [type, rawId, name] = String(id).split("~");
    if (!this.dir || !(type in ENTITIES) || !/^\d+$/.test(rawId || "") || !STAMP_RE.test(name || "")) return null;
    const file = path.join(this.dir, type, rawId, `${name}.json`);
    return { type: type as HistoryEntityType, entityId: Number(rawId), name, file };
  }

  private readRecord(file: string): HistoryRecord | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as HistoryRecord;
    } catch {
      return null;
    }
  }

  private recordFiles(entityDir: string): string[] {
    try {
      return fs.readdirSync(entityDir).filter((f) => f.endsWith(".json")).sort();
    } catch {
      return [];
    }
  }

  private lastRecord(entityDir: string): { file: string; record: HistoryRecord } | null {
    const files = this.recordFiles(entityDir);
    if (files.length === 0) return null;
    const file = path.join(entityDir, files[files.length - 1]);
    const record = this.readRecord(file);
    return record ? { file, record } : null;
  }

  private summarize(id: string, record: HistoryRecord): HistorySummary {
    return {
      id,
      entityType: record.entityType,
      entityTypeLabel: ENTITIES[record.entityType].typeLabel,
      entityId: record.entityId,
      cantiereId: record.cantiereId,
      label: record.label,
      action: record.action,
      source: record.source,
      sourceLabel: record.sourceLabel,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      changedFields: record.changes ? Object.keys(record.changes).map(prettyKey) : [],
      relatedCount: (record.related?.reinsert ?? []).reduce((n, r) => n + r.rows.length, 0),
      restoredAt: record.restoredAt,
    };
  }

  list(opts: {
    entityType?: HistoryEntityType;
    entityId?: number;
    cantiereId?: number;
    action?: HistoryAction;
    limit?: number;
  } = {}): HistorySummary[] {
    if (!this.dir) return [];
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

    const candidates: Array<{ type: HistoryEntityType; entityId: number; name: string; file: string }> = [];
    const types = opts.entityType ? [opts.entityType] : ENTITY_TYPES;
    for (const type of types) {
      const typeDir = path.join(this.dir, type);
      const ids = opts.entityId != null ? [String(opts.entityId)] : this.safeReaddir(typeDir);
      for (const rawId of ids) {
        const entityDir = path.join(typeDir, rawId);
        for (const f of this.recordFiles(entityDir)) {
          candidates.push({ type, entityId: Number(rawId), name: f.slice(0, -5), file: path.join(entityDir, f) });
        }
      }
    }
    candidates.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

    const out: HistorySummary[] = [];
    for (const c of candidates) {
      if (out.length >= limit) break;
      const record = this.readRecord(c.file);
      if (!record) continue;
      if (opts.cantiereId != null && record.cantiereId !== opts.cantiereId) continue;
      if (opts.action && record.action !== opts.action) continue;
      out.push(this.summarize(this.makeId(c.type, c.entityId, c.name), record));
    }
    return out;
  }

  private safeReaddir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
  }

  private display(table: string, column: string, value: unknown): string {
    if (value == null) return "";
    const type = TYPE_BY_TABLE.get(table);
    const col = type ? Object.values(getTableColumns(ENTITIES[type].schema)).find((c) => c.name === column) : undefined;
    if (col?.columnType === "SQLiteBoolean") return value ? "Sì" : "No";
    if (column === "contenuto" && typeof value === "string") {
      try { return pmToText(JSON.parse(value) as PmNode).trim(); } catch { /* testo semplice */ }
    }
    return String(value);
  }

  get(id: string): HistoryDetail | null {
    const ref = this.parseId(id);
    if (!ref) return null;
    const record = this.readRecord(ref.file);
    if (!record) return null;

    const table = getTableName(ENTITIES[ref.type].schema);
    const current = this.readRow(table, ref.entityId);
    const fields: HistoryField[] = [];

    for (const column of Object.keys(record.changes ?? {})) {
      const after = record.changes![column];
      const subBefore = column === "scheda_data" ? parseObject(record.before[column]) : null;
      const subAfter = column === "scheda_data" ? parseObject(after) : null;
      const subCurrent = column === "scheda_data" && current ? parseObject(current[column]) : null;

      if (subBefore && subAfter) {
        // Dati della scheda: un campo alla volta, cosi' si ripristina solo quello sbagliato.
        for (const key of Array.from(new Set([...Object.keys(subBefore), ...Object.keys(subAfter)]))) {
          if (stableStringify(subBefore[key] ?? null) === stableStringify(subAfter[key] ?? null)) continue;
          const cur = subCurrent?.[key];
          fields.push({
            key: `${column}.${key}`,
            label: prettyKey(key),
            before: text(subBefore[key]),
            after: text(subAfter[key]),
            current: text(cur),
            alreadyRestored: stableStringify(cur ?? null) === stableStringify(subBefore[key] ?? null),
          });
        }
        continue;
      }

      fields.push({
        key: column,
        label: prettyKey(column),
        before: this.display(table, column, record.before[column]),
        after: this.display(table, column, after),
        current: this.display(table, column, current?.[column]),
        alreadyRestored: !current || canonical(column, current[column]) === canonical(column, record.before[column]),
      });
    }

    return { ...this.summarize(id, record), fields, exists: !!current };
  }

  // Ripristino ---------------------------------------------------------------------------------

  /** Annulla una modifica (anche solo alcuni campi) oppure ricrea una scheda eliminata. */
  restore(id: string, fields?: string[]): HistoryRestoreResult {
    const ref = this.parseId(id);
    const record = ref ? this.readRecord(ref.file) : null;
    if (!ref || !record) throw new Error("Versione non trovata");

    const table = getTableName(ENTITIES[ref.type].schema);
    const done = (restored: string[], attachmentPaths: string[] = []): HistoryRestoreResult => ({
      entityType: ref.type,
      entityId: ref.entityId,
      cantiereId: record.cantiereId,
      action: record.action,
      restored,
      attachmentPaths,
    });

    if (record.action === "delete") {
      if (this.readRow(table, ref.entityId)) throw new Error("La scheda esiste già");
      const attachmentPaths: string[] = [];
      this.sqlite.transaction(() => {
        this.insertRow(table, record.before);
        for (const group of record.related?.reinsert ?? []) {
          for (const row of group.rows) {
            this.insertRow(group.table, row, true);
            if (group.table === "allegati" && typeof row.percorso === "string") attachmentPaths.push(row.percorso);
          }
        }
        for (const link of record.related?.relink ?? []) {
          const marks = link.ids.map(() => "?").join(",");
          this.sqlite
            .prepare(`UPDATE "${link.table}" SET "${link.column}" = ? WHERE id IN (${marks}) AND "${link.column}" IS NULL`)
            .run(link.value, ...link.ids);
        }
      })();
      atomicWrite(ref.file, { ...record, restoredAt: new Date().toISOString() });
      return done([ENTITIES[ref.type].label(record.before)], attachmentPaths);
    }

    const current = this.readRow(table, ref.entityId);
    if (!current) throw new Error("La scheda non esiste più: ripristina prima la versione eliminata");

    const wanted = new Set(fields && fields.length > 0 ? fields : Object.keys(record.changes ?? {}));
    const patch: Row = {};
    const restored: string[] = [];

    for (const column of Object.keys(record.changes ?? {})) {
      const subKeys = Array.from(wanted).filter((k) => k.startsWith(`${column}.`)).map((k) => k.slice(column.length + 1));
      if (wanted.has(column)) {
        patch[column] = record.before[column] ?? null;
        restored.push(prettyKey(column));
      } else if (subKeys.length > 0) {
        const before = parseObject(record.before[column]) ?? {};
        const next = parseObject(current[column]) ?? {};
        for (const key of subKeys) {
          if (key in before) next[key] = before[key];
          else delete next[key];
          restored.push(prettyKey(key));
        }
        patch[column] = JSON.stringify(next);
      }
    }
    if (restored.length === 0) throw new Error("Nessun campo da ripristinare");

    // Il ripristino e' a sua volta una versione (mai fusa con altre): si puo' annullare.
    const parent = requestContext.getStore();
    const ctx: RequestContext = {
      source: "ripristino",
      batchId: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ids: parent?.ids ?? [],
    };
    requestContext.run(ctx, () =>
      this.track(ref.type, ref.entityId, "update", () => {
        const columns = Object.keys(patch);
        const hasUpdatedAt = "updated_at" in current;
        const sets = columns.map((c) => `"${c}" = ?`).concat(hasUpdatedAt ? ['"updated_at" = ?'] : []);
        const values = columns.map((c) => patch[c]).concat(hasUpdatedAt ? [new Date().toISOString()] : []);
        this.sqlite.prepare(`UPDATE "${table}" SET ${sets.join(", ")} WHERE id = ?`).run(...values, ref.entityId);
      }),
    );
    return done(restored);
  }

  private insertRow(table: string, row: Row, ignoreConflicts = false) {
    const columns = Object.keys(row);
    this.sqlite
      .prepare(
        `INSERT ${ignoreConflicts ? "OR IGNORE " : ""}INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      )
      .run(...columns.map((c) => row[c] ?? null));
  }

  // Manutenzione -------------------------------------------------------------------------------

  /** Tiene le versioni piu' recenti; le eliminazioni restano piu' a lungo (sono la rete di sicurezza). */
  private prune(entityDir: string) {
    const files = this.recordFiles(entityDir);
    if (files.length <= KEEP_VERSIONS) return;
    const now = Date.now();
    files.slice(0, files.length - KEEP_VERSIONS).forEach((name, index) => {
      const file = path.join(entityDir, name);
      const record = this.readRecord(file);
      if (!record) return void fs.rmSync(file, { force: true });
      const age = now - Date.parse(record.createdAt);
      if (record.action === "delete" && age < KEEP_DELETED_MS) return;
      if (age > KEEP_MIN_AGE_MS || files.length - index > KEEP_HARD_CAP) fs.rmSync(file, { force: true });
    });
  }

  /** Pulizia periodica: elimina le versioni di eliminazioni vecchie e i relativi file allegati. */
  pruneAll() {
    if (!this.dir) return;
    const now = Date.now();
    for (const type of ENTITY_TYPES) {
      for (const rawId of this.safeReaddir(path.join(this.dir, type))) {
        const entityDir = path.join(this.dir, type, rawId);
        this.prune(entityDir);
        for (const name of this.recordFiles(entityDir)) {
          const file = path.join(entityDir, name);
          const record = this.readRecord(file);
          if (record?.action === "delete" && now - Date.parse(record.createdAt) > KEEP_DELETED_MS) {
            fs.rmSync(file, { force: true });
          }
        }
      }
    }
    if (this.trashDir) this.pruneTrash(this.trashDir, now);
  }

  private pruneTrash(dir: string, now: number) {
    for (const entry of this.safeReaddir(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          this.pruneTrash(full, now);
          if (this.safeReaddir(full).length === 0) fs.rmdirSync(full);
        } else if (now - stat.mtimeMs > KEEP_DELETED_MS) {
          fs.rmSync(full, { force: true });
        }
      } catch {
        /* file sparito nel frattempo */
      }
    }
  }

  /** Copia completa del database prima di operazioni molto distruttive (es. eliminare un cantiere). */
  snapshotDatabase(backupsDir: string, tag: string): string | null {
    if (!this.dir) return null;
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
      const file = path.join(backupsDir, `pre-${tag}-${new Date().toISOString().replace(/[-:.]/g, "")}.sqlite`);
      fs.writeFileSync(file, this.sqlite.serialize());
      return file;
    } catch (error) {
      this.logFailure("copia database", error);
      return null;
    }
  }
}
