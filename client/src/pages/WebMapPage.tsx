import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import {
  Map as MapIcon,
  X,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Link,
  FileBox,
  ImageIcon,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getProjectHeader } from "@/lib/project";
import { apiRequest } from "@/lib/queryClient";

// ─── tipi ────────────────────────────────────────────────────────────────────
type FeatureProps = {
  id: number;
  us_id: number | null;
  codice_us: string | null;
  tipo: string | null;
  qc_status: string | null;
  geom_type: string;
  label: string | null;
  colore: string | null;
  has_allegati: boolean;
  gpkg_source: string | null;
};

type UsItem = { id: number; codiceUs: string; tipo: string | null };
type AllegatoItem = { id: number; tipo: string; nomeFile: string; mimeType: string | null };
type UsDetail = {
  id: number; codiceUs: string; tipo: string | null; definizione: string | null;
  descrizione: string | null; periodoIniziale: string | null; periodoFinale: string | null;
  settore: string | null; qcStatus: string | null;
};

// ─── colore per qc_status ─────────────────────────────────────────────────────
function qcColor(status: string | null): string {
  if (status === "ok") return "#22c55e";
  if (status === "warning") return "#f59e0b";
  if (status === "error") return "#ef4444";
  return "#3b82f6";
}

// ─── componente principale ───────────────────────────────────────────────────
export function WebMapPage() {
  const { cid } = useParams<{ cid: string }>() as { cid: string };
  const { toast } = useToast();
  const qc = useQueryClient();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // side panel
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);
  const [selectedUsId, setSelectedUsId] = useState<number | null>(null);

  // dialog associazione US
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogFeatureId, setLinkDialogFeatureId] = useState<number | null>(null);
  const [selectedUsForLink, setSelectedUsForLink] = useState<string>("");

  // import gpkg
  const [gpkgFile, setGpkgFile] = useState<File | null>(null);
  const [importPanelOpen, setImportPanelOpen] = useState(false);

  // draw mode
  const [drawMode, setDrawMode] = useState<"none" | "polygon" | "line" | "point">("none");

  // ─── fetch dati ─────────────────────────────────────────────────────────────
  const { data: featureCollection, refetch: refetchFeatures } = useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["/api/cantieri", cid, "webgis/features"],
    queryFn: async () => {
      const res = await fetch(`/api/cantieri/${cid}/webgis/features`, { headers: getProjectHeader() });
      if (!res.ok) throw new Error("Errore caricamento features");
      return res.json();
    },
    enabled: !!cid,
  });

  const { data: usList = [] } = useQuery<UsItem[]>({
    queryKey: ["/api/cantieri", cid, "us"],
    queryFn: async () => {
      const res = await fetch(`/api/cantieri/${cid}/us`, { headers: getProjectHeader() });
      if (!res.ok) throw new Error("Errore caricamento US");
      return res.json();
    },
    enabled: !!cid,
  });

  const { data: selectedUs } = useQuery<UsDetail>({
    queryKey: ["/api/us", selectedUsId],
    queryFn: async () => {
      const res = await fetch(`/api/us/${selectedUsId}`, { headers: getProjectHeader() });
      if (!res.ok) throw new Error("Errore caricamento US");
      return res.json();
    },
    enabled: !!selectedUsId,
  });

  const { data: selectedUsAllegati = [] } = useQuery<AllegatoItem[]>({
    queryKey: ["/api/cantieri", cid, "allegati", "us", selectedUsId],
    queryFn: async () => {
      const res = await fetch(`/api/cantieri/${cid}/allegati?usId=${selectedUsId}`, { headers: getProjectHeader() });
      if (!res.ok) throw new Error("Errore caricamento allegati");
      return res.json();
    },
    enabled: !!selectedUsId,
  });

  // ─── mutations ──────────────────────────────────────────────────────────────
  const createFeatureMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch(`/api/cantieri/${cid}/webgis/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getProjectHeader() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Errore creazione geometria");
      return res.json();
    },
    onSuccess: (data) => {
      refetchFeatures();
      // Apri dialog associazione subito dopo la creazione
      setLinkDialogFeatureId(data.id);
      setLinkDialogOpen(true);
    },
    onError: () => toast({ title: "Errore", description: "Impossibile salvare la geometria", variant: "destructive" }),
  });

  const linkUsMutation = useMutation({
    mutationFn: async ({ featureId, usId }: { featureId: number; usId: number | null }) => {
      const res = await fetch(`/api/webgis/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getProjectHeader() },
        body: JSON.stringify({ us_id: usId }),
      });
      if (!res.ok) throw new Error("Errore associazione US");
      return res.json();
    },
    onSuccess: () => {
      refetchFeatures();
      toast({ title: "Associazione salvata" });
    },
  });

  const deleteFeatureMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/webgis/features/${id}`, {
        method: "DELETE",
        headers: getProjectHeader(),
      });
      if (!res.ok) throw new Error("Errore eliminazione");
    },
    onSuccess: () => { refetchFeatures(); setSidePanelOpen(false); },
  });

  const importGpkgMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/cantieri/${cid}/webgis/import-gpkg`, {
        method: "POST",
        headers: getProjectHeader(),
        body: formData,
      });
      if (!res.ok) throw new Error("Errore import GeoPackage");
      return res.json();
    },
    onSuccess: (data) => {
      refetchFeatures();
      toast({ title: "Import completato", description: `${data.imported} geometrie importate` });
      setImportPanelOpen(false);
    },
    onError: (e: any) => toast({ title: "Errore import", description: e.message, variant: "destructive" }),
  });

  // ─── inizializzazione mappa ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [12.5, 41.9],
      zoom: 6,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
    }) as unknown as MapboxDraw;

    map.addControl(draw as any);
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-left");

    mapRef.current = map;
    drawRef.current = draw;

    map.on("load", () => {
      // Source geometrie US
      map.addSource("us-geometries", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Poligoni fill
      map.addLayer({
        id: "us-polygons-fill",
        type: "fill",
        source: "us-geometries",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "qc_status"], "ok"], "#22c55e",
            ["==", ["get", "qc_status"], "warning"], "#f59e0b",
            ["==", ["get", "qc_status"], "error"], "#ef4444",
            ["==", ["get", "us_id"], null], "#94a3b8",
            "#3b82f6",
          ],
          "fill-opacity": 0.32,
        },
      });

      // Poligoni outline
      map.addLayer({
        id: "us-polygons-outline",
        type: "line",
        source: "us-geometries",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": "#1e3a5f", "line-width": 1.8 },
      });

      // Linee
      map.addLayer({
        id: "us-lines",
        type: "line",
        source: "us-geometries",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#7c3aed", "line-width": 2.5 },
      });

      // Punti
      map.addLayer({
        id: "us-points",
        type: "circle",
        source: "us-geometries",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "case",
            ["!=", ["get", "us_id"], null], "#f97316",
            "#94a3b8",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      // Label codice US
      map.addLayer({
        id: "us-labels",
        type: "symbol",
        source: "us-geometries",
        filter: ["!=", ["get", "codice_us"], null],
        layout: {
          "text-field": ["get", "codice_us"],
          "text-size": 11,
          "text-offset": [0, -1.2],
          "text-anchor": "bottom",
        },
        paint: {
          "text-color": "#1e293b",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Click handlers
      ["us-polygons-fill", "us-lines", "us-points"].forEach((layerId) => {
        map.on("click", layerId, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const props = feature.properties as FeatureProps;
          if (props.us_id) {
            setSelectedFeatureId(props.id);
            setSelectedUsId(props.us_id);
            setSidePanelOpen(true);
          } else {
            setLinkDialogFeatureId(props.id);
            setSelectedUsForLink("");
            setLinkDialogOpen(true);
          }
        });
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      });

      setMapReady(true);
    });

    // Draw events
    map.on("draw.create" as any, (e: any) => {
      const feature = e.features?.[0];
      if (!feature?.geometry) return;
      const geomType = feature.geometry.type.toLowerCase().replace("multi", "");
      createFeatureMutation.mutate({ geometry: feature.geometry, geom_type: geomType });
      // Rimuovi dalla draw source dopo il salvataggio
      setTimeout(() => drawRef.current?.deleteAll(), 100);
      setDrawMode("none");
    });

    map.on("draw.update" as any, (e: any) => {
      const feature = e.features?.[0];
      if (!feature) return;
      // update geometria esistente se ha proprietà id
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  // ─── aggiorna source quando arrivano nuove features ──────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("us-geometries") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      featureCollection ?? { type: "FeatureCollection", features: [] }
    );

    // Fit bounds se ci sono features
    if (featureCollection?.features?.length) {
      try {
        const coords: [number, number][] = [];
        for (const f of featureCollection.features) {
          const g = (f as any).geometry;
          if (!g) continue;
          if (g.type === "Point") coords.push(g.coordinates as [number, number]);
          else if (g.type === "LineString") coords.push(...(g.coordinates as [number, number][]));
          else if (g.type === "Polygon") coords.push(...(g.coordinates[0] as [number, number][]));
        }
        if (coords.length > 0) {
          const lngs = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          mapRef.current.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 40, maxZoom: 20, duration: 800 }
          );
        }
      } catch {
        // ignora
      }
    }
  }, [featureCollection, mapReady]);

  // ─── handlers ────────────────────────────────────────────────────────────────
  const activateDraw = useCallback((mode: "polygon" | "line" | "point") => {
    const draw = drawRef.current;
    if (!draw) return;
    setDrawMode(mode);
    if (mode === "polygon") (draw as any).changeMode("draw_polygon");
    else if (mode === "line") (draw as any).changeMode("draw_line_string");
    else if (mode === "point") (draw as any).changeMode("draw_point");
  }, []);

  const cancelDraw = useCallback(() => {
    drawRef.current?.changeMode("simple_select" as any);
    setDrawMode("none");
  }, []);

  const handleLinkUs = useCallback(async () => {
    if (!linkDialogFeatureId) return;
    await linkUsMutation.mutateAsync({
      featureId: linkDialogFeatureId,
      usId: selectedUsForLink ? Number(selectedUsForLink) : null,
    });
    setLinkDialogOpen(false);
    setSelectedUsForLink("");
    setLinkDialogFeatureId(null);
  }, [linkDialogFeatureId, selectedUsForLink, linkUsMutation]);

  const unassociatedCount = useMemo(
    () => featureCollection?.features?.filter((f: any) => f.properties?.us_id == null).length ?? 0,
    [featureCollection]
  );

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center px-4 py-2 border-b border-border bg-background z-10 shrink-0">
        <div className="flex items-center gap-1 text-sm font-semibold">
          <MapIcon size={16} className="text-primary" />
          WebGIS
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Disegno */}
        <Button
          size="sm" variant={drawMode === "polygon" ? "default" : "outline"}
          onClick={() => drawMode === "polygon" ? cancelDraw() : activateDraw("polygon")}
        >
          <Plus size={13} className="mr-1" /> Poligono
        </Button>
        <Button
          size="sm" variant={drawMode === "line" ? "default" : "outline"}
          onClick={() => drawMode === "line" ? cancelDraw() : activateDraw("line")}
        >
          <Pencil size={13} className="mr-1" /> Linea
        </Button>
        <Button
          size="sm" variant={drawMode === "point" ? "default" : "outline"}
          onClick={() => drawMode === "point" ? cancelDraw() : activateDraw("point")}
        >
          <Plus size={13} className="mr-1" /> Punto
        </Button>

        {drawMode !== "none" && (
          <Button size="sm" variant="ghost" onClick={cancelDraw}>
            <X size={13} className="mr-1" /> Annulla disegno
          </Button>
        )}

        <div className="h-4 w-px bg-border" />

        {/* Import GeoPackage */}
        <Button
          size="sm" variant="outline"
          onClick={() => setImportPanelOpen((v) => !v)}
        >
          <Upload size={13} className="mr-1" /> Importa GeoPackage
        </Button>

        {unassociatedCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {unassociatedCount} geometrie non associate
          </Badge>
        )}
      </div>

      {/* Import panel */}
      {importPanelOpen && (
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex gap-3 items-end shrink-0">
          <div>
            <Label className="text-xs">File GeoPackage (.gpkg)</Label>
            <Input
              type="file" accept=".gpkg,.sqlite" className="h-8 text-xs"
              onChange={(e) => setGpkgFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            size="sm"
            disabled={!gpkgFile || importGpkgMutation.isPending}
            onClick={() => gpkgFile && importGpkgMutation.mutate(gpkgFile)}
          >
            <FileBox size={13} className="mr-1" />
            {importGpkgMutation.isPending ? "Importo..." : "Importa"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setImportPanelOpen(false)}>
            <X size={13} />
          </Button>
        </div>
      )}

      {/* Mappa + Side panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mappa */}
        <div
          ref={mapContainerRef}
          className="flex-1"
          style={{ minHeight: 0 }}
        />

        {/* Side panel US */}
        {sidePanelOpen && selectedUs && (
          <div className="w-80 border-l border-border flex flex-col bg-background shrink-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <p className="font-semibold text-sm">{selectedUs.codiceUs}</p>
                {selectedUs.tipo && (
                  <p className="text-xs text-muted-foreground">{selectedUs.tipo}</p>
                )}
              </div>
              <div className="flex gap-1">
                {selectedFeatureId && (
                  <Button
                    size="icon" variant="ghost"
                    title="Scollega geometria"
                    onClick={() => {
                      linkUsMutation.mutate({ featureId: selectedFeatureId, usId: null });
                      setSidePanelOpen(false);
                    }}
                  >
                    <Link size={14} />
                  </Button>
                )}
                {selectedFeatureId && (
                  <Button
                    size="icon" variant="ghost"
                    title="Elimina geometria"
                    onClick={() => {
                      if (confirm("Eliminare la geometria?")) {
                        deleteFeatureMutation.mutate(selectedFeatureId);
                      }
                    }}
                  >
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => setSidePanelOpen(false)}>
                  <X size={14} />
                </Button>
              </div>
            </div>

            {/* Contenuto */}
            <ScrollArea className="flex-1 px-4 py-3">
              <div className="space-y-3 text-sm">
                {/* Badge QC */}
                {selectedUs.qcStatus && (
                  <Badge
                    style={{ backgroundColor: qcColor(selectedUs.qcStatus) }}
                    className="text-white"
                  >
                    QC: {selectedUs.qcStatus}
                  </Badge>
                )}

                {/* Campi principali */}
                {selectedUs.definizione && (
                  <div>
                    <p className="text-xs text-muted-foreground">Definizione</p>
                    <p>{selectedUs.definizione}</p>
                  </div>
                )}
                {selectedUs.descrizione && (
                  <div>
                    <p className="text-xs text-muted-foreground">Descrizione</p>
                    <p className="line-clamp-4">{selectedUs.descrizione}</p>
                  </div>
                )}
                {(selectedUs.periodoIniziale || selectedUs.periodoFinale) && (
                  <div>
                    <p className="text-xs text-muted-foreground">Periodo</p>
                    <p>{[selectedUs.periodoIniziale, selectedUs.periodoFinale].filter(Boolean).join(" – ")}</p>
                  </div>
                )}
                {selectedUs.settore && (
                  <div>
                    <p className="text-xs text-muted-foreground">Settore</p>
                    <p>{selectedUs.settore}</p>
                  </div>
                )}

                {/* Allegati */}
                {selectedUsAllegati.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-2 font-semibold">Allegati</p>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedUsAllegati.map((a) => {
                        const isImage = a.mimeType?.startsWith("image/") ||
                          ["foto", "fotogrammetria"].includes(a.tipo);
                        return (
                          <a
                            key={a.id}
                            href={`/api/allegati/${a.id}/file`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded border overflow-hidden hover:ring-2 ring-primary block"
                          >
                            {isImage ? (
                              <div className="relative">
                                <img
                                  src={`/api/allegati/${a.id}/file`}
                                  className="w-full h-20 object-cover"
                                  alt={a.nomeFile}
                                  loading="lazy"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                                <ImageIcon size={12} className="absolute top-1 right-1 text-white drop-shadow" />
                              </div>
                            ) : (
                              <div className="w-full h-20 flex flex-col items-center justify-center bg-muted gap-1 p-1">
                                <FileBox size={18} className="text-muted-foreground" />
                                <span className="text-[10px] text-center line-clamp-2 text-muted-foreground">
                                  {a.nomeFile}
                                </span>
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-border">
              <Button
                className="w-full gap-1" size="sm"
                onClick={() => {
                  window.location.hash = `/cantiere/${cid}/us?us=${selectedUs.id}`;
                }}
              >
                <ExternalLink size={13} /> Apri scheda completa
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog associazione US */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Associa geometria a Unità Stratigrafica</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Seleziona la scheda US da associare a questa geometria, oppure lascia senza associazione.
            </p>
            <Select value={selectedUsForLink} onValueChange={setSelectedUsForLink}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona US..." />
              </SelectTrigger>
              <SelectContent>
                {usList.map((us) => (
                  <SelectItem key={us.id} value={String(us.id)}>
                    {us.codiceUs}{us.tipo ? ` — ${us.tipo}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkDialogOpen(false); setLinkDialogFeatureId(null); }}>
              Chiudi senza associare
            </Button>
            <Button onClick={handleLinkUs} disabled={!selectedUsForLink || linkUsMutation.isPending}>
              {linkUsMutation.isPending ? "Salvo..." : "Associa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
