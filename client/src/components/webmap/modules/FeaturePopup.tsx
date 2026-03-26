import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { createRoot, type Root } from "react-dom/client";
import { ExternalLink, Info, Layers, Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getProjectHeader } from "@/lib/project";
import type { WebMapLayer } from "@/components/webmap/types";

type ClickedFeature = {
  layerId: number;
  layerName: string;
  properties: Record<string, unknown>;
  lngLat: { lng: number; lat: number };
};

type UsRecord = {
  codiceUS?: string;
  tipo?: string | null;
  definizione?: string | null;
  descrizione?: string | null;
  datazione?: string | null;
};

function guessUSCode(properties: Record<string, unknown>): string | null {
  const candidates = [
    "codice_us",
    "codiceus",
    "codice",
    "us_code",
    "us",
    "us_id",
    "id_us",
    "codiceUS",
    "codiceUs",
  ];
  for (const key of candidates) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function filterProps(properties: Record<string, unknown>): Array<[string, string]> {
  const skip = new Set(["fid", "ogc_fid", "gid", "objectid", "shape_area", "shape_len"]);
  return Object.entries(properties)
    .filter(([key, value]) => !skip.has(key.toLowerCase()) && value != null && value !== "")
    .map(([key, value]) => [key, String(value)]);
}

function formatCoord(value: number, digits = 6) {
  return value.toFixed(digits);
}

function FeaturePopupBody({
  feature,
  cantiereId,
  onClose,
  onNavigateUS,
}: {
  feature: ClickedFeature;
  cantiereId: number;
  onClose: () => void;
  onNavigateUS?: (codiceUS: string) => void;
}) {
  const usCode = guessUSCode(feature.properties);
  const visibleProps = filterProps(feature.properties);
  const [usLoading, setUsLoading] = useState(false);
  const [usData, setUsData] = useState<UsRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!usCode) {
      setUsData(null);
      return () => {
        cancelled = true;
      };
    }

    setUsLoading(true);
    setUsData(null);
    fetch(`/api/cantieri/${cantiereId}/us?codice=${encodeURIComponent(usCode)}`, {
      headers: getProjectHeader(),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json().catch(() => []);
        if (!Array.isArray(payload)) return null;
        const exact = payload.find((item: any) =>
          String(item?.codiceUS || "").toLowerCase() === usCode.toLowerCase(),
        );
        return (exact || payload[0] || null) as UsRecord | null;
      })
      .then((resolved) => {
        if (!cancelled) setUsData(resolved);
      })
      .catch(() => {
        if (!cancelled) setUsData(null);
      })
      .finally(() => {
        if (!cancelled) setUsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cantiereId, usCode]);

  return (
    <div className="flex flex-col max-h-[480px] min-w-[260px] max-w-[320px]">
      <div className="flex items-center justify-between px-3 py-2 bg-primary text-primary-foreground rounded-t-lg">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers size={13} className="shrink-0" />
          <span className="text-xs font-medium truncate">{feature.layerName}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b border-border text-[10px] text-muted-foreground">
        <MapPin size={10} />
        {formatCoord(feature.lngLat.lat)}°N, {formatCoord(feature.lngLat.lng)}°E
      </div>

      <div className="overflow-auto flex-1 px-3 py-2 space-y-3">
        {usCode && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-primary">
                US correlata
              </span>
              {usLoading && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
            </div>

            {usData ? (
              <div className="space-y-0.5">
                <p className="text-sm font-bold">{usData.codiceUS}</p>
                {usData.tipo && <p className="text-[11px] text-muted-foreground">{usData.tipo}</p>}
                {usData.definizione && (
                  <p className="text-[11px] text-muted-foreground italic">{usData.definizione}</p>
                )}
                {usData.descrizione && <p className="text-[11px] mt-1">{usData.descrizione}</p>}
                {usData.datazione && (
                  <p className="text-[11px] text-muted-foreground">📅 {usData.datazione}</p>
                )}
                {onNavigateUS && usData.codiceUS && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-6 text-[11px] gap-1 mt-1.5"
                    onClick={() => onNavigateUS(usData.codiceUS!)}
                  >
                    <ExternalLink size={10} />
                    Apri scheda US
                  </Button>
                )}
              </div>
            ) : !usLoading ? (
              <p className="text-[11px] text-muted-foreground">
                Codice US <span className="font-mono font-bold">{usCode}</span> non trovato
              </p>
            ) : null}
          </div>
        )}

        {visibleProps.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
              <Info size={10} />
              Attributi ({visibleProps.length})
            </p>
            <div className="space-y-0.5">
              {visibleProps.map(([key, value]) => (
                <div
                  key={key}
                  className="flex gap-2 text-[11px] border-b border-border/40 pb-0.5 last:border-0"
                >
                  <span className="text-muted-foreground shrink-0 w-28 truncate font-medium">{key}</span>
                  <span className="flex-1 break-all">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {visibleProps.length === 0 && !usCode && (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            Nessun attributo disponibile
          </p>
        )}
      </div>
    </div>
  );
}

export function useFeaturePopup(
  mapRef: React.MutableRefObject<maplibregl.Map | null>,
  layers: WebMapLayer[],
  cantiereId: number,
  onNavigateUS?: (codiceUS: string) => void,
) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupRootRef = useRef<Root | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const interactiveIds = layers.flatMap((layer) => [
      `layer-${layer.id}-fill`,
      `layer-${layer.id}-line`,
      `layer-${layer.id}-circle`,
    ]);

    const closePopup = () => {
      popupRef.current?.remove();
      popupRef.current = null;
      popupRootRef.current?.unmount();
      popupRootRef.current = null;
    };

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const availableLayerIds = interactiveIds.filter((id) => !!map.getLayer(id));
      if (availableLayerIds.length === 0) {
        closePopup();
        return;
      }

      const found = map.queryRenderedFeatures(event.point, { layers: availableLayerIds });
      if (!found.length) {
        closePopup();
        return;
      }

      const feature = found[0];
      const sourceMatch = String(feature.source || "").match(/^layer-(\d+)/);
      const layerId = sourceMatch ? Number(sourceMatch[1]) : -1;
      const layerMeta = layers.find((item) => item.id === layerId);

      const clicked: ClickedFeature = {
        layerId,
        layerName: layerMeta?.displayName || String(feature.source || "Layer"),
        properties: (feature.properties || {}) as Record<string, unknown>,
        lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat },
      };

      closePopup();

      const container = document.createElement("div");
      const root = createRoot(container);
      popupRootRef.current = root;
      root.render(
        <FeaturePopupBody
          feature={clicked}
          cantiereId={cantiereId}
          onClose={closePopup}
          onNavigateUS={onNavigateUS}
        />,
      );

      const popup = new maplibregl.Popup({
        maxWidth: "340px",
        className: "feature-popup-wrapper",
        closeButton: false,
        closeOnClick: false,
      });
      popup
        .setLngLat(event.lngLat)
        .setDOMContent(container)
        .addTo(map);
      popup.on("close", () => {
          popupRootRef.current?.unmount();
          popupRootRef.current = null;
          popupRef.current = null;
        });
      popupRef.current = popup;
    };

    const handleMove = (event: maplibregl.MapMouseEvent) => {
      const availableLayerIds = interactiveIds.filter((id) => !!map.getLayer(id));
      if (!availableLayerIds.length) {
        map.getCanvas().style.cursor = "";
        return;
      }
      const found = map.queryRenderedFeatures(event.point, { layers: availableLayerIds });
      map.getCanvas().style.cursor = found.length ? "pointer" : "";
    };

    map.on("click", handleClick);
    map.on("mousemove", handleMove);

    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMove);
      map.getCanvas().style.cursor = "";
      closePopup();
    };
  }, [mapRef, layers, cantiereId, onNavigateUS]);

  return {
    closePopup: () => popupRef.current?.remove(),
  };
}
