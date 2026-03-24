import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Database, Map as MapIcon, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";

type WebMapTable = {
  tableName: string;
  dataType: string;
  rowCount: number;
  geometryColumn: string | null;
  srid: number | null;
};

type WebMapFeature = {
  type: "Feature";
  geometry: any;
  properties: Record<string, unknown>;
};

type WebMapPreviewPayload = {
  sourceFileName: string;
  tableName: string;
  tables: WebMapTable[];
  featureCollection: {
    type: "FeatureCollection";
    features: WebMapFeature[];
  };
  styleHint: {
    strokeColor: string;
    fillColor: string;
    fillOpacity: number;
    weight: number;
  };
  warnings: string[];
};

function FitGeoJsonBounds({ featureCollection }: { featureCollection: WebMapPreviewPayload["featureCollection"] | null }) {
  const map = useMap();

  useEffect(() => {
    if (!featureCollection || featureCollection.features.length === 0) return;

    try {
      const bounds = L.geoJSON(featureCollection as any).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
      }
    } catch {
      // ignore invalid geometry bounds
    }
  }, [featureCollection, map]);

  return null;
}

function renderPopup(feature: WebMapFeature): string {
  const props = feature.properties || {};
  const entries = Object.entries(props);
  if (entries.length === 0) return "Nessun attributo";
  return entries
    .slice(0, 16)
    .map(([key, value]) => `${key}: ${value ?? "-"}`)
    .join("\n");
}

export function WebMapPage() {
  const { cid } = useParams<{ cid: string }>();
  const { toast } = useToast();

  const [selectedGeoPackage, setSelectedGeoPackage] = useState<File | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [limit, setLimit] = useState("1200");
  const [payload, setPayload] = useState<WebMapPreviewPayload | null>(null);

  const previewMutation = useMutation({
    mutationFn: async ({ keepTable }: { keepTable: boolean }) => {
      if (!selectedGeoPackage) {
        throw new Error("Seleziona un file GeoPackage");
      }

      const formData = new FormData();
      formData.append("file", selectedGeoPackage);
      if (keepTable && selectedTable) {
        formData.append("tableName", selectedTable);
      }
      if (limit.trim()) {
        formData.append("limit", limit.trim());
      }

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
    onSuccess: (result, variables) => {
      setPayload(result);
      if (!variables.keepTable || !selectedTable) {
        setSelectedTable(result.tableName);
      }
      toast({
        title: "WebMap aggiornata",
        description: `${result.featureCollection.features.length} geometrie caricate.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore caricamento webmap",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      }),
  });

  const mapStyle = useMemo(() => {
    if (!payload) {
      return {
        strokeColor: "#2563eb",
        fillColor: "#2563eb",
        fillOpacity: 0.24,
        weight: 2,
      };
    }
    return payload.styleHint;
  }, [payload]);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapIcon size={22} className="text-primary" />
          WebMap GeoPackage
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visualizza layer e attributi del GeoPackage in mappa (interrogabile), con stile automatico se disponibile.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end">
          <div>
            <Label>File GeoPackage</Label>
            <Input
              type="file"
              accept=".gpkg,.sqlite"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setSelectedGeoPackage(file);
                setPayload(null);
                setSelectedTable("");
              }}
            />
          </div>

          <div>
            <Label>Layer</Label>
            <Select value={selectedTable} onValueChange={setSelectedTable} disabled={!payload || payload.tables.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona layer..." />
              </SelectTrigger>
              <SelectContent>
                {(payload?.tables || []).map((table) => (
                  <SelectItem key={table.tableName} value={table.tableName}>
                    {table.tableName} ({table.rowCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Limite feature</Label>
            <Input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="1200" />
          </div>

          <Button
            className="gap-2"
            onClick={() => previewMutation.mutate({ keepTable: true })}
            disabled={!selectedGeoPackage || previewMutation.isPending}
          >
            <RefreshCcw size={15} className={previewMutation.isPending ? "animate-spin" : ""} />
            {previewMutation.isPending ? "Carico..." : "Carica mappa"}
          </Button>
        </div>

        {payload && (
          <div className="text-xs text-muted-foreground">
            File: <span className="font-medium text-foreground">{payload.sourceFileName}</span> | Layer attivo:{" "}
            <span className="font-medium text-foreground">{payload.tableName}</span> | Feature:{" "}
            <span className="font-medium text-foreground">{payload.featureCollection.features.length}</span>
          </div>
        )}
        {payload?.warnings?.length ? (
          <div className="text-xs text-amber-700 space-y-1">
            {payload.warnings.map((warning) => (
              <p key={warning}>- {warning}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-muted/10">
        <MapContainer
          center={[41.9, 12.5]}
          zoom={6}
          scrollWheelZoom
          style={{ height: "62vh", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitGeoJsonBounds featureCollection={payload?.featureCollection || null} />
          {payload && payload.featureCollection.features.length > 0 && (
            <GeoJSON
              data={payload.featureCollection as any}
              style={() => ({
                color: mapStyle.strokeColor,
                fillColor: mapStyle.fillColor,
                fillOpacity: mapStyle.fillOpacity,
                weight: mapStyle.weight,
              })}
              pointToLayer={(_feature, latlng) =>
                L.circleMarker(latlng, {
                  radius: 6,
                  color: mapStyle.strokeColor,
                  fillColor: mapStyle.fillColor,
                  fillOpacity: 0.9,
                  weight: 1.5,
                })
              }
              onEachFeature={(feature, layer) => {
                const text = renderPopup(feature as WebMapFeature);
                layer.bindPopup(`<pre style="white-space:pre-wrap;max-width:280px;margin:0">${text}</pre>`);
              }}
            />
          )}
        </MapContainer>
      </div>

      {payload && payload.featureCollection.features.length === 0 && (
        <div className="text-sm text-muted-foreground">
          Nessuna geometria visualizzabile nel layer selezionato.
        </div>
      )}
    </div>
  );
}

