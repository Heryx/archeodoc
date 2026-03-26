import { useMemo, useState } from "react";
import { useWebMap } from "../store";

const PAGE_SIZE = 20;

export function AttributeTable() {
  const { state } = useWebMap();
  const [page, setPage] = useState(0);
  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);

  const fields = useMemo(() => {
    if (!activeLayer || activeLayer.featureCollection.features.length === 0) return [] as string[];
    const properties = activeLayer.featureCollection.features[0].properties || {};
    return Object.keys(properties).filter((field) => !field.startsWith("_"));
  }, [activeLayer]);

  if (!state.modules.attributeTable) return null;
  if (!activeLayer) {
    return <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Seleziona un layer attivo.</div>;
  }
  if (activeLayer.sourceKind === "raster") {
    return <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Layer raster: tabella attributi non disponibile.</div>;
  }

  const total = activeLayer.featureCollection.features.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const rows = activeLayer.featureCollection.features.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <div className="border-t border-border bg-card max-h-56 overflow-auto">
      <div className="sticky top-0 z-10 bg-card border-b border-border px-3 py-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold">
          {activeLayer.tableName} - {total} record
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground disabled:opacity-30"
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            disabled={currentPage === 0}
          >
            ‹
          </button>
          <span>
            {currentPage + 1}/{totalPages}
          </span>
          <button
            type="button"
            className="hover:text-foreground disabled:opacity-30"
            onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
            disabled={currentPage >= totalPages - 1}
          >
            ›
          </button>
        </div>
      </div>

      <table className="w-full text-[11px]">
        <thead className="sticky top-7 bg-muted/40">
          <tr>
            {fields.map((field) => (
              <th key={field} className="text-left px-2 py-1 border-r border-border/40 whitespace-nowrap">
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((feature, rowIndex) => {
            const fid = Number(feature.properties?._fid ?? -1);
            const selected = state.selectedFeatureId != null && fid === state.selectedFeatureId;
            return (
              <tr key={rowIndex} className={selected ? "bg-primary/10" : "hover:bg-muted/20"}>
                {fields.map((field) => (
                  <td key={field} className="px-2 py-1 border-t border-border/30 border-r border-border/20 max-w-44 truncate">
                    {String(feature.properties?.[field] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
