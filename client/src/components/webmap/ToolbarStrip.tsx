import {
  Camera,
  Download,
  Layers,
  Map as MapIcon,
  Mountain,
  Palette,
  Printer,
  Ruler,
  Search,
  SearchCode,
  TableProperties,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWebMap } from "./store";
import type { ActiveModules, BasemapId } from "./types";

const BASEMAPS: Array<{ id: BasemapId; label: string }> = [
  { id: "none", label: "Nessuna" },
  { id: "osm", label: "OSM" },
  { id: "satellite_esri", label: "Satellite" },
  { id: "topo", label: "Topo" },
];

type ModuleKey = keyof Omit<ActiveModules, "demSource" | "terrainExaggeration">;

const TOOLS: Array<{
  key: ModuleKey;
  label: string;
  icon: React.ReactNode;
  dividerBefore?: boolean;
}> = [
  { key: "terrain", label: "Terrain 3D", icon: <Mountain size={14} /> },
  { key: "styleRenderer", label: "Renderer", icon: <Palette size={14} /> },
  { key: "measure", label: "Misura", icon: <Ruler size={14} /> },
  { key: "inspect", label: "Inspect feature", icon: <SearchCode size={14} /> },
  { key: "attributeTable", label: "Tabella attributi", icon: <TableProperties size={14} /> },
  { key: "layerManager", label: "Layer", icon: <Layers size={14} />, dividerBefore: true },
  { key: "geocoder", label: "Cerca luogo", icon: <Search size={14} /> },
  { key: "snapshot", label: "Snapshot", icon: <Camera size={14} /> },
  { key: "print", label: "Stampa", icon: <Printer size={14} />, dividerBefore: true },
  { key: "export", label: "Export GeoJSON", icon: <Download size={14} /> },
];

export function ToolbarStrip({ children }: { children?: React.ReactNode }) {
  const { state, dispatch } = useWebMap();
  const { toast } = useToast();

  const toggleModule = (module: ModuleKey) => {
    dispatch({ type: "TOGGLE_MODULE", module });
    if (module === "measure" || module === "export") {
      toast({
        title: "Modulo pronto",
        description: "Colleghiamo il plugin dedicato nel prossimo step.",
      });
    }
  };

  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card flex-wrap">
        <div className="flex items-center gap-1 border-r border-border pr-3 mr-1">
          <MapIcon size={12} className="text-muted-foreground" />
          {BASEMAPS.map((basemap) => (
            <button
              key={basemap.id}
              type="button"
              className={cn(
                "text-[11px] px-2 py-0.5 rounded transition-colors",
                state.basemap === basemap.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => dispatch({ type: "SET_BASEMAP", basemap: basemap.id })}
            >
              {basemap.label}
            </button>
          ))}
        </div>

        {TOOLS.map((tool) => (
          <div
            key={tool.key}
            className={cn("flex items-center", tool.dividerBefore && "ml-1 pl-1 border-l border-border")}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    state.modules[tool.key]
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => toggleModule(tool.key)}
                >
                  {tool.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {tool.label}
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
