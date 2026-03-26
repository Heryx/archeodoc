import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, LocateFixed, Trash2 } from "lucide-react";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { fitToLayer } from "./mapUtils";
import { useWebMap } from "./store";
import type { GeometryKind } from "./types";

function GeomBadge({ kind }: { kind: GeometryKind }) {
  const classes: Record<GeometryKind, string> = {
    Point: "bg-orange-500/20 text-orange-300",
    LineString: "bg-green-500/20 text-green-300",
    Polygon: "bg-blue-500/20 text-blue-300",
    Mixed: "bg-purple-500/20 text-purple-300",
    Unknown: "bg-muted text-muted-foreground",
  };

  const labels: Record<GeometryKind, string> = {
    Point: "PT",
    LineString: "LN",
    Polygon: "PG",
    Mixed: "MX",
    Unknown: "?",
  };

  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", classes[kind])}>
      {labels[kind]}
    </span>
  );
}

type LayerItemProps = {
  layerId: string;
  index: number;
};

function LayerItem({ layerId, index }: LayerItemProps) {
  const { state, dispatch, mapRef } = useWebMap();
  const layer = state.layers[index];
  const [expanded, setExpanded] = useState(false);
  const isActive = state.activeLayerId === layerId;

  const onDropLayer = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const fromId = event.dataTransfer.getData("text/plain");
    if (!fromId || fromId === layerId) return;
    const fromIndex = state.layers.findIndex((item) => item.id === fromId);
    const toIndex = state.layers.findIndex((item) => item.id === layerId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    dispatch({ type: "MOVE_LAYER", fromIndex, toIndex });
  };

  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", layerId)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropLayer}
      className={cn(
        "rounded-md border transition-colors",
        isActive ? "border-primary/60 bg-primary/5" : "border-border bg-card",
      )}
      onClick={() => dispatch({ type: "SET_ACTIVE", id: layerId })}
    >
      <div className="px-2 py-1.5 flex items-center gap-1.5">
        <GripVertical size={13} className="text-muted-foreground shrink-0" />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "TOGGLE_VISIBLE", id: layerId });
          }}
          title={layer.visible ? "Nascondi layer" : "Mostra layer"}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <span
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: layer.sourceKind === "raster" ? "#64748b" : layer.style.fillColor }}
        />
        <GeomBadge kind={layer.geometryKind} />
        <span className="text-xs truncate flex-1 font-medium">{layer.tableName}</span>
        <span className="text-[10px] text-muted-foreground">{layer.rowCount}</span>
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground",
            layer.sourceKind === "raster" && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (layer.sourceKind === "raster") return;
            const map = mapRef.current;
            if (!map) return;
            fitToLayer(map, layer.featureCollection);
            dispatch({ type: "SET_ACTIVE", id: layerId });
          }}
          title={layer.sourceKind === "raster" ? "Zoom layer disponibile per layer vettoriali" : "Zoom sul layer"}
          disabled={layer.sourceKind === "raster"}
        >
          <LocateFixed size={13} />
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "REMOVE_LAYER", id: layerId });
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border/60 space-y-2" onClick={(event) => event.stopPropagation()}>
          {layer.sourceKind !== "raster" && (
            <div className="flex gap-3 mt-2">
              <label className="text-[10px] text-muted-foreground flex flex-col gap-1">
                Fill
                <input
                  type="color"
                  className="w-8 h-6 bg-transparent border-none p-0"
                  value={layer.style.fillColor}
                  onChange={(event) => {
                    dispatch({
                      type: "SET_STYLE",
                      id: layerId,
                      style: { fillColor: event.target.value },
                    });
                  }}
                />
              </label>
              <label className="text-[10px] text-muted-foreground flex flex-col gap-1">
                Stroke
                <input
                  type="color"
                  className="w-8 h-6 bg-transparent border-none p-0"
                  value={layer.style.strokeColor}
                  onChange={(event) => {
                    dispatch({
                      type: "SET_STYLE",
                      id: layerId,
                      style: { strokeColor: event.target.value },
                    });
                  }}
                />
              </label>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Opacita ({Math.round(layer.opacity * 100)}%)
          </div>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[layer.opacity]}
            onValueChange={([value]) => dispatch({ type: "SET_OPACITY", id: layerId, opacity: value })}
          />
        </div>
      )}
    </div>
  );
}

export function LayerPanel() {
  const { state } = useWebMap();
  const ordered = state.layers.map((layer, index) => ({ layer, index })).reverse();

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide">
        Layers ({state.layers.length})
      </div>
      <div className="p-2 space-y-1 overflow-y-auto flex-1">
        {ordered.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center pt-6">
            Nessun layer caricato
          </div>
        ) : (
          ordered.map(({ layer, index }) => (
            <LayerItem key={layer.id} layerId={layer.id} index={index} />
          ))
        )}
      </div>
    </div>
  );
}
