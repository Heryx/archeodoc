import { formatUsCode } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import type { QcLog } from "@shared/schema";
import { QcItemRow } from "@/components/qc/QcItemRow";

type QcUSCardProps = {
  us: any;
  logs: QcLog[];
  showDismissed: boolean;
  runPending: boolean;
  defaultOpen?: boolean;
  onRunQc: (usId: number) => void;
  onToggleDismiss: (logId: number, dismissed: boolean) => void;
};

export function QcUSCard({ us, logs, showDismissed, runPending, defaultOpen, onRunQc, onToggleDismiss }: QcUSCardProps) {
  const { settings: codeSettings } = useProjectCodeSettings();

  return (
    <QcItemRow
      title={<span className="font-mono">{formatUsCode(us.codiceUS, us.tipo, codeSettings.tombaStyle)}</span>}
      subtitle={us.definizione}
      status={us.qcStatus || "pending"}
      logs={logs}
      showDismissed={showDismissed}
      runPending={runPending}
      defaultOpen={defaultOpen}
      okMessage="Scheda completa e coerente"
      onRun={() => onRunQc(us.id)}
      onToggleDismiss={onToggleDismiss}
    />
  );
}
