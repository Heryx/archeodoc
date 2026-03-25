import { useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWebMap } from "../store";

const COLOR_RAMPS: Record<string, string[]> = {
  "Blu-Rosso": ["#2563eb", "#7c3aed", "#dc2626"],
  "Verde-Giallo": ["#166534", "#84cc16", "#fbbf24"],
  Viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
};

function quantileBreaks(values: number[], bins: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < bins; i++) {
    const idx = Math.min(sorted.length - 1, Math.round((i / (bins - 1)) * (sorted.length - 1)));
    out.push(sorted[idx]);
  }
  return out;
}

export function StyleRendererPanel() {
  const { state, dispatch } = useWebMap();
  const [rampKey, setRampKey] = useState<keyof typeof COLOR_RAMPS>("Blu-Rosso");
  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
  const activeRenderer = state.styleRenderer?.layerId === activeLayer?.id ? state.styleRenderer : null;

  const numericFields = useMemo(() => {
    if (!activeLayer || activeLayer.featureCollection.features.length === 0) return [] as string[];
    const properties = activeLayer.featureCollection.features[0].properties || {};
    return Object.entries(properties)
      .filter(([key, value]) => !key.startsWith("_") && typeof value === "number")
      .map(([key]) => key);
  }, [activeLayer]);

  useEffect(() => {
    if (!state.modules.styleRenderer) return;
    if (!activeLayer) {
      if (state.styleRenderer) dispatch({ type: "SET_STYLE_RENDERER", config: null });
      return;
    }
    if (!activeRenderer) return;
    if (!numericFields.includes(activeRenderer.field)) {
      dispatch({ type: "SET_STYLE_RENDERER", config: null });
    }
  }, [state.modules.styleRenderer, state.styleRenderer, activeLayer, activeRenderer, numericFields, dispatch]);

  if (!state.modules.styleRenderer || !activeLayer) return null;

  return (
    <div className="px-3 py-2 border-b border-border bg-card/70 flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Campo numerico</p>
        <Select
          value={activeRenderer && numericFields.includes(activeRenderer.field) ? activeRenderer.field : ""}
          onValueChange={(field) => {
            const values = activeLayer.featureCollection.features
              .map((feature) => feature.properties?.[field])
              .filter((value): value is number => typeof value === "number");
            const ramp = COLOR_RAMPS[rampKey];
            dispatch({
              type: "SET_STYLE_RENDERER",
              config: {
                layerId: activeLayer.id,
                mode: "graduated",
                field,
                colorRamp: ramp,
                breaks: quantileBreaks(values, ramp.length),
              },
            });
          }}
        >
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue placeholder="Seleziona campo..." />
          </SelectTrigger>
          <SelectContent>
            {numericFields.map((field) => (
              <SelectItem key={field} value={field} className="text-xs">
                {field}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Rampa colore</p>
        <Select
          value={rampKey}
          onValueChange={(value: keyof typeof COLOR_RAMPS) => {
            setRampKey(value);
            if (!activeRenderer) return;
            dispatch({
              type: "SET_STYLE_RENDERER",
              config: {
                ...activeRenderer,
                colorRamp: COLOR_RAMPS[value],
              },
            });
          }}
        >
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue placeholder="Scegli rampa..." />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(COLOR_RAMPS).map((label) => (
              <SelectItem key={label} value={label} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
