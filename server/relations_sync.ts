/**
 * Inverse relation synchronisation.
 *
 * When a US is saved with relation fields, this module automatically
 * updates the inverse relation on the referenced US records.
 *
 * E.g.: saving US 001 with `copre: "US 002"` will add "US 001" to
 * `coperto_da` on US 002.
 */
import type { IStorage } from "./storage";

// ── Relation field definitions ───────────────────────────────────────────────

/** Top-level DB columns that hold relation values */
const TOP_LEVEL_FIELDS = ["copre", "coperto_da", "si_lega_a", "uguale_a"] as const;
type TopLevelField = (typeof TOP_LEVEL_FIELDS)[number];

/** schedaData JSON fields that hold relation values */
const SCHEDA_DATA_FIELDS = [
  "taglia",
  "tagliatoDa",
  "riempie",
  "riempitoDa",
  "siAppoggiaA",
  "gliSiAppoggia",
  "posterioreA",
  "anterioreA",
] as const;
type SchedaDataField = (typeof SCHEDA_DATA_FIELDS)[number];

type RelField = TopLevelField | SchedaDataField;

// For each field, its inverse field.
// Symmetric fields (si_lega_a, uguale_a) map to themselves.
const INVERSE_MAP: Record<RelField, RelField> = {
  copre: "coperto_da",
  coperto_da: "copre",
  si_lega_a: "si_lega_a",
  uguale_a: "uguale_a",
  taglia: "tagliatoDa",
  tagliatoDa: "taglia",
  riempie: "riempitoDa",
  riempitoDa: "riempie",
  siAppoggiaA: "gliSiAppoggia",
  gliSiAppoggia: "siAppoggiaA",
  posterioreA: "anterioreA",
  anterioreA: "posterioreA",
};

const TOP_LEVEL_SET = new Set<string>(TOP_LEVEL_FIELDS);

// ── Parsing / serialisation helpers ─────────────────────────────────────────

function parseSchedaData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function serializeSchedaData(data: Record<string, unknown>): string | null {
  const keys = Object.keys(data);
  if (!keys.length) return null;
  return JSON.stringify(data);
}

