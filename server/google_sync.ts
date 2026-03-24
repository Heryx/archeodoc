import type { Cantiere, Giornata, UnitaStratigrafica } from "@shared/schema";
import type { USThesaurusConfig } from "@shared/us_thesaurus";
import { normalizeUsDefinizioneWithVocabulary, normalizeUsTipoWithVocabulary } from "@shared/us_thesaurus";
import type { IStorage } from "./storage";
import { inferMissingFields } from "./ai";
import { parseJournalDocument, type GiornataData, type USData } from "./google_docs_parser";

type ProposedTopLevelFields = {
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: string | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
};

type ExistingSnapshot = {
  id: number;
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: string | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
  giornataId: number | null;
  schedaData: Record<string, string>;
};

type DayMeta = {
  data: string;
  meteo?: string;
  operai?: number;
};

const TOP_LEVEL_SYNC_KEYS = [
  "tipo",
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "periodoIniziale",
  "periodoFinale",
  "materialiRinvenuti",
  "campioni",
] as const;

export type GoogleSyncPreviewItem = {
  key: string;
  giornataData: string;
  giornataMeteo?: string;
  giornataOperai?: number;
  codiceUS: string;
  usNumero: number;
  status: "new" | "existing";
  missingFields: string[];
  deterministic: Record<string, string | null>;
  ai: Record<string, string | null>;
  proposed: ProposedTopLevelFields & { schedaData: Record<string, string> };
  existing?: ExistingSnapshot;
  rawText: string;
};

export type GoogleSyncPreview = {
  docId: string;
  giornate: number;
  usTotali: number;
  items: GoogleSyncPreviewItem[];
  warnings: string[];
};

export type GoogleSyncDecision = {
  action?: "confirm" | "skip" | "edit";
  overrides?: Partial<ProposedTopLevelFields> & {
    schedaData?: Record<string, string | null>;
  };
};

export type GoogleSyncApplyResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
};

function normalizeCodeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function formatUsCode(numero: number): string {
  return `US ${numero}`;
}

