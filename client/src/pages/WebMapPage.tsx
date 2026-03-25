import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { Eraser, Map as MapIcon, PencilRuler, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";
import { AttributeTable } from "@/components/webmap/modules/AttributeTable";
import { LayerPanel } from "@/components/webmap/LayerPanel";
import { TerrainPanel } from "@/components/webmap/modules/TerrainModule";
import { StyleRendererPanel } from "@/components/webmap/modules/StyleRenderer";
import { DEFAULT_STYLE, pickColor, useWebMap, useWebMapStore, WebMapContext } from "@/components/webmap/store";
import { ToolbarStrip } from "@/components/webmap/ToolbarStrip";
import {
  BASEMAP_STYLES,
  addLayerToMap,
  disableTerrain,
  enableTerrain,
  fitToLayer,
  fillLayerId,
  interactiveLayerIds,
  lineLayerId,
  pointLayerId,
  removeLayerFromMap,
  sourceId,
  syncLayerOrder,
  syncLayerStyle,
  syncLayerVisibility,
} from "@/components/webmap/mapUtils";
import type { FeatureCollection, GeometryKind, MapLayer, WebMapPreviewPayload } from "@/components/webmap/types";

let drawClassPatched = false;

function patchMapboxDrawForMapLibre() {
  if (drawClassPatched) return;
  drawClassPatched = true;

  const classes = (MapboxDraw as any)?.constants?.classes;
  if (!classes) return;
  classes.CANVAS = "maplibregl-canvas";
  classes.CONTROL_BASE = "maplibregl-ctrl";
  classes.CONTROL_PREFIX = "maplibregl-ctrl-";
  classes.CONTROL_GROUP = "maplibregl-ctrl-group";
  classes.ATTRIBUTION = "maplibregl-ctrl-attrib";
}

function guessGeometryKind(collection: FeatureCollection): GeometryKind {
  const kinds = new Set(
    collection.features
      .map((feature) => String(feature.geometry?.type || ""))
      .filter(Boolean)
      .map((type) => (type.includes("Polygon") ? "Polygon" : type.includes("Line") ? "LineString" : type.includes("Point") ? "Point" : "Unknown")),
  );

  if (kinds.size === 0) return "Unknown";
  if (kinds.size > 1) return "Mixed";
  return Array.from(kinds)[0] as GeometryKind;
}

function withFeatureIds(collection: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature, index) => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        _fid: index,
      },
    })),
  };
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function popupHtml(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties).filter(([key]) => !key.startsWith("_"));
  if (entries.length === 0) return "<div style='font-size:12px'>Nessun attributo</div>";

  return `<div style="max-width:320px;">${entries
    .slice(0, 24)
    .map(
      ([key, value]) =>
        `<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:start;border-bottom:1px solid #2f2f2f;padding:4px 0;">
          <strong style="font-size:12px;opacity:.85;">${escapeHtml(key)}</strong>
          <span style="font-size:12px;word-break:break-word;">${escapeHtml(value ?? "-")}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function buildInterpolateExpression(field: string, breaks: number[], colors: string[]) {
  if (breaks.length === 0 || colors.length === 0) return null;
  const expr: unknown[] = ["interpolate", ["linear"], ["to-number", ["get", field], 0]];
  for (let i = 0; i < breaks.length; i++) {
    expr.push(breaks[i], colors[Math.min(i, colors.length - 1)]);
  }
  return expr;
}

function applyGraduatedRenderer(map: maplibregl.Map, layer: MapLayer, field: string, breaks: number[], colors: string[]) {
  const expr = buildInterpolateExpression(field, breaks, colors);
  if (!expr) return;
  const fillId = fillLayerId(layer.id);
  const lineId = lineLayerId(layer.id);
  const pointId = pointLayerId(layer.id);

  if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-color", expr as any);
  if (map.getLayer(lineId)) map.setPaintProperty(lineId, "line-color", expr as any);
  if (map.getLayer(pointId)) map.setPaintProperty(pointId, "circle-color", expr as any);
}

