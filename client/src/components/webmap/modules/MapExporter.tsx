import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { Camera, Download, FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getProjectHeader } from "@/lib/project";
import type { MapSnapshotRecord } from "@/components/webmap/types";

type MapExporterProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cantiereId: number;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  basemap: string;
  activeLayerName?: string | null;
  visibleLayerNames: string[];
};

type ExportTab = "capture" | "library" | "link";

type DocumentazioneTipo = "giornaliera" | "settimanale" | "fine_scavo";

type DocumentazioneRecord = {
  id: number;
  cantiereId: number;
  tipo: DocumentazioneTipo;
  titolo: string;
  dataInizio: string | null;
  dataFine: string | null;
  stato: "bozza" | "completata";
  allegatoId: number | null;
  createdAt: string;
  updatedAt: string;
  allegato?: {
    id: number;
    nomeFile: string;
    url: string;
  } | null;
};

function drawNorthArrow(ctx: CanvasRenderingContext2D) {
  const x = 26;
  const y = 48;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(-14, -30, 28, 44);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -15);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, 8);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawScale(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
  lat: number,
) {
  const metersPerPixel = (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) / (256 * Math.pow(2, zoom));
  const targetPx = 120;
  const rawMeters = metersPerPixel * targetPx;
  const niceSteps = [1, 2, 5];
  const exponent = Math.floor(Math.log10(Math.max(rawMeters, 1)));
  const base = Math.pow(10, exponent);
  let best = base;
  let minDiff = Infinity;
  for (const step of niceSteps) {
    for (const mul of [0.1, 1, 10]) {
      const candidate = step * base * mul;
      const diff = Math.abs(candidate - rawMeters);
      if (diff < minDiff) {
        minDiff = diff;
        best = candidate;
      }
    }
  }

  const px = Math.max(40, Math.round(best / metersPerPixel));
  const x = width - px - 20;
  const y = height - 58;
  const label = best >= 1000 ? `${(best / 1000).toFixed(best >= 10000 ? 0 : 1)} km` : `${Math.round(best)} m`;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x - 8, y - 20, px + 16, 28);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.moveTo(x + px, y - 6);
  ctx.lineTo(x + px, y + 6);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + px / 2, y - 8);
  ctx.restore();
}

async function buildSnapshotDataUrl(input: {
  map: maplibregl.Map;
  title: string;
  caption: string;
  showScale: boolean;
  showNorth: boolean;
}) {
  const { map, title, caption, showScale, showNorth } = input;

  map.triggerRepaint();
  await new Promise<void>((resolve) => {
    if (map.loaded()) {
      requestAnimationFrame(() => resolve());
      return;
    }
    map.once("idle", () => resolve());
  });

  const sourceCanvas = map.getCanvas();
  let rawDataUrl: string;
  try {
    rawDataUrl = sourceCanvas.toDataURL("image/png");
  } catch {
    throw new Error(
      "Canvas bloccato da CORS: la basemap corrente non consente l'export. Passa a OSM o usa una basemap con CORS abilitato.",
    );
  }
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = sourceCanvas.width;
  overlayCanvas.height = sourceCanvas.height;
  const ctx = overlayCanvas.getContext("2d");
  if (!ctx) throw new Error("Impossibile creare canvas offscreen");

  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Render snapshot fallito"));
    image.src = rawDataUrl;
  });
  ctx.drawImage(image, 0, 0);

  const barHeight = caption ? 68 : 46;
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.fillRect(0, overlayCanvas.height - barHeight, overlayCanvas.width, barHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText(title, 14, overlayCanvas.height - barHeight + 22);
  if (caption) {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "12px sans-serif";
    ctx.fillText(caption, 14, overlayCanvas.height - barHeight + 42);
  }
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "11px sans-serif";
  ctx.fillText(new Date().toLocaleString("it-IT"), 14, overlayCanvas.height - 10);

  if (showNorth) drawNorthArrow(ctx);
  if (showScale) drawScale(ctx, overlayCanvas.width, overlayCanvas.height, map.getZoom(), map.getCenter().lat);

  return {
    imageData: overlayCanvas.toDataURL("image/png"),
    width: overlayCanvas.width,
    height: overlayCanvas.height,
  };
}

