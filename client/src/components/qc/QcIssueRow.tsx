import { AlertCircle, AlertTriangle, Eye, EyeOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QcLog } from "@shared/schema";

type QcIssueRowProps = {
  issue: QcLog;
  onToggleDismiss: (id: number, dismissed: boolean) => void;
};

const levelStyles = {
  error: { icon: AlertCircle, text: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
  warning: { icon: AlertTriangle, text: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
  info: { icon: Info, text: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
} as const;

export function QcIssueRow({ issue, onToggleDismiss }: QcIssueRowProps) {
  const style = levelStyles[issue.livello as keyof typeof levelStyles] || levelStyles.info;
  const Icon = style.icon;

  return (
    <div className={cn("flex items-start gap-3 rounded-lg px-4 py-3", style.bg, issue.dismissed && "opacity-50")}>
      <Icon size={15} className={cn(style.text, "mt-0.5 shrink-0")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{issue.messaggio}</p>
        <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
          {issue.categoria && <span className="capitalize">{issue.categoria}</span>}
          {issue.campoInteressato && <span className="font-mono">{issue.campoInteressato}</span>}
        </div>
      </div>
      <button
        type="button"
        title={issue.dismissed ? "Ripristina avviso" : "Nascondi avviso"}
        onClick={() => onToggleDismiss(issue.id, !issue.dismissed)}
        className="shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        {issue.dismissed ? (
          <Eye size={14} className="text-muted-foreground" />
        ) : (
          <EyeOff size={14} className="text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
