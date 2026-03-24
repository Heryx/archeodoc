import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Image,
  Layers,
} from "lucide-react";
import { StatCard } from "@/components/stats/StatCard";
import type { Stats } from "@/components/stats/types";

type StatsSummaryGridProps = {
  stats: Stats;
};

export function StatsSummaryGrid({ stats }: StatsSummaryGridProps) {
  const { giornate, us, allegati, qc } = stats;
  const qcTotal = qc.erroriAperti + qc.warningAperti;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon={CalendarDays}
        label="Giornate"
        value={giornate.totale}
        sub={`${giornate.reportGenerati} con report AI`}
      />
      <StatCard
        icon={Layers}
        label="Unita Strat."
        value={us.totale}
        sub={`${us.schedeGenerate} schede AI generate`}
      />
      <StatCard icon={Image} label="Allegati" value={allegati.totale} />
      <StatCard
        icon={qc.erroriAperti > 0 ? AlertCircle : CheckCircle2}
        label="Problemi QC"
        value={qcTotal}
        sub={`${qc.erroriAperti} errori · ${qc.warningAperti} avvisi`}
        color={qc.erroriAperti > 0 ? "red" : qc.warningAperti > 0 ? "amber" : "green"}
      />
    </div>
  );
}
