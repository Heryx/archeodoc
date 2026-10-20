import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { useWebMap } from "../store";

type MeasureMode = "distance" | "area" | "angle";
type LngLat = [number, number];

const EARTH_RADIUS_M = 6378137;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineDistance(a: LngLat, b: LngLat) {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Spherical excess formula for polygon area on a sphere (ring of [lng, lat]).
function sphericalArea(ring: LngLat[]) {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total += (toRad(lng2) - toRad(lng1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

function bearing(from: LngLat, to: LngLat) {
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const dLng = toRad(to[0] - from[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function angleAtVertex(p1: LngLat, vertex: LngLat, p3: LngLat) {
  const b1 = bearing(vertex, p1);
  const b2 = bearing(vertex, p3);
  let diff = Math.abs(b1 - b2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(3)} km` : `${meters.toFixed(2)} m`;
}

function formatArea(squareMeters: number) {
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(4)} km²`;
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(4)} ha`;
  return `${squareMeters.toFixed(2)} m²`;
}

const SOURCE_ID = "measure-tool-source";
const FILL_LAYER = "measure-tool-fill";
const LINE_LAYER = "measure-tool-line";
const POINT_LAYER = "measure-tool-points";

export function MeasureToolPanel() {
  const { state, dispatch, mapRef } = useWebMap();
  const active = state.modules.measure;
  const [mode, setMode] = useState<MeasureMode>("distance");
  const [points, setPoints] = useState<LngLat[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!active) setPoints([]);
  }, [active]);

  // Attach map click handler + sketch layers while the tool is active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !active) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#f59e0b",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    const handleClick = (event: { lngLat: { lng: number; lat: number } }) => {
      const lngLat: LngLat = [event.lngLat.lng, event.lngLat.lat];
      setPoints((prev) => {
        if (modeRef.current === "angle" && prev.length >= 3) return prev;
        return [...prev, lngLat];
      });
    };

    map.on("click", handleClick);
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [active, mapRef]);

  // Keep the sketch source in sync with the clicked points.
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!map || !source) return;

    const features: GeoJSON.Feature[] = points.map((point, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: point },
      properties: { index },
    }));

    if (points.length >= 2) {
      if (mode === "area" && points.length >= 3) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
          properties: {},
        });
      } else {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: points },
          properties: {},
        });
      }
    }

    source.setData({ type: "FeatureCollection", features });
  }, [points, mode, mapRef]);

  // Remove sketch layers/source when the tool is closed or unmounted.
  useEffect(() => {
    if (active) return;
    const map = mapRef.current;
    if (!map) return;
    [FILL_LAYER, LINE_LAYER, POINT_LAYER].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }, [active, mapRef]);

  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      [FILL_LAYER, LINE_LAYER, POINT_LAYER].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!active) return null;

  let resultLabel = "Clicca sulla mappa per iniziare la misura";
  if (mode === "distance" && points.length >= 2) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversineDistance(points[i - 1], points[i]);
    resultLabel = `Distanza totale: ${formatDistance(total)} (${points.length} punti)`;
  } else if (mode === "area" && points.length >= 3) {
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) perimeter += haversineDistance(points[i], points[(i + 1) % points.length]);
    resultLabel = `Area: ${formatArea(sphericalArea(points))} · Perimetro: ${formatDistance(perimeter)}`;
  } else if (mode === "angle" && points.length === 3) {
    resultLabel = `Angolo al vertice: ${angleAtVertex(points[0], points[1], points[2]).toFixed(2)}°`;
  } else if (points.length > 0) {
    resultLabel =
      mode === "angle"
        ? "Clicca il vertice, poi un punto per ciascun lato"
        : "Continua a cliccare per aggiungere punti";
  }

  return (
    <div className="px-3 py-2 border-t border-border bg-card/70 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {(["distance", "area", "angle"] as MeasureMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              mode === m ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setMode(m);
              setPoints([]);
            }}
          >
            {m === "distance" ? "Distanza" : m === "area" ? "Area" : "Angolo"}
          </button>
        ))}
      </div>
      <span className="text-xs font-medium text-foreground">{resultLabel}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[11px]"
        onClick={() => setPoints([])}
        disabled={points.length === 0}
      >
        Nuova misura
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "measure" })}
      >
        Chiudi
      </Button>
    </div>
  );
}