function parseRelCodes(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
  } catch { /* plain text */ }
  return text
    .split(/[,;|\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeRelCodes(codes: string[]): string {
  return codes.join(", ");
}

function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Adds `sourceCode` to the relation field `field` on `targetUS`, if not already present */
function addToRelation(
  existing: string | null | undefined,
  sourceCode: string,
): string {
  const codes = parseRelCodes(existing);
  const norm = normalizeCode(sourceCode);
  if (codes.some((c) => normalizeCode(c) === norm)) return serializeRelCodes(codes);
  return serializeRelCodes([...codes, sourceCode]);
}

/** Removes `sourceCode` from relation field `field` on `targetUS` */
function removeFromRelation(
  existing: string | null | undefined,
  sourceCode: string,
): string {
  const codes = parseRelCodes(existing);
  const norm = normalizeCode(sourceCode);
  const filtered = codes.filter((c) => normalizeCode(c) !== norm);
  return serializeRelCodes(filtered);
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface PendingInverse {
  /** The US id that needs to be updated */
  targetId: number;
  /** Human-readable code of the target US */
  targetCode: string;
  /** The field on the target US that should receive the inverse value */
  field: RelField;
  /** The value to be added (the source US code) */
  valueToAdd: string;
}

/**
 * Computes which inverse relations are missing WITHOUT writing anything.
 * Returns a list of proposed changes for the user to confirm.
 */
export function computePendingInverses(
  storage: IStorage,
  updatedId: number,
): PendingInverse[] {
  const updated = storage.getUS(updatedId);
  if (!updated) return [];

  const sourceCode = updated.codiceUS?.trim();
  if (!sourceCode) return [];

  const schedaNew = parseSchedaData(updated.schedaData);
  const newValues = extractRelationValues(
    updated as unknown as Record<string, unknown>,
    schedaNew,
  );

  const allUS = storage.getUSList(updated.cantiereId);
  const byCode = new Map<string, typeof allUS[number]>();
  for (const us of allUS) {
    if (us.codiceUS?.trim()) {
      byCode.set(normalizeCode(us.codiceUS), us);
    }
  }

  const pending: PendingInverse[] = [];

  for (const field of [...TOP_LEVEL_FIELDS, ...SCHEDA_DATA_FIELDS] as RelField[]) {
    const inverseField = INVERSE_MAP[field];
    const referencedCodes = parseRelCodes(newValues[field]);

    for (const refCodeRaw of referencedCodes) {
      const refNorm = normalizeCode(refCodeRaw);
      if (refNorm === normalizeCode(sourceCode)) continue;

      const targetUS = byCode.get(refNorm);
      if (!targetUS) continue;

      const targetSchedaData = parseSchedaData(targetUS.schedaData);
      const isTopLevel = TOP_LEVEL_SET.has(inverseField);

      const currentInverse = isTopLevel
        ? String((targetUS as any)[inverseField] || "")
        : String(targetSchedaData[inverseField] || "");

      const codes = parseRelCodes(currentInverse);
      const alreadyPresent = codes.some((c) => normalizeCode(c) === normalizeCode(sourceCode));
      if (alreadyPresent) continue;

      pending.push({
        targetId: targetUS.id,
        targetCode: targetUS.codiceUS!,
        field: inverseField,
        valueToAdd: sourceCode,
      });
    }
  }

  return pending;
}

/**
 * Applies a specific list of pending inverses (user-confirmed).
 */
export function applyPendingInverses(
  storage: IStorage,
  inverses: PendingInverse[],
): void {
  for (const inv of inverses) {
    const targetUS = storage.getUS(inv.targetId);
    if (!targetUS) continue;

    const isTopLevel = TOP_LEVEL_SET.has(inv.field);
    const targetSchedaData = parseSchedaData(targetUS.schedaData);

    const currentVal = isTopLevel
      ? String((targetUS as any)[inv.field] || "")
      : String(targetSchedaData[inv.field] || "");

    const nextVal = addToRelation(currentVal, inv.valueToAdd);
    if (nextVal === currentVal) continue;

    if (isTopLevel) {
      storage.updateUS(inv.targetId, { [inv.field]: nextVal });
    } else {
      targetSchedaData[inv.field] = nextVal;
      storage.updateUS(inv.targetId, { schedaData: serializeSchedaData(targetSchedaData) });
    }
  }
}

interface RelationDelta {
  /** Fields and their new raw values after update */
  newValues: Record<RelField, string>;
  /** Fields and their old raw values before update */
  oldValues: Record<RelField, string>;
  sourceCode: string;
  cantiereId: number;
}

function extractRelationValues(
  topLevelData: Record<string, unknown>,
  schedaData: Record<string, unknown>,
): Record<RelField, string> {
  const out = {} as Record<RelField, string>;
  for (const f of TOP_LEVEL_FIELDS) {
    out[f] = String(topLevelData[f] || "");
  }
  for (const f of SCHEDA_DATA_FIELDS) {
    out[f] = String(schedaData[f] || "");
  }
  return out;
}

/**
 * After saving a US, sync inverse relations on all referenced US records.
 *
 * @param storage  The project storage instance
 * @param updatedId  The id of the US that was just saved
 */
export function syncInverseRelations(
  storage: IStorage,
  updatedId: number,
): void {
  const updated = storage.getUS(updatedId);
  if (!updated) return;

  const sourceCode = updated.codiceUS?.trim();
  if (!sourceCode) return;

  const schedaNew = parseSchedaData(updated.schedaData);
  const newValues = extractRelationValues(
    updated as unknown as Record<string, unknown>,
    schedaNew,
  );

  // Get all US in the same cantiere for code → id lookup
  const allUS = storage.getUSList(updated.cantiereId);
  const byCode = new Map<string, typeof allUS[number]>();
  for (const us of allUS) {
    if (us.codiceUS?.trim()) {
      byCode.set(normalizeCode(us.codiceUS), us);
    }
  }

  // For each relation field, ensure the inverse is set on each referenced US
  for (const field of [...TOP_LEVEL_FIELDS, ...SCHEDA_DATA_FIELDS] as RelField[]) {
    const inverseField = INVERSE_MAP[field];
    const referencedCodes = parseRelCodes(newValues[field]);

    for (const refCodeRaw of referencedCodes) {
      const refNorm = normalizeCode(refCodeRaw);
      // Don't touch self-references
      if (refNorm === normalizeCode(sourceCode)) continue;

      const targetUS = byCode.get(refNorm);
      if (!targetUS) continue; // referenced US doesn't exist yet — skip

      // Read current inverse value on target
      const targetSchedaData = parseSchedaData(targetUS.schedaData);
      const isTopLevel = TOP_LEVEL_SET.has(inverseField);

      const currentInverse = isTopLevel
        ? String((targetUS as any)[inverseField] || "")
        : String(targetSchedaData[inverseField] || "");

      const nextInverse = addToRelation(currentInverse, sourceCode);
      if (nextInverse === currentInverse) continue; // already there

      if (isTopLevel) {
        storage.updateUS(targetUS.id, { [inverseField]: nextInverse });
      } else {
        targetSchedaData[inverseField] = nextInverse;
        storage.updateUS(targetUS.id, {
          schedaData: serializeSchedaData(targetSchedaData),
        });
      }
    }
  }

  // Also: for any US that USED TO reference this US in a field, but no longer
  // does (i.e., the code was removed), remove the inverse on those records.
  // We can detect this by scanning all other US for their inverse fields pointing
  // back at sourceCode, and checking if the forward relation still holds.
  for (const otherUS of allUS) {
    if (otherUS.id === updatedId) continue;
    const otherCode = otherUS.codiceUS?.trim();
    if (!otherCode) continue;

    const otherSched = parseSchedaData(otherUS.schedaData);
    let otherModified = false;
    const otherTopPatch: Record<string, string> = {};

    for (const field of [...TOP_LEVEL_FIELDS, ...SCHEDA_DATA_FIELDS] as RelField[]) {
      const inverseField = INVERSE_MAP[field];

      // Does otherUS's `field` include sourceCode?
      const isTopLevel = TOP_LEVEL_SET.has(field);
      const otherFieldVal = isTopLevel
        ? String((otherUS as any)[field] || "")
        : String(otherSched[field] || "");

      const codesInField = parseRelCodes(otherFieldVal);
      const hasSource = codesInField.some((c) => normalizeCode(c) === normalizeCode(sourceCode));
      if (!hasSource) continue;

      // otherUS's `field` references sourceCode.
      // Check if the updated US still has `inverseField` → otherCode
      const inverseIsTopLevel = TOP_LEVEL_SET.has(inverseField);
      const updatedInverseVal = inverseIsTopLevel
        ? String((updated as any)[inverseField] || "")
        : String(schedaNew[inverseField] || "");
      const updatedInverseCodes = parseRelCodes(updatedInverseVal);
      const stillLinked = updatedInverseCodes.some(
        (c) => normalizeCode(c) === normalizeCode(otherCode),
      );
      if (stillLinked) continue;

      // The updated US removed `otherCode` from its `inverseField`.
      // So remove `sourceCode` from otherUS's `field`.
      const newFieldVal = removeFromRelation(otherFieldVal, sourceCode);
      if (isTopLevel) {
        otherTopPatch[field] = newFieldVal;
      } else {
        otherSched[field] = newFieldVal;
        otherModified = true;
      }
    }

    if (otherModified || Object.keys(otherTopPatch).length > 0) {
      const patch: Record<string, unknown> = { ...otherTopPatch };
      if (otherModified) {
        patch.schedaData = serializeSchedaData(otherSched);
      }
      storage.updateUS(otherUS.id, patch);
    }
  }
}
