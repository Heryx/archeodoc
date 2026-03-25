export type GeometryKind = "Point" | "LineString" | "Polygon" | "Mixed" | "Unknown";

export type LayerStyle = {
  fillColor: string;
  strokeColor: string;
  fillOpacity: number;
  strokeWidth: number;
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
  rowCount: number;
  geometryKind: GeometryKind;
  visible: boolean;
  opacity: number;
  style: LayerStyle;
  featureCollection: FeatureCollection;
};

export type BasemapId = "osm" | "satellite_esri" | "topo";
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
  measure: boolean;
  export: boolean;
  inspect: boolean;
  styleRenderer: boolean;
  attributeTable: boolean;
};

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
  | { type: "REMOVE_LAYER"; id: string }
  | { type: "SET_ACTIVE"; id: string | null }
  | { type: "SET_SELECTED_FEATURE"; id: number | null }
  | { type: "TOGGLE_VISIBLE"; id: string }
  | { type: "SET_OPACITY"; id: string; opacity: number }
  | { type: "SET_STYLE"; id: string; style: Partial<LayerStyle> }
  | { type: "MOVE_LAYER"; fromIndex: number; toIndex: number }
  | { type: "SET_BASEMAP"; basemap: BasemapId }
  | { type: "TOGGLE_MODULE"; module: keyof Omit<ActiveModules, "demSource" | "terrainExaggeration"> }
  | { type: "SET_DEM_SOURCE"; source: DemSource }
  | { type: "SET_TERRAIN_EXAGGERATION"; value: number }
  | { type: "SET_STYLE_RENDERER"; config: StyleRendererConfig | null };
