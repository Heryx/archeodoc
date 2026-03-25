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
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";

type WebMapTable = {
  tableName: string;
  dataType: string;
  rowCount: number;
  geometryColumn: string | null;
  srid: number | null;
};

type WebMapFeature = {
  type: "Feature";
  geometry: any;
  properties: Record<string, unknown>;
};

type WebMapPreviewPayload = {
  sourceFileName: string;
  tableName: string;
  tables: WebMapTable[];
  featureCollection: {
    type: "FeatureCollection";
    features: WebMapFeature[];
  };
  styleHint: {
    strokeColor: string;
    fillColor: string;
    fillOpacity: number;
    weight: number;
  };
  warnings: string[];
};

const PREVIEW_SOURCE_ID = "webmap-preview-source";
const PREVIEW_FILL_LAYER_ID = "webmap-preview-fill";
const PREVIEW_LINE_LAYER_ID = "webmap-preview-line";
const PREVIEW_POINT_LAYER_ID = "webmap-preview-point";
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] } as const;

const BASE_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
} as const;

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

function ensurePreviewLayers(
  map: maplibregl.Map,
  styleHint: WebMapPreviewPayload["styleHint"],
) {
  if (!map.getSource(PREVIEW_SOURCE_ID)) {
    map.addSource(PREVIEW_SOURCE_ID, {
      type: "geojson",
      data: EMPTY_FEATURE_COLLECTION as any,
    });
  }

  if (!map.getLayer(PREVIEW_FILL_LAYER_ID)) {
    map.addLayer({
      id: PREVIEW_FILL_LAYER_ID,
      type: "fill",
      source: PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": styleHint.fillColor,
        "fill-opacity": styleHint.fillOpacity,
        "fill-outline-color": styleHint.strokeColor,
      },
    });
  }

  if (!map.getLayer(PREVIEW_LINE_LAYER_ID)) {
    map.addLayer({
      id: PREVIEW_LINE_LAYER_ID,
      type: "line",
      source: PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": styleHint.strokeColor,
        "line-width": Math.max(1, styleHint.weight),
      },
    });
  }

  if (!map.getLayer(PREVIEW_POINT_LAYER_ID)) {
    map.addLayer({
      id: PREVIEW_POINT_LAYER_ID,
      type: "circle",
      source: PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": styleHint.fillColor,
        "circle-stroke-color": styleHint.strokeColor,
        "circle-stroke-width": 1.5,
        "circle-radius": 6,
      },
    });
  }

  map.setPaintProperty(PREVIEW_FILL_LAYER_ID, "fill-color", styleHint.fillColor);
  map.setPaintProperty(PREVIEW_FILL_LAYER_ID, "fill-opacity", styleHint.fillOpacity);
  map.setPaintProperty(PREVIEW_FILL_LAYER_ID, "fill-outline-color", styleHint.strokeColor);
  map.setPaintProperty(PREVIEW_LINE_LAYER_ID, "line-color", styleHint.strokeColor);
  map.setPaintProperty(PREVIEW_LINE_LAYER_ID, "line-width", Math.max(1, styleHint.weight));
  map.setPaintProperty(PREVIEW_POINT_LAYER_ID, "circle-color", styleHint.fillColor);
  map.setPaintProperty(PREVIEW_POINT_LAYER_ID, "circle-stroke-color", styleHint.strokeColor);
}

function parseFeatureProperties(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPopupHtml(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return '<div style="font-size:12px;">Nessun attributo</div>';
  }

  const rows = entries
    .slice(0, 20)
    .map(
      ([key, value]) =>
        `<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:start;border-bottom:1px solid #2f2f2f;padding:4px 0;">
          <strong style="font-size:12px;opacity:.85;">${escapeHtml(key)}</strong>
          <span style="font-size:12px;word-break:break-word;">${escapeHtml(value ?? "-")}</span>
        </div>`,
    )
    .join("");

  return `<div style="max-width:320px;">${rows}</div>`;
}

function extendBounds(value: unknown, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  if (!Array.isArray(value) || value.length === 0) return;

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    return;
  }

  for (const nested of value) {
    extendBounds(nested, bounds);
  }
}

function getFeatureCollectionBounds(featureCollection: WebMapPreviewPayload["featureCollection"] | null) {
  if (!featureCollection || !featureCollection.features.length) return null;

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const feature of featureCollection.features) {
    extendBounds(feature?.geometry?.coordinates, bounds);
  }

  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }

  return bounds;
}

