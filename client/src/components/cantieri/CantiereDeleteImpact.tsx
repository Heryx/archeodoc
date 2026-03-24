import type { CantiereDeleteImpact } from "@/components/cantieri/types";

type CantiereDeleteImpactProps = {
  isLoading: boolean;
  impact: CantiereDeleteImpact | null;
};

export function CantiereDeleteImpactDetails({ isLoading, impact }: CantiereDeleteImpactProps) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>;
  }

  if (!impact) return null;

  return (
    <div className="text-sm space-y-1">
      <p className="font-medium">Impatto:</p>
      <p>- Giornate: {impact.giornateCount}</p>
      <p>- US: {impact.usCount}</p>
      <p>- Allegati: {impact.allegatiCount}</p>
      <p>- Log QC: {impact.qcLogsCount}</p>
      <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
    </div>
  );
}
