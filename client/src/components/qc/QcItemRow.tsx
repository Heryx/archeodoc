import { useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, ChevronRight, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QcLog } from "@shared/schema";
import { QcIssueRow } from "@/components/qc/QcIssueRow";

export function qcStatusClass(status: string): string {
  if (status === "ok") return "qc-ok";
  if (status === "warning") return "qc-warning";
  if (status === "error") return "qc-error";
  return "qc-pending";
}

export function qcStatusLabel(status: string, warnCount: number, errCount: number): string {
  if (status === "ok") return "OK";
  if (status === "pending") return "Non verificata";
  const parts: string[] = [];
  if (errCount > 0) parts.push(`${errCount} errori`);
  if (warnCount > 0) parts.push(`${warnCount} avvisi`);
  return parts.length > 0 ? parts.join(", ") : status;
}

type QcItemRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  status: string;
  logs: QcLog[];
  showDismissed: boolean;
  runPending: boolean;
  okMessage: string;
  defaultOpen?: boolean;
  onRun: () => void;
  onToggleDismiss: (logId: number, dismissed: boolean) => void;
  testId?: string;
  runTestId?: string;
};

/**
 * Riga compatta di un elemento sottoposto a QC (giornata, US, in futuro schede
 * materiali, SAS...): una sola riga con lo stato, i dettagli si aprono al clic.
 */
export function QcItemRow({
  title,
  subtitle,
  status,
  logs,
  showDismissed,
  runPending,
  okMessage,
  defaultOpen = false,
  onRun,
  onToggleDismiss,
  testId,
  runTestId,
}: QcItemRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const visibleLogs = showDismissed ? logs : logs.filter((log) => !log.dismissed);
  const live = logs.filter((log) => !log.dismissed);
  const errCount = live.filter((log) => log.livello === "error").length;
  const warnCount = live.filter((log) => log.livello === "warning").length;
  const infoCount = live.filter((log) => log.livello === "info").length;
  const hasBody = visibleLogs.length > 0 || status === "ok";

  return (
    <div className="rounded-md border border-border" data-testid={testId}>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50"
        >
          <ChevronRight
            size={14}
            className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90", !hasBody && "opacity-30")}
          />
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {subtitle && <span className="min-w-0 truncate text-sm text-muted-foreground">{subtitle}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {errCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-red-600"><AlertCircle size={13} />{errCount}</span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-amber-500"><AlertTriangle size={13} />{warnCount}</span>
            )}
            {infoCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-blue-500"><Info size={13} />{infoCount}</span>
            )}
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", qcStatusClass(status))}>
              {status === "ok" || status === "pending" ? qcStatusLabel(status, warnCount, errCount) : status === "error" ? "Errore" : "Avviso"}
            </span>
          </span>
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          title="Riesegui QC"
          data-testid={runTestId}
          onClick={onRun}
          disabled={runPending}
        >
          <RefreshCw size={13} />
        </Button>
      </div>

      {open && (
        <div className="space-y-1.5 px-3 pb-3 pt-1">
          {visibleLogs.map((issue) => (
            <QcIssueRow key={issue.id} issue={issue} onToggleDismiss={onToggleDismiss} />
          ))}
          {status === "ok" && (
            <p className="px-1 text-sm text-green-600 dark:text-green-400">{okMessage}</p>
          )}
          {!hasBody && <p className="px-1 text-sm text-muted-foreground">Nessuna segnalazione da mostrare.</p>}
        </div>
      )}
    </div>
  );
}