function WebMapContent() {
  const { cid } = useParams<{ cid: string }>();
  const { toast } = useToast();
  const { state, dispatch, mapRef } = useWebMap();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const prevLayerIdsRef = useRef<string[]>([]);
  const basemapAppliedRef = useRef(state.basemap);
  const stateRef = useRef(state);

  const [selectedGeoPackage, setSelectedGeoPackage] = useState<File | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [limit, setLimit] = useState("1200");
  const [availableTables, setAvailableTables] = useState<WebMapPreviewPayload["tables"]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drawFeatureCount, setDrawFeatureCount] = useState(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGeoPackage) throw new Error("Seleziona un file GeoPackage");

      const formData = new FormData();
      formData.append("file", selectedGeoPackage);
      if (selectedTable.trim()) formData.append("tableName", selectedTable.trim());
      if (limit.trim()) formData.append("limit", limit.trim());

      const response = await fetch(`/api/cantieri/${cid}/geopackage/webmap-preview`, {
        method: "POST",
        body: formData,
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || "Anteprima webmap fallita");
      }

      return response.json() as Promise<WebMapPreviewPayload>;
    },
    onSuccess: (result) => {
      setAvailableTables(result.tables || []);
      setWarnings(result.warnings || []);
      setSelectedTable(result.tableName);

      const normalizedCollection = withFeatureIds(result.featureCollection);
      const nextColor = pickColor(state.layers.length);
      const layer: MapLayer = {
        id: crypto.randomUUID(),
        sourceFileName: result.sourceFileName,
        tableName: result.tableName,
        rowCount: normalizedCollection.features.length,
        geometryKind: guessGeometryKind(normalizedCollection),
        visible: true,
        opacity: 1,
        style: {
          ...DEFAULT_STYLE,
          fillColor: result.styleHint.fillColor || nextColor,
          strokeColor: result.styleHint.strokeColor || nextColor,
          fillOpacity: Number.isFinite(result.styleHint.fillOpacity) ? result.styleHint.fillOpacity : DEFAULT_STYLE.fillOpacity,
          strokeWidth: Number.isFinite(result.styleHint.weight) ? Math.max(1, result.styleHint.weight) : DEFAULT_STYLE.strokeWidth,
        },
        featureCollection: normalizedCollection,
      };

      dispatch({ type: "ADD_LAYER", layer });
      const map = mapRef.current;
      if (map && map.isStyleLoaded()) {
        fitToLayer(map, layer.featureCollection);
      }

      toast({
        title: "Layer aggiunto",
        description: `${layer.rowCount} feature su ${layer.tableName}`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore caricamento layer",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    patchMapboxDrawForMapLibre();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLES[state.basemap] as any,
      center: [12.5, 41.9],
      zoom: 6,
      maxPitch: 60,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        line_string: true,
        point: true,
        trash: true,
      },
      defaultMode: "simple_select",
    });
    drawRef.current = draw;
    map.addControl(draw as any, "top-left");

    const refreshDrawStats = () => {
      setDrawFeatureCount(drawRef.current?.getAll().features.length || 0);
    };
    map.on("draw.create", refreshDrawStats);
    map.on("draw.update", refreshDrawStats);
    map.on("draw.delete", refreshDrawStats);

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const snapshot = stateRef.current;
      const visibleLayers = snapshot.layers.filter((layer) => layer.visible);
      if (visibleLayers.length === 0) return;

      const sorted = [...visibleLayers].sort((a, b) => {
        if (a.id === snapshot.activeLayerId) return -1;
        if (b.id === snapshot.activeLayerId) return 1;
        return 0;
      });

      const interactiveIds = sorted
        .flatMap((layer) => interactiveLayerIds(layer))
        .filter((layerId) => !!map.getLayer(layerId));

      if (interactiveIds.length === 0) return;

      const found = map.queryRenderedFeatures(event.point, { layers: interactiveIds });
      if (found.length === 0) return;

      const feature = found[0];
      const source = String(feature.source || "");
      const layer = snapshot.layers.find((item) => sourceId(item.id) === source);
      if (layer && layer.id !== snapshot.activeLayerId) {
        dispatch({ type: "SET_ACTIVE", id: layer.id });
      }

      const properties = (feature.properties || {}) as Record<string, unknown>;
      const fid = Number(properties._fid);
      dispatch({ type: "SET_SELECTED_FEATURE", id: Number.isFinite(fid) ? fid : null });

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setHTML(popupHtml(properties))
        .addTo(map);
    };

    map.on("click", handleClick);

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      drawRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [dispatch, mapRef, state.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapAppliedRef.current === state.basemap) return;

    basemapAppliedRef.current = state.basemap;
    map.setStyle(BASEMAP_STYLES[state.basemap] as any);
  }, [state.basemap, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = () => {
      const currentIds = state.layers.map((layer) => layer.id);
      const previousIds = prevLayerIdsRef.current;

      for (const removedId of previousIds.filter((id) => !currentIds.includes(id))) {
        removeLayerFromMap(map, removedId);
      }

      for (const layer of state.layers) {
        addLayerToMap(map, layer);
        syncLayerVisibility(map, layer);
        syncLayerStyle(map, layer);
      }

      syncLayerOrder(map, state.layers);
      prevLayerIdsRef.current = currentIds;

      if (state.modules.terrain) {
        enableTerrain(map, state.modules.demSource, state.modules.terrainExaggeration);
      } else {
        disableTerrain(map);
      }

      if (
        state.modules.styleRenderer &&
        state.styleRenderer &&
        state.styleRenderer.mode === "graduated"
      ) {
        const layer = state.layers.find((item) => item.id === state.styleRenderer?.layerId);
        if (layer) {
          applyGraduatedRenderer(
            map,
            layer,
            state.styleRenderer.field,
            state.styleRenderer.breaks,
            state.styleRenderer.colorRamp,
          );
        }
      }
    };

    if (map.isStyleLoaded()) {
      sync();
      return;
    }

    map.once("styledata", sync);
    return () => {
      map.off("styledata", sync);
    };
  }, [
    state.layers,
    state.modules.terrain,
    state.modules.demSource,
    state.modules.terrainExaggeration,
    state.modules.styleRenderer,
    state.styleRenderer,
    mapRef,
  ]);

  const activeLayer = useMemo(
    () => state.layers.find((layer) => layer.id === state.activeLayerId) || null,
    [state.layers, state.activeLayerId],
  );

  const clearDrawings = () => {
    drawRef.current?.deleteAll();
    setDrawFeatureCount(0);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <MapIcon size={18} className="text-primary" />
        <h1 className="text-lg font-bold">WebMap GIS</h1>
        <span className="text-xs text-muted-foreground">MapLibre · Multi-layer · QGIS-like panel</span>
      </div>

      <ToolbarStrip />
      <TerrainPanel />
      <StyleRendererPanel />

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-72 border-r border-border bg-card/70">
          <LayerPanel />
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="grid md:grid-cols-[1fr_1fr_160px_auto] gap-2 items-end">
              <div>
                <Label>GeoPackage</Label>
                <Input
                  type="file"
                  accept=".gpkg,.sqlite"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setSelectedGeoPackage(file);
                    setAvailableTables([]);
                    setSelectedTable("");
                    setWarnings([]);
                  }}
                />
              </div>

              <div>
                <Label>Layer</Label>
                <Select
                  value={selectedTable}
                  onValueChange={setSelectedTable}
                  disabled={availableTables.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona layer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTables.map((table) => (
                      <SelectItem key={table.tableName} value={table.tableName}>
                        {table.tableName} ({table.rowCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Limite feature</Label>
                <Input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="1200" />
              </div>

              <Button
                className="gap-2"
                onClick={() => previewMutation.mutate()}
                disabled={!selectedGeoPackage || previewMutation.isPending}
              >
                <RefreshCcw size={15} className={previewMutation.isPending ? "animate-spin" : ""} />
                {previewMutation.isPending ? "Carico..." : "Aggiungi layer"}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                <PencilRuler size={12} />
                Geometrie disegnate: <span className="font-medium text-foreground">{drawFeatureCount}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={clearDrawings}
                disabled={drawFeatureCount === 0}
              >
                <Eraser size={12} />
                Cancella schizzi
              </Button>
              {activeLayer && (
                <span>
                  Layer attivo: <span className="font-medium text-foreground">{activeLayer.tableName}</span>
                </span>
              )}
            </div>

            {warnings.length > 0 && (
              <div className="text-xs text-amber-700 space-y-1">
                {warnings.map((warning) => (
                  <p key={warning}>- {warning}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 relative">
            <div ref={mapContainerRef} className="absolute inset-0" />
          </div>
          <AttributeTable />
        </section>
      </div>
    </div>
  );
}

export function WebMapPage() {
  const store = useWebMapStore();

  return (
    <TooltipProvider>
      <WebMapContext.Provider value={store}>
        <WebMapContent />
      </WebMapContext.Provider>
    </TooltipProvider>
  );
}
