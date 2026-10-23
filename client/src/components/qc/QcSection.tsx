import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QcStatusStats } from "@/components/qc/types";

type QcSectionProps = {
  id: string;
  title: string;
  icon: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Numero di elementi (mostrato accanto al titolo) */
  count?: number;
  /** Riepilogo stati: se assente la sezione e' di sola consultazione (es. regole) */
  stats?: QcStatusStats;
  children: ReactNode;
};

/**
 * Sezione comprimibile della pagina QC. La barra resta visibile (e fissa in alto
 * mentre si scorre la lista) con il riepilogo degli stati: una nuova categoria di
 * schede si aggiunge dichiarando un'altra sezione, senza toccare il resto.
 */
export function QcSection({ id, title, icon: Icon, open, onOpenChange, count, stats, children }: QcSectionProps) {
  return (
    <section id={`qc-section-${id}`} className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "sticky top-0 z-10 flex w-full items-center gap-3 bg-background px-4 py-2.5 text-left hover:bg-muted/50",
          open ? "rounded-t-lg border-b border-border" : "rounded-lg",
        )}
      >
        <Icon size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
        {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
        <span className="ml-auto flex items-center gap-3">
          {stats && stats.error > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600" title="Con errori"><AlertCircle size={14} />{stats.error}</span>
          )}
          {stats && stats.warning > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-500" title="Con avvisi"><AlertTriangle size={14} />{stats.warning}</span>
          )}
          {stats && stats.pending > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Non verificate"><RefreshCw size={13} />{stats.pending}</span>
          )}
          {stats && stats.ok > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-600" title="OK"><CheckCircle2 size={14} />{stats.ok}</span>
          )}
          <ChevronDown size={16} className={cn("text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}