export function WebMapPage() {
  const { cid } = useParams<{ cid: string }>();
  const { toast } = useToast();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const drawStatsBoundRef = useRef(false);

  const [selectedGeoPackage, setSelectedGeoPackage] = useState<File | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [limit, setLimit] = useState("1200");
  const [payload, setPayload] = useState<WebMapPreviewPayload | null>(null);
  const [drawFeatureCount, setDrawFeatureCount] = useState(0);

  const mapStyle = useMemo(() => {
    if (!payload) {
      return {
        strokeColor: "#2563eb",
        fillColor: "#2563eb",
        fillOpacity: 0.24,
        weight: 2,
      };
    }
    return payload.styleHint;
  }, [payload]);

  const previewMutation = useMutation({
    mutationFn: async ({ keepTable }: { keepTable: boolean }) => {
      if (!selectedGeoPackage) {
        throw new Error("Seleziona un file GeoPackage");
      }

      const formData = new FormData();
      formData.append("file", selectedGeoPackage);
      if (keepTable && selectedTable) {
        formData.append("tableName", selectedTable);
      }
      if (limit.trim()) {
        formData.append("limit", limit.trim());
      }

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
    onSuccess: (result, variables) => {
      setPayload(result);
      if (!variables.keepTable || !selectedTable) {
        setSelectedTable(result.tableName);
      }
      toast({
        title: "WebMap aggiornata",
        description: `${result.featureCollection.features.length} geometrie caricate.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore caricamento webmap",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    patchMapboxDrawForMapLibre();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASE_MAP_STYLE as any,
      center: [12.5, 41.9],
      zoom: 6,
      maxPitch: 60,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

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
      const count = drawRef.current?.getAll()?.features?.length || 0;
      setDrawFeatureCount(count);
    };

    const handleFeatureClick = (event: any) => {
      const clicked = event.features?.[0];
      if (!clicked) return;

      const properties = parseFeatureProperties(clicked.properties);
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setHTML(buildPopupHtml(properties))
        .addTo(map);
    };

    const bindFeatureInteractions = () => {
      for (const layerId of [PREVIEW_FILL_LAYER_ID, PREVIEW_LINE_LAYER_ID, PREVIEW_POINT_LAYER_ID]) {
        map.on("click", layerId, handleFeatureClick);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    };

    map.on("load", () => {
      ensurePreviewLayers(map, mapStyle);
      if (!drawStatsBoundRef.current) {
        drawStatsBoundRef.current = true;
        map.on("draw.create", refreshDrawStats);
        map.on("draw.update", refreshDrawStats);
        map.on("draw.delete", refreshDrawStats);
      }
      bindFeatureInteractions();
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      drawRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateData = () => {
      ensurePreviewLayers(map, mapStyle);
      const source = map.getSource(PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const featureCollection = payload?.featureCollection || EMPTY_FEATURE_COLLECTION;
      source.setData(featureCollection as any);

      const bounds = getFeatureCollectionBounds(payload?.featureCollection || null);
      if (!bounds) return;

      map.fitBounds(
        [
          [bounds.minX, bounds.minY],
          [bounds.maxX, bounds.maxY],
        ],
        {
          padding: 36,
          maxZoom: 18,
          duration: 500,
        },
      );
    };

    if (map.isStyleLoaded()) {
      updateData();
      return;
    }

    map.once("load", updateData);
    return () => {
      map.off("load", updateData);
    };
  }, [payload, mapStyle]);

  const clearDrawings = () => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    setDrawFeatureCount(0);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapIcon size={22} className="text-primary" />
          WebMap GeoPackage (MapLibre)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visualizzazione WebGL ad alte prestazioni con editing geometrie locale (MapLibre GL JS + Draw).
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end">
          <div>
            <Label>File GeoPackage</Label>
            <Input
              type="file"
              accept=".gpkg,.sqlite"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setSelectedGeoPackage(file);
                setPayload(null);
                setSelectedTable("");
              }}
            />
          </div>

          <div>
            <Label>Layer</Label>
            <Select value={selectedTable} onValueChange={setSelectedTable} disabled={!payload || payload.tables.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona layer..." />
              </SelectTrigger>
              <SelectContent>
                {(payload?.tables || []).map((table) => (
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
            onClick={() => previewMutation.mutate({ keepTable: true })}
            disabled={!selectedGeoPackage || previewMutation.isPending}
          >
            <RefreshCcw size={15} className={previewMutation.isPending ? "animate-spin" : ""} />
            {previewMutation.isPending ? "Carico..." : "Carica mappa"}
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
        </div>

        {payload && (
          <div className="text-xs text-muted-foreground">
            File: <span className="font-medium text-foreground">{payload.sourceFileName}</span> | Layer attivo:{" "}
            <span className="font-medium text-foreground">{payload.tableName}</span> | Feature:{" "}
            <span className="font-medium text-foreground">{payload.featureCollection.features.length}</span>
          </div>
        )}
        {payload?.warnings?.length ? (
          <div className="text-xs text-amber-700 space-y-1">
            {payload.warnings.map((warning) => (
              <p key={warning}>- {warning}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-muted/10">
        <div ref={mapContainerRef} style={{ height: "62vh", width: "100%" }} />
      </div>

      {payload && payload.featureCollection.features.length === 0 && (
        <div className="text-sm text-muted-foreground">
          Nessuna geometria visualizzabile nel layer selezionato.
        </div>
      )}
    </div>
  );
}
