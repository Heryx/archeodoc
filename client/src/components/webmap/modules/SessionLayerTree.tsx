import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  Folder,
  FolderOpen,
  GripVertical,
  Layers,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebMap } from "../store";
import { fitToLayer } from "../mapUtils";
import type { MapLayer } from "../types";

function geometryIconLabel(layer: MapLayer): string {
  if (layer.sourceKind === "raster") return "R";
  switch (layer.geometryKind) {
    case "Point":
      return "•";
    case "LineString":
      return "—";
    case "Polygon":
      return "▢";
    default:
      return "◆";
  }
}

function LayerRow({
  layer,
  active,
  onDragStart,
}: {
  layer: MapLayer;
  active: boolean;
  onDragStart: (id: string) => void;
}) {
  const { dispatch, mapRef } = useWebMap();

  return (
    <div
      draggable
      onDragStart={() => onDragStart(layer.id)}
      onClick={() => dispatch({ type: "SET_ACTIVE", id: layer.id })}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        active ? "bg-primary/10 border border-primary/40" : "border border-transparent hover:bg-muted/60"
      }`}
    >
      <GripVertical size={12} className="text-muted-foreground/60 cursor-grab shrink-0" />
      <span
        className="w-4 text-center text-[11px] shrink-0 font-mono"
        style={{ color: layer.style.strokeColor }}
        title={layer.geometryKind}
      >
        {geometryIconLabel(layer)}
      </span>
      <span className={`flex-1 text-xs truncate ${!layer.visible ? "opacity-40 line-through" : ""}`}>
        {layer.tableName}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">{layer.rowCount}</span>
      <button
        type="button"
        className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
        title="Zoom to layer"
        onClick={(event) => {
          event.stopPropagation();
          const map = mapRef.current;
          if (map && layer.featureCollection.features.length > 0) {
            fitToLayer(map, layer.featureCollection);
          }
        }}
      >
        <ZoomIn size={12} />
      </button>
      <button
        type="button"
        className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
        title={layer.visible ? "Nascondi" : "Mostra"}
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: "TOGGLE_VISIBLE", id: layer.id });
        }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-40" />}
      </button>
      <button
        type="button"
        className="p-0.5 rounded hover:bg-destructive/10 text-destructive transition-colors shrink-0 opacity-0 group-hover:opacity-100"
        title="Rimuovi layer"
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: "REMOVE_LAYER", id: layer.id });
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export function SessionLayerTree({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useWebMap();
  const [dragId, setDragId] = useState<string | null>(null);

  const layersByGroup = (groupId: string | null) =>
    state.layers.filter((layer) => (layer.groupId ?? null) === groupId);

  const dropOnGroup = (groupId: string | null) => {
    if (dragId) dispatch({ type: "SET_LAYER_GROUP", layerId: dragId, groupId });
    setDragId(null);
  };

  const groupVisibility = (groupId: string): "all" | "none" | "mixed" => {
    const children = layersByGroup(groupId);
    if (children.length === 0) return "all";
    const visibleCount = children.filter((layer) => layer.visible).length;
    if (visibleCount === 0) return "none";
    if (visibleCount === children.length) return "all";
    return "mixed";
  };

  const toggleGroupVisibility = (groupId: string) => {
    const currentVisibility = groupVisibility(groupId);
    const nextVisible = currentVisibility !== "all";
    layersByGroup(groupId).forEach((layer) => {
      if (layer.visible !== nextVisible) dispatch({ type: "TOGGLE_VISIBLE", id: layer.id });
    });
  };

  const ungrouped = layersByGroup(null);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-primary" />
          <span className="font-semibold text-sm">Layer sessione</span>
          {state.layers.length > 0 && (
            <span className="text-xs text-muted-foreground">({state.layers.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Nuovo gruppo"
            onClick={() => {
              const name = window.prompt("Nome del nuovo gruppo", "Nuovo gruppo");
              if (!name?.trim()) return;
              dispatch({
                type: "ADD_GROUP",
                group: { id: crypto.randomUUID(), name: name.trim(), expanded: true },
              });
            }}
          >
            <FolderPlus size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X size={13} />
          </Button>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto px-3 py-2 space-y-1"
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => dropOnGroup(null)}
      >
        {state.layers.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <Layers size={24} className="mx-auto mb-2 opacity-30" />
            Nessun layer nella sessione. Usa "Import" per aggiungerne.
          </div>
        ) : (
          <>
            {state.groups.map((group) => {
              const children = layersByGroup(group.id);
              const visibility = groupVisibility(group.id);
              return (
                <div
                  key={group.id}
                  className="rounded-md border border-border/70"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDrop={(event) => {
                    event.stopPropagation();
                    dropOnGroup(group.id);
                  }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/40">
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
                      onClick={() => dispatch({ type: "TOGGLE_GROUP_EXPANDED", id: group.id })}
                    >
                      {group.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    {group.expanded ? (
                      <FolderOpen size={13} className="text-amber-500 shrink-0" />
                    ) : (
                      <Folder size={13} className="text-amber-500 shrink-0" />
                    )}
                    <span className="flex-1 text-xs font-medium truncate">{group.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{children.length}</span>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
                      title={visibility === "none" ? "Mostra tutti" : "Nascondi tutti"}
                      onClick={() => toggleGroupVisibility(group.id)}
                    >
                      {visibility === "none" ? (
                        <EyeOff size={12} className="opacity-40" />
                      ) : (
                        <Eye size={12} className={visibility === "mixed" ? "opacity-60" : ""} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-destructive/10 text-destructive transition-colors shrink-0"
                      title="Elimina gruppo (i layer restano)"
                      onClick={() => dispatch({ type: "REMOVE_GROUP", id: group.id })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {group.expanded && (
                    <div className="px-2 pb-2 pt-1 space-y-1">
                      {children.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground italic px-1">
                          Trascina qui un layer per raggrupparlo
                        </p>
                      ) : (
                        children.map((layer) => (
                          <LayerRow
                            key={layer.id}
                            layer={layer}
                            active={layer.id === state.activeLayerId}
                            onDragStart={setDragId}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {ungrouped.length > 0 && (
              <div className="space-y-1 pt-1">
                {state.groups.length > 0 && (
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-1">
                    Senza gruppo
                  </p>
                )}
                {ungrouped.map((layer) => (
                  <LayerRow
                    key={layer.id}
                    layer={layer}
                    active={layer.id === state.activeLayerId}
                    onDragStart={setDragId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
