import { useEffect, useMemo, useState } from "react";
import { calcolaSettimaneProgetto, type ProgettoWeek } from "@shared/weekUtils";

type GiornataLite = {
  id: number;
  data: string;
  settore?: string | null;
};

export function useGiornatePerSettimana<T extends GiornataLite>(giornate: T[]) {
  const settimane = useMemo<ProgettoWeek[]>(() => calcolaSettimaneProgetto(giornate), [giornate]);

  const [selectedWeek, setSelectedWeek] = useState<number>(settimane.at(-1)?.weekNumber ?? 1);
  const [selectedGiornataId, setSelectedGiornataId] = useState<number | null>(null);

  useEffect(() => {
    const hasSelectedWeek = settimane.some((w) => w.weekNumber === selectedWeek);
    if (!hasSelectedWeek) {
      setSelectedWeek(settimane.at(-1)?.weekNumber ?? 1);
      setSelectedGiornataId(null);
    }
  }, [settimane, selectedWeek]);

  const giornateDellaSettimana = useMemo(() => {
    const week = settimane.find((w) => w.weekNumber === selectedWeek);
    if (!week) return [] as T[];
    const ids = new Set(week.giornateIds);
    return giornate
      .filter((g) => ids.has(g.id))
      .sort((a, b) => new Date(`${a.data}T00:00:00`).getTime() - new Date(`${b.data}T00:00:00`).getTime());
  }, [giornate, settimane, selectedWeek]);

  const selectWeek = (weekNumber: number) => {
    setSelectedWeek(weekNumber);
    setSelectedGiornataId(null);
  };

  return {
    settimane,
    selectedWeek,
    selectWeek,
    giornateDellaSettimana,
    selectedGiornataId,
    setSelectedGiornataId,
  };
}
