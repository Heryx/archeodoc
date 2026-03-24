import type { USDeleteImpact } from "@/components/us/types";

type USAllegatiImpactProps = {
  isLoading: boolean;
  deleteImpact: USDeleteImpact | null;
};

export function USAllegatiImpact({ isLoading, deleteImpact }: USAllegatiImpactProps) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>;
  }

  if (!deleteImpact) return null;

  return (
    <div className="text-sm space-y-1">
      <p className="font-medium">Impatto:</p>
      <p>- Allegati collegati: {deleteImpact.allegatiCount}</p>
      <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
    </div>
  );
}
