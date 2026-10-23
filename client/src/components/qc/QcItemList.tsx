import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "error" | "warning" | "pending" | "ok";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Tutte" },
  { value: "error", label: "Errori" },
  { value: "warning", label: "Avvisi" },
  { value: "pending", label: "Non verificate" },
  { value: "ok", label: "OK" },
];

type QcItemListProps<T> = {
  items: T[];
  getKey: (item: T) => string | number;
  getStatus: (item: T) => string;
  getSearchText: (item: T) => string;
  /** `defaultOpen` e' vero quando si filtra su errori o avvisi: i dettagli sono subito visibili */
  renderItem: (item: T, defaultOpen: boolean) => ReactNode;
  searchPlaceholder?: string;
  pageSize?: number;
};

/** Elenco filtrabile (stato + ricerca) e a pagine di elementi sottoposti a QC. */
export function QcItemList<T>({
  items,
  getKey,
  getStatus,
  getSearchText,
  renderItem,
  searchPlaceholder = "Cerca...",
  pageSize = 40,
}: QcItemListProps<T>) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);

  const normalized = (item: T) => (getStatus(item) || "pending") as StatusFilter;
  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: items.length, error: 0, warning: 0, pending: 0, ok: 0 };
    for (const item of items) {
      const status = normalized(item);
      if (status in result) result[status] += 1;
    }
    return result;
  }, [items]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === "all" || normalized(item) === filter) && (!q || getSearchText(item).toLowerCase().includes(q)),
      ),
    [items, filter, q],
  );
  const shown = filtered.slice(0, limit);
  const autoOpen = filter === "error" || filter === "warning";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.filter((f) => f.value === "all" || f.value === filter || counts[f.value] > 0).map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => { setFilter(f.value); setLimit(pageSize); }}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              filter === f.value
                ? "border-foreground/40 bg-muted text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {f.label} <span className="opacity-70">{counts[f.value]}</span>
          </button>
        ))}
        {items.length > 8 && (
          <div className="relative ml-auto w-44">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(pageSize); }}
              placeholder={searchPlaceholder}
              className="h-7 pl-7 text-xs"
            />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-muted-foreground">Nessun elemento corrisponde ai filtri.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((item) => (
            <div key={`${getKey(item)}-${autoOpen}`}>{renderItem(item, autoOpen)}</div>
          ))}
        </div>
      )}

      {filtered.length > shown.length && (
        <div className="flex justify-center pt-1">
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + pageSize)}>
            Mostra altre {Math.min(pageSize, filtered.length - shown.length)} ({filtered.length - shown.length} nascoste)
          </Button>
        </div>
      )}
    </div>
  );
}
