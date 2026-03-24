import { useMemo, useRef } from "react";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GeoPackagePreviewPayload } from "@/components/upload/types";

type GeoPackageImportCardProps = {
  selectedGeoPackage: File | null;
  onSelectGeoPackage: (file: File | null) => void;
  onPreview: () => void;
  previewPending: boolean;
  previewData: GeoPackagePreviewPayload | null;
  selectedTable: string;
  onSelectTable: (tableName: string) => void;
  importUnknownColumns: boolean;
  onImportUnknownColumnsChange: (value: boolean) => void;
  onImport: () => void;
  importPending: boolean;
};

function mapEntries(map: Record<string, string | undefined>): Array<[string, string]> {
  return Object.entries(map)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => [key, String(value)]);
}

export function GeoPackageImportCard({
  selectedGeoPackage,
  onSelectGeoPackage,
  onPreview,
  previewPending,
  previewData,
  selectedTable,
  onSelectTable,
  importUnknownColumns,
  onImportUnknownColumnsChange,
  onImport,
  importPending,
}: GeoPackageImportCardProps) {
  const geopackageInputRef = useRef<HTMLInputElement>(null);

  const activeTable = useMemo(
    () => previewData?.tables.find((table) => table.tableName === selectedTable) || previewData?.tables[0] || null,
    [previewData, selectedTable],
  );

  return (
    <Card className="mb-6">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Database size={16} />
              Import GeoPackage
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Anteprima tabellare prima dell&apos;import: scegli cosa importare e come mapparlo.
            </p>
          </div>
          <input
            ref={geopackageInputRef}
            type="file"
            accept=".gpkg,.sqlite"
            className="hidden"
            onChange={(event) => {
              onSelectGeoPackage(event.target.files?.[0] || null);
            }}
          />
          <Button variant="outline" onClick={() => geopackageInputRef.current?.click()}>
            Seleziona file
          </Button>
        </div>

        {selectedGeoPackage && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium truncate">{selectedGeoPackage.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Dimensione: {(selectedGeoPackage.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onPreview} disabled={!selectedGeoPackage || previewPending || importPending}>
            {previewPending ? "Analisi in corso..." : "Analizza struttura"}
          </Button>
          <Button onClick={onImport} disabled={!selectedGeoPackage || importPending || previewPending}>
            {importPending ? "Import in corso..." : "Importa GeoPackage"}
          </Button>
        </div>

        {previewData && (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="grid md:grid-cols-[1fr_220px] gap-3 items-end">
              <div>
                <Label>Tabella da importare</Label>
                <Select value={selectedTable} onValueChange={onSelectTable}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona tabella..." />
                  </SelectTrigger>
                  <SelectContent>
                    {previewData.tables.map((table) => (
                      <SelectItem key={table.tableName} value={table.tableName}>
                        {table.tableName} ({table.rowCount} righe)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="import-extra-columns"
                  checked={importUnknownColumns}
                  onCheckedChange={(checked) => onImportUnknownColumnsChange(Boolean(checked))}
                />
                <Label htmlFor="import-extra-columns" className="text-xs">
                  Importa attributi extra in `schedaData`
                </Label>
              </div>
            </div>

            {activeTable && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  Tipo: {activeTable.dataType} | Geometria: {activeTable.geometryColumn || "assente"} | SRID: {activeTable.srid ?? "n/d"}
                  {activeTable.style && (
                    <span>
                      {" "} | Stile layer: {activeTable.style.styleName || "presente"} ({activeTable.style.hasQml ? "QML" : "-"} / {activeTable.style.hasSld ? "SLD" : "-"})
                    </span>
                  )}
                </div>

                <div className="text-xs">
                  <p className="font-medium mb-1">Mappatura automatica rilevata</p>
                  <div className="flex flex-wrap gap-1">
                    {mapEntries(activeTable.autoMap).length === 0 && (
                      <span className="text-muted-foreground">Nessun campo riconosciuto automaticamente.</span>
                    )}
                    {mapEntries(activeTable.autoMap).map(([key, value]) => (
                      <span key={`${key}-${value}`} className="rounded bg-background border border-border px-2 py-0.5">
                        {key}
                        {" -> "}
                        {value}
                      </span>
                    ))}
                  </div>
                </div>

                {activeTable.sampleRows.length > 0 && (
                  <div className="text-xs">
                    <p className="font-medium mb-1">Prime righe (anteprima attributi)</p>
                    <div className="max-h-44 overflow-auto rounded border border-border bg-background">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/70">
                          <tr>
                            {activeTable.columns.slice(0, 8).map((column) => (
                              <th key={column} className="text-left px-2 py-1 border-b border-border font-medium">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeTable.sampleRows.map((row, rowIndex) => (
                            <tr key={`preview-row-${rowIndex}`} className="border-b border-border/60">
                              {activeTable.columns.slice(0, 8).map((column) => (
                                <td key={`${rowIndex}-${column}`} className="px-2 py-1 align-top">
                                  {row[column] ?? "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {previewData.warnings.length > 0 && (
              <div className="text-xs text-amber-700 space-y-1">
                {previewData.warnings.map((warning) => (
                  <p key={warning}>- {warning}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
