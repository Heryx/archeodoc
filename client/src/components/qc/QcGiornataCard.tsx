import { CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { QcLog } from "@shared/schema";
import { QcIssueRow } from "@/components/qc/QcIssueRow";

type QcGiornataCardProps = {
  giornata: any;
  logs: QcLog[];
  showDismissed: boolean;
  runPending: boolean;
  onRunQc: (giornataId: number) => void;
  onToggleDismiss: (logId: number, dismissed: boolean) => void;
};

function statusLabel(status: string, warnCount: number, errCount: number): string {
  if (status === "ok") return "OK";
  if (status === "warning") return `${warnCount} avvisi`;
  if (status === "error") return `${errCount} errori`;
  return "Non verificata";
}

function statusClass(status: string): string {
  if (status === "ok") return "qc-ok";
  if (status === "warning") return "qc-warning";
  if (status === "error") return "qc-error";
  return "qc-pending";
}

export function QcGiornataCard({
  giornata,
  logs,
  showDismissed,
  runPending,
  onRunQc,
  onToggleDismiss,
}: QcGiornataCardProps) {
  const visibleLogs = showDismissed ? logs : logs.filter((log) => !log.dismissed);
  const errCount = logs.filter((log) => log.livello === "error" && !log.dismissed).length;
  const warnCount = logs.filter((log) => log.livello === "warning" && !log.dismissed).length;
  const status = giornata.qcStatus || "pending";

  return (
    <Card data-testid={`card-qc-${giornata.id}`}>
      <CardHeader className="py-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base font-semibold">{giornata.data}</CardTitle>
            {giornata.settore && <span className="text-sm text-muted-foreground">Settore {giornata.settore}</span>}
            <span className={cn("px-2 py-0.5 rounded text-xs font-medium", statusClass(status))}>
              {statusLabel(status, warnCount, errCount)}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            data-testid={`button-run-qc-${giornata.id}`}
            onClick={() => onRunQc(giornata.id)}
            disabled={runPending}
          >
            <RefreshCw size={13} />
            {runPending ? "..." : "Riesegui"}
          </Button>
        </div>
      </CardHeader>

      {visibleLogs.length > 0 && (
        <CardContent className="pt-0 px-5 pb-4">
          <div className="space-y-1.5">
            {visibleLogs.map((issue) => (
              <QcIssueRow key={issue.id} issue={issue} onToggleDismiss={onToggleDismiss} />
            ))}
          </div>
        </CardContent>
      )}

      {status === "ok" && (
        <CardContent className="pt-0 px-5 pb-4">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
            <CheckCircle2 size={15} />
            <span>Documentazione completa e coerente</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
