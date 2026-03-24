import { ArrowRight, ArrowRightLeft, CalendarDays, MapPin, Pencil, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CantiereGridProps = {
  cantieri: any[];
  isLoading: boolean;
  deletePending: boolean;
  transferPending: boolean;
  onNavigate: (path: string) => void;
  onEdit: (cantiere: any) => void;
  onDelete: (cantiere: any) => void;
  onTransfer: (cantiere: any) => void;
};

export function CantiereGrid({
  cantieri,
  isLoading,
  deletePending,
  transferPending,
  onNavigate,
  onEdit,
  onDelete,
  onTransfer,
}: CantiereGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (cantieri.length === 0) {
    return (
      <div className="text-center py-24 border-2 border-dashed border-border rounded-xl">
        <div className="text-4xl mb-3">🏺</div>
        <p className="font-medium text-foreground">Nessun cantiere</p>
        <p className="text-muted-foreground text-sm mt-1">Crea il primo cantiere per iniziare</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cantieri.map((c: any) => (
        <Card
          key={c.id}
          data-testid={`card-cantiere-${c.id}`}
          className="hover:border-primary/50 transition-colors cursor-pointer group"
          onClick={() => onNavigate(`/cantiere/${c.id}`)}
        >
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge variant="secondary" className="mb-2 font-mono text-xs">
                  {c.codice}
                </Badge>
                <CardTitle className="text-base">{c.nome}</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-600 hover:text-red-700"
                  data-testid={`button-elimina-cantiere-${c.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c);
                  }}
                  disabled={deletePending}
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  data-testid={`button-trasferisci-cantiere-${c.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransfer(c);
                  }}
                  disabled={transferPending}
                >
                  <ArrowRightLeft size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  data-testid={`button-modifica-cantiere-${c.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(c);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5">
              <MapPin size={13} />
              {c.localita}
            </div>
            {c.responsabile && (
              <div className="flex items-center gap-1.5">
                <User size={13} />
                {c.responsabile}
              </div>
            )}
            {c.dataInizio && (
              <div className="flex items-center gap-1.5">
                <CalendarDays size={13} />
                Dal {c.dataInizio}
                {c.dataFine ? ` al ${c.dataFine}` : ""}
              </div>
            )}
            <div className="text-xs mt-1 opacity-70">{c.committente}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
