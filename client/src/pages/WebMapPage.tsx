import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import {
  Camera,
  Download,
  FileArchive,
  Globe2,
  Layers,
  Layers3,
  Map as MapIcon,
  RefreshCcw,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";
import { apiRequest } from "@/lib/queryClient";
import { AttributeTable } from "@/components/webmap/modules/AttributeTable";
import { Geocoder } from "@/components/webmap/modules/Geocoder";
import { useFeaturePopup } from "@/components/webmap/modules/FeaturePopup";
import { LayerManager } from "@/components/webmap/modules/LayerManager";
import { MapExporter } from "@/components/webmap/modules/MapExporter";
import { PrintMap } from "@/components/webmap/modules/PrintMap";
import { LayerPanel } from "@/components/webmap/LayerPanel";
import { useWebMapLayers } from "@/components/webmap/hooks/useWebMapLayers";
import { TerrainPanel } from "@/components/webmap/modules/TerrainModule";
import { StyleRendererPanel } from "@/components/webmap/modules/StyleRenderer";
import { DEFAULT_STYLE, pickColor, useWebMap, useWebMapStore, WebMapContext } from "@/components/webmap/store";
import { ToolbarStrip } from "@/components/webmap/ToolbarStrip";
import {
  BASEMAP_STYLES,
  addLayerToMap,
  disableTerrain,
  ensureBasemapLayer,
  enableTerrain,
  fitToLayer,
  fillLayerId,
  interactiveLayerIds,
  lineLayerId,
  pointLayerId,
  removeLayerFromMap,
  sourceId,
  syncActiveLayerHighlight,
  syncLayerOrder,
  syncLayerStyle,
  syncLayerVisibility,
} from "@/components/webmap/mapUtils";
import type {
  FeatureCollection,
  GeometryKind,
  MapLayer,
  MapSnapshotRecord,
  RasterLayerConfig,
  WebMapPreviewPayload,
} from "@/components/webmap/types";
import { normalizeUSCode, usCodeKey } from "@shared/normalize_us_code";

let drawClassPatched = false;
const US_CODE_FIELDS = ["codiceUS", "codice_us", "codice", "us_code", "us", "id_us", "cod_us"];
const REMOTE_SOURCE_TYPES = ["xyz", "wms", "wmts", "wfs", "arcgis"] as const;
type RemoteSourceType = (typeof REMOTE_SOURCE_TYPES)[number];
type WebMapPanelTab = "geopackage" | "sources" | "shapefile" | "snapshot";
type USLookupEntry = {
  id: number;
  codiceUS: string;
  tipo?: string | null;
  definizione?: string | null;
  descrizione?: string | null;
  quota?: number | null;
  quotaPianoCampagna?: number | null;
  settore?: string | null;
};

const ITALIAN_SOURCE_PRESETS: Array<{
  id: string;
  label: string;
  type: RemoteSourceType;
  url: string;
  layerName?: string;
  attribution?: string;
}> = [
  {
    id: "igm-wms",
    label: "IGM (WMS template)",
    type: "wms",
    url: "https://www.pcn.minambiente.it/geoportale/wms?",
    layerName: "OI.ORTOIMMAGINI.2006",
    attribution: "Geoportale Nazionale",
  },
  {
    id: "geoportale-ortofoto",
    label: "Geoportale Ortofoto (WMS)",
    type: "wms",
    url: "https://wms.pcn.minambiente.it/ogc?",
    layerName: "OI.ORTOIMMAGINI.2012",
    attribution: "Geoportale Nazionale",
  },
  {
    id: "lidar-hillshade",
    label: "LiDAR Hillshade (XYZ template)",
    type: "xyz",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "OpenTopoMap",
  },
];

const DRAW_STYLES: any[] = [
  {
    id: "gl-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"]],
    paint: {
      "fill-color": ["case", ["==", ["get", "active"], "true"], "#f59e0b", "#3b82f6"],
      "fill-opacity": 0.12,
    },
  },
  {
    id: "gl-draw-lines",
    type: "line",
    filter: ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": ["case", ["==", ["get", "active"], "true"], "#f59e0b", "#3b82f6"],
      "line-width": ["case", ["==", ["get", "active"], "true"], 3, 2],
    },
  },
  {
    id: "gl-draw-point-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#ffffff",
    },
  },
  {
    id: "gl-draw-point-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": ["case", ["==", ["get", "active"], "true"], "#f59e0b", "#3b82f6"],
    },
  },
  {
    id: "gl-draw-vertex-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#ffffff",
    },
  },
  {
    id: "gl-draw-vertex-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": "#f59e0b",
    },
  },
  {
    id: "gl-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"]],
    paint: {
      "circle-radius": 3,
      "circle-color": "#f59e0b",
    },
  },
];

