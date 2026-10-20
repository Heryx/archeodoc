import type { IStorage } from "./storage";
import type { GiornataData } from "./google_docs_parser";
import { parseJournalDocument } from "./google_docs_parser";
import { inferGiornataObiettivo } from "./ai";

export type RuoloPersona = "operaio" | "archeologo" | "topografo";

export interface PersonaClassificata {
  nome: string;
  ruolo: RuoloPersona;
  isNew: boolean; // true = non era nel DB persone
}

export interface GiornataPreviewItem {
  data: string;
  oraInizio: string | null;
  oraFine: string | null;
  meteo: string | null;
  personale: PersonaClassificata[];
  attivitaSvolta: string | null;
  tipoScavo: "manuale" | "meccanico" | "misto" | null; // null = non deducibile, da chiedere
  obiettivo: string | null; // dedotto dall'AI
  usRilevate: number[]; // numeri US trovate nel testo
  esisteNelDb: boolean;
  campiMancanti: string[]; // nomi campi non compilabili automaticamente
}

export interface GiornaleImportPreview {
  docId: string;
  giornate: GiornataPreviewItem[];
  nuovePersone: string[]; // nomi da classificare (non nel DB)
  warnings: string[];
}

export interface GiornataImportDecision {
  data: string;
  tipoScavo?: "manuale" | "meccanico" | "misto" | null;
  obiettivo?: string;
  coordinatori?: string[]; // nomi degli archeologi coordinatori selezionati
  // override eventuali altri campi
  oraInizio?: string;
  oraFine?: string;
  meteo?: string;
  skip?: boolean;
}

export interface GiornaleImportApplyResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function parseJsonArray(val: string | null | undefined): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

