export type QcStatusStats = {
  ok: number;
  warning: number;
  error: number;
  pending: number;
};

export function computeQcStatusStats(giornate: Array<{ qcStatus?: string | null }>): QcStatusStats {
  const stats: QcStatusStats = { ok: 0, warning: 0, error: 0, pending: 0 };

  for (const giornata of giornate) {
    const status = (giornata.qcStatus || "pending") as keyof QcStatusStats;
    if (status in stats) {
      stats[status] += 1;
    }
  }

  return stats;
}
