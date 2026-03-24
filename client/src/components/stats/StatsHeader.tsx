import { BarChart3, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Stats } from "@/components/stats/types";

type StatsHeaderProps = {
  stats: Stats;
  runQcPending: boolean;
  exportLoading: boolean;
  onRunQc: () => void;
  onExportZip: () => void;
};

export function StatsHeader({ stats, runQcPending, exportLoading, onRunQc, onExportZip }: StatsHeaderProps) {
  const { cantiere } = stats;

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 size={22} className="text-primary" />
          {cantiere.nome}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {cantiere.codice} - {cantiere.localita}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" onClick={onRunQc} disabled={runQcPending} className="gap-2">
          <RefreshCw size={15} className={runQcPending ? "animate-spin" : ""} />
          {runQcPending ? "QC in corso..." : "Esegui QC"}
        </Button>
        <Button onClick={onExportZip} disabled={exportLoading} className="gap-2">
          <Download size={15} />
          {exportLoading ? "Preparazione..." : "Esporta ZIP"}
        </Button>
      </div>
    </div>
  );
}
