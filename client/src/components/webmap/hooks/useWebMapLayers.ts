import { useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import type maplibregl from "maplibre-gl";
import { getProjectHeader } from "@/lib/project";
import type {
  FeatureCollection,
  GeometryKind,
  MapLayer,
  WebMapAction,
  WebMapLayer,
} from "@/components/webmap/types";

const SOURCE_PREFIX = "layer-";

function sourceId(layerId: number) {
  return `${SOURCE_PREFIX}${layerId}`;
}

function lineId(layerId: number) {
  return `${SOURCE_PREFIX}${layerId}-line`;
}

function fillId(layerId: number) {
  return `${SOURCE_PREFIX}${layerId}-fill`;
}

function circleId(layerId: number) {
  return `${SOURCE_PREFIX}${layerId}-circle`;
}

function rasterId(layerId: number) {
  return `${SOURCE_PREFIX}${layerId}-raster`;
}

function defaultStyle() {
  return {
    strokeColor: "#2563eb",
    fillColor: "#2563eb",
    fillOpacity: 0.24,
    weight: 2,
  };
}

function parseStyle(styleJson: string | null) {
  try {
    return styleJson ? { ...defaultStyle(), ...JSON.parse(styleJson) } : defaultStyle();
  } catch {
    return defaultStyle();
  }
}

function toGeometryKind(geometryType: string | null): GeometryKind {
  const normalized = String(geometryType || "").toLowerCase();
  if (normalized.includes("polygon")) return "Polygon";
  if (normalized.includes("line")) return "LineString";
  if (normalized.includes("point")) return "Point";
  if (normalized === "mixed") return "Mixed";
  return "Unknown";
}

function withFeatureIds(collection: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (collection.features || []).map((feature, index) => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        _fid: index,
      },
    })),
  };
}

function mapDbLayerToStoreLayer(
  dbLayer: WebMapLayer,
  featureCollection?: FeatureCollection,
  cantiereId?: number,
): MapLayer {
  const style = parseStyle(dbLayer.styleJson);

  if (dbLayer.kind === "raster" && dbLayer.rasterBounds) {
    return {
      id: String(dbLayer.id),
      sourceFileName: dbLayer.sourceFileName,
      tableName: dbLayer.tableName,
      sourceSrid: dbLayer.sridOriginal,
      rowCount: 0,
      geometryKind: "Unknown",
      sourceKind: "raster",
      visible: dbLayer.visible,
      opacity: 1,
      style: {
        fillColor: style.fillColor,
        strokeColor: style.strokeColor,
        fillOpacity: style.fillOpacity,
        strokeWidth: style.weight,
      },
      featureCollection: { type: "FeatureCollection", features: [] },
      rasterConfig: {
        protocol: "image",
        imageUrl: `/api/cantieri/${cantiereId}/webmap/layers/${dbLayer.id}/raster`,
        imageCoordinates: dbLayer.rasterBounds,
      },
    };
  }

  return {
    id: String(dbLayer.id),
    sourceFileName: dbLayer.sourceFileName,
    tableName: dbLayer.tableName,
    sourceSrid: dbLayer.sridOriginal,
    rowCount: dbLayer.featureCount,
    geometryKind: toGeometryKind(dbLayer.geometryType),
    sourceKind: "vector",
    visible: dbLayer.visible,
    opacity: style.fillOpacity,
    style: {
      fillColor: style.fillColor,
      strokeColor: style.strokeColor,
      fillOpacity: style.fillOpacity,
      strokeWidth: style.weight,
    },
    featureCollection: featureCollection ?? { type: "FeatureCollection", features: [] },
  };
}

function layersSignature(layers: WebMapLayer[]): string {
  return layers
    .filter((l) => l.visible)
    .map((l) => `${l.id}:${l.zIndex}:${l.styleJson || ""}:${l.kind || "vector"}:${l.rasterPath || ""}`)
    .sort()
    .join("|");
}

function persistentSourcesPresent(map: maplibregl.Map, layers: WebMapLayer[]): boolean {
  const style = map.getStyle();
  if (!style) return false;
  const expected = layers.filter((l) => l.visible).map((l) => sourceId(l.id));
  return expected.every((id) => Boolean(style.sources?.[id]));
}

