import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Image, Layers, ShieldCheck } from "lucide-react";
import type { Stats } from "@/components/stats/types";

type StatsBreakdownRowProps = {
  stats: Stats;
};

const qcColors: Record<string, string> = {
  ok: "bg-green-500",
  warning: "bg-amber-400",
  error: "bg-red-500",
  pending: "bg-gray-300",
};

const qcLabels: Record<string, string> = {
  ok: "OK",
  warning: "Avvisi",
  error: "Errori",
  pending: "Da verificare",
};

function sortedEntries(record: Record<string, number>) {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

export function StatsBreakdownRow({ stats }: StatsBreakdownRowProps) {
  const { giornate, us, allegati } = stats;
  const tipiUS = sortedEntries(us.perTipo);
  const tipiAllegati = sortedEntries(allegati.perTipo);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-primary" /> Stato QC Giornate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(giornate.qcStatus).map(([status, count]) => {
            if (count === 0) return null;
            const percentage = giornate.totale > 0 ? Math.round((count / giornate.totale) * 100) : 0;

            return (
              <div key={status}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{qcLabels[status] || status}</span>
                  <span className="font-medium">
                    {count} ({percentage}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", qcColors[status] || "bg-gray-400")}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}

          {giornate.totale === 0 && <p className="text-xs text-muted-foreground">Nessuna giornata registrata</p>}
        </CardContent>
      </Card>

      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Layers size={14} className="text-primary" /> US per tipo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tipiUS.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessuna US registrata</p>
          ) : (
            <div className="space-y-1.5">
              {tipiUS.map(([tipo, count]) => (
                <div key={tipo} className="flex items-center justify-between">
                  <span className="text-sm capitalize text-muted-foreground">{tipo}</span>
                  <Badge variant="secondary" className="tabular-nums">
                    {count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Image size={14} className="text-primary" /> Allegati per tipo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tipiAllegati.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun allegato caricato</p>
          ) : (
            <div className="space-y-1.5">
              {tipiAllegati.map(([tipo, count]) => (
                <div key={tipo} className="flex items-center justify-between">
                  <span className="text-sm capitalize text-muted-foreground">{tipo}</span>
                  <Badge variant="secondary" className="tabular-nums">
                    {count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
