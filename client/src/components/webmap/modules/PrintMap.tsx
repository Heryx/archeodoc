import { useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { FileDown, Loader2, Printer, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PageFormat = "A4L" | "A4P" | "A3L" | "A3P";

const FORMATS: Record<PageFormat, { label: string; w: number; h: number }> = {
  A4L: { label: "A4 orizzontale", w: 297, h: 210 },
  A4P: { label: "A4 verticale", w: 210, h: 297 },
  A3L: { label: "A3 orizzontale", w: 420, h: 297 },
  A3P: { label: "A3 verticale", w: 297, h: 420 },
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
  const [showGrid, setShowGrid] = useState(false);
  const [showNorth, setShowNorth] = useState(true);
  const [showScale, setShowScale] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

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

    const canvas = document.createElement("canvas");
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non disponibile");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageW, pageH);

    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(marginPx / 2, marginPx / 2, pageW - marginPx, pageH - marginPx);

    map.triggerRepaint();
    await new Promise<void>((resolve) => {
      if (map.loaded()) resolve();
      else map.once("idle", resolve);
    });

    const mapCanvas = map.getCanvas();
    ctx.drawImage(
      mapCanvas,
      0,
      0,
      mapCanvas.width,
      mapCanvas.height,
      marginPx,
      marginPx,
      mapAreaW,
      mapAreaH,
    );

    if (showGrid) {
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 0.5;
      const step = Math.round(20 * MM_TO_PX);
      for (let x = marginPx; x < marginPx + mapAreaW; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, marginPx);
        ctx.lineTo(x, marginPx + mapAreaH);
        ctx.stroke();
      }
      for (let y = marginPx; y < marginPx + mapAreaH; y += step) {
        ctx.beginPath();
        ctx.moveTo(marginPx, y);
        ctx.lineTo(marginPx + mapAreaW, y);
        ctx.stroke();
      }
    }

    if (showNorth) {
      const nx = marginPx + 32;
      const ny = marginPx + mapAreaH - 45;
      ctx.save();
      ctx.translate(nx, ny);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#2563eb";
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(7, 2);
      ctx.lineTo(-7, 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#aaa";
      ctx.beginPath();
      ctx.moveTo(0, 16);
      ctx.lineTo(7, 2);
      ctx.lineTo(-7, 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#111";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.fillText("N", 0, -19);
      ctx.restore();
    }

    if (showScale) {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const metersPerPixel =
        (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);

      const barMm = 40;
      const barMeters = Math.round(metersPerPixel * (mapAreaW * barMm) / fmt.w);
      const roundedMeters = roundToNice(barMeters);
      const actualBarPx = Math.round(
        (roundedMeters / metersPerPixel) * (mapAreaW / Math.max(1, mapCanvas.width)),
      );

      const sx = marginPx + mapAreaW - actualBarPx - 16;
      const sy = marginPx + mapAreaH - 18;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(sx - 4, sy - 12, actualBarPx + 8, 20);

      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + actualBarPx, sy);
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx, sy + 5);
      ctx.moveTo(sx + actualBarPx, sy - 5);
      ctx.lineTo(sx + actualBarPx, sy + 5);
      ctx.stroke();

      const label =
        roundedMeters >= 1000
          ? `${(roundedMeters / 1000).toFixed(roundedMeters % 1000 === 0 ? 0 : 1)} km`
          : `${roundedMeters} m`;
      ctx.fillStyle = "#111";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(label, sx + actualBarPx / 2, sy - 3);
    }

    const fy = marginPx + mapAreaH + Math.round(4 * MM_TO_PX);
    const fh = footerPx - Math.round(4 * MM_TO_PX);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(marginPx, fy, mapAreaW, fh);

    ctx.fillStyle = "#ffffff";
    if (title) {
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "left";
      ctx.fillText(title, marginPx + 10, fy + fh / 2 + 4);
    }
    if (author) {
      ctx.font = "10px Arial";
      ctx.textAlign = "right";
      ctx.fillText(author, marginPx + mapAreaW - 10, fy + fh / 2 - 4);
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "9px Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      `ArcheoDoc · ${new Date().toLocaleDateString("it-IT")}`,
      marginPx + mapAreaW - 10,
      fy + fh / 2 + 8,
    );

    return canvas;
  };

  const generatePreview = async () => {
    setLoading(true);
    try {
      const canvas = await buildPrintCanvas();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } finally {
      setLoading(false);
    }
  };

  const downloadPng = () => {
    if (!previewUrl) return;
    const anchor = document.createElement("a");
    anchor.href = previewUrl;
    anchor.download = `${title || "planimetria"}_${FORMATS[format].label}.png`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[760px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Printer size={15} className="text-primary" />
            <span className="font-semibold text-sm">Stampa planimetria</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-56 shrink-0 border-r border-border p-4 space-y-4 overflow-auto">
            <div>
              <Label className="text-xs">Formato pagina</Label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {(Object.entries(FORMATS) as Array<[PageFormat, { label: string; w: number; h: number }]>).map(([key, fmt]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFormat(key);
                      setPreviewUrl(null);
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
                onChange={(event) => setTitle(event.target.value)}
                placeholder="es. Planimetria Scavo 2026"
                className="h-7 text-xs mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">Autore / Ente</Label>
              <Input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="es. Dott. Guarino"
                className="h-7 text-xs mt-1"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Elementi cartografici</Label>
              {[
                { id: "north", label: "Freccia nord", value: showNorth, setter: setShowNorth },
                { id: "scale", label: "Barra scala", value: showScale, setter: setShowScale },
                { id: "grid", label: "Griglia 20mm", value: showGrid, setter: setShowGrid },
              ].map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={(event) => {
                      item.setter(event.target.checked);
                      setPreviewUrl(null);
                    }}
                    className="accent-primary"
                  />
                  {item.label}
                </label>
              ))}
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
              <div className="text-center text-xs text-muted-foreground">
                <Printer size={32} className="mx-auto mb-2 opacity-30" />
                <p>Configura le opzioni e clicca</p>
                <p className="font-medium mt-0.5">Genera anteprima</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
