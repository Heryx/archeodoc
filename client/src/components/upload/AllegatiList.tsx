import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UploadFileIcon } from "@/components/upload/UploadFileIcon";
import type { AllegatoItem } from "@/components/upload/types";

type AllegatiListProps = {
  allegati: AllegatoItem[];
  showDescFor: number | null;
  onToggleDescription: (id: number) => void;
};

export function AllegatiList({ allegati, showDescFor, onToggleDescription }: AllegatiListProps) {
  return (
    <>
      <h2 className="text-lg font-semibold mb-3">Documenti caricati ({allegati.length})</h2>
      {allegati.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-border rounded-lg text-muted-foreground text-sm">
          Nessun documento ancora caricato
        </div>
      ) : (
        <div className="space-y-2">
          {allegati.map((allegato) => (
            <Card key={allegato.id} data-testid={`card-allegato-${allegato.id}`}>
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <UploadFileIcon tipo={allegato.tipo} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{allegato.nomeFile}</span>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {allegato.tipo}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                    {allegato.operatore && <span>{allegato.operatore}</span>}
                    {allegato.dimensione && <span>{(allegato.dimensione / 1024).toFixed(0)} KB</span>}
                    {allegato.descrizioneAi && <span className="text-green-600 dark:text-green-400">Analizzato AI</span>}
                  </div>
                  {showDescFor === allegato.id && allegato.descrizione && (
                    <div className="mt-2 text-xs bg-muted/50 rounded p-2">{allegato.descrizione}</div>
                  )}
                </div>
                {allegato.descrizione && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs"
                    onClick={() => onToggleDescription(allegato.id)}
                  >
                    <Eye size={12} />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
