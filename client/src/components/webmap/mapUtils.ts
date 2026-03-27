import maplibregl from "maplibre-gl";
import type { BasemapId, DemSource, FeatureCollection, MapLayer } from "./types";

export const BASEMAP_STYLES: Record<BasemapId, object> = {
  none: {
    version: 8,
    sources: {},
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1f2937" } },
    ],
  },
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["/api/map-tiles/osm/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "(c) OpenStreetMap contributors",
        maxzoom: 19,
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1f2937" } },
      { id: "osm", type: "raster", source: "osm" },
    ],
  },
  satellite_esri: {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: ["/api/map-tiles/esri/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "(c) Esri",
        maxzoom: 19,
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#111827" } },
      { id: "satellite", type: "raster", source: "satellite" },
    ],
  },
  topo: {
    version: 8,
    sources: {
      topo: {
        type: "raster",
        tiles: ["/api/map-tiles/opentopo/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "(c) OpenTopoMap contributors",
        maxzoom: 17,
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1f2937" } },
      { id: "topo", type: "raster", source: "topo" },
    ],
  },
};

const BASEMAP_META: Record<
  BasemapId,
  {
    backgroundLayerId: string;
    backgroundColor: string;
    sourceId?: string;
    rasterLayerId?: string;
    tiles?: string[];
    tileSize?: number;
    attribution?: string;
    maxzoom?: number;
  }
> = {
  none: {
    backgroundLayerId: "basemap-bg-none",
    backgroundColor: "#1f2937",
  },
  osm: {
    backgroundLayerId: "basemap-bg-osm",
    backgroundColor: "#1f2937",
    sourceId: "basemap-osm",
    rasterLayerId: "basemap-raster-osm",
    tiles: ["/api/map-tiles/osm/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "(c) OpenStreetMap contributors",
    maxzoom: 19,
  },
  satellite_esri: {
    backgroundLayerId: "basemap-bg-esri",
    backgroundColor: "#111827",
    sourceId: "basemap-esri",
    rasterLayerId: "basemap-raster-esri",
    tiles: ["/api/map-tiles/esri/{z}/{y}/{x}"],
    tileSize: 256,
    attribution: "(c) Esri",
    maxzoom: 19,
  },
  topo: {
    backgroundLayerId: "basemap-bg-topo",
    backgroundColor: "#1f2937",
    sourceId: "basemap-topo",
    rasterLayerId: "basemap-raster-topo",
    tiles: ["/api/map-tiles/opentopo/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "(c) OpenTopoMap contributors",
    maxzoom: 17,
  },
};

export function ensureBasemapLayer(map: maplibregl.Map, basemap: BasemapId) {
  const meta = BASEMAP_META[basemap];
  if (!meta) return;

  if (meta.sourceId && meta.tiles && !map.getSource(meta.sourceId)) {
    map.addSource(meta.sourceId, {
      type: "raster",
      tiles: meta.tiles,
      tileSize: meta.tileSize || 256,
      attribution: meta.attribution,
      maxzoom: meta.maxzoom,
    } as any);
  }

  if (!map.getLayer(meta.backgroundLayerId)) {
    map.addLayer({
      id: meta.backgroundLayerId,
      type: "background",
      paint: { "background-color": meta.backgroundColor },
    } as any);
  }

  if (meta.rasterLayerId && meta.sourceId && !map.getLayer(meta.rasterLayerId)) {
    map.addLayer({
      id: meta.rasterLayerId,
      type: "raster",
      source: meta.sourceId,
      paint: { "raster-opacity": 1 },
    } as any);
  }
}

const maptilerKey = (import.meta as any)?.env?.VITE_MAPTILER_KEY;

export const DEM_SOURCES: Record<
  DemSource,
  { tiles: string[]; label: string; attribution: string; encoding: "terrarium" | "mapbox" }
> = {
  jaxa: {
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    label: "JAXA/Terrarium",
    attribution: "Terrain tiles (c) Mapzen, JAXA",
    encoding: "terrarium",
  },
  copernicus: {
    tiles: maptilerKey
      ? [`https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${maptilerKey}`]
      : ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    label: "Copernicus DEM",
    attribution: maptilerKey ? "Copernicus DEM (c) ESA/EU via MapTiler" : "Copernicus DEM (fallback Terrarium)",
    encoding: maptilerKey ? "mapbox" : "terrarium",
  },
};

const DEM_SOURCE_ID = "terrain-dem-source";
const SKY_LAYER_ID = "terrain-sky-layer";
const ACTIVE_HIGHLIGHT_POLYGON_ID = "active-layer-highlight-polygon";
const ACTIVE_HIGHLIGHT_LINE_ID = "active-layer-highlight-line";
const ACTIVE_HIGHLIGHT_POINT_ID = "active-layer-highlight-point";

export function sourceId(layerId: string) {
  return `src-${layerId}`;
}

export function fillLayerId(layerId: string) {
  return `fill-${layerId}`;
}

export function lineLayerId(layerId: string) {
  return `line-${layerId}`;
}

export function pointLayerId(layerId: string) {
  return `point-${layerId}`;
}

export function rasterLayerId(layerId: string) {
  return `raster-${layerId}`;
}

export function interactiveLayerIds(layer: MapLayer): string[] {
  if (layer.sourceKind === "raster") return [];
  return [fillLayerId(layer.id), lineLayerId(layer.id), pointLayerId(layer.id)];
}

export function addLayerToMap(map: maplibregl.Map, layer: MapLayer) {
  const sid = sourceId(layer.id);
  const rid = rasterLayerId(layer.id);
  const fillId = fillLayerId(layer.id);
  const lineId = lineLayerId(layer.id);
  const pointId = pointLayerId(layer.id);

  if (layer.sourceKind === "raster" && layer.rasterConfig) {
    if (!map.getSource(sid)) {
      map.addSource(sid, {
        type: "raster",
        tiles: layer.rasterConfig.tiles,
        tileSize: layer.rasterConfig.tileSize || 256,
        attribution: layer.rasterConfig.attribution,
      } as any);
    }

    if (!map.getLayer(rid)) {
      map.addLayer({
        id: rid,
        type: "raster",
        source: sid,
        paint: {
          "raster-opacity": layer.opacity,
        },
      });
    }
    return;
  }

  if (!map.getSource(sid)) {
    map.addSource(sid, { type: "geojson", data: layer.featureCollection as any });
  } else {
    (map.getSource(sid) as maplibregl.GeoJSONSource).setData(layer.featureCollection as any);
  }

  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: "fill",
      source: sid,
      filter: [
        "any",
        ["==", ["geometry-type"], "Polygon"],
        ["==", ["geometry-type"], "MultiPolygon"],
      ],
      paint: {
        "fill-color": layer.style.fillColor,
        "fill-opacity": layer.style.fillOpacity * layer.opacity,
        "fill-outline-color": layer.style.strokeColor,
      },
    });
  }

  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: "line",
      source: sid,
      filter: [
        "any",
        ["==", ["geometry-type"], "LineString"],
        ["==", ["geometry-type"], "MultiLineString"],
      ],
      paint: {
        "line-color": layer.style.strokeColor,
        "line-width": layer.style.strokeWidth,
        "line-opacity": layer.opacity,
      },
    });
  }

  if (!map.getLayer(pointId)) {
    map.addLayer({
      id: pointId,
      type: "circle",
      source: sid,
      filter: [
        "any",
        ["==", ["geometry-type"], "Point"],
        ["==", ["geometry-type"], "MultiPoint"],
      ],
      paint: {
        "circle-color": layer.style.fillColor,
        "circle-stroke-color": layer.style.strokeColor,
        "circle-stroke-width": 1.5,
        "circle-radius": 6,
        "circle-opacity": layer.opacity,
      },
    });
  }
}