function relationNumbersToJson(values?: number[]): string | null {
  if (!values || values.length === 0) return null;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const code = formatUsCode(value);
    const key = normalizeCodeKey(code);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }

  return out.length > 0 ? JSON.stringify(out) : null;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSchedaData(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value == null) continue;
      const text = String(value).trim();
      if (!text) continue;
      out[key] = text;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeSchedaData(data: Record<string, string>): string | null {
  const entries = Object.entries(data).filter(([, value]) => String(value || "").trim().length > 0);
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

function usDeterministicFields(us: USData): { topLevel: ProposedTopLevelFields; schedaData: Record<string, string> } {
  const topLevel: ProposedTopLevelFields = {
    tipo: toNullableString(us.tipo),
    definizione: toNullableString(us.definizione),
    descrizione: toNullableString(us.descrizione ?? us.note),
    interpretazione: toNullableString(us.interpretazione),
    quota: toNullableString(us.quota),
    settore: toNullableString(us.settore),
    coperto_da: relationNumbersToJson(us.coperto_da),
    copre: relationNumbersToJson(us.copre),
    si_lega_a: relationNumbersToJson(us.si_lega_a),
    uguale_a: relationNumbersToJson(us.uguale_a),
    periodoIniziale: toNullableString(us.periodoIniziale),
    periodoFinale: toNullableString(us.periodoFinale),
    materialiRinvenuti: toNullableString(us.materialiRinvenuti),
    campioni: toNullableString(us.campioni),
  };

  const schedaData: Record<string, string> = {};
  const map: Record<string, unknown> = {
    localita: us.localita,
    anno: us.anno,
    saggio: us.saggio,
    quadrati: us.quadrati,
    nCatalogoGenerale: us.nCatalogoGenerale,
    nCatalogoInternazionale: us.nCatalogoInternazionale,
    naturaUs: us.naturaUs,
    areaEdificioStruttura: us.areaEdificioStruttura,
    ambienteUnitaFunzionale: us.ambienteUnitaFunzionale,
    piante: us.piante,
    sezioni: us.sezioni,
    prospetti: us.prospetti,
    fotografie: us.fotografie,
    criteriDistinzione: us.criteriDistinzione,
    naturaAzione: us.naturaAzione,
    agenteFormazione: us.agenteFormazione,
    durataFormazione: us.durataFormazione,
    modoFormazione: us.modoFormazione,
    componentiInorganici: us.componentiInorganici,
    componentiOrganici: us.componentiOrganici,
    densitaMaterialeInorganici: us.densitaMaterialeInorganici,
    densitaMaterialeOrganici: us.densitaMaterialeOrganici,
    componentiArtificiali: us.componentiArtificiali,
    colore: us.colore,
    consistenza: us.consistenza,
    inclusi: us.inclusi,
    misure: us.misure,
    stratoConfigurazioneSuperficie: us.stratoConfigurazioneSuperficie,
    stratoSpessoreVariazioni: us.stratoSpessoreVariazioni,
    stratoDefinizioneConfine: us.stratoDefinizioneConfine,
    stratoMorfologiaInclusi: us.stratoMorfologiaInclusi,
    strutturaOrientamento: us.strutturaOrientamento,
    strutturaTecnicaCostruttiva: us.strutturaTecnicaCostruttiva,
    strutturaMaterialiLegante: us.strutturaMaterialiLegante,
    strutturaMessaInOpera: us.strutturaMessaInOpera,
    strutturaTracceLavorazione: us.strutturaTracceLavorazione,
    negativaFormaContorno: us.negativaFormaContorno,
    negativaProfiloPareti: us.negativaProfiloPareti,
    negativaTipoStacco: us.negativaTipoStacco,
    negativaProfiloFondo: us.negativaProfiloFondo,
    note: us.note,
    riempie: relationNumbersToJson(us.riempie),
    riempitoDa: relationNumbersToJson(us.riempita_da),
    taglia: relationNumbersToJson(us.taglia),
    tagliatoDa: relationNumbersToJson(us.tagliata_da),
    siAppoggiaA: relationNumbersToJson(us.si_appoggia_a),
    gliSiAppoggia: relationNumbersToJson(us.gli_si_appoggia),
    ugualeAStratigrafico: relationNumbersToJson(us.uguale_a),
    posterioreA: relationNumbersToJson(us.posteriore_a),
    anterioreA: relationNumbersToJson(us.anteriore_a),
    statoConservazioneValutazione: us.statoConservazioneValutazione,
    statoConservazioneModificazioni: us.statoConservazioneModificazioni,
    statoConservazionePercentuale: us.statoConservazionePercentuale,
    metodoScavo: us.metodoScavo,
    osservazioniMetodoScavo: us.osservazioniMetodoScavo,
    interpretazioneEstesa: us.interpretazioneEstesa,
    elementiDatanti: us.elementiDatanti,
    datazioneAssoluta: us.datazioneAssoluta,
    periodoFase: us.periodoFase,
    epoca: us.epoca,
    riferimentiTabelleMateriali: us.riferimentiTabelleMateriali,
    datiQuantitativiReperti: us.datiQuantitativiReperti,
    campionature: us.campionature,
    flottazione: us.flottazione,
    flottazioneSecchi: us.flottazioneSecchi,
    setacciatura: us.setacciatura,
    setacciaturaSecchi: us.setacciaturaSecchi,
    affidabilitaStratigrafica: us.affidabilitaStratigrafica,
    motivazioneAffidabilita: us.motivazioneAffidabilita,
    responsabileSABAPUMB: us.responsabileSABAPUMB,
    responsabileArcheosistemi: us.responsabileArcheosistemi,
    direttoreScientifico: us.direttoreScientifico,
    responsabileSettore: us.responsabileSettore,
    compilatoreScheda: us.compilatoreScheda,
    dataCompilazione: us.dataCompilazione,
  };

  for (const [key, value] of Object.entries(map)) {
    const text = toNullableString(value);
    if (text) {
      schedaData[key] = text;
    }
  }

  return { topLevel, schedaData };
}

function mergeAiIntoProposed(
  base: { topLevel: ProposedTopLevelFields; schedaData: Record<string, string> },
  aiFields: Record<string, string | null>,
) {
  const topLevel: ProposedTopLevelFields = { ...base.topLevel };
  const schedaData: Record<string, string> = { ...base.schedaData };

  for (const [key, rawValue] of Object.entries(aiFields)) {
    const value = toNullableString(rawValue);
    if (!value) continue;

    if ((TOP_LEVEL_SYNC_KEYS as readonly string[]).includes(key)) {
      const typedKey = key as keyof ProposedTopLevelFields;
      if (isEmptyValue(topLevel[typedKey])) {
        topLevel[typedKey] = value;
      }
      continue;
    }

    // Tutti gli altri campi AI vengono mantenuti in schedaData.
    if (!schedaData[key]) {
      schedaData[key] = value;
    }
  }

  return { topLevel, schedaData };
}

function buildExistingSnapshot(us: UnitaStratigrafica): ExistingSnapshot {
  return {
    id: us.id,
    tipo: us.tipo,
    definizione: us.definizione,
    descrizione: us.descrizione,
    interpretazione: us.interpretazione,
    quota: toNullableString(us.quota),
    settore: us.settore,
    coperto_da: us.coperto_da,
    copre: us.copre,
    si_lega_a: us.si_lega_a,
    uguale_a: us.uguale_a,
    periodoIniziale: us.periodoIniziale,
    periodoFinale: us.periodoFinale,
    materialiRinvenuti: us.materialiRinvenuti,
    campioni: us.campioni,
    giornataId: us.giornataId,
    schedaData: parseSchedaData(us.schedaData),
  };
}

function ensureGiornataByDate(
  storage: IStorage,
  cantiereId: number,
  dayMap: Map<string, Giornata>,
  dayMeta: DayMeta | undefined,
  date: string,
): Giornata {
  const existing = dayMap.get(date);
  if (existing) return existing;

  const created = storage.createGiornata({
    cantiereId,
    data: date,
    condMeteo: dayMeta?.meteo || null,
    operatori: dayMeta?.operai != null ? JSON.stringify([`${dayMeta.operai} operai`]) : null,
    settore: null,
    note: "Import da Google Docs",
  });

  dayMap.set(date, created);
  return created;
}

function mergeWithOverrides(
  item: GoogleSyncPreviewItem,
  decision?: GoogleSyncDecision,
): ProposedTopLevelFields & { schedaData: Record<string, string> } {
  const merged: ProposedTopLevelFields & { schedaData: Record<string, string> } = {
    ...item.proposed,
    schedaData: { ...item.proposed.schedaData },
  };

  const overrides = decision?.overrides;
  if (!overrides) return merged;

  for (const key of TOP_LEVEL_SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      merged[key] = toNullableString(overrides[key]);
    }
  }

  if (overrides.schedaData && typeof overrides.schedaData === "object") {
    for (const [field, value] of Object.entries(overrides.schedaData)) {
      const normalized = toNullableString(value);
      if (!normalized) {
        delete merged.schedaData[field];
      } else {
        merged.schedaData[field] = normalized;
      }
    }
  }

  return merged;
}

