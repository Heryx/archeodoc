import { ChevronRight, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseOperatori } from "@/components/giornata/types";

function QcBadge({ status }: { status?: string | null }) {
  const s = status || "pending";
  const map: Record<string, { label: string; cls: string }> = {
    ok: { label: "OK", cls: "qc-ok" },
    warning: { label: "Avviso", cls: "qc-warning" },
    error: { label: "Errore", cls: "qc-error" },
    pending: { label: "Da verificare", cls: "qc-pending" },
  };
  const { label, cls } = map[s] || map.pending;
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium", cls)}>{label}</span>;
}

type GiornataListProps = {
  cid: string;
  gid?: string;
  giornate: any[];
  isLoading: boolean;
  runQcPending: boolean;
  deletePending: boolean;
  onNavigate: (path: string) => void;
  onRunQc: (id: number) => void;
  onEdit: (giornata: any) => void;
  onDelete: (giornata: any) => void;
};

export function GiornataList({
  cid,
  gid,
  giornate,
  isLoading,
  runQcPending,
  deletePending,
  onNavigate,
  onRunQc,
  onEdit,
  onDelete,
}: GiornataListProps) {
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

        return (
          <Card
            key={g.id}
            data-testid={`card-giornata-${g.id}`}
            className={cn(
              "hover:border-primary/40 transition-colors cursor-pointer group",
              active && "border-primary/40 bg-primary/5",
            )}
            onClick={() => onNavigate(`/cantiere/${cid}/giornata/${g.id}`)}
          >
            <CardContent className="py-4 px-5 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{g.data}</span>
                  <QcBadge status={g.qcStatus} />
                  {g.condMeteo && <span className="text-xs text-muted-foreground capitalize">{g.condMeteo}</span>}
                </div>
                <div className="text-sm text-muted-foreground flex gap-4">
                  {g.settore && <span>Settore: {g.settore}</span>}
                  {operatoriString && <span>{operatoriString}</span>}
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
                  }}
                  disabled={runQcPending}
                >
                  <ShieldCheck size={14} className="mr-1" />
                  QC
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
                <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
