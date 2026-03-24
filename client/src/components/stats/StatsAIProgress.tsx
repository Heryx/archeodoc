import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wand2 } from "lucide-react";
import type { Stats } from "@/components/stats/types";

type StatsAIProgressProps = {
  stats: Stats;
};

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function StatsAIProgress({ stats }: StatsAIProgressProps) {
  const { giornate, us } = stats;
  const giornatePct = percentage(giornate.reportGenerati, giornate.totale);
  const usPct = percentage(us.schedeGenerate, us.totale);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Wand2 size={14} className="text-primary" /> Avanzamento AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Report giornalieri generati</span>
            <span className="font-medium">
              {giornate.reportGenerati}/{giornate.totale}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${giornatePct}%` }} />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Schede US generate</span>
            <span className="font-medium">
              {us.schedeGenerate}/{us.totale}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usPct}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
