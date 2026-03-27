import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { FileDown, Loader2, Printer, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PageFormat = "A4L" | "A4P" | "A3L" | "A3P";
type CoordinateLabelMode = "none" | "corners" | "grid-lines";
type TextSizePreset = "small" | "medium" | "large";

const FORMATS: Record<PageFormat, { label: string; w: number; h: number }> = {
  A4L: { label: "A4 orizzontale", w: 297, h: 210 },
  A4P: { label: "A4 verticale", w: 210, h: 297 },
  A3L: { label: "A3 orizzontale", w: 420, h: 297 },
  A3P: { label: "A3 verticale", w: 297, h: 420 },
};

const TEXT_SIZE_TO_PX: Record<TextSizePreset, number> = {
  small: 9,
  medium: 11,
  large: 13,
};

const DPI = 150;
const MM_TO_PX = DPI / 25.4;
const MARGIN_MM = 12;

function roundToNice(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1))));
  const normalized = value / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return nice * magnitude;
}

function formatLon(value: number): string {
  const abs = Math.abs(value).toFixed(5);
  return `${abs}${value >= 0 ? "E" : "W"}`;
}

function formatLat(value: number): string {
  const abs = Math.abs(value).toFixed(5);
  return `${abs}${value >= 0 ? "N" : "S"}`;
}

function drawLabelTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSizePx: number,
  align: CanvasTextAlign = "left",
) {
  ctx.save();
  ctx.font = `${fontSizePx}px Arial`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const padX = 4;
  const padY = 2;
  const width = textWidth + padX * 2;
  const height = fontSizePx + padY * 2;
  const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  const top = y - height / 2;

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, width, height);

  ctx.fillStyle = "#0f172a";
  ctx.fillText(text, x + (align === "left" ? padX : align === "right" ? -padX : 0), y);
  ctx.restore();
}

async function waitForMapRender(map: maplibregl.Map): Promise<void> {
  map.triggerRepaint();
  await new Promise<void>((resolve) => {
    if (map.loaded()) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      return;
    }
    map.once("idle", () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function mapCanvasToDataUrl(map: maplibregl.Map): Promise<string> {
  const sourceCanvas = map.getCanvas();
  try {
    return sourceCanvas.toDataURL("image/png");
  } catch {
    throw new Error(
      "Export bloccato da CORS sulla mappa. Usa layer/basemap con CORS abilitato o passanti dal proxy locale.",
    );
  }
}

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Impossibile leggere il frame mappa per la stampa."));
    image.src = dataUrl;
  });
  return image;
}

