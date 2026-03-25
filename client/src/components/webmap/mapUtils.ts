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
        attribution: "© OpenStreetMap contributors",
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
        attribution: "© Esri",
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
        attribution: "© OpenTopoMap contributors",
        maxzoom: 17,
      },
    },
    layers: [{ id: "topo", type: "raster", source: "topo" }],
  },
};

export const DEM_SOURCES: Record<DemSource, { tiles: string[]; label: string; attribution: string }> = {
  jaxa: {
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    label: "JAXA/Terrarium",
    attribution: "Terrain tiles © Mapzen, JAXA",
  },
  copernicus: {
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    label: "Copernicus DEM",
    attribution: "Copernicus DEM © ESA / EU",
  },
};

const DEM_SOURCE_ID = "terrain-dem-source";

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
      filter: ["==", ["geometry-type"], "Polygon"],
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
      filter: ["==", ["geometry-type"], "LineString"],
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
      filter: ["==", ["geometry-type"], "Point"],
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
  for (const layer of layers) {
    for (const lid of [fillLayerId(layer.id), lineLayerId(layer.id), pointLayerId(layer.id)]) {
      if (map.getLayer(lid)) {
        map.moveLayer(lid);
      }
    }
  }
}

export function enableTerrain(map: maplibregl.Map, demSource: DemSource, exaggeration: number) {
  const dem = DEM_SOURCES[demSource];
  if (!map.getSource(DEM_SOURCE_ID)) {
    map.addSource(DEM_SOURCE_ID, {
      type: "raster-dem",
      encoding: "terrarium",
      tiles: dem.tiles,
      tileSize: 256,
      attribution: dem.attribution,
    });
  }

  map.setTerrain({ source: DEM_SOURCE_ID, exaggeration });
}

export function disableTerrain(map: maplibregl.Map) {
  map.setTerrain(null);
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
