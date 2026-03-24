import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { QcStatusStats } from "@/components/qc/types";

type QcSummaryCardsProps = {
  stats: QcStatusStats;
};

export function QcSummaryCards({ stats }: QcSummaryCardsProps) {
  const cards = [
    {
      key: "ok",
      label: "Giornate OK",
      icon: CheckCircle2,
      value: stats.ok,
      text: "text-green-600",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      key: "warning",
      label: "Con avvisi",
      icon: AlertTriangle,
      value: stats.warning,
      text: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-900/20",
    },
    {
      key: "error",
      label: "Con errori",
      icon: AlertCircle,
      value: stats.error,
      text: "text-red-600",
      bg: "bg-red-50 dark:bg-red-900/20",
    },
    {
      key: "pending",
      label: "Non verificate",
      icon: RefreshCw,
      value: stats.pending,
      text: "text-muted-foreground",
      bg: "bg-muted/50",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.key} className={cn("border-0", card.bg)}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon size={20} className={card.text} />
              <div>
                <div className="text-xl font-bold">{card.value}</div>
                <div className="text-xs text-muted-foreground">{card.label}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