function toPersistedTopLevelValue(
  key: (typeof TOP_LEVEL_SYNC_KEYS)[number],
  value: string | null,
): string | number | null {
  if (key === "quota") {
    return toNullableNumber(value);
  }
  return value;
}

function normalizeProposedTopLevel(
  fields: ProposedTopLevelFields,
  thesaurus?: USThesaurusConfig,
): ProposedTopLevelFields {
  const tipo = normalizeUsTipoWithVocabulary(fields.tipo, thesaurus?.tipo) || null;
  const definizione = normalizeUsDefinizioneWithVocabulary(
    fields.definizione,
    tipo || fields.tipo,
    thesaurus?.definizione,
  ) || null;

  return {
    ...fields,
    tipo,
    definizione,
  };
}

export async function buildGoogleSyncPreview(
  storage: IStorage,
  cantiereId: number,
  docId: string,
): Promise<GoogleSyncPreview> {
  const parsed = await parseJournalDocument(docId);
  const warnings: string[] = [];

  const existingUs = storage.getUSList(cantiereId);
  const usByCode = new Map<string, UnitaStratigrafica>();
  for (const us of existingUs) {
    usByCode.set(normalizeCodeKey(us.codiceUS), us);
  }

  const giornate = storage.getGiornate(cantiereId);
  const dayByDate = new Map<string, Giornata>();
  for (const day of giornate) {
    dayByDate.set(day.data, day);
  }

  const items: GoogleSyncPreviewItem[] = [];
  let usTotali = 0;

  for (const day of parsed) {
    if (!day.data) {
      warnings.push("Rilevata una giornata senza data valida: ignorata");
      continue;
    }

    for (const parsedUs of day.us) {
      usTotali += 1;
      const codiceUS = formatUsCode(parsedUs.numero);
      const existing = usByCode.get(normalizeCodeKey(codiceUS));

      const base = usDeterministicFields(parsedUs);
      const presentFields = {
        numero: parsedUs.numero,
        ...base.topLevel,
        ...base.schedaData,
      };
      const ai = await inferMissingFields(parsedUs.rawText || "", presentFields, parsedUs.campi_da_inferire || []);
      const merged = mergeAiIntoProposed(base, ai);

      const deterministicMap: Record<string, string | null> = {
        ...Object.fromEntries(Object.entries(base.topLevel).map(([k, v]) => [k, toNullableString(v)])),
        ...Object.fromEntries(Object.entries(base.schedaData).map(([k, v]) => [k, toNullableString(v)])),
      };

      items.push({
        key: `${day.data}::${codiceUS}`,
        giornataData: day.data,
        giornataMeteo: day.meteo,
        giornataOperai: day.operai,
        codiceUS,
        usNumero: parsedUs.numero,
        status: existing ? "existing" : "new",
        missingFields: parsedUs.campi_da_inferire || [],
        deterministic: deterministicMap,
        ai,
        proposed: {
          ...merged.topLevel,
          schedaData: merged.schedaData,
        },
        existing: existing ? buildExistingSnapshot(existing) : undefined,
        rawText: parsedUs.rawText || "",
      });

      if (!dayByDate.has(day.data)) {
        warnings.push(`Giornata ${day.data} non presente nel DB: verra creata in apply.`);
      }
    }
  }

  return {
    docId,
    giornate: parsed.length,
    usTotali,
    items,
    warnings,
  };
}

