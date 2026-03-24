import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type MaterialiListProps = {
  materiali: any[];
  usById: Map<number, any>;
  isLoading: boolean;
  onEdit: (materiale: any) => void;
  onDelete: (materiale: any) => void;
};

export function MaterialiList({ materiali, usById, isLoading, onEdit, onDelete }: MaterialiListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (materiali.length === 0) {
    return (
      <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
        <p className="font-medium">Nessuna scheda materiale</p>
        <p className="text-muted-foreground text-sm mt-1">Aggiungi la prima scheda RA</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {materiali.map((ra: any) => {
        const us = ra.usId ? usById.get(ra.usId) : null;

        return (
          <Card key={ra.id}>
            <CardContent className="py-4 px-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono font-semibold text-primary">{ra.codice}</span>
                    {ra.tipo && (
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                        {ra.tipo}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {us ? `US: ${us.codiceUS}` : "US: non associata"}
                    </span>
                  </div>

                  {ra.descrizione && <p className="text-sm text-muted-foreground line-clamp-2">{ra.descrizione}</p>}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onEdit(ra)}>
                    <Pencil size={12} /> Modifica
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs text-red-600 hover:text-red-700"
                    onClick={() => onDelete(ra)}
                  >
                    <Trash2 size={12} /> Elimina
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
