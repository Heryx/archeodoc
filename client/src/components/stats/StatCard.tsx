import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "green" | "red" | "amber";
};

export function StatCard({ icon: Icon, label, value, sub, color = "default" }: StatCardProps) {
  const colorClass = {
    default: "text-primary",
    green: "text-green-600",
    red: "text-red-600",
    amber: "text-amber-600",
  }[color];

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={cn("text-3xl font-bold mt-1", colorClass)}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon size={20} className={cn("mt-1 opacity-50", colorClass)} />
        </div>
      </CardContent>
    </Card>
  );
}