function removePersistentLayers(map: maplibregl.Map) {
  const style = map.getStyle();
  if (!style) return;

  const layerIds = (style.layers || [])
    .map((layer) => layer.id)
    .filter((id) => id.startsWith(SOURCE_PREFIX));
  for (const id of layerIds) {
    if (map.getLayer(id)) map.removeLayer(id);
  }

  const sourceIds = Object.keys(style.sources || {}).filter((id) => id.startsWith(SOURCE_PREFIX));
  for (const id of sourceIds) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

async function fetchGeoJson(cantiereId: number, layerId: number) {
  const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers/${layerId}/geojson`, {
    headers: getProjectHeader(),
  });
  if (!response.ok) throw new Error("GeoJSON layer non disponibile");
  return response.json();
}

async function renderPersistentLayers(
  map: maplibregl.Map,
  cantiereId: number,
  layers: WebMapLayer[],
  runId: number,
  runRef: MutableRefObject<number>,
  dispatch: Dispatch<WebMapAction>,
) {
  const ordered = [...layers]
    .filter((layer) => layer.visible)
    .sort((a, b) => a.zIndex - b.zIndex || a.id - b.id);

  removePersistentLayers(map);
  if (ordered.length === 0) return;

  for (const layer of ordered) {
    if (runId !== runRef.current) return;

    if (layer.kind === "raster" && layer.rasterBounds) {
      if (!map.isStyleLoaded()) return;
      const sid = sourceId(layer.id);
      map.addSource(sid, {
        type: "image",
        url: `/api/cantieri/${cantiereId}/webmap/layers/${layer.id}/raster`,
        coordinates: layer.rasterBounds,
      } as any);
      map.addLayer({
        id: rasterId(layer.id),
        type: "raster",
        source: sid,
        paint: { "raster-opacity": 1 },
      });
      dispatch({
        type: "SYNC_LAYER",
        layer: mapDbLayerToStoreLayer(layer, undefined, cantiereId),
      });
      continue;
    }

    let fc: any;
    try {
      fc = await fetchGeoJson(cantiereId, layer.id);
    } catch {
      continue;
    }
    if (runId !== runRef.current || !map.isStyleLoaded()) return;

    const sid = sourceId(layer.id);
    map.addSource(sid, { type: "geojson", data: fc });

    const normalizedCollection = withFeatureIds(
      (fc && fc.type === "FeatureCollection" ? fc : { type: "FeatureCollection", features: [] }) as FeatureCollection,
    );
    dispatch({
      type: "SYNC_LAYER",
      layer: mapDbLayerToStoreLayer(layer, normalizedCollection, cantiereId),
    });

    const style = parseStyle(layer.styleJson);
    const gtype = (layer.geometryType || "").toLowerCase();

    const addPoint = gtype.includes("point");
    const addLine = gtype.includes("line");
    const addPolygon = gtype.includes("polygon");
    const isMixed = gtype === "mixed" || !gtype;

    if (addPolygon || isMixed) {
      map.addLayer({
        id: fillId(layer.id),
        type: "fill",
        source: sid,
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "fill-color": style.fillColor,
          "fill-opacity": style.fillOpacity,
        },
      });
    }

    if (addLine || addPolygon || isMixed) {
      map.addLayer({
        id: lineId(layer.id),
        type: "line",
        source: sid,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString", "Polygon", "MultiPolygon"]]],
        paint: {
          "line-color": style.strokeColor,
          "line-width": style.weight,
          "line-opacity": 0.9,
        },
      });
    }

    if (addPoint || isMixed) {
      map.addLayer({
        id: circleId(layer.id),
        type: "circle",
        source: sid,
        filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
        paint: {
          "circle-color": style.fillColor,
          "circle-opacity": Math.min(1, style.fillOpacity + 0.35),
          "circle-stroke-color": style.strokeColor,
          "circle-stroke-width": Math.max(1, style.weight * 0.6),
          "circle-radius": 5,
        },
      });
    }
  }
}

export function useWebMapLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  cantiereId: number,
  dispatch: Dispatch<WebMapAction>,
  enabled = true,
) {
  const prevLayerIds = useRef<Set<string>>(new Set());

  const { data: layers = [] } = useQuery<WebMapLayer[]>({
    queryKey: ["webmap-layers", cantiereId],
    queryFn: async () => {
      const response = await fetch(`/api/cantieri/${cantiereId}/webmap/layers`, {
        headers: getProjectHeader(),
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: enabled && Number.isFinite(cantiereId) && cantiereId > 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const currentIds = new Set(layers.map((layer) => String(layer.id)));

    prevLayerIds.current.forEach((oldId) => {
      if (!currentIds.has(oldId)) {
        dispatch({ type: "REMOVE_LAYER", id: oldId });
      }
    });

    for (const dbLayer of layers) {
      dispatch({
        type: "SYNC_LAYER",
        layer: mapDbLayerToStoreLayer(dbLayer, undefined, cantiereId),
      });
    }

    prevLayerIds.current = currentIds;
  }, [layers, dispatch, cantiereId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const runRef = { current: Date.now() };
    let lastAppliedSignature: string | null = null;
    let applying = false;
    let pendingRerun = false;

    const apply = () => {
      // "styledata" scatta anche per le modifiche fatte da noi stessi qui sotto
      // (addSource/addLayer, incluso il caricamento di un'immagine raster grande):
      // senza queste guardie ogni applicazione si ritriggera da sola, interrompendo
      // (abort) i fetch dei raster prima che finiscano di caricare. Mentre un giro e'
      // gia' in corso, un nuovo trigger viene solo segnato come "da ricontrollare a
      // fine corsa", non eseguito subito.
      if (applying) {
        pendingRerun = true;
        return;
      }
      const signature = layersSignature(layers);
      if (signature === lastAppliedSignature && persistentSourcesPresent(map, layers)) {
        return;
      }
      lastAppliedSignature = signature;
      applying = true;
      runRef.current += 1;
      void renderPersistentLayers(map, cantiereId, layers, runRef.current, runRef, dispatch).finally(() => {
        applying = false;
        if (pendingRerun) {
          pendingRerun = false;
          apply();
        }
      });
    };

    if (map.isStyleLoaded()) apply();
    const onStyleData = () => apply();
    map.on("styledata", onStyleData);

    return () => {
      map.off("styledata", onStyleData);
      if (map.isStyleLoaded()) {
        removePersistentLayers(map);
      }
    };
  }, [mapRef, cantiereId, layers, dispatch]);

  return { layers };
}
