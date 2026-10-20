import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWebMap } from "./store";
import type { BasemapId, WebMapPanelTab } from "./types";

const BASEMAPS: Array<{ id: BasemapId; label: string }> = [
  { id: "none", label: "Nessuna" },
  { id: "osm", label: "OSM" },
  { id: "satellite_esri", label: "Satellite" },
  { id: "topo", label: "Topo" },
];

function MenuButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="text-xs px-2.5 py-1 rounded hover:bg-muted transition-colors text-foreground/90"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MenuBar({
  openPanel,
  onOpenCrsDialog,
  onClearCustomLayers,
}: {
  openPanel: (tab: WebMapPanelTab) => void;
  onOpenCrsDialog: () => void;
  onClearCustomLayers: () => void;
}) {
  const { state, dispatch } = useWebMap();

  return (
    <div className={cn("flex items-center gap-0.5 px-2 py-1 border-b border-border bg-card/60")}>
      <MenuButton label="Progetto">
        <DropdownMenuItem onClick={() => openPanel("geopackage")}>Importa GeoPackage/SpatiaLite</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("qgis-project")}>Importa cartella progetto QGIS</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("shapefile")}>Importa Shapefile</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openPanel("snapshot")}>Snapshot ed export</DropdownMenuItem>
        <DropdownMenuItem onClick={onClearCustomLayers}>Reset layer custom</DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Layer">
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "layerManager" })}>
          {state.modules.layerManager ? "Nascondi pannello layer" : "Mostra pannello layer"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "styleRenderer" })}>
          Renderer / stile layer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "attributeTable" })}>
          Tabella attributi
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "inspect" })}>
          Informazioni elementi (Identify)
        </DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Raster">
        <DropdownMenuItem onClick={() => openPanel("sources")}>Aggiungi sorgente raster (XYZ/WMS/WMTS)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("geopackage")}>Importa GeoPackage raster</DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Vista">
        <DropdownMenuLabel className="text-[10px]">Basemap</DropdownMenuLabel>
        {BASEMAPS.map((basemap) => (
          <DropdownMenuItem
            key={basemap.id}
            onClick={() => dispatch({ type: "SET_BASEMAP", basemap: basemap.id })}
            className={state.basemap === basemap.id ? "font-semibold" : undefined}
          >
            {basemap.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "terrain" })}>
          Terrain 3D
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "buildings3d" })}>
          Edifici 3D
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "measure" })}>
          Strumento misura
        </DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Web">
        <DropdownMenuItem onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "geocoder" })}>
          Cerca luogo (geocoder)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("sources")}>Sorgenti remote WMS/WFS/ArcGIS</DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Database">
        <DropdownMenuItem onClick={() => openPanel("geopackage")}>Importa GeoPackage / SpatiaLite</DropdownMenuItem>
      </MenuButton>

      <MenuButton label="Impostazioni">
        <DropdownMenuItem onClick={onOpenCrsDialog}>Sistema di riferimento (CRS)</DropdownMenuItem>
      </MenuButton>
    </div>
  );
}