export function removeLayerFromMap(map: maplibregl.Map, layerId: string) {
  for (const lid of [rasterLayerId(layerId), fillLayerId(layerId), lineLayerId(layerId), pointLayerId(layerId)]) {
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  const sid = sourceId(layerId);
  if (map.getSource(sid)) map.removeSource(sid);
}

export function syncLayerVisibility(map: maplibregl.Map, layer: MapLayer) {
  const vis = layer.visible ? "visible" : "none";
  if (layer.sourceKind === "raster") {
    const rid = rasterLayerId(layer.id);
    if (map.getLayer(rid)) {
      map.setLayoutProperty(rid, "visibility", vis);
    }
    return;
  }
  for (const lid of interactiveLayerIds(layer)) {
    if (map.getLayer(lid)) {
      map.setLayoutProperty(lid, "visibility", vis);
    }
  }
}

export function syncLayerStyle(map: maplibregl.Map, layer: MapLayer) {
  if (layer.sourceKind === "raster") {
    const rid = rasterLayerId(layer.id);
    if (map.getLayer(rid)) {
      map.setPaintProperty(rid, "raster-opacity", layer.opacity);
    }
    return;
  }

  const fillId = fillLayerId(layer.id);
  const lineId = lineLayerId(layer.id);
  const pointId = pointLayerId(layer.id);

  if (map.getLayer(fillId)) {
    map.setPaintProperty(fillId, "fill-color", layer.style.fillColor);
    map.setPaintProperty(fillId, "fill-opacity", layer.style.fillOpacity * layer.opacity);
    map.setPaintProperty(fillId, "fill-outline-color", layer.style.strokeColor);
  }
  if (map.getLayer(lineId)) {
    map.setPaintProperty(lineId, "line-color", layer.style.strokeColor);
    map.setPaintProperty(lineId, "line-width", layer.style.strokeWidth);
    map.setPaintProperty(lineId, "line-opacity", layer.opacity);
  }
  if (map.getLayer(pointId)) {
    map.setPaintProperty(pointId, "circle-color", layer.style.fillColor);
    map.setPaintProperty(pointId, "circle-stroke-color", layer.style.strokeColor);
    map.setPaintProperty(pointId, "circle-opacity", layer.opacity);
  }
}

export function syncLayerOrder(map: maplibregl.Map, layers: MapLayer[]) {
  let beforeId: string | undefined;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const orderIds = layer.sourceKind === "raster"
      ? [rasterLayerId(layer.id)]
      : [pointLayerId(layer.id), lineLayerId(layer.id), fillLayerId(layer.id)];
    for (const lid of orderIds) {
      if (!map.getLayer(lid)) continue;
      if (beforeId && map.getLayer(beforeId)) {
        map.moveLayer(lid, beforeId);
      } else {
        map.moveLayer(lid);
      }
      beforeId = lid;
    }
  }
}

