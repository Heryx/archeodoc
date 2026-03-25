import maplibregl from "maplibre-gl";
import type { BasemapId, DemSource, FeatureCollection, MapLayer } from "./types";

export const BASEMAP_STYLES: Record<BasemapId, object> = {
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "(c) OpenStreetMap contributors",
        maxzoom: 19,
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
  satellite_esri: {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "(c) Esri",
        maxzoom: 19,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  },
  topo: {
    version: 8,
    sources: {
      topo: {
        type: "raster",
        tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "(c) OpenTopoMap contributors",
        maxzoom: 17,
      },
    },
    layers: [{ id: "topo", type: "raster", source: "topo" }],
  },
};

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

export function interactiveLayerIds(layer: MapLayer): string[] {
  return [fillLayerId(layer.id), lineLayerId(layer.id), pointLayerId(layer.id)];
}

export function addLayerToMap(map: maplibregl.Map, layer: MapLayer) {
  const sid = sourceId(layer.id);
  const fillId = fillLayerId(layer.id);
  const lineId = lineLayerId(layer.id);
  const pointId = pointLayerId(layer.id);

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
  for (const lid of [fillLayerId(layerId), lineLayerId(layerId), pointLayerId(layerId)]) {
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  const sid = sourceId(layerId);
  if (map.getSource(sid)) map.removeSource(sid);
}

export function syncLayerVisibility(map: maplibregl.Map, layer: MapLayer) {
  const vis = layer.visible ? "visible" : "none";
  for (const lid of interactiveLayerIds(layer)) {
    if (map.getLayer(lid)) {
      map.setLayoutProperty(lid, "visibility", vis);
    }
  }
}

export function syncLayerStyle(map: maplibregl.Map, layer: MapLayer) {
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
    for (const lid of [pointLayerId(layer.id), lineLayerId(layer.id), fillLayerId(layer.id)]) {
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