function expandSubdomainTiles(urlTemplate: string): string[] {
  if (!urlTemplate.includes("{s}")) return [urlTemplate];
  return ["a", "b", "c"].map((sub) => urlTemplate.replaceAll("{s}", sub));
}

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

function isImagePath(value: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(value.trim());
}

function isDisplayableImageUrl(value: string): boolean {
  const normalized = value.trim();
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return true;
  if (normalized.startsWith("/")) return true;
  return false;
}

function renderPopupValue(value: unknown): string {
  const normalized = String(value ?? "-").trim();
  if (!normalized) return "-";
  if (!isImagePath(normalized)) return escapeHtml(normalized);

  const escaped = escapeHtml(normalized);
  if (!isDisplayableImageUrl(normalized)) return escaped;

  return `
    <a href="${escaped}" target="_blank" rel="noreferrer" style="display:block;text-decoration:none;">
      <img src="${escaped}" alt="preview" style="max-width:100%;max-height:160px;object-fit:cover;border-radius:6px;border:1px solid #3a3a3a;margin-bottom:4px;" />
      <span style="font-size:11px;opacity:.8;word-break:break-word;">${escaped}</span>
    </a>
  `;
}

function detectUSCodeFromProperties(properties: Record<string, unknown>): string | null {
  for (const field of US_CODE_FIELDS) {
    const value = properties[field];
    if (value == null) continue;
    const code = normalizeUSCode(value);
    if (code) return code;
  }
  return null;
}

function linkedUsHtml(linkedUs: USLookupEntry | null): string {
  if (!linkedUs) return "";

  const quota = linkedUs.quota != null ? `${linkedUs.quota} m s.l.m.` : "n.d.";
  const quotaPc = linkedUs.quotaPianoCampagna != null ? `${linkedUs.quotaPianoCampagna} m da p.c.` : "n.d.";
  return `
    <div style="border:1px solid #3b3b3b;border-radius:8px;padding:8px;margin-bottom:8px;background:#181818;">
      <div style="font-size:11px;opacity:.7;">US collegata</div>
      <div style="font-size:13px;font-weight:600;">${escapeHtml(linkedUs.codiceUS)}</div>
      <div style="font-size:12px;opacity:.9;">${escapeHtml(linkedUs.tipo || "-")} · ${escapeHtml(linkedUs.definizione || "-")}</div>
      <div style="font-size:11px;opacity:.8;">Settore: ${escapeHtml(linkedUs.settore || "-")}</div>
      <div style="font-size:11px;opacity:.8;">Quota: ${escapeHtml(quota)} · ${escapeHtml(quotaPc)}</div>
    </div>
  `;
}

function popupHtml(properties: Record<string, unknown>, linkedUs: USLookupEntry | null): string {
  const entries = Object.entries(properties).filter(([key]) => !key.startsWith("_"));
  if (entries.length === 0) return "<div style='font-size:12px'>Nessun attributo</div>";

  return `<div style="max-width:320px;">${linkedUsHtml(linkedUs)}${entries
    .slice(0, 24)
      .map(
        ([key, value]) =>
        `<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:start;border-bottom:1px solid #2f2f2f;padding:4px 0;">
          <strong style="font-size:12px;opacity:.85;">${escapeHtml(key)}</strong>
          <span style="font-size:12px;word-break:break-word;">${renderPopupValue(value)}</span>
        </div>`,
      )
    .join("")}</div>`;
}

function buildWmsTileTemplate(baseUrl: string, layerName: string): string {
  const params = new URLSearchParams({
    base: baseUrl,
    layers: layerName,
    version: "1.1.1",
    srs: "EPSG:3857",
    format: "image/png",
    transparent: "true",
    styles: "",
    width: "256",
    height: "256",
    bbox: "{bbox-epsg-3857}",
  });
  return `/api/map-proxy/wms?${params.toString()}`;
}

function buildArcGisGeoJsonUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/query") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/query`;
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}where=1%3D1&outFields=*&f=geojson`;
}

function mergeFeatureCollections(collections: FeatureCollection[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection.features),
  };
}

async function readShapefileZip(file: File): Promise<FeatureCollection> {
  const { default: shp } = await import("shpjs");
  const raw = await file.arrayBuffer();
  const parsed: any = await shp(raw);
  if (Array.isArray(parsed)) {
    const normalized = parsed.filter((item) => item?.type === "FeatureCollection");
    return mergeFeatureCollections(normalized as FeatureCollection[]);
  }
  if (parsed?.type === "FeatureCollection") {
    return parsed as FeatureCollection;
  }
  return { type: "FeatureCollection", features: [] };
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
  const usLookupRef = useRef<Map<string, USLookupEntry>>(new Map());

  const [selectedGeoPackage, setSelectedGeoPackage] = useState<File | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [limit, setLimit] = useState("1200");
  const [availableTables, setAvailableTables] = useState<WebMapPreviewPayload["tables"]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drawFeatureCount, setDrawFeatureCount] = useState(0);
  const [mapUnsupported, setMapUnsupported] = useState(false);
  const [remoteType, setRemoteType] = useState<RemoteSourceType>("xyz");
  const [remoteTitle, setRemoteTitle] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteLayerName, setRemoteLayerName] = useState("");
  const [remoteAttribution, setRemoteAttribution] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedShapefile, setSelectedShapefile] = useState<File | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [tileProbeStatus, setTileProbeStatus] = useState<"idle" | "ok" | "error">("idle");
  const [canvasDiag, setCanvasDiag] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(6);
  const [scaleLabel, setScaleLabel] = useState<string>("1:?");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WebMapPanelTab>("geopackage");
  const { layers: persistedLayers } = useWebMapLayers(mapRef, Number(cid), Boolean(cid));

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    setTileProbeStatus("idle");
    fetch("/api/map-tiles/osm/0/0/0.png", { headers: getProjectHeader() })
      .then((response) => {
        if (cancelled) return;
        setTileProbeStatus(response.ok ? "ok" : "error");
      })
      .catch(() => {
        if (cancelled) return;
        setTileProbeStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: usList = [] } = useQuery<USLookupEntry[]>({
    queryKey: ["/api/cantieri", cid, "us", "map-lookup"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
    staleTime: 30_000,
  });

  const { data: snapshotData } = useQuery<{ snapshots: MapSnapshotRecord[] }>({
    queryKey: ["/api/cantieri", cid, "map-snapshots"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/map-snapshots`)).json(),
    enabled: !!cid,
    staleTime: 15_000,
  });

  const snapshots = snapshotData?.snapshots || [];
  const usLookup = useMemo(() => {
    const map = new Map<string, USLookupEntry>();
    for (const us of usList) {
      const key = usCodeKey(us.codiceUS);
      if (!key) continue;
      map.set(key, us);
    }
    return map;
  }, [usList]);

  useEffect(() => {
    usLookupRef.current = usLookup;
  }, [usLookup]);

  const pushVectorLayer = (
    sourceFileName: string,
    tableName: string,
    collection: FeatureCollection,
    styleHint?: Partial<WebMapPreviewPayload["styleHint"]>,
    sourceSrid?: number | null,
  ) => {
    const normalizedCollection = withFeatureIds(collection);
    const nextColor = pickColor(state.layers.length);
    const layer: MapLayer = {
      id: crypto.randomUUID(),
      sourceFileName,
      tableName,
      sourceSrid: sourceSrid ?? null,
      rowCount: normalizedCollection.features.length,
      geometryKind: guessGeometryKind(normalizedCollection),
      sourceKind: "vector",
      visible: true,
      opacity: 1,
      style: {
        ...DEFAULT_STYLE,
        fillColor: styleHint?.fillColor || nextColor,
        strokeColor: styleHint?.strokeColor || nextColor,
        fillOpacity: Number.isFinite(styleHint?.fillOpacity as number) ? Number(styleHint?.fillOpacity) : DEFAULT_STYLE.fillOpacity,
        strokeWidth: Number.isFinite(styleHint?.weight as number) ? Math.max(1, Number(styleHint?.weight)) : DEFAULT_STYLE.strokeWidth,
      },
      featureCollection: normalizedCollection,
    };
    dispatch({ type: "ADD_LAYER", layer });
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      fitToLayer(map, layer.featureCollection);
    }
    return layer;
  };

  const pushRasterLayer = (
    tableName: string,
    rasterConfig: RasterLayerConfig,
    sourceFileName = "remote",
  ) => {
    const layer: MapLayer = {
      id: crypto.randomUUID(),
      sourceFileName,
      tableName,
      rowCount: 0,
      geometryKind: "Unknown",
      sourceKind: "raster",
      visible: true,
      opacity: 0.75,
      style: DEFAULT_STYLE,
      featureCollection: { type: "FeatureCollection", features: [] },
      rasterConfig,
    };
    dispatch({ type: "ADD_LAYER", layer });
    return layer;
  };

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
      const tableInfo = (result.tables || []).find((table) => table.tableName === result.tableName);
      const layer = pushVectorLayer(
        result.sourceFileName,
        result.tableName,
        result.featureCollection,
        result.styleHint,
        tableInfo?.srid ?? null,
      );

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

  const sourceLoaderMutation = useMutation({
    mutationFn: async () => {
      const title = remoteTitle.trim() || `${remoteType.toUpperCase()} layer`;
      const url = remoteUrl.trim();
      if (!url) throw new Error("Inserisci URL sorgente");

      if (remoteType === "xyz" || remoteType === "wmts") {
        if (!url.includes("{z}") || !url.includes("{x}") || !url.includes("{y}")) {
          throw new Error("Per XYZ/WMTS usa una tile template con {z}/{x}/{y}");
        }
        const tiles = expandSubdomainTiles(url);
        pushRasterLayer(title, {
          protocol: remoteType,
          tiles,
          tileSize: 256,
          attribution: remoteAttribution.trim() || undefined,
        }, "remote-raster");
        return;
      }

      if (remoteType === "wms") {
        const layerName = remoteLayerName.trim();
        if (!layerName) throw new Error("Layer WMS obbligatorio");
        const tileTemplate = buildWmsTileTemplate(url, layerName);
        pushRasterLayer(title, {
          protocol: "wms",
          tiles: [tileTemplate],
          tileSize: 256,
          attribution: remoteAttribution.trim() || undefined,
        }, "remote-wms");
        return;
      }

      if (remoteType === "wfs") {
        const layerName = remoteLayerName.trim();
        const endpoint = url.includes("service=WFS")
          ? url
          : `${url}${url.includes("?") ? "&" : "?"}service=WFS&request=GetFeature&version=2.0.0&typeNames=${encodeURIComponent(layerName)}&outputFormat=application/json&srsName=EPSG:4326`;
        const response = await fetch(endpoint, { headers: getProjectHeader() });
        if (!response.ok) throw new Error("Download WFS fallito");
        const fc = await response.json() as FeatureCollection;
        pushVectorLayer("remote-wfs", title, fc, undefined, 4326);
        return;
      }

      if (remoteType === "arcgis") {
        const response = await fetch(buildArcGisGeoJsonUrl(url), { headers: getProjectHeader() });
        if (!response.ok) throw new Error("Download ArcGIS REST fallito");
        const fc = await response.json() as FeatureCollection;
        pushVectorLayer("remote-arcgis", title, fc, undefined, 4326);
      }
    },
    onSuccess: () => {
      toast({ title: "Sorgente aggiunta alla mappa" });
    },
    onError: (error: any) => {
      toast({
        title: "Errore SourceLoader",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const shapefileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShapefile) throw new Error("Seleziona prima uno shapefile .zip");
      const collection = await readShapefileZip(selectedShapefile);
      if (!collection.features?.length) throw new Error("Nessuna feature trovata nello shapefile");
      pushVectorLayer(selectedShapefile.name, remoteTitle.trim() || selectedShapefile.name, collection, undefined, 4326);
    },
    onSuccess: () => toast({ title: "Shapefile caricato in mappa" }),
    onError: (error: any) =>
      toast({
        title: "Errore shapefile",
        description: error?.message || "Impossibile caricare il file",
        variant: "destructive",
      }),
  });

  const exportSketchesMutation = useMutation({
    mutationFn: async () => {
      const draw = drawRef.current;
      if (!draw) throw new Error("Tool disegno non inizializzato");
      const featureCollection = draw.getAll() as FeatureCollection;
      const featureCount = featureCollection.features?.length || 0;
      if (featureCount === 0) throw new Error("Nessuno schizzo da esportare");

      const defaultTitle = `Sketches_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
      const titolo = (window.prompt("Nome file GeoPackage", defaultTitle) || "").trim();
      if (!titolo) throw new Error("Export annullato: nome file obbligatorio");

      return (await apiRequest("POST", `/api/cantieri/${cid}/webmap/sketches/export-geopackage`, {
        titolo,
        featureCollection,
      })).json();
    },
    onSuccess: (result: any) => {
      const url = result?.file?.url;
      if (typeof url === "string" && url.length > 0) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      toast({
        title: "GeoPackage creato",
        description: `${result?.file?.featureCount ?? "N"} geometrie esportate`,
      });
    },
    onError: (error: any) => {
      const message = String(error?.message || "");
      if (message.includes("annullato")) return;
      toast({
        title: "Errore export GeoPackage",
        description: message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    setMapLoaded(false);
    setMapLoadError(null);
    if (typeof (maplibregl as any).supported === "function" && !(maplibregl as any).supported()) {
      setMapUnsupported(true);
      toast({
        title: "WebGL non supportato",
        description: "MapLibre richiede WebGL attivo nel browser/GPU.",
        variant: "destructive",
      });
      return;
    }
    setMapUnsupported(false);
    patchMapboxDrawForMapLibre();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLES[state.basemap] as any,
      center: [12.5, 41.9],
      zoom: 6,
      maxPitch: 60,
    });
    mapRef.current = map;
    const updateScaleStatus = () => {
      try {
        const zoom = map.getZoom();
        const lat = map.getCenter().lat;
        const metersPerPixel =
          (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) /
          (256 * Math.pow(2, zoom));
        const scaleDenominator = metersPerPixel * (96 / 0.0254);
        setZoomLevel(zoom);
        setScaleLabel(`1:${Math.max(1, Math.round(scaleDenominator)).toLocaleString("it-IT")}`);
      } catch {
        setScaleLabel("1:?");
      }
    };
    const resize = () => map.resize();
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(mapContainerRef.current);
    window.addEventListener("resize", resize);
    requestAnimationFrame(resize);
    setTimeout(resize, 50);
    setTimeout(resize, 250);

    const loadTimeout = window.setTimeout(() => {
      if (!map.loaded()) {
        setMapLoadError("La mappa non ha completato il caricamento. Verifica GPU/WebGL o blocchi di rete.");
      }
    }, 7000);

    map.once("load", () => {
      setMapLoaded(true);
      setMapLoadError(null);
      ensureBasemapLayer(map, stateRef.current.basemap);
      const canvas = map.getCanvas();
      canvas.style.filter = "none";
      canvas.style.opacity = "1";
      canvas.style.mixBlendMode = "normal";
      window.setTimeout(() => {
        try {
          const style = window.getComputedStyle(canvas);
          const unusual = style.filter !== "none" || Number(style.opacity || "1") < 0.99 || style.mixBlendMode !== "normal";
          setCanvasDiag(
            unusual
              ? `Canvas alterata (filter=${style.filter}, opacity=${style.opacity}, blend=${style.mixBlendMode})`
              : null,
          );
        } catch {
          setCanvasDiag(null);
        }
      }, 120);
      updateScaleStatus();
      resize();
    });
    map.on("zoom", updateScaleStatus);
    map.on("moveend", updateScaleStatus);

    map.on("error", (event) => {
      const message = event?.error?.message || "Errore caricamento mappa/layer";
      setMapLoadError(message);
      const sourceIdRaw = (event as any)?.sourceId;
      if (typeof sourceIdRaw === "string" && sourceIdRaw.startsWith("src-")) {
        const candidate = stateRef.current.layers.find((layer) => sourceId(layer.id) === sourceIdRaw);
        if (candidate?.visible) {
          dispatch({ type: "TOGGLE_VISIBLE", id: candidate.id });
        }
      }
      if (/Failed to fetch|401|403|404|CORS|NetworkError/i.test(message)) {
        toast({
          title: "Layer non caricabile",
          description: message,
          variant: "destructive",
        });
      }
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: "simple_select",
      styles: DRAW_STYLES,
    });
    drawRef.current = draw;
    map.addControl(draw as any);

    const refreshDrawStats = () => {
      setDrawFeatureCount(drawRef.current?.getAll().features.length || 0);
    };
    map.on("draw.create", refreshDrawStats);
    map.on("draw.update", refreshDrawStats);
    map.on("draw.delete", refreshDrawStats);

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const currentDrawMode = (drawRef.current as any)?.getMode?.();
      if (currentDrawMode && currentDrawMode !== "simple_select") return;

      const snapshot = stateRef.current;
      if (snapshot.modules.inspect) return;
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
      const detectedCode = detectUSCodeFromProperties(properties);
      const linkedUs = detectedCode ? usLookupRef.current.get(usCodeKey(detectedCode)) || null : null;

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setHTML(popupHtml(properties, linkedUs))
        .addTo(map);
    };

    map.on("click", handleClick);

    return () => {
      window.clearTimeout(loadTimeout);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      popupRef.current?.remove();
      popupRef.current = null;
      drawRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [dispatch, mapRef, toast]);

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
      ensureBasemapLayer(map, state.basemap);

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

      syncActiveLayerHighlight(map, state.layers, state.activeLayerId);
    };

    if (map.isStyleLoaded()) {
      sync();
      return;
    }

    map.once("style.load", sync);
    return () => {
      map.off("style.load", sync);
    };
  }, [
    state.layers,
    state.activeLayerId,
    state.basemap,
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
  const visibleLayerNames = useMemo(
    () => state.layers.filter((layer) => layer.visible).map((layer) => layer.tableName),
    [state.layers],
  );
  const activeLayerCrs = activeLayer?.sourceSrid && Number.isFinite(activeLayer.sourceSrid)
    ? `EPSG:${activeLayer.sourceSrid}`
    : activeLayer?.sourceKind === "raster"
      ? "EPSG:3857"
      : "EPSG:4326";

  const clearCustomLayers = () => {
    const ids = state.layers.map((layer) => layer.id);
    for (const id of ids) {
      dispatch({ type: "REMOVE_LAYER", id });
    }
    popupRef.current?.remove();
    dispatch({ type: "SET_SELECTED_FEATURE", id: null });
    toast({ title: "Layer custom rimossi", description: "Mappa riportata alla sola basemap." });
  };

  const openPanel = (tab: WebMapPanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
  };

  useFeaturePopup(
    mapRef,
    state.modules.inspect ? persistedLayers : [],
    Number(cid),
    (codiceUS) => {
      window.open(`/cantiere/${cid}/us?codice=${encodeURIComponent(codiceUS)}`, "_blank", "noopener,noreferrer");
    },
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <MapIcon size={18} className="text-primary" />
        <h1 className="text-lg font-bold">WebMap GIS</h1>
        <span className="text-xs text-muted-foreground">MapLibre · Multi-layer · QGIS-like panel</span>
      </div>

      <ToolbarStrip>
        <div className="px-3 py-1.5 border-t border-border bg-card flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Dati</span>
            <Button
              variant={state.modules.layerManager ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "layerManager" })}
            >
              <Layers size={13} />
              Layer DB
            </Button>
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => openPanel("geopackage")}>
              <Layers3 size={13} />
              GeoPackage
            </Button>
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => openPanel("shapefile")}>
              <FileArchive size={13} />
              Shapefile
            </Button>
          </div>
          <span className="h-5 border-r border-border" />
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Sorgenti</span>
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => openPanel("sources")}>
              <Workflow size={13} />
              SourceLoader (WMS/XYZ)
            </Button>
          </div>
          <span className="h-5 border-r border-border" />
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Output</span>
            <Button
              variant={state.modules.snapshot ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => dispatch({ type: "TOGGLE_MODULE", module: "snapshot" })}
            >
              <Camera size={13} />
              MapExporter
            </Button>
          </div>
        </div>
        <TerrainPanel />
        <StyleRendererPanel />
      </ToolbarStrip>

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-72 border-r border-border bg-card/70">
          <LayerPanel />
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 relative min-h-[360px] overflow-hidden [&_.maplibregl-control-container]:hidden">
            <div ref={mapContainerRef} className="h-full w-full" />
            {state.modules.geocoder && (
              <Geocoder mapRef={mapRef} position="top-right" />
            )}
            {state.modules.layerManager && (
              <div className="absolute left-0 top-0 bottom-0 w-72 z-30 bg-background/95 backdrop-blur-sm border-r border-border shadow-xl">
                <LayerManager
                  cantiereId={Number(cid)}
                  onClose={() => dispatch({ type: "TOGGLE_MODULE", module: "layerManager" })}
                />
              </div>
            )}
            {mapUnsupported && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
                WebGL non disponibile: impossibile visualizzare la mappa.
              </div>
            )}
          </div>
          <AttributeTable />
          <div className="px-4 py-1 border-t border-border text-xs text-muted-foreground flex flex-wrap items-center gap-3 bg-card/60">
            <span>
              Stato mappa:{" "}
              <span className={mapLoaded ? "text-emerald-500" : "text-amber-500"}>
                {mapLoaded ? "caricata" : "in caricamento"}
              </span>
            </span>
            <span>
              Probe tile OSM:{" "}
              <span className={tileProbeStatus === "ok" ? "text-emerald-500" : tileProbeStatus === "error" ? "text-red-500" : ""}>
                {tileProbeStatus === "ok" ? "ok" : tileProbeStatus === "error" ? "errore" : "test..."}
              </span>
            </span>
            <span>Zoom: <span className="font-medium text-foreground">{zoomLevel.toFixed(2)}</span></span>
            <span>Scala visibilita: <span className="font-medium text-foreground">{scaleLabel}</span></span>
            <span>CRS progetto: <span className="font-medium text-foreground">{activeLayerCrs}</span></span>
            <span>Schizzi: <span className="font-medium text-foreground">{drawFeatureCount}</span></span>
            {activeLayer && (
              <span>
                Layer attivo: <span className="font-medium text-foreground">{activeLayer.tableName}</span>
              </span>
            )}
            <span>
              Snapshot salvati: <span className="font-medium text-foreground">{snapshots.length}</span>
            </span>
            {mapLoadError && <span className="text-red-500 truncate">{mapLoadError}</span>}
            {canvasDiag && <span className="text-amber-500 truncate">{canvasDiag}</span>}
          </div>
        </section>
      </div>

      <MapExporter
        open={state.modules.snapshot}
        onOpenChange={(open) => {
          if (open !== state.modules.snapshot) {
            dispatch({ type: "TOGGLE_MODULE", module: "snapshot" });
          }
        }}
        cantiereId={Number(cid)}
        mapRef={mapRef}
        basemap={state.basemap}
        activeLayerName={activeLayer?.tableName || null}
        visibleLayerNames={visibleLayerNames}
      />
      {state.modules.print && (
        <PrintMap
          mapRef={mapRef}
          onClose={() => dispatch({ type: "TOGGLE_MODULE", module: "print" })}
        />
      )}

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl p-0">
          <div className="h-full flex flex-col">
            <SheetHeader className="px-5 py-4 border-b border-border">
              <SheetTitle>Strumenti WebMap</SheetTitle>
              <SheetDescription>
                Gestione sorgenti e import in una sidebar apribile, senza coprire la mappa.
              </SheetDescription>
            </SheetHeader>

            <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={panelTab === "geopackage" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setPanelTab("geopackage")}
              >
                <Layers3 size={13} />
                GeoPackage
              </Button>
              <Button
                size="sm"
                variant={panelTab === "sources" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setPanelTab("sources")}
              >
                <Workflow size={13} />
                SourceLoader
              </Button>
              <Button
                size="sm"
                variant={panelTab === "shapefile" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setPanelTab("shapefile")}
              >
                <FileArchive size={13} />
                Shapefile
              </Button>
              <Button
                size="sm"
                variant={panelTab === "snapshot" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setPanelTab("snapshot")}
              >
                <Camera size={13} />
                Snapshot
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {panelTab === "geopackage" && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-3 items-end">
                    <div>
                      <Label>GeoPackage / SpatiaLite</Label>
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
                  </div>
                  <div className="grid grid-cols-[180px_auto] gap-3 items-end">
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
                </div>
              )}

              {panelTab === "sources" && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-[140px_1fr] gap-3 items-end">
                    <div>
                      <Label>Tipo sorgente</Label>
                      <Select value={remoteType} onValueChange={(value) => setRemoteType(value as RemoteSourceType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="xyz">XYZ</SelectItem>
                          <SelectItem value="wms">WMS</SelectItem>
                          <SelectItem value="wmts">WMTS</SelectItem>
                          <SelectItem value="wfs">WFS (GeoJSON)</SelectItem>
                          <SelectItem value="arcgis">ArcGIS REST</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>URL sorgente</Label>
                      <Input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://..." />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3 items-end">
                    <div>
                      <Label>Layer/TipoName</Label>
                      <Input
                        value={remoteLayerName}
                        onChange={(event) => setRemoteLayerName(event.target.value)}
                        placeholder={remoteType === "wms" ? "nome layer WMS" : remoteType === "wfs" ? "typeName WFS" : "opzionale"}
                      />
                    </div>
                    <div>
                      <Label>Titolo layer</Label>
                      <Input value={remoteTitle} onChange={(event) => setRemoteTitle(event.target.value)} placeholder="Titolo in legenda" />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3 items-end">
                    <div>
                      <Label>Attribution (opzionale)</Label>
                      <Input value={remoteAttribution} onChange={(event) => setRemoteAttribution(event.target.value)} placeholder="Fonte layer" />
                    </div>
                    <div>
                      <Label>Preset italiani</Label>
                      <Select
                        value={selectedPresetId}
                        onValueChange={(presetId) => {
                          setSelectedPresetId(presetId);
                          const preset = ITALIAN_SOURCE_PRESETS.find((item) => item.id === presetId);
                          if (!preset) return;
                          setRemoteType(preset.type);
                          setRemoteUrl(preset.url);
                          setRemoteLayerName(preset.layerName || "");
                          setRemoteAttribution(preset.attribution || "");
                          setRemoteTitle(preset.label);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona preset..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ITALIAN_SOURCE_PRESETS.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    className="gap-2"
                    onClick={() => sourceLoaderMutation.mutate()}
                    disabled={sourceLoaderMutation.isPending}
                  >
                    <Globe2 size={14} />
                    <RefreshCcw size={14} className={sourceLoaderMutation.isPending ? "animate-spin" : ""} />
                    Aggiungi sorgente
                  </Button>
                </div>
              )}

              {panelTab === "shapefile" && (
                <div className="space-y-4">
                  <div>
                    <Label>Shapefile (.zip)</Label>
                    <Input
                      type="file"
                      accept=".zip"
                      onChange={(event) => setSelectedShapefile(event.target.files?.[0] || null)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => shapefileMutation.mutate()}
                    disabled={!selectedShapefile || shapefileMutation.isPending}
                  >
                    {shapefileMutation.isPending ? "Import..." : "Importa Shapefile"}
                  </Button>
                </div>
              )}

              {panelTab === "snapshot" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        if (!state.modules.snapshot) {
                          dispatch({ type: "TOGGLE_MODULE", module: "snapshot" });
                        }
                      }}
                    >
                      <Camera size={14} />
                      Apri MapExporter
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => exportSketchesMutation.mutate()}
                      disabled={exportSketchesMutation.isPending || drawFeatureCount === 0}
                    >
                      <Download size={14} />
                      {exportSketchesMutation.isPending ? "Esporto..." : "Esporta schizzi .gpkg"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="gap-2"
                      onClick={clearCustomLayers}
                      disabled={state.layers.length === 0}
                    >
                      Reset layer custom
                    </Button>
                  </div>
                  {snapshots.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {snapshots.slice(0, 20).map((snapshot) => (
                        <a
                          key={snapshot.id}
                          href={snapshot.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] rounded border border-border px-2 py-1 hover:bg-muted"
                        >
                          {snapshot.titolo}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="text-xs text-amber-700 space-y-1 rounded border border-amber-700/40 bg-amber-500/10 p-2">
                  {warnings.map((warning) => (
                    <p key={warning}>- {warning}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
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