function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  mapX: number,
  mapY: number,
  mapH: number,
  textPx: number,
) {
  const radius = Math.max(18, Math.round(textPx * 2));
  const nx = mapX + radius + 10;
  const ny = mapY + mapH - radius - 10;

  ctx.save();
  ctx.translate(nx, ny);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.stroke();

  const arrowTop = Math.round(radius * 0.72);
  const arrowHalf = Math.max(6, Math.round(radius * 0.28));
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.moveTo(0, -arrowTop);
  ctx.lineTo(arrowHalf, 2);
  ctx.lineTo(-arrowHalf, 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#9ca3af";
  ctx.beginPath();
  ctx.moveTo(0, arrowTop);
  ctx.lineTo(arrowHalf, 2);
  ctx.lineTo(-arrowHalf, 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#111827";
  ctx.font = `bold ${Math.max(10, Math.round(textPx * 1.1))}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -radius - 2);
  ctx.restore();
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number,
  pageWmm: number,
  textPx: number,
) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const metersPerPixel = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);

  const barMm = 40;
  const barMeters = Math.round(metersPerPixel * (mapW * barMm) / pageWmm);
  const roundedMeters = roundToNice(barMeters);
  const actualBarPx = Math.max(42, Math.round((roundedMeters / metersPerPixel) * (mapW / Math.max(1, map.getCanvas().width))));

  const sx = mapX + mapW - actualBarPx - 16;
  const sy = mapY + mapH - 18;

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(sx - 5, sy - 13, actualBarPx + 10, 22);

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + actualBarPx, sy);
  ctx.moveTo(sx, sy - 5);
  ctx.lineTo(sx, sy + 5);
  ctx.moveTo(sx + actualBarPx, sy - 5);
  ctx.lineTo(sx + actualBarPx, sy + 5);
  ctx.stroke();

  const label = roundedMeters >= 1000
    ? `${(roundedMeters / 1000).toFixed(roundedMeters % 1000 === 0 ? 0 : 1)} km`
    : `${roundedMeters} m`;
  ctx.fillStyle = "#111827";
  ctx.font = `bold ${Math.max(9, textPx)}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText(label, sx + actualBarPx / 2, sy - 4);
}

function drawCornerCoordinates(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number,
  sourceW: number,
  sourceH: number,
  textPx: number,
) {
  const corners = [
    { ox: 0, oy: 0, x: mapX + 4, y: mapY + 10, align: "left" as CanvasTextAlign },
    { ox: sourceW, oy: 0, x: mapX + mapW - 4, y: mapY + 10, align: "right" as CanvasTextAlign },
    { ox: 0, oy: sourceH, x: mapX + 4, y: mapY + mapH - 10, align: "left" as CanvasTextAlign },
    { ox: sourceW, oy: sourceH, x: mapX + mapW - 4, y: mapY + mapH - 10, align: "right" as CanvasTextAlign },
  ];
  for (const corner of corners) {
    const coord = map.unproject([corner.ox, corner.oy]);
    drawLabelTag(
      ctx,
      `${formatLon(coord.lng)} ${formatLat(coord.lat)}`,
      corner.x,
      corner.y,
      Math.max(8, textPx - 1),
      corner.align,
    );
  }
}

function drawGridLineCoordinates(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number,
  sourceW: number,
  sourceH: number,
  stepPx: number,
  textPx: number,
) {
  const safeStep = Math.max(10, stepPx);
  for (let x = mapX; x <= mapX + mapW + 0.5; x += safeStep) {
    const srcX = ((x - mapX) / mapW) * sourceW;
    const top = map.unproject([srcX, 0]);
    drawLabelTag(ctx, formatLon(top.lng), x, mapY + 10, Math.max(8, textPx - 1), "center");
  }
  for (let y = mapY; y <= mapY + mapH + 0.5; y += safeStep) {
    const srcY = ((y - mapY) / mapH) * sourceH;
    const left = map.unproject([0, srcY]);
    drawLabelTag(ctx, formatLat(left.lat), mapX + 4, y, Math.max(8, textPx - 1), "left");
  }
}

export function PrintMap({
  mapRef,
  onClose,
}: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<PageFormat>("A4L");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [textSize, setTextSize] = useState<TextSizePreset>("medium");
  const [showGrid, setShowGrid] = useState(false);
  const [gridStepMm, setGridStepMm] = useState("20");
  const [coordinateMode, setCoordinateMode] = useState<CoordinateLabelMode>("none");
  const [showNorth, setShowNorth] = useState(true);
  const [showScale, setShowScale] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const buildPrintCanvas = async (): Promise<HTMLCanvasElement> => {
    const map = mapRef.current;
    if (!map) throw new Error("Mappa non disponibile");

    const fmt = FORMATS[format];
    const pageW = Math.round(fmt.w * MM_TO_PX);
    const pageH = Math.round(fmt.h * MM_TO_PX);
    const marginPx = Math.round(MARGIN_MM * MM_TO_PX);
    const footerPx = Math.round(18 * MM_TO_PX);
    const mapAreaW = pageW - marginPx * 2;
    const mapAreaH = pageH - marginPx * 2 - footerPx;
    const textPx = TEXT_SIZE_TO_PX[textSize];
    const gridStep = Math.max(5, Number(gridStepMm) || 20);
    const stepPx = Math.max(6, Math.round(gridStep * MM_TO_PX));

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = pageW;
    pageCanvas.height = pageH;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non disponibile");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(marginPx / 2, marginPx / 2, pageW - marginPx, pageH - marginPx);

    await waitForMapRender(map);
    const sourceCanvas = map.getCanvas();
    const mapFrameDataUrl = await mapCanvasToDataUrl(map);
    const mapFrame = await dataUrlToImage(mapFrameDataUrl);
    ctx.drawImage(mapFrame, 0, 0, sourceCanvas.width, sourceCanvas.height, marginPx, marginPx, mapAreaW, mapAreaH);

    if (showGrid) {
      ctx.strokeStyle = "rgba(0,0,0,0.1)";
      ctx.lineWidth = 0.5;
      for (let x = marginPx; x <= marginPx + mapAreaW + 0.5; x += stepPx) {
        ctx.beginPath();
        ctx.moveTo(x, marginPx);
        ctx.lineTo(x, marginPx + mapAreaH);
        ctx.stroke();
      }
      for (let y = marginPx; y <= marginPx + mapAreaH + 0.5; y += stepPx) {
        ctx.beginPath();
        ctx.moveTo(marginPx, y);
        ctx.lineTo(marginPx + mapAreaW, y);
        ctx.stroke();
      }
    }

    if (coordinateMode === "corners") {
      drawCornerCoordinates(
        ctx,
        map,
        marginPx,
        marginPx,
        mapAreaW,
        mapAreaH,
        sourceCanvas.width,
        sourceCanvas.height,
        textPx,
      );
    } else if (coordinateMode === "grid-lines" && showGrid) {
      drawGridLineCoordinates(
        ctx,
        map,
        marginPx,
        marginPx,
        mapAreaW,
        mapAreaH,
        sourceCanvas.width,
        sourceCanvas.height,
        stepPx,
        textPx,
      );
    }

    if (showNorth) {
      drawNorthArrow(ctx, marginPx, marginPx, mapAreaH, textPx);
    }
    if (showScale) {
      drawScaleBar(ctx, map, marginPx, marginPx, mapAreaW, mapAreaH, fmt.w, textPx);
    }

    const fy = marginPx + mapAreaH + Math.round(4 * MM_TO_PX);
    const fh = footerPx - Math.round(4 * MM_TO_PX);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(marginPx, fy, mapAreaW, fh);

    ctx.fillStyle = "#ffffff";
    if (title) {
      ctx.font = `bold ${Math.round(textPx * 1.15)}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(title, marginPx + 10, fy + fh / 2 + 4);
    }
    if (author) {
      ctx.font = `${Math.max(9, textPx)}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(author, marginPx + mapAreaW - 10, fy + fh / 2 - 4);
    }

    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.font = `${Math.max(8, textPx - 1)}px Arial`;
    ctx.textAlign = "right";
    ctx.fillText(
      `ArcheoDoc - ${new Date().toLocaleDateString("it-IT")}`,
      marginPx + mapAreaW - 10,
      fy + fh / 2 + 8,
    );

    return pageCanvas;
  };

  const generatePreview = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const canvas = await buildPrintCanvas();
      clearPreview();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Impossibile creare l'immagine di anteprima.");
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Errore durante la generazione dell'anteprima.");
    } finally {
      setLoading(false);
    }
  };

  const downloadPng = () => {
    if (!previewUrl) return;
    const anchor = document.createElement("a");
    anchor.href = previewUrl;
    anchor.download = `${(title || "planimetria").replace(/[^\w\-]+/g, "_")}_${FORMATS[format].label}.png`;
    anchor.click();
  };

  const printDirect = () => {
    if (!previewUrl) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const pageSize = FORMATS[format].label.includes("A3") ? "A3" : "A4";
    const orientation = format.endsWith("L") ? "landscape" : "portrait";
    win.document.write(`
      <html><head><title>${title || "Planimetria"}</title>
      <style>
        *{margin:0;padding:0}
        body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}
        img{max-width:100%;height:auto;display:block}
        @media print{
          @page{size:${pageSize} ${orientation};margin:0}
          img{width:100%;height:100%;object-fit:contain}
        }
      </style></head>
      <body><img src="${previewUrl}" onload="window.print();window.close();" /></body></html>
    `);
    win.document.close();
  };

  const onCloseDialog = () => {
    clearPreview();
    setErrorText(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[860px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Printer size={15} className="text-primary" />
            <span className="font-semibold text-sm">Stampa planimetria</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onCloseDialog}>
            <X size={14} />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-72 shrink-0 border-r border-border p-4 space-y-4 overflow-auto">
            <div>
              <Label className="text-xs">Formato pagina</Label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {(Object.entries(FORMATS) as Array<[PageFormat, { label: string; w: number; h: number }]>).map(([key, fmt]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFormat(key);
                      clearPreview();
                    }}
                    className={`text-[11px] rounded px-2 py-1.5 border transition-colors ${
                      format === key
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Titolo mappa</Label>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  clearPreview();
                }}
                placeholder="es. Planimetria Scavo 2026"
                className="h-7 text-xs mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">Autore / Ente</Label>
              <Input
                value={author}
                onChange={(event) => {
                  setAuthor(event.target.value);
                  clearPreview();
                }}
                placeholder="es. Dott. Guarino"
                className="h-7 text-xs mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">Dimensione testo</Label>
              <select
                value={textSize}
                onChange={(event) => {
                  setTextSize(event.target.value as TextSizePreset);
                  clearPreview();
                }}
                className="mt-1 h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="small">Piccolo</option>
                <option value="medium">Medio</option>
                <option value="large">Grande</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Elementi cartografici</Label>
              {[
                { id: "north", label: "Freccia nord", value: showNorth, setter: setShowNorth },
                { id: "scale", label: "Barra scala", value: showScale, setter: setShowScale },
                { id: "grid", label: "Grigliato", value: showGrid, setter: setShowGrid },
              ].map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={(event) => {
                      item.setter(event.target.checked);
                      clearPreview();
                    }}
                    className="accent-primary"
                  />
                  {item.label}
                </label>
              ))}
            </div>

            {showGrid && (
              <div>
                <Label className="text-xs">Dimensione griglia (mm)</Label>
                <Input
                  type="number"
                  min="5"
                  step="1"
                  value={gridStepMm}
                  onChange={(event) => {
                    setGridStepMm(event.target.value);
                    clearPreview();
                  }}
                  className="h-7 text-xs mt-1"
                />
              </div>
            )}

            <div>
              <Label className="text-xs">Coordinate</Label>
              <select
                value={coordinateMode}
                onChange={(event) => {
                  setCoordinateMode(event.target.value as CoordinateLabelMode);
                  clearPreview();
                }}
                className="mt-1 h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="none">Nessuna</option>
                <option value="corners">Solo angoli</option>
                <option value="grid-lines">Ogni linea griglia</option>
              </select>
              {coordinateMode === "grid-lines" && !showGrid && (
                <p className="text-[11px] text-amber-600 mt-1">Attiva il grigliato per visualizzare le coordinate su ogni linea.</p>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs"
                onClick={generatePreview}
                disabled={loading}
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
                Genera anteprima
              </Button>

              {previewUrl && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 text-xs"
                    onClick={downloadPng}
                  >
                    <FileDown size={12} />
                    Scarica PNG
                  </Button>
                  <Button size="sm" className="w-full gap-1.5 text-xs" onClick={printDirect}>
                    <Printer size={12} />
                    Stampa
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 bg-muted/20 overflow-auto flex items-center justify-center p-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Anteprima stampa"
                className="max-w-full max-h-full object-contain shadow-lg rounded border border-border"
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground max-w-sm">
                <Printer size={32} className="mx-auto mb-2 opacity-30" />
                <p>Configura le opzioni e clicca</p>
                <p className="font-medium mt-0.5">Genera anteprima</p>
                {errorText && <p className="text-red-600 mt-3">{errorText}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