export function applyGoogleSyncPreview(
  storage: IStorage,
  cantiere: Cantiere,
  preview: GoogleSyncPreview,
  decisions: Record<string, GoogleSyncDecision>,
  thesaurus?: USThesaurusConfig,
): GoogleSyncApplyResult {
  const result: GoogleSyncApplyResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };

  const dayByDate = new Map<string, Giornata>();
  for (const day of storage.getGiornate(cantiere.id)) {
    dayByDate.set(day.data, day);
  }

  for (const item of preview.items) {
    const decision = decisions[item.key] || {};
    const action = decision.action || "confirm";

    if (action === "skip") {
      result.skipped += 1;
      continue;
    }

    const resolved = mergeWithOverrides(item, decision);
    const resolvedNormalized = {
      ...resolved,
      ...normalizeProposedTopLevel(resolved, thesaurus),
    };
    const giornata = ensureGiornataByDate(
      storage,
      cantiere.id,
      dayByDate,
      {
        data: item.giornataData,
        meteo: item.giornataMeteo,
        operai: item.giornataOperai,
      },
      item.giornataData,
    );

    try {
      if (item.status === "new") {
        storage.createUS({
          cantiereId: cantiere.id,
          giornataId: giornata.id,
          codiceUS: item.codiceUS,
          tipo: resolvedNormalized.tipo,
          definizione: resolvedNormalized.definizione,
          descrizione: resolvedNormalized.descrizione,
          interpretazione: resolvedNormalized.interpretazione,
          quota: toNullableNumber(resolvedNormalized.quota),
          settore: resolvedNormalized.settore,
          coperto_da: resolvedNormalized.coperto_da,
          copre: resolvedNormalized.copre,
          si_lega_a: resolvedNormalized.si_lega_a,
          uguale_a: resolvedNormalized.uguale_a,
          periodoIniziale: resolvedNormalized.periodoIniziale,
          periodoFinale: resolvedNormalized.periodoFinale,
          materialiRinvenuti: resolvedNormalized.materialiRinvenuti,
          campioni: resolvedNormalized.campioni,
          schedaModelKey: cantiere.usModelKey || "base-us",
          schedaData: serializeSchedaData(resolvedNormalized.schedaData),
        });
        result.created += 1;
        continue;
      }

      const existing = item.existing;
      if (!existing) {
        result.errors.push(`Snapshot mancante per ${item.codiceUS}`);
        continue;
      }

      const patch: Partial<UnitaStratigrafica> = {};

      for (const key of TOP_LEVEL_SYNC_KEYS) {
        const overrideProvided = !!decision.overrides && Object.prototype.hasOwnProperty.call(decision.overrides, key);
        const nextValue = resolvedNormalized[key];
        const prevValue = existing[key];
        const persistedNext = toPersistedTopLevelValue(key, nextValue);

        if (overrideProvided) {
          if (nextValue !== prevValue) {
            (patch as Record<string, unknown>)[key] = persistedNext;
          }
          continue;
        }

        if (isEmptyValue(prevValue) && !isEmptyValue(nextValue)) {
          (patch as Record<string, unknown>)[key] = persistedNext;
        }
      }

      if (!existing.giornataId) {
        patch.giornataId = giornata.id;
      }

      const schedaDataNext = { ...existing.schedaData };
      let schedaChanged = false;

      for (const [field, value] of Object.entries(resolvedNormalized.schedaData)) {
        const overrideProvided =
          !!decision.overrides?.schedaData &&
          Object.prototype.hasOwnProperty.call(decision.overrides.schedaData, field);

        if (overrideProvided) {
          const normalized = toNullableString(decision.overrides?.schedaData?.[field]);
          const prev = schedaDataNext[field] || null;
          if (!normalized) {
            if (prev) {
              delete schedaDataNext[field];
              schedaChanged = true;
            }
          } else if (prev !== normalized) {
            schedaDataNext[field] = normalized;
            schedaChanged = true;
          }
          continue;
        }

        if (!schedaDataNext[field]) {
          schedaDataNext[field] = value;
          schedaChanged = true;
        }
      }

      if (schedaChanged) {
        patch.schedaData = serializeSchedaData(schedaDataNext);
      }

      if (Object.keys(patch).length === 0) {
        result.unchanged += 1;
        continue;
      }

      storage.updateUS(existing.id, patch);
      result.updated += 1;
    } catch (error) {
      result.errors.push(`${item.codiceUS}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

