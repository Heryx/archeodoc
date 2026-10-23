import type { QcLog } from "@shared/schema";
import { QcItemRow } from "@/components/qc/QcItemRow";

type QcGiornataCardProps = {
  giornata: any;
  logs: QcLog[];
  showDismissed: boolean;
  runPending: boolean;
  defaultOpen?: boolean;
  onRunQc: (giornataId: number) => void;
  onToggleDismiss: (logId: number, dismissed: boolean) => void;
};

export function QcGiornataCard({
  giornata,
  logs,
  showDismissed,
  runPending,
  defaultOpen,
  onRunQc,
  onToggleDismiss,
}: QcGiornataCardProps) {
  return (
    <QcItemRow
      testId={`card-qc-${giornata.id}`}
      runTestId={`button-run-qc-${giornata.id}`}
      title={giornata.data}
      subtitle={giornata.settore ? `Settore ${giornata.settore}` : undefined}
      status={giornata.qcStatus || "pending"}
      logs={logs}
      showDismissed={showDismissed}
      runPending={runPending}
      defaultOpen={defaultOpen}
      okMessage="Documentazione completa e coerente"
      onRun={() => onRunQc(giornata.id)}
      onToggleDismiss={onToggleDismiss}
    />
  );
}
