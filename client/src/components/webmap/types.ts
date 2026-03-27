export type GeometryKind = "Point" | "LineString" | "Polygon" | "Mixed" | "Unknown";

export type LayerStyle = {
  fillColor: string;
  strokeColor: string;
  fillOpacity: number;
  strokeWidth: number;
};

export type LayerSourceKind = "vector" | "raster";

export type RasterLayerConfig = {
  protocol: "xyz" | "wms" | "wmts";
  tiles: string[];
  tileSize?: number;
  attribution?: string;
};

export type FeatureGeometry = {
  type: string;
  coordinates: unknown;
};

export type Feature = {
  type: "Feature";
  geometry: FeatureGeometry | null;
  properties: Record<string, unknown>;
  id?: string | number;
};

export type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

export type WebMapTable = {
  tableName: string;
  dataType: string;
  rowCount: number;
  geometryColumn: string | null;
  srid: number | null;
};

export type WebMapPreviewPayload = {
  sourceFileName: string;
  tableName: string;
  tables: WebMapTable[];
  featureCollection: FeatureCollection;
  styleHint: {
    strokeColor: string;
    fillColor: string;
    fillOpacity: number;
    weight: number;
  };
  warnings: string[];
};

export type MapLayer = {
  id: string;
  sourceFileName: string;
  tableName: string;
  sourceSrid?: number | null;
  rowCount: number;
  geometryKind: GeometryKind;
  sourceKind: LayerSourceKind;
  visible: boolean;
  opacity: number;
  style: LayerStyle;
  featureCollection: FeatureCollection;
  rasterConfig?: RasterLayerConfig;
};

export type BasemapId = "none" | "osm" | "satellite_esri" | "topo";
export type DemSource = "jaxa" | "copernicus";
export type StyleRendererMode = "simple" | "graduated";

export type StyleRendererConfig = {
  layerId: string;
  mode: StyleRendererMode;
  field: string;
  colorRamp: string[];
  breaks: number[];
};

export type ActiveModules = {
  terrain: boolean;
  demSource: DemSource;
  terrainExaggeration: number;
  buildings3d: boolean;
  measure: boolean;
  export: boolean;
  inspect: boolean;
  styleRenderer: boolean;
  attributeTable: boolean;
  geocoder: boolean;
  print: boolean;
  snapshot: boolean;
  layerManager: boolean;
};

export type ActiveModuleKey = keyof Omit<ActiveModules, "demSource" | "terrainExaggeration">;

export type WebMapState = {
  layers: MapLayer[];
  activeLayerId: string | null;
  selectedFeatureId: number | null;
  basemap: BasemapId;
  modules: ActiveModules;
  styleRenderer: StyleRendererConfig | null;
};

export type WebMapAction =
  | { type: "ADD_LAYER"; layer: MapLayer }
  | { type: "SYNC_LAYER"; layer: MapLayer }
  | { type: "REMOVE_LAYER"; id: string }
  | { type: "SET_ACTIVE"; id: string | null }
  | { type: "SET_SELECTED_FEATURE"; id: number | null }
  | { type: "TOGGLE_VISIBLE"; id: string }
  | { type: "SET_OPACITY"; id: string; opacity: number }
  | { type: "SET_STYLE"; id: string; style: Partial<LayerStyle> }
  | { type: "MOVE_LAYER"; fromIndex: number; toIndex: number }
  | { type: "SET_BASEMAP"; basemap: BasemapId }
  | { type: "TOGGLE_MODULE"; module: ActiveModuleKey }
  | { type: "SET_DEM_SOURCE"; source: DemSource }
  | { type: "SET_TERRAIN_EXAGGERATION"; value: number }
  | { type: "SET_STYLE_RENDERER"; config: StyleRendererConfig | null };

export type MapSnapshotRecord = {
  id: number;
  cantiereId: number;
  titolo: string;
  didascalia: string | null;
  tags: string | null;
  percorso: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bounds: string | null;
  center: string | null;
  zoom: number | null;
  bearing: number | null;
  pitch: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type WebMapLayer = {
  id: number;
  cantiereId: number;
  tableName: string;
  displayName: string;
  sourceFileName: string;
  sourceFormat: "gpkg" | "geojson" | "kml" | "csv";
  sridOriginal: number | null;
  featureCount: number;
  geometryType: string | null;
  styleJson: string | null;
  visible: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
};
