/**
 * Periodi / epoche di cantiere.
 *
 * Il registro (tabella `periodi`) dichiara nome, ordine e date; le US lo
 * richiamano per nome nei campi di testo periodoIniziale / periodoFinale.
 * L'ordine puo' essere proposto dalla stratigrafia: il periodo le cui US stanno
 * piu' in basso nella matrice e' il piu' antico.
 */
import type { Periodo, UnitaStratigrafica } from "@shared/schema";
import type { IStorage } from "./storage";
import { normalizeUSCode } from "@shared/normalize_us_code";
import { buildMatrixGraph } from "./matrix_export";

const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const natural = (a: string, b: string) => a.localeCompare(b, "it", { numeric: true, sensitivity: "base" });

export type UnregisteredPeriod = { nome: string; count: number };

/** Nomi usati nelle US (iniziale / finale) che non sono nel registro. */
export function collectUnregistered(usList: UnitaStratigrafica[], registered: Periodo[]): UnregisteredPeriod[] {
  const known = new Set(registered.map((p) => norm(p.nome)));
  const found = new Map<string, UnregisteredPeriod>();
  for (const us of usList) {
    for (const raw of [us.periodoIniziale, us.periodoFinale]) {
      const nome = raw?.trim().replace(/\s+/g, " ");
      if (!nome || known.has(norm(nome))) continue;
      const entry = found.get(norm(nome)) ?? { nome, count: 0 };
      entry.count += 1;
      found.set(norm(nome), entry);
    }
  }
  return Array.from(found.values()).sort((a, b) => natural(a.nome, b.nome));
}

/**
 * Ordina i nomi dal piu' antico al piu' recente in base al livello medio delle
 * loro US nella matrice (livello alto = piu' in basso = piu' antico).
 * Nomi senza US collegate nella matrice vanno in coda, in ordine naturale.
 */
export function suggestOrder(usList: UnitaStratigrafica[], nomi: string[]): string[] {
  const levels = new Map<string, number[]>();
  const { nodes } = buildMatrixGraph(usList, "all");
  const levelOf = new Map(nodes.map((n) => [n.key, n.level]));
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    const nome = us.periodoIniziale?.trim();
    if (!code || !nome) continue;
    const level = levelOf.get(code.replace(/\s+/g, "").toUpperCase());
    if (level === undefined) continue;
    const list = levels.get(norm(nome)) ?? [];
    list.push(level);
    levels.set(norm(nome), list);
  }
  const mean = (nome: string) => {
    const values = levels.get(norm(nome));
    return values?.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  return [...nomi].sort((a, b) => {
    const ma = mean(a);
    const mb = mean(b);
    if (ma !== null && mb !== null && ma !== mb) return mb - ma; // piu' profondo = piu' antico = prima
    if (ma === null && mb !== null) return 1;
    if (ma !== null && mb === null) return -1;
    return natural(a, b);
  });
}

/** Crea nel registro i nomi presenti nelle US ma assenti, in ordine stratigrafico, dopo quelli esistenti. */
export function registerPeriodsFromUs(storage: IStorage, cantiereId: number): Periodo[] {
  const usList = storage.getUSList(cantiereId);
  const registered = storage.getPeriodi(cantiereId);
  const missing = collectUnregistered(usList, registered).map((p) => p.nome);
  let ordine = registered.reduce((m, p) => Math.max(m, p.ordine), 0);
  return suggestOrder(usList, missing).map((nome) =>
    storage.createPeriodo({ cantiereId, nome, descrizione: null, ordine: ++ordine, startTime: null, endTime: null }),
  );
}

/** Riordina i periodi registrati dal piu' antico al piu' recente secondo la stratigrafia. */
export function reorderByStratigraphy(storage: IStorage, cantiereId: number): Periodo[] {
  const registered = storage.getPeriodi(cantiereId);
  const order = suggestOrder(storage.getUSList(cantiereId), registered.map((p) => p.nome));
  const byName = new Map(registered.map((p) => [p.nome, p]));
  order.forEach((nome, index) => storage.updatePeriodo(byName.get(nome)!.id, { ordine: index + 1 }));
  return storage.getPeriodi(cantiereId);
}

/** Rinomina un periodo e aggiorna le US che lo richiamavano per nome. */
export function renamePeriod(storage: IStorage, periodo: Periodo, nuovoNome: string): number {
  let updated = 0;
  for (const us of storage.getUSList(periodo.cantiereId)) {
    const patch: Record<string, string> = {};
    if (us.periodoIniziale && norm(us.periodoIniziale) === norm(periodo.nome)) patch.periodoIniziale = nuovoNome;
    if (us.periodoFinale && norm(us.periodoFinale) === norm(periodo.nome)) patch.periodoFinale = nuovoNome;
    if (Object.keys(patch).length) {
      storage.updateUS(us.id, patch);
      updated += 1;
    }
  }
  storage.updatePeriodo(periodo.id, { nome: nuovoNome });
  return updated;
}

/** "100-118, 125 130" -> ["100", ..., "118", "125", "130"]. Gli intervalli valgono per codici numerici. */
export function parseCodeList(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from <= 2000) {
        for (let n = from; n <= to; n += 1) out.push(String(n));
        continue;
      }
    }
    out.push(token);
  }
  return out;
}

export type AssignPeriodResult = { updated: number; notFound: string[]; created: boolean };

/** Assegna un periodo (periodoIniziale) a un elenco di US; lo registra se non esiste. */
export function assignPeriod(
  storage: IStorage,
  cantiereId: number,
  nome: string,
  codes: string[],
): AssignPeriodResult {
  const registered = storage.getPeriodi(cantiereId);
  const exists = registered.some((p) => norm(p.nome) === norm(nome));
  if (!exists) {
    storage.createPeriodo({
      cantiereId,
      nome,
      descrizione: null,
      ordine: registered.reduce((m, p) => Math.max(m, p.ordine), 0) + 1,
      startTime: null,
      endTime: null,
    });
  }
  const byKey = new Map<string, UnitaStratigrafica>();
  for (const us of storage.getUSList(cantiereId)) {
    const code = us.codiceUS?.trim();
    if (code) byKey.set(normalizeUSCode(code), us);
  }
  const notFound: string[] = [];
  let updated = 0;
  for (const code of codes) {
    const us = byKey.get(normalizeUSCode(code));
    if (!us) {
      notFound.push(code);
      continue;
    }
    storage.updateUS(us.id, { periodoIniziale: nome });
    updated += 1;
  }
  return { updated, notFound, created: !exists };
}
