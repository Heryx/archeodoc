import {
  Download,
  Map as MapIcon,
  Mountain,
  Palette,
  Ruler,
  SearchCode,
  TableProperties,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWebMap } from "./store";
import type { BasemapId } from "./types";

const BASEMAPS: Array<{ id: BasemapId; label: string }> = [
  { id: "none", label: "Nessuna" },
  { id: "osm", label: "OSM" },
  { id: "satellite_esri", label: "Satellite" },
  { id: "topo", label: "Topo" },
];

const TOOLS: Array<{
  key: "terrain" | "styleRenderer" | "measure" | "export" | "inspect" | "attributeTable";
  label: string;
  icon: React.ReactNode;
}> = [
  { key: "terrain", label: "Terrain 3D", icon: <Mountain size={15} /> },
  { key: "styleRenderer", label: "Renderer", icon: <Palette size={15} /> },
  { key: "measure", label: "Misura", icon: <Ruler size={15} /> },
  { key: "export", label: "Export", icon: <Download size={15} /> },
  { key: "inspect", label: "Inspect", icon: <SearchCode size={15} /> },
  { key: "attributeTable", label: "Tabella attributi", icon: <TableProperties size={15} /> },
];

export function ToolbarStrip({ children }: { children?: React.ReactNode }) {
  const { state, dispatch } = useWebMap();
  const { toast } = useToast();

  const toggleModule = (moduleKey: (typeof TOOLS)[number]["key"]) => {
    dispatch({ type: "TOGGLE_MODULE", module: moduleKey });
    if (moduleKey === "measure" || moduleKey === "export" || moduleKey === "inspect") {
      toast({
        title: "Modulo pronto",
        description: "Colleghiamo il plugin dedicato nel prossimo step.",
      });
    }
  };

  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center gap-1 px-3 py-1.5 flex-wrap">
        <div className="flex items-center gap-1 border-r border-border pr-3 mr-2">
          <MapIcon size={13} className="text-muted-foreground" />
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
          <Tooltip key={tool.key}>
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
                title={tool.label}
              >
                {tool.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {tool.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {children}
    </div>
  );
}
