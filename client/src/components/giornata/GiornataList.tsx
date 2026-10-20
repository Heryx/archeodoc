import { AlertCircle, AlertTriangle, Camera, ChevronDown, ChevronUp, Info, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseOperatori } from "@/components/giornata/types";
import { GiornataFotoPanel } from "@/components/giornata/GiornataFotoPanel";

function QcBadge({ status }: { status?: string | null }) {
  const s = status || "pending";
  if (s === "ok") return <span className="qc-ok px-2 py-0.5 rounded text-xs font-medium">OK</span>;
  if (s === "error") return <span title="Errore QC"><AlertCircle size={14} className="text-red-600 shrink-0" /></span>;
  if (s === "warning") return <span title="Avviso QC"><AlertTriangle size={14} className="text-amber-500 shrink-0" /></span>;
  return null;
}

const issueStyles = {
  error: { icon: AlertCircle, text: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
  warning: { icon: AlertTriangle, text: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
  info: { icon: Info, text: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
} as const;

function QcIssuePanel({ logs }: { logs: any[] }) {
  const active = logs.filter((l) => !l.dismissed);
  if (active.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {active.map((issue: any) => {
        const style = issueStyles[issue.livello as keyof typeof issueStyles] || issueStyles.info;
        const Icon = style.icon;
        return (
          <div key={issue.id} className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", style.bg)}>
            <Icon size={13} className={cn(style.text, "mt-0.5 shrink-0")} />
            <div className="flex-1 min-w-0">
              <span>{issue.messaggio}</span>
              {issue.campoInteressato && (
                <span className="ml-2 text-xs text-muted-foreground font-mono">{issue.campoInteressato}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type GiornataListProps = {
  cid: string;
  gid?: string;
  giornate: any[];
  isLoading: boolean;
  runQcPending: boolean;
  deletePending: boolean;
  qcLogsMap?: Record<number, any[]>;
  onNavigate: (path: string) => void;
  onOpenDetail: (giornataId: number) => void;
  onRunQc: (id: number) => void;
  onEdit: (giornata: any) => void;
  onDelete: (giornata: any) => void;
};

const cantiereIdFromCid = (cid: string) => Number(cid);

export function GiornataList({
  cid,
  gid,
  giornate,
  isLoading,
  runQcPending,
  deletePending,
  qcLogsMap = {},
  onNavigate,
  onOpenDetail,
  onRunQc,
  onEdit,
  onDelete,
}: GiornataListProps) {
  const [expandedQc, setExpandedQc] = useState<Set<number>>(new Set());
  const [expandedFoto, setExpandedFoto] = useState<Set<number>>(new Set());
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (giornate.length === 0) {
    return (
      <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
        <p className="font-medium">Nessuna giornata registrata</p>
        <p className="text-muted-foreground text-sm mt-1">Aggiungi la prima giornata di scavo</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {giornate.map((g: any) => {
        const operatoriString = parseOperatori(g.operatori);
        const active = gid && String(g.id) === gid;
        const logs: any[] = qcLogsMap[g.id] || [];
        const activeIssues = logs.filter((l) => !l.dismissed);
        const isExpanded = expandedQc.has(g.id);
        const isFotoExpanded = expandedFoto.has(g.id);

        return (
          <Card
            key={g.id}
            data-testid={`card-giornata-${g.id}`}
            className={cn(
              "hover:border-primary/40 transition-colors cursor-pointer group",
              active && "border-primary/40 bg-primary/5",
            )}
            onClick={() => onOpenDetail(g.id)}
          >
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{g.data}</span>
                    <QcBadge status={g.qcStatus} />
                  </div>
                  <div className="text-sm text-muted-foreground flex gap-4">
                    {g.settore && <span>Settore: {g.settore}</span>}
                    {operatoriString && <span>{operatoriString}</span>}
                    {g.usCount != null && g.usCount > 0 && (
                      <span className="text-primary font-medium">{g.usCount} US</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-qc-${g.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunQc(g.id);
                      setExpandedQc((prev) => { const next = new Set(prev); next.add(g.id); return next; });
                    }}
                    disabled={runQcPending}
                  >
                    <ShieldCheck size={14} className="mr-1" />
                    QC
                  </Button>
                  <Button
                    variant={isFotoExpanded ? "secondary" : "outline"}
                    size="sm"
                    title="Foto giornata"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFoto((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                        return next;
                      });
                    }}
                  >
                    <Camera size={14} className="mr-1" />
                    Foto
                  </Button>
                  {activeIssues.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={isExpanded ? "Nascondi avvisi" : `Mostra ${activeIssues.length} avvisi`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedQc((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                          return next;
                        });
                      }}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Button>
                  )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  data-testid={`button-modifica-giornata-${g.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(g);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  data-testid={`button-elimina-giornata-${g.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(g);
                  }}
                  disabled={deletePending}
                >
                  <Trash2 size={14} className="text-red-600" />
                </Button>
              </div>
              </div>
              {isExpanded && activeIssues.length > 0 && <QcIssuePanel logs={logs} />}
              {isFotoExpanded && (
                <GiornataFotoPanel
                  cantiereId={cantiereIdFromCid(cid)}
                  giornataId={g.id}
                  giornataData={g.data}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
