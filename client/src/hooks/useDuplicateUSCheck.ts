import { useMemo } from "react";
import { normalizeUSCode, usCodeKey } from "@shared/normalize_us_code";

type USLite = {
  id: number;
  codiceUS: string;
};

export type DuplicateUSGroup = {
  normalizedCode: string;
  schede: USLite[];
};

export function useDuplicateUSCheck(unitaStrat: USLite[]): DuplicateUSGroup[] {
  return useMemo(() => {
    const groups = new Map<string, USLite[]>();

    for (const us of unitaStrat) {
      const key = usCodeKey(us.codiceUS);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ id: us.id, codiceUS: us.codiceUS });
    }

    return Array.from(groups.entries())
      .filter(([, schede]) => schede.length > 1)
      .map(([key, schede]) => ({
        normalizedCode: normalizeUSCode(key) || key,
        schede: schede.sort((a, b) => String(a.codiceUS || "").localeCompare(String(b.codiceUS || ""))),
      }))
      .sort((a, b) => a.normalizedCode.localeCompare(b.normalizedCode));
  }, [unitaStrat]);
}

export function findPotentialDuplicateUS(
  codiceUS: string,
  unitaStrat: USLite[],
  excludeId?: number,
): USLite | null {
  const key = usCodeKey(codiceUS);
  if (!key) return null;

  return (
    unitaStrat.find((us) => {
      if (excludeId && us.id === excludeId) return false;
      return usCodeKey(us.codiceUS) === key;
    }) || null
  );
}
