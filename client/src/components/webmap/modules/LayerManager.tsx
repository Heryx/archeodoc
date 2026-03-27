import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  Loader2,
  Palette,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";
import type { WebMapLayer } from "@/components/webmap/types";

type StyleHint = {
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
};

const QUICK_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#374151",
];

function defaultStyle(): StyleHint {
  return { strokeColor: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.24, weight: 2 };
}

function parseStyle(styleJson: string | null): StyleHint {
  try {
    return styleJson ? JSON.parse(styleJson) : defaultStyle();
  } catch {
    return defaultStyle();
  }
}

function LayerItem({
  layer,
  cantiereId,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  layer: WebMapLayer;
  cantiereId: number;
  onDragStart: (id: number) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (targetId: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showStyle, setShowStyle] = useState(false);
  const style = parseStyle(layer.styleJson);

  const toggleMutation = useMutation({
    mutationFn: async (visible: boolean) => {
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers/${layer.id}/visibility`, {
        method: "PATCH",
        headers: { ...getProjectHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ visible }),
      });
      if (!response.ok) throw new Error("Toggle visibilità fallito");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webmap-layers", cantiereId] });
    },
  });

  const styleMutation = useMutation({
    mutationFn: async (patch: Partial<StyleHint>) => {
      const merged = { ...style, ...patch };
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers/${layer.id}/style`, {
        method: "PATCH",
        headers: { ...getProjectHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ styleJson: JSON.stringify(merged) }),
      });
      if (!response.ok) throw new Error("Salvataggio stile fallito");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webmap-layers", cantiereId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers/${layer.id}`, {
        method: "DELETE",
        headers: getProjectHeader(),
      });
      if (!response.ok) throw new Error("Cancellazione fallita");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webmap-layers", cantiereId] });
      toast({ title: "Layer eliminato", description: layer.displayName });
    },
    onError: (error: any) => {
      toast({
        title: "Errore eliminazione",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  return (
    <div
      draggable
      onDragStart={() => onDragStart(layer.id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(layer.id)}
      className="group rounded-lg border border-border bg-card/70 hover:bg-card transition-colors"
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <GripVertical
          size={14}
          className="text-muted-foreground cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        />
        <button
          type="button"
          className="w-3 h-3 rounded-full border border-white/20 shrink-0 shadow-sm"
          style={{ backgroundColor: style.fillColor }}
          onClick={() => setShowStyle((value) => !value)}
          title="Stile layer"
        />
        <span className={`flex-1 text-xs truncate ${!layer.visible ? "opacity-40 line-through" : ""}`}>
          {layer.displayName}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {layer.featureCount.toLocaleString()}
        </span>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
          onClick={() => toggleMutation.mutate(!layer.visible)}
          title={layer.visible ? "Nascondi" : "Mostra"}
        >
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="opacity-40" />}
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
          onClick={() => setShowStyle((value) => !value)}
          title="Modifica stile"
        >
          <Palette size={12} />
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-destructive/10 text-destructive transition-colors shrink-0"
          onClick={() => deleteMutation.mutate()}
          title="Elimina layer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {showStyle && (
        <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Colori rapidi
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: color, borderColor: style.fillColor === color ? "#ffffff" : "transparent" }}
                onClick={() => styleMutation.mutate({ fillColor: color, strokeColor: color })}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <Label className="text-[10px]">Opacità</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={style.fillOpacity}
                onChange={(event) => styleMutation.mutate({ fillOpacity: Number(event.target.value) })}
                className="w-full h-1.5 accent-primary"
              />
            </div>
            <div>
              <Label className="text-[10px]">Spessore</Label>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={style.weight}
                onChange={(event) => styleMutation.mutate({ weight: Number(event.target.value) })}
                className="w-full h-1.5 accent-primary"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={style.fillColor}
              onChange={(event) => styleMutation.mutate({ fillColor: event.target.value, strokeColor: event.target.value })}
              className="w-7 h-7 rounded cursor-pointer border border-border"
            />
            <span className="text-[10px] text-muted-foreground font-mono">{style.fillColor}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function LayerManager({
  cantiereId,
  onClose,
  onLayersChange,
}: {
  cantiereId: number;
  onClose: () => void;
  onLayersChange?: (layers: WebMapLayer[]) => void;
}) {
  const queryClient = useQueryClient();
  const [dragId, setDragId] = useState<number | null>(null);

  const { data: layers = [], isLoading } = useQuery<WebMapLayer[]>({
    queryKey: ["webmap-layers", cantiereId],
    queryFn: async () => {
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers`, {
        headers: getProjectHeader(),
      });
      if (!response.ok) throw new Error("Caricamento layer fallito");
      const data = (await response.json()) as WebMapLayer[];
      onLayersChange?.(data);
      return data;
    },
  });
  const reorderMutation = useMutation({
    mutationFn: async (payload: { id: number; zIndex: number }) => {
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers/${payload.id}/zindex`, {
        method: "PATCH",
        headers: { ...getProjectHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ zIndex: payload.zIndex }),
      });
      if (!response.ok) throw new Error("Riordino layer fallito");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webmap-layers", cantiereId] });
    },
  });

  function handleDrop(targetId: number) {
    if (dragId == null || dragId === targetId) return;
    const from = layers.find((layer) => layer.id === dragId);
    const to = layers.find((layer) => layer.id === targetId);
    if (!from || !to) return;
    reorderMutation.mutate({ id: dragId, zIndex: to.zIndex });
    reorderMutation.mutate({ id: targetId, zIndex: from.zIndex });
    setDragId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-primary" />
          <span className="font-semibold text-sm">Layer Persistenti</span>
          {layers.length > 0 && <span className="text-xs text-muted-foreground">({layers.length})</span>}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={13} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-3 py-2 space-y-1.5">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : layers.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <Layers size={24} className="mx-auto mb-2 opacity-30" />
            Nessun layer persistente.
          </div>
        ) : (
          layers.map((layer) => (
            <LayerItem
              key={layer.id}
              layer={layer}
              cantiereId={cantiereId}
              onDragStart={setDragId}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            />
          ))
        )}
      </div>
    </div>
  );
}



