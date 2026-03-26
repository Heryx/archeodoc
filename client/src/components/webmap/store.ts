import { createContext, useContext, useReducer, useRef, type Dispatch, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import type { LayerStyle, MapLayer, WebMapAction, WebMapState } from "./types";

export const DEFAULT_STYLE: LayerStyle = {
  fillColor: "#2563eb",
  strokeColor: "#1d4ed8",
  fillOpacity: 0.3,
  strokeWidth: 2,
};

const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#65a30d",
  "#ea580c",
  "#0f766e",
];

export function pickColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

const initialState: WebMapState = {
  layers: [],
  activeLayerId: null,
  selectedFeatureId: null,
  basemap: "osm",
  modules: {
    terrain: false,
    demSource: "jaxa",
    terrainExaggeration: 1.5,
    measure: false,
    export: false,
    inspect: false,
    styleRenderer: false,
    attributeTable: false,
    geocoder: false,
    print: false,
    snapshot: false,
    layerManager: false,
  },
  styleRenderer: null,
};

function nextActiveLayerAfterDelete(layers: MapLayer[], deletedId: string, current: string | null) {
  if (current !== deletedId) return current;
  const remaining = layers.filter((layer) => layer.id !== deletedId);
  if (remaining.length === 0) return null;
  return remaining[remaining.length - 1].id;
}

function reducer(state: WebMapState, action: WebMapAction): WebMapState {
  switch (action.type) {
    case "ADD_LAYER":
      return {
        ...state,
        layers: [...state.layers, action.layer],
        activeLayerId: action.layer.id,
      };
    case "SYNC_LAYER": {
      const existing = state.layers.find((layer) => layer.id === action.layer.id);
      if (existing) {
        const hasIncomingFeatures =
          Array.isArray(action.layer.featureCollection?.features) &&
          action.layer.featureCollection.features.length > 0;
        return {
          ...state,
          layers: state.layers.map((layer) =>
            layer.id === action.layer.id
              ? {
                  ...layer,
                  sourceFileName: action.layer.sourceFileName,
                  tableName: action.layer.tableName,
                  sourceSrid: action.layer.sourceSrid,
                  geometryKind: action.layer.geometryKind,
                  sourceKind: action.layer.sourceKind,
                  visible: action.layer.visible,
                  opacity: action.layer.opacity,
                  style: action.layer.style,
                  rowCount: action.layer.rowCount,
                  featureCollection: hasIncomingFeatures
                    ? action.layer.featureCollection
                    : layer.featureCollection,
                }
              : layer,
          ),
        };
      }
      return { ...state, layers: [...state.layers, action.layer] };
    }
    case "REMOVE_LAYER":
      return {
        ...state,
        layers: state.layers.filter((layer) => layer.id !== action.id),
        activeLayerId: nextActiveLayerAfterDelete(state.layers, action.id, state.activeLayerId),
        selectedFeatureId: state.activeLayerId === action.id ? null : state.selectedFeatureId,
      };
    case "SET_ACTIVE":
      return { ...state, activeLayerId: action.id, selectedFeatureId: null };
    case "SET_SELECTED_FEATURE":
      return { ...state, selectedFeatureId: action.id };
    case "TOGGLE_VISIBLE":
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, visible: !layer.visible } : layer,
        ),
      };
    case "SET_OPACITY":
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, opacity: action.opacity } : layer,
        ),
      };
    case "SET_STYLE":
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, style: { ...layer.style, ...action.style } } : layer,
        ),
      };
    case "MOVE_LAYER": {
      const layers = [...state.layers];
      if (
        action.fromIndex < 0 ||
        action.fromIndex >= layers.length ||
        action.toIndex < 0 ||
        action.toIndex >= layers.length
      ) {
        return state;
      }
      const [moved] = layers.splice(action.fromIndex, 1);
      layers.splice(action.toIndex, 0, moved);
      return { ...state, layers };
    }
    case "SET_BASEMAP":
      return { ...state, basemap: action.basemap };
    case "TOGGLE_MODULE":
      return {
        ...state,
        modules: {
          ...state.modules,
          [action.module]: !state.modules[action.module],
        },
      };
    case "SET_DEM_SOURCE":
      return {
        ...state,
        modules: { ...state.modules, demSource: action.source },
      };
    case "SET_TERRAIN_EXAGGERATION":
      return {
        ...state,
        modules: { ...state.modules, terrainExaggeration: action.value },
      };
    case "SET_STYLE_RENDERER":
      return { ...state, styleRenderer: action.config };
    default:
      return state;
  }
}

export type WebMapContextValue = {
  state: WebMapState;
  dispatch: Dispatch<WebMapAction>;
  mapRef: MutableRefObject<maplibregl.Map | null>;
};

export const WebMapContext = createContext<WebMapContextValue | null>(null);

export function useWebMapStore(): WebMapContextValue {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mapRef = useRef<maplibregl.Map | null>(null);
  return { state, dispatch, mapRef };
}

export function useWebMap() {
  const context = useContext(WebMapContext);
  if (!context) throw new Error("useWebMap must be used inside WebMapContext.Provider");
  return context;
}
