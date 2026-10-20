import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWebMap } from "./store";

const PROJECT_CRS = "EPSG:3857";

export function CrsSelector({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state } = useWebMap();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sistema di riferimento (CRS)</DialogTitle>
          <DialogDescription>
            La mappa renderizza sempre in Web Mercator; il CRS sorgente serve per verificare l'import di
            shapefile/GeoPackage privi di proiezione dichiarata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border px-3 py-2 bg-muted/30">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">CRS mappa (rendering)</p>
            <p className="font-mono font-semibold">{PROJECT_CRS}</p>
          </div>

          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">
              CRS sorgente per layer ({state.layers.length})
            </p>
            {state.layers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nessun layer caricato in sessione.</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-auto">
                {state.layers.map((layer) => (
                  <div
                    key={layer.id}
                    className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1"
                  >
                    <span className="text-xs truncate">{layer.tableName}</span>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                      {layer.sourceSrid ? `EPSG:${layer.sourceSrid}` : layer.sourceKind === "raster" ? PROJECT_CRS : "EPSG:4326"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
