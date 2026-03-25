import { Slider } from "@/components/ui/slider";
import { DEM_SOURCES } from "../mapUtils";
import { useWebMap } from "../store";
import type { DemSource } from "../types";

export function TerrainPanel() {
  const { state, dispatch } = useWebMap();
  if (!state.modules.terrain) return null;

  return (
    <div className="px-3 py-2 border-b border-border bg-card/70 flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">DEM source</p>
        <div className="flex items-center gap-1">
          {(Object.keys(DEM_SOURCES) as DemSource[]).map((source) => (
            <button
              key={source}
              type="button"
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                state.modules.demSource === source
                  ? "bg-amber-600 text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => dispatch({ type: "SET_DEM_SOURCE", source })}
            >
              {DEM_SOURCES[source].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 min-w-44">
        <p className="text-[11px] text-muted-foreground">
          Esagerazione: <span className="font-semibold text-foreground">{state.modules.terrainExaggeration.toFixed(1)}x</span>
        </p>
        <Slider
          min={0.5}
          max={5}
          step={0.1}
          value={[state.modules.terrainExaggeration]}
          onValueChange={([value]) => dispatch({ type: "SET_TERRAIN_EXAGGERATION", value })}
        />
      </div>
    </div>
  );
}