export function clearActiveLayerHighlight(map: maplibregl.Map) {
  if (map.getLayer(ACTIVE_HIGHLIGHT_POLYGON_ID)) map.removeLayer(ACTIVE_HIGHLIGHT_POLYGON_ID);
  if (map.getLayer(ACTIVE_HIGHLIGHT_LINE_ID)) map.removeLayer(ACTIVE_HIGHLIGHT_LINE_ID);
  if (map.getLayer(ACTIVE_HIGHLIGHT_POINT_ID)) map.removeLayer(ACTIVE_HIGHLIGHT_POINT_ID);
}

export function syncActiveLayerHighlight(map: maplibregl.Map, layers: MapLayer[], activeLayerId: string | null) {
  clearActiveLayerHighlight(map);
  if (!activeLayerId) return;

  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  if (!activeLayer || !activeLayer.visible) return;
  if (activeLayer.sourceKind === "raster") return;

  const sid = sourceId(activeLayer.id);
  if (!map.getSource(sid)) return;

  map.addLayer({
    id: ACTIVE_HIGHLIGHT_POLYGON_ID,
    type: "line",
    source: sid,
    filter: [
      "any",
      ["==", ["geometry-type"], "Polygon"],
      ["==", ["geometry-type"], "MultiPolygon"],
    ],
    paint: {
      "line-color": "#facc15",
      "line-width": 3,
      "line-dasharray": [2, 1.2],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: ACTIVE_HIGHLIGHT_LINE_ID,
    type: "line",
    source: sid,
    filter: [
      "any",
      ["==", ["geometry-type"], "LineString"],
      ["==", ["geometry-type"], "MultiLineString"],
    ],
    paint: {
      "line-color": "#facc15",
      "line-width": 4,
      "line-dasharray": [2, 1.2],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: ACTIVE_HIGHLIGHT_POINT_ID,
    type: "circle",
    source: sid,
    filter: [
      "any",
      ["==", ["geometry-type"], "Point"],
      ["==", ["geometry-type"], "MultiPoint"],
    ],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#facc15",
      "circle-stroke-width": 3,
      "circle-radius": 9,
      "circle-opacity": 1,
    },
  });

  map.moveLayer(ACTIVE_HIGHLIGHT_POLYGON_ID);
  map.moveLayer(ACTIVE_HIGHLIGHT_LINE_ID);
  map.moveLayer(ACTIVE_HIGHLIGHT_POINT_ID);
}

export function enableTerrain(map: maplibregl.Map, demSource: DemSource, exaggeration: number) {
  const dem = DEM_SOURCES[demSource];

  map.setTerrain(null);
  if (map.getLayer(SKY_LAYER_ID)) map.removeLayer(SKY_LAYER_ID);
  if (map.getSource(DEM_SOURCE_ID)) map.removeSource(DEM_SOURCE_ID);

  map.addSource(DEM_SOURCE_ID, {
    type: "raster-dem",
    encoding: dem.encoding,
    tiles: dem.tiles,
    tileSize: 256,
    attribution: dem.attribution,
  });

  map.setTerrain({ source: DEM_SOURCE_ID, exaggeration });
  map.addLayer({
    id: SKY_LAYER_ID,
    type: "sky",
    paint: {
      "sky-type": "atmosphere",
      "sky-atmosphere-sun": [0, 90],
      "sky-atmosphere-sun-intensity": 12,
    },
  } as any);
}

export function disableTerrain(map: maplibregl.Map) {
  map.setTerrain(null);
  if (map.getLayer(SKY_LAYER_ID)) map.removeLayer(SKY_LAYER_ID);
  if (map.getSource(DEM_SOURCE_ID)) map.removeSource(DEM_SOURCE_ID);
}

function walkBounds(value: unknown, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  if (!Array.isArray(value)) return;
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
  for (const nested of value) walkBounds(nested, bounds);
}

export function fitToLayer(map: maplibregl.Map, fc: FeatureCollection) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const feature of fc.features) {
    walkBounds(feature?.geometry?.coordinates, bounds);
  }

  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return;
  }

  map.fitBounds(
    [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.maxY],
    ],
    {
      padding: 36,
      maxZoom: 18,
      duration: 450,
    },
  );
}