export function MapExporter({
  open,
  onOpenChange,
  cantiereId,
  mapRef,
  basemap,
  activeLayerName,
  visibleLayerNames,
}: MapExporterProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<ExportTab>("capture");
  const [titolo, setTitolo] = useState("");
  const [didascalia, setDidascalia] = useState("");
  const [tags, setTags] = useState("");
  const [showScale, setShowScale] = useState(true);
  const [showNorth, setShowNorth] = useState(true);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [selectedDocumentazioneId, setSelectedDocumentazioneId] = useState<number | null>(null);
  const [newDocTipo, setNewDocTipo] = useState<DocumentazioneTipo>("giornaliera");
  const [newDocTitolo, setNewDocTitolo] = useState("");
  const [newDocDataInizio, setNewDocDataInizio] = useState("");
  const [newDocDataFine, setNewDocDataFine] = useState("");
  const [linkPosizione, setLinkPosizione] = useState("");
  const [linkedDocMessage, setLinkedDocMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!titolo.trim()) {
      setTitolo(`Snapshot ${new Date().toLocaleString("it-IT")}`);
    }
    if (!didascalia.trim() && activeLayerName) {
      setDidascalia(`Layer attivo: ${activeLayerName}`);
    }
  }, [open, titolo, didascalia, activeLayerName]);

  const queryKey = useMemo(
    () => ["/api/cantieri", String(cantiereId), "map-snapshots"] as const,
    [cantiereId],
  );

  const snapshotsQuery = useQuery<{ snapshots: MapSnapshotRecord[] }>({
    queryKey: [...queryKey],
    queryFn: async () => {
      const response = await fetch(`/api/cantieri/${cantiereId}/map-snapshots`, {
        headers: getProjectHeader(),
      });
      if (!response.ok) throw new Error("Caricamento snapshot fallito");
      return response.json();
    },
    enabled: open,
    staleTime: 10_000,
  });

  const documentazioniQuery = useQuery<{ documentazioni: DocumentazioneRecord[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"],
    queryFn: async () => {
      const response = await fetch(`/api/cantieri/${cantiereId}/documentazioni`, {
        headers: getProjectHeader(),
      });
      if (!response.ok) throw new Error("Caricamento documentazioni fallito");
      return response.json();
    },
    enabled: open,
    staleTime: 10_000,
  });

  const createPreviewMutation = useMutation({
    mutationFn: async () => {
      const map = mapRef.current;
      if (!map) throw new Error("Mappa non disponibile");
      const title = titolo.trim() || "Snapshot mappa";
      const caption = didascalia.trim();
      const rendered = await buildSnapshotDataUrl({
        map,
        title,
        caption,
        showScale,
        showNorth,
      });
      return rendered.imageData;
    },
    onSuccess: (dataUrl) => {
      setPreviewDataUrl(dataUrl);
    },
    onError: (error: any) => {
      toast({
        title: "Errore anteprima",
        description: error?.message || "Impossibile generare l'anteprima",
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const map = mapRef.current;
      if (!map) throw new Error("Mappa non disponibile");
      const title = titolo.trim();
      if (!title) throw new Error("Titolo obbligatorio");

      const caption = didascalia.trim();
      const rendered = await buildSnapshotDataUrl({
        map,
        title,
        caption,
        showScale,
        showNorth,
      });

      const center = map.getCenter();
      const bounds = map.getBounds();
      return (await apiRequest("POST", `/api/cantieri/${cantiereId}/map-snapshots`, {
        titolo: title,
        didascalia: caption || null,
        tags: tags.trim() || null,
        imageData: rendered.imageData,
        width: rendered.width,
        height: rendered.height,
        bounds: JSON.stringify(bounds.toArray()),
        center: JSON.stringify([center.lng, center.lat]),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        basemap,
        layerNames: JSON.stringify(visibleLayerNames),
      })).json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast({ title: "Snapshot salvato in libreria" });
      setTab("library");
    },
    onError: (error: any) => {
      toast({
        title: "Errore salvataggio snapshot",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/map-snapshots/${id}`);
    },
    onSuccess: async (_data, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: [...queryKey] });
      if (selectedSnapshotId === deletedId) {
        setSelectedSnapshotId(null);
        setLinkedDocMessage(null);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Errore eliminazione snapshot",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const createDocumentazioneMutation = useMutation({
    mutationFn: async () => {
      const titolo = newDocTitolo.trim();
      return (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni`, {
        tipo: newDocTipo,
        titolo: titolo || null,
        dataInizio: newDocDataInizio || null,
        dataFine: newDocDataFine || null,
      })).json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] });
      const createdId = Number(data?.documentazione?.id);
      if (Number.isFinite(createdId)) {
        setSelectedDocumentazioneId(createdId);
      }
      toast({ title: "Documentazione creata" });
    },
    onError: (error: any) => {
      toast({
        title: "Errore creazione documentazione",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const linkSnapshotMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSnapshotId) throw new Error("Seleziona uno snapshot");
      if (!selectedDocumentazioneId) throw new Error("Seleziona una documentazione");
      const posizioneRaw = Number(linkPosizione);
      return (await apiRequest("POST", `/api/documentazioni/${selectedDocumentazioneId}/snapshots`, {
        snapshotId: selectedSnapshotId,
        posizione: Number.isFinite(posizioneRaw) ? Math.trunc(posizioneRaw) : undefined,
      })).json();
    },
    onSuccess: async () => {
      const doc = documentazioni.find((item) => item.id === selectedDocumentazioneId);
      setLinkedDocMessage(doc ? `Snapshot collegato a: ${doc.titolo}` : "Snapshot collegato");
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] });
      toast({ title: "Snapshot collegato alla documentazione" });
    },
    onError: (error: any) => {
      toast({
        title: "Errore collegamento snapshot",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const snapshots = snapshotsQuery.data?.snapshots || [];
  const documentazioni = documentazioniQuery.data?.documentazioni || [];

  useEffect(() => {
    if (!open) return;
    if (!selectedSnapshotId && snapshots.length > 0) {
      setSelectedSnapshotId(snapshots[0].id);
    }
  }, [open, snapshots[0]?.id, selectedSnapshotId]);

  useEffect(() => {
    if (!open) return;
    if (!selectedDocumentazioneId && documentazioni.length > 0) {
      setSelectedDocumentazioneId(documentazioni[0].id);
    }
  }, [open, documentazioni[0]?.id, selectedDocumentazioneId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[86vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>MapExporter</DialogTitle>
          <DialogDescription>
            Cattura la mappa con overlay (scala/nord/titolo), salva in libreria e riusa nelle relazioni.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <Button
            variant={tab === "capture" ? "default" : "outline"}
            size="sm"
            className="h-7"
            onClick={() => setTab("capture")}
          >
            Cattura
          </Button>
          <Button
            variant={tab === "library" ? "default" : "outline"}
            size="sm"
            className="h-7"
            onClick={() => setTab("library")}
          >
            Libreria ({snapshots.length})
          </Button>
          <Button
            variant={tab === "link" ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1"
            onClick={() => setTab("link")}
          >
            <FileText size={13} />
            Collega a documentazione
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "capture" && (
            <div className="h-full min-h-0 grid grid-cols-[320px_1fr]">
            <div className="border-r border-border p-4 space-y-3 overflow-y-auto">
              <div>
                <Label>Titolo *</Label>
                <Input value={titolo} onChange={(event) => setTitolo(event.target.value)} placeholder="Titolo figura" />
              </div>
              <div>
                <Label>Didascalia</Label>
                <Textarea
                  value={didascalia}
                  onChange={(event) => setDidascalia(event.target.value)}
                  placeholder="Descrizione breve della figura"
                  rows={3}
                />
              </div>
              <div>
                <Label>Tag (virgola)</Label>
                <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="webmap, planimetria, area-a" />
              </div>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={showScale} onChange={(event) => setShowScale(event.target.checked)} />
                  Mostra scala metrica
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={showNorth} onChange={(event) => setShowNorth(event.target.checked)} />
                  Mostra freccia nord
                </label>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => createPreviewMutation.mutate()}
                  disabled={createPreviewMutation.isPending}
                >
                  {createPreviewMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  Genera anteprima
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !titolo.trim()}
                >
                  {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Salva snapshot
                </Button>
                {previewDataUrl && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = previewDataUrl;
                      link.download = `${(titolo.trim() || "snapshot").replace(/[^\w\-]+/g, "_")}.png`;
                      link.click();
                    }}
                  >
                    <Download size={14} />
                    Scarica PNG
                  </Button>
                )}
              </div>
            </div>

            <div className="p-4 overflow-hidden flex items-center justify-center bg-muted/20">
              {previewDataUrl ? (
                <img
                  src={previewDataUrl}
                  alt="Anteprima snapshot mappa"
                  className="max-w-full max-h-full object-contain rounded border border-border bg-black/20"
                />
              ) : (
                <div className="text-sm text-muted-foreground text-center">
                  Clicca su <strong>Genera anteprima</strong> per vedere l'export.
                </div>
              )}
            </div>
            </div>
          )}

          {tab === "library" && (
            <div className="h-full min-h-0 p-4 overflow-y-auto">
            {snapshotsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Caricamento libreria snapshot...</div>
            ) : snapshots.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nessuno snapshot salvato.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {snapshots.map((snapshot) => (
                  <div key={snapshot.id} className="border border-border rounded-md p-3 bg-card/50 space-y-2">
                    <div className="font-medium text-sm truncate">{snapshot.titolo}</div>
                    {snapshot.didascalia && (
                      <div className="text-xs text-muted-foreground line-clamp-2">{snapshot.didascalia}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(snapshot.createdAt).toLocaleString("it-IT")}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={snapshot.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                      >
                        <Download size={12} />
                        Apri
                      </a>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2 gap-1"
                        onClick={() => deleteMutation.mutate(snapshot.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 size={12} />
                        Elimina
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          )}

          {tab === "link" && (
            <div className="h-full min-h-0 grid grid-cols-[340px_1fr]">
            <div className="border-r border-border p-4 space-y-3 overflow-y-auto">
              <div>
                <Label>Snapshot da collegare</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={selectedSnapshotId ?? ""}
                  onChange={(event) => {
                    setSelectedSnapshotId(Number(event.target.value));
                    setLinkedDocMessage(null);
                  }}
                >
                  <option value="" disabled>
                    Seleziona snapshot...
                  </option>
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.titolo}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>Documentazione target</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={selectedDocumentazioneId ?? ""}
                  onChange={(event) => {
                    setSelectedDocumentazioneId(Number(event.target.value));
                    setLinkedDocMessage(null);
                  }}
                >
                  <option value="" disabled>
                    Seleziona documentazione...
                  </option>
                  {documentazioni.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.titolo} ({doc.tipo})
                    </option>
                  ))}
                </select>
                {documentazioniQuery.isLoading && (
                  <div className="mt-1 text-xs text-muted-foreground">Caricamento documentazioni...</div>
                )}
                {!documentazioniQuery.isLoading && documentazioni.length === 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Nessuna documentazione disponibile. Crea una nuova bozza qui sotto.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border p-3 space-y-2 bg-card/40">
                <div className="text-xs font-medium">Crea nuova documentazione</div>
                <div>
                  <Label>Tipo</Label>
                  <select
                    value={newDocTipo}
                    onChange={(event) => setNewDocTipo(event.target.value as DocumentazioneTipo)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="giornaliera">Giornaliera</option>
                    <option value="settimanale">Settimanale</option>
                    <option value="fine_scavo">Fine scavo</option>
                  </select>
                </div>
                <div>
                  <Label>Titolo (opzionale)</Label>
                  <Input
                    value={newDocTitolo}
                    onChange={(event) => setNewDocTitolo(event.target.value)}
                    placeholder="Es. Giornata 2026-03-27"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Data inizio</Label>
                    <Input type="date" value={newDocDataInizio} onChange={(event) => setNewDocDataInizio(event.target.value)} />
                  </div>
                  <div>
                    <Label>Data fine</Label>
                    <Input type="date" value={newDocDataFine} onChange={(event) => setNewDocDataFine(event.target.value)} />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="gap-2 w-full"
                  onClick={() => createDocumentazioneMutation.mutate()}
                  disabled={createDocumentazioneMutation.isPending}
                >
                  {createDocumentazioneMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FileText size={14} />
                  )}
                  Crea documentazione
                </Button>
              </div>

              <div>
                <Label>Posizione (opzionale)</Label>
                <Input
                  value={linkPosizione}
                  onChange={(event) => setLinkPosizione(event.target.value)}
                  placeholder="10, 20, 30..."
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Lascia vuoto per aggiungere lo snapshot in fondo.
                </div>
              </div>

              <Button
                className="gap-2 w-full"
                onClick={() => linkSnapshotMutation.mutate()}
                disabled={
                  linkSnapshotMutation.isPending ||
                  !selectedSnapshotId ||
                  !selectedDocumentazioneId
                }
              >
                {linkSnapshotMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FileText size={14} />
                )}
                Collega snapshot
              </Button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              <div className="text-sm font-medium">Output</div>
              {linkedDocMessage ? (
                <div className="rounded-md border border-border p-3 space-y-2 bg-card/40">
                  <div className="text-sm">{linkedDocMessage}</div>
                  <a
                    href={`#/cantiere/${cantiereId}/documentazioni`}
                    className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                  >
                    <Download size={12} />
                    Apri pagina Documentazioni
                  </a>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Seleziona snapshot e documentazione, poi collega.
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Il DOCX finale si genera dalla pagina Documentazioni, non qui.
              </div>
            </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