function serializeJsonArray(arr: string[]): string | null {
  const filtered = arr.filter(Boolean);
  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

export async function buildGiornaleImportPreview(
  storage: IStorage,
  cantiereId: number,
  docIdOrUrl: string,
): Promise<GiornaleImportPreview> {
  const giornateDoc = await parseJournalDocument(docIdOrUrl);
  const docId = docIdOrUrl.includes("/") ? docIdOrUrl : docIdOrUrl;

  const warnings: string[] = [];
  const personeDb = new Map(storage.getPersone().map((p) => [p.nome.toLowerCase(), p]));
  const giornateDb = new Map(storage.getGiornate(cantiereId).map((g) => [g.data, g]));

  // Raccoglie tutti i nomi nuovi (non nel DB persone)
  const nuovePersoneSet = new Set<string>();

  const items: GiornataPreviewItem[] = [];

  for (const giornata of giornateDoc) {
    if (!giornata.data) {
      warnings.push("Giornata senza data valida: ignorata.");
      continue;
    }

    // Classifica personale
    const personale: PersonaClassificata[] = [];
    for (const nome of giornata.personale || []) {
      const inDb = personeDb.get(nome.toLowerCase());
      if (inDb) {
        personale.push({ nome, ruolo: inDb.ruolo as RuoloPersona, isNew: false });
      } else {
        nuovePersoneSet.add(nome);
        personale.push({ nome, ruolo: "operaio", isNew: true }); // ruolo default, utente corregge
      }
    }

    // Obiettivo via AI
    let obiettivo: string | null = null;
    try {
      obiettivo = await inferGiornataObiettivo(giornata.attivitaSvolta || "");
    } catch { /* AI non disponibile, lascia null */ }

    const campiMancanti: string[] = [];
    if (giornata.tipoScavo === null) campiMancanti.push("tipoScavo");
    if (!obiettivo) campiMancanti.push("obiettivo");

    items.push({
      data: giornata.data,
      oraInizio: giornata.oraInizio || null,
      oraFine: giornata.oraFine || null,
      meteo: giornata.meteo || null,
      personale,
      attivitaSvolta: giornata.attivitaSvolta || null,
      tipoScavo: giornata.tipoScavo ?? null,
      obiettivo,
      usRilevate: giornata.us.map((u) => u.numero),
      esisteNelDb: giornateDb.has(giornata.data),
      campiMancanti,
    });
  }

  return {
    docId,
    giornate: items,
    nuovePersone: Array.from(nuovePersoneSet),
    warnings,
  };
}

export function applyGiornaleImport(
  storage: IStorage,
  cantiereId: number,
  preview: GiornaleImportPreview,
  decisioni: GiornataImportDecision[],
  classificazioni: Array<{ nome: string; ruolo: RuoloPersona }>,
): GiornaleImportApplyResult {
  const result: GiornaleImportApplyResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // 1. Salva le nuove persone nel DB
  for (const { nome, ruolo } of classificazioni) {
    try {
      const existing = storage.getPersonaByNome(nome);
      if (!existing) {
        storage.createPersona({ nome, ruolo });
      }
    } catch (e) {
      result.errors.push(`Persona "${nome}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Mappa classificazioni per lookup rapido
  const classificazioneMap = new Map<string, RuoloPersona>(
    classificazioni.map(({ nome, ruolo }) => [nome.toLowerCase(), ruolo]),
  );

  // Carica tutte le persone DB (include quelle appena create)
  const personeDb = new Map(storage.getPersone().map((p) => [p.nome.toLowerCase(), p]));

  // Mappa decisioni per data
  const decisioniMap = new Map<string, GiornataImportDecision>(
    decisioni.map((d) => [d.data, d]),
  );

  const giornateDb = new Map(storage.getGiornate(cantiereId).map((g) => [g.data, g]));

  for (const item of preview.giornate) {
    const decisione: GiornataImportDecision = decisioniMap.get(item.data) || { data: item.data };
    if (decisione.skip) { result.skipped += 1; continue; }

    try {
      // Risolvi personale con le classificazioni definitives
      const scavatori: string[] = [];
      const archeologi: string[] = [];
      const topografi: string[] = [];

      for (const p of item.personale) {
        const ruolo = classificazioneMap.get(p.nome.toLowerCase())
          || (personeDb.get(p.nome.toLowerCase())?.ruolo as RuoloPersona | undefined)
          || "operaio";

        if (ruolo === "operaio") scavatori.push(p.nome);
        else if (ruolo === "archeologo") archeologi.push(p.nome);
        else if (ruolo === "topografo") topografi.push(p.nome);
      }

      const coordinatori = decisione.coordinatori ?? [];
      const tipoScavo = decisione.tipoScavo !== undefined ? decisione.tipoScavo : item.tipoScavo;
      const obiettivo = decisione.obiettivo !== undefined ? decisione.obiettivo : item.obiettivo;

      const giornataPayload = {
        cantiereId,
        data: item.data,
        oraInizio: decisione.oraInizio ?? item.oraInizio ?? null,
        oraFine: decisione.oraFine ?? item.oraFine ?? null,
        condMeteo: decisione.meteo ?? item.meteo ?? null,
        scavatori: serializeJsonArray(scavatori),
        archeologi: serializeJsonArray(archeologi),
        topografo: serializeJsonArray(topografi),
        archeologoCoordinatore: serializeJsonArray(coordinatori),
        tipoScavo: tipoScavo ?? null,
        obiettivo: obiettivo ?? null,
        attivitaSvolta: item.attivitaSvolta ?? null,
        note: "Import da Google Docs",
      };

      const existing = giornateDb.get(item.data);
      if (existing) {
        // Aggiorna solo campi vuoti (non sovrascrive dati esistenti)
        const patch: Record<string, unknown> = {};
        if (!existing.oraInizio && giornataPayload.oraInizio) patch.oraInizio = giornataPayload.oraInizio;
        if (!existing.oraFine && giornataPayload.oraFine) patch.oraFine = giornataPayload.oraFine;
        if (!existing.condMeteo && giornataPayload.condMeteo) patch.condMeteo = giornataPayload.condMeteo;
        if (!existing.scavatori && giornataPayload.scavatori) patch.scavatori = giornataPayload.scavatori;
        if (!existing.archeologi && giornataPayload.archeologi) patch.archeologi = giornataPayload.archeologi;
        if (!existing.topografo && giornataPayload.topografo) patch.topografo = giornataPayload.topografo;
        if (!existing.archeologoCoordinatore && giornataPayload.archeologoCoordinatore) patch.archeologoCoordinatore = giornataPayload.archeologoCoordinatore;
        if (!existing.tipoScavo && giornataPayload.tipoScavo) patch.tipoScavo = giornataPayload.tipoScavo;
        if (!existing.obiettivo && giornataPayload.obiettivo) patch.obiettivo = giornataPayload.obiettivo;
        if (!existing.attivitaSvolta && giornataPayload.attivitaSvolta) patch.attivitaSvolta = giornataPayload.attivitaSvolta;

        if (Object.keys(patch).length > 0) {
          storage.updateGiornata(existing.id, patch as Parameters<typeof storage.updateGiornata>[1]);
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      } else {
        storage.createGiornata(giornataPayload);
        result.created += 1;
      }
    } catch (e) {
      result.errors.push(`Giornata ${item.data}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
