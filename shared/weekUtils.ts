export type ProgettoWeek = {
  weekNumber: number;
  label: string;
  giornateIds: number[];
  dataInizio: string;
  dataFine: string;
};

function parseDateOnly(isoDate: string): Date | null {
  const normalized = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function fmtDate(iso: string): string {
  const date = parseDateOnly(iso);
  if (!date) return iso;
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function calcolaSettimaneProgetto(giornate: { id: number; data: string }[]): ProgettoWeek[] {
  if (!Array.isArray(giornate) || giornate.length === 0) return [];

  const sorted = [...giornate]
    .filter((item) => Number.isFinite(Number(item.id)) && !!parseDateOnly(item.data))
    .sort((a, b) => {
      const aTime = parseDateOnly(a.data)?.getTime() || 0;
      const bTime = parseDateOnly(b.data)?.getTime() || 0;
      return aTime - bTime;
    });

  if (sorted.length === 0) return [];

  const prima = parseDateOnly(sorted[0].data);
  if (!prima) return [];

  const weeks = new Map<number, { ids: number[]; dates: string[] }>();

  for (const giornata of sorted) {
    const date = parseDateOnly(giornata.data);
    if (!date) continue;

    const diff = Math.floor((date.getTime() - prima.getTime()) / (1000 * 60 * 60 * 24));
    const weekNum = Math.floor(diff / 7) + 1;

    if (!weeks.has(weekNum)) {
      weeks.set(weekNum, { ids: [], dates: [] });
    }

    weeks.get(weekNum)!.ids.push(Number(giornata.id));
    weeks.get(weekNum)!.dates.push(giornata.data);
  }

  return Array.from(weeks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekNum, { ids, dates }]) => {
      const sortedDates = [...dates].sort((a, b) => a.localeCompare(b));
      const dataInizio = sortedDates[0];
      const dataFine = sortedDates[sortedDates.length - 1];
      return {
        weekNumber: weekNum,
        label: `W${weekNum} - ${fmtDate(dataInizio)} -> ${fmtDate(dataFine)}`,
        giornateIds: ids,
        dataInizio,
        dataFine,
      };
    });
}
