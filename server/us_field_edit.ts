import type { IStorage } from "./storage";
import type { ProjectDefinition } from "./projects";
import type { UnitaStratigrafica } from "@shared/schema";
import { getProjectSchemaDefinition } from "./projects";
import { getUsTopLevelThesaurusFromSchema } from "@shared/us_schema_thesaurus";
import {
  normalizeUsDefinizioneWithVocabulary,
  normalizeUsTipoWithVocabulary,
} from "@shared/us_thesaurus";
import { syncInverseRelations } from "./relations_sync";

/**
 * Colonne di primo livello della tabella US (allineato a US_TOP_LEVEL_KEYS in server/routes.ts).
 * Tutto ciò che non è qui viene salvato in schedaData, coerentemente con buildUSFlatFields
 * (che fa sempre prevalere schedaData sulla colonna).
 */
const US_TOP_LEVEL_KEYS = new Set<string>([
  "codiceUS",
  "tipo",
  "definizione",
  "descrizione",
  "interpretazione",
  "quota",
  "quotaPianoCampagna",
  "settore",
  "coperto_da",
  "copre",
  "si_lega_a",
  "uguale_a",
  "periodoIniziale",
  "periodoFinale",
  "materialiRinvenuti",
  "campioni",
  "giornataId",
]);

function parseSchedaData(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function serializeSchedaData(value: Record<string, unknown>): string | null {
  const entries = Object.entries(value).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== "",
  );
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

/**
 * Applica la modifica di un singolo campo a una US, decidendo automaticamente se la chiave è
 * una colonna nota di primo livello o un campo custom del modello (→ schedaData). In entrambi
 * i casi propaga le relazioni stratigrafiche inverse. Usato sia dall'edit inline dell'Elenco
 * US sia dalle modifiche batch proposte dall'assistente IA.
 */
export function applyUsInlineFieldEdit(
  storage: IStorage,
  project: ProjectDefinition,
  id: number,
  rawKey: string,
  rawValue: unknown,
): UnitaStratigrafica | undefined {
  const existing = storage.getUS(id);
  if (!existing) return undefined;

  const key = String(rawKey || "").trim();
  if (!key) return existing;
  const value = rawValue != null ? String(rawValue) : "";

  if (US_TOP_LEVEL_KEYS.has(key)) {
    const patch: Record<string, unknown> = { [key]: value };
    const schema = getProjectSchemaDefinition(project.id);
    const usThesaurus = getUsTopLevelThesaurusFromSchema(schema);
    if (key === "tipo") {
      patch.tipo = normalizeUsTipoWithVocabulary(value, usThesaurus.tipo);
    }
    if (key === "definizione") {
      patch.definizione = normalizeUsDefinizioneWithVocabulary(
        value,
        existing.tipo,
        usThesaurus.definizione,
      );
    }
    const updated = storage.updateUS(id, patch);
    syncInverseRelations(storage, id);
    return storage.getUS(id) ?? updated ?? undefined;
  }

  const nextSchedaData = { ...parseSchedaData(existing.schedaData), [key]: value };
  const updated = storage.updateUS(id, { schedaData: serializeSchedaData(nextSchedaData) });
  syncInverseRelations(storage, id);
  return storage.getUS(id) ?? updated ?? undefined;
}
