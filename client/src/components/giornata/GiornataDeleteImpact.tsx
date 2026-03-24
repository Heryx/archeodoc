import type { GiornataDeleteImpact } from "@/components/giornata/types";

type GiornataDeleteImpactProps = {
  isLoading: boolean;
  impact: GiornataDeleteImpact | null;
};

export function GiornataDeleteImpactDetails({ isLoading, impact }: GiornataDeleteImpactProps) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>;
  }

  if (!impact) return null;

  return (
    <div className="text-sm space-y-1">
      <p className="font-medium">Impatto:</p>
      <p>- US collegate (verranno scollegate): {impact.usCollegateCount}</p>
      <p>- Allegati: {impact.allegatiCount}</p>
      <p>- Log QC: {impact.qcLogsCount}</p>
      <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
    </div>
  );
}
