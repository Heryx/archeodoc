import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Loader2, Navigation, Search, X } from "lucide-react";

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  boundingbox: [string, string, string, string];
};

function useNominatim(query: string, enabled: boolean) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || query.trim().length < 3) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);

      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", query.trim());
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "6");
        url.searchParams.set("addressdetails", "0");

        const response = await fetch(url.toString(), {
          signal: abortRef.current.signal,
          headers: { "Accept-Language": "it,en" },
        });
        if (!response.ok) throw new Error("Geocoding fallito");
        const payload = (await response.json()) as NominatimResult[];
        setResults(Array.isArray(payload) ? payload : []);
      } catch (error: any) {
        if (error?.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query, enabled]);

  return { results, loading, clear: () => setResults([]) };
}

function categoryIcon(type: string): string {
  if (["city", "town", "village", "municipality"].includes(type)) return "🏘️";
  if (["administrative", "boundary"].includes(type)) return "🗺️";
  if (["archaeological_site", "ruins", "monument"].includes(type)) return "🏛️";
  if (["road", "motorway", "path"].includes(type)) return "🛣️";
  if (["building", "house"].includes(type)) return "🏠";
  if (["water", "river", "lake"].includes(type)) return "💧";
  return "📍";
}

export function Geocoder({
  mapRef,
  position = "top-right",
}: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  position?: "top-left" | "top-right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading, clear } = useNominatim(query, open);

  const toggleOpen = () => {
    setOpen((value) => {
      if (!value) {
        window.setTimeout(() => inputRef.current?.focus(), 50);
      }
      return !value;
    });
    setQuery("");
    clear();
  };

  const flyToResult = (result: NominatimResult) => {
    const map = mapRef.current;
    if (!map) return;

    const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
    if (Math.abs(maxLat - minLat) < 0.01 && Math.abs(maxLon - minLon) < 0.01) {
      map.flyTo({
        center: [Number(result.lon), Number(result.lat)],
        zoom: 16,
        duration: 1200,
      });
    } else {
      map.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        { padding: 60, maxZoom: 17, duration: 1200 },
      );
    }

    const markerElement = document.createElement("div");
    markerElement.style.cssText = `
      width:18px;height:18px;border-radius:50% 50% 50% 0;
      background:#2563eb;border:2px solid white;
      transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,0.4);
    `;
    const marker = new maplibregl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([Number(result.lon), Number(result.lat)])
      .addTo(map);
    window.setTimeout(() => marker.remove(), 4000);

    setOpen(false);
    setQuery("");
    clear();
  };

  const geolocate = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 16,
          duration: 1000,
        });
        setOpen(false);
      },
      () => {},
    );
  };

  const posClass = position === "top-left" ? "left-3 top-3" : "right-3 top-3";

  return (
    <div className={`absolute ${posClass} z-20 flex flex-col items-end gap-1`}>
      <button
        type="button"
        onClick={toggleOpen}
        className={`flex items-center justify-center w-8 h-8 rounded-full shadow-md transition-colors ${
          open
            ? "bg-primary text-primary-foreground"
            : "bg-background/90 backdrop-blur-sm border border-border hover:bg-muted text-foreground"
        }`}
        title="Cerca luogo"
      >
        {open ? <X size={14} /> : <Search size={14} />}
      </button>

      {open && (
        <div className="w-80 bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            {loading ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Search size={14} className="shrink-0 text-muted-foreground" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca indirizzo, luogo, sito..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(event) => {
                if (event.key === "Escape") toggleOpen();
                if (event.key === "Enter" && results.length > 0) flyToResult(results[0]);
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  clear();
                }}
                className="shrink-0 p-0.5 rounded hover:bg-muted"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {results.length > 0 && (
            <ul className="max-h-60 overflow-auto py-1">
              {results.map((result) => (
                <li key={result.place_id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-start gap-2"
                    onClick={() => flyToResult(result)}
                  >
                    <span className="text-base shrink-0 mt-0.5">{categoryIcon(result.type)}</span>
                    <span className="text-xs leading-snug">{result.display_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loading && query.trim().length >= 3 && results.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3 px-4">
              Nessun risultato per "<em>{query}</em>"
            </p>
          )}

          {query.trim().length < 3 && (
            <div className="px-3 py-2 space-y-1">
              <p className="text-[10px] text-muted-foreground">
                Digita almeno 3 caratteri per cercare
              </p>
              <button
                type="button"
                onClick={geolocate}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Navigation size={11} />
                Vai alla mia posizione
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