const OFM_BUILDINGS_SOURCE = "ofm-buildings";
const OFM_BUILDINGS_LAYER = "ofm-buildings-3d";
const OFM_BUILDINGS_SOURCE_LAYER = "building";
const buildingsSourceListeners = new WeakMap<maplibregl.Map, (event: maplibregl.MapSourceDataEvent) => void>();

export function enableBuildings3D(map: maplibregl.Map) {
  const labelLayerId = map
    .getStyle()
    ?.layers?.find((layer) => layer.type === "symbol" && !!(layer.layout as any)?.["text-field"])?.id;

  if (!map.getSource(OFM_BUILDINGS_SOURCE)) {
    map.addSource(OFM_BUILDINGS_SOURCE, {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    } as any);
  }

  const numericHeightExpr: any = [
    "coalesce",
    ["to-number", ["get", "render_height"]],
    ["to-number", ["get", "height"]],
    0,
  ];
  const numericBaseExpr: any = [
    "coalesce",
    ["to-number", ["get", "render_min_height"]],
    0,
  ];

  const addBuildingLayer = () => {
    if (map.getLayer(OFM_BUILDINGS_LAYER)) return;
    map.addLayer(
      {
        id: OFM_BUILDINGS_LAYER,
        source: OFM_BUILDINGS_SOURCE,
        "source-layer": OFM_BUILDINGS_SOURCE_LAYER,
        type: "fill-extrusion",
        minzoom: 14,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            numericHeightExpr,
            0,
            "#94a3b8",
            50,
            "#64748b",
            200,
            "#334155",
          ],
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            15,
            ["coalesce", numericHeightExpr, 5],
          ],
          "fill-extrusion-base": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            15,
            numericBaseExpr,
          ],
          "fill-extrusion-opacity": 0.85,
        },
      } as any,
      labelLayerId,
    );
  };

  if (map.isSourceLoaded(OFM_BUILDINGS_SOURCE)) {
    addBuildingLayer();
  } else if (!buildingsSourceListeners.has(map)) {
    const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === OFM_BUILDINGS_SOURCE && event.isSourceLoaded) {
        addBuildingLayer();
        map.off("sourcedata", onSourceData);
        buildingsSourceListeners.delete(map);
      }
    };
    buildingsSourceListeners.set(map, onSourceData);
    map.on("sourcedata", onSourceData);
  }

  if (map.getPitch() < 20) {
    map.easeTo({ pitch: 45, duration: 600 });
  }
}

export function disableBuildings3D(map: maplibregl.Map) {
  const listener = buildingsSourceListeners.get(map);
  if (listener) {
    map.off("sourcedata", listener);
    buildingsSourceListeners.delete(map);
  }

  const hadLayer = !!map.getLayer(OFM_BUILDINGS_LAYER);
  const hadSource = !!map.getSource(OFM_BUILDINGS_SOURCE);
  if (hadLayer) map.removeLayer(OFM_BUILDINGS_LAYER);
  if (hadSource) map.removeSource(OFM_BUILDINGS_SOURCE);
  if (hadLayer && map.getPitch() > 0) {
    map.easeTo({ pitch: 0, duration: 400 });
  }
}
