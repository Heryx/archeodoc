import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRight, Download, Upload, Trash2, Columns, Database, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getProjectHeader } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";

type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
  protected: boolean;
};

type TableInfo = {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
};

type ConfirmTarget =
  | { kind: "column"; table: string; column: string }
  | { kind: "row"; table: string; id: number };

export function DatabaseCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [tableRows, setTableRows] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingRows, setLoadingRows] = useState<string | null>(null);

  const { data: tables = [], isLoading, refetch } = useQuery<TableInfo[]>({
    queryKey: ["/api/db/tables"],
    queryFn: async () => (await apiRequest("GET", "/api/db/tables")).json(),
    staleTime: 0,
  });

  const dropColumn = useMutation({
    mutationFn: async ({ table, column }: { table: string; column: string }) => {
      const r = await apiRequest("DELETE", `/api/db/tables/${table}/columns/${column}`, {});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      return r.json();
    },
    onSuccess: (_, { table, column }) => {
      toast({ title: `Colonna "${column}" eliminata dalla tabella "${table}"` });
      qc.invalidateQueries({ queryKey: ["/api/db/tables"] });
    },
    onError: (e: Error) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  const dropRow = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: number }) => {
      const r = await apiRequest("DELETE", `/api/db/tables/${table}/rows/${id}`, {});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      return r.json();
    },
    onSuccess: (_, { table, id }) => {
      toast({ title: `Riga #${id} eliminata da "${table}"` });
      setTableRows((prev) => ({
        ...prev,
        [table]: (prev[table] || []).filter((r) => (r as any).id !== id),
      }));
      qc.invalidateQueries({ queryKey: ["/api/db/tables"] });
    },
    onError: (e: Error) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  async function loadRows(table: string) {
    if (tableRows[table]) return;
    setLoadingRows(table);
    try {
      const r = await apiRequest("GET", `/api/db/tables/${table}/rows?limit=100`);
      const data = await r.json();
      setTableRows((prev) => ({ ...prev, [table]: data }));
    } catch {
      toast({ title: "Errore caricamento righe", variant: "destructive" });
    } finally {
      setLoadingRows(null);
    }
  }

  async function handleBackup() {
    try {
      const r = await fetch("/api/db/backup", { headers: getProjectHeader() });
      if (!r.ok) throw new Error("Errore download backup");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `archeodoc-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Errore backup", description: err.message, variant: "destructive" });
    }
  }

  async function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("db", file);
    try {
      const r = await fetch("/api/db/restore", { method: "POST", body: fd, headers: getProjectHeader() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      toast({ title: "Database ripristinato", description: data.message });
      refetch();
    } catch (err: any) {
      toast({ title: "Errore ripristino", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  }

  const confirmMessage =
    confirm?.kind === "column"
      ? `Eliminare la colonna "${confirm.column}" dalla tabella "${confirm.table}"? Tutti i dati in quella colonna saranno persi irreversibilmente.`
      : confirm?.kind === "row"
        ? `Eliminare la riga #${confirm.id} dalla tabella "${confirm.table}"? L'operazione è irreversibile.`
        : "";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-muted-foreground" />
              <CardTitle className="text-base">Gestione Database</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={handleBackup}>
                <Download size={14} /> Scarica backup
              </Button>
              <label>
                <Button size="sm" variant="outline" className="gap-1" asChild>
                  <span><Upload size={14} /> Ripristina</span>
                </Button>
                <input type="file" accept=".sqlite,.db" className="hidden" onChange={handleRestore} />
              </label>
            </div>
          </div>
          <CardDescription>
            Visualizza e gestisci la struttura del database. Le operazioni di eliminazione sono irreversibili.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 size={16} className="animate-spin" /> Caricamento struttura...
            </div>
          ) : (
            <div className="space-y-2">
              {tables.map((table) => (
                <Collapsible
                  key={table.name}
                  open={openTable === table.name}
                  onOpenChange={(open) => {
                    setOpenTable(open ? table.name : null);
                    if (open) loadRows(table.name);
                  }}
                >
                  <CollapsibleTrigger asChild>
                    <button className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/60 transition-colors">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${openTable === table.name ? "rotate-90" : ""}`}
                        />
                        <span className="font-mono font-medium">{table.name}</span>
                        <Badge variant="secondary" className="text-xs">{table.rowCount} righe</Badge>
                        <Badge variant="outline" className="text-xs">{table.columns.length} col.</Badge>
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 rounded-md border border-border bg-background p-3 space-y-3">

                      {/* Columns */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                          <Columns size={12} /> Colonne
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="text-left py-1 pr-3 font-medium">Nome</th>
                                <th className="text-left py-1 pr-3 font-medium">Tipo</th>
                                <th className="text-left py-1 pr-3 font-medium">Flags</th>
                                <th className="text-left py-1 font-medium">Azioni</th>
                              </tr>
                            </thead>
                            <tbody>
                              {table.columns.map((col) => (
                                <tr key={col.name} className="border-b border-border/50 last:border-0">
                                  <td className="py-1 pr-3 font-mono">{col.name}</td>
                                  <td className="py-1 pr-3 text-muted-foreground">{col.type || "—"}</td>
                                  <td className="py-1 pr-3">
                                    {col.pk && <Badge className="text-[10px] mr-1">PK</Badge>}
                                    {col.notnull && <Badge variant="outline" className="text-[10px] mr-1">NOT NULL</Badge>}
                                    {col.dflt_value != null && (
                                      <Badge variant="secondary" className="text-[10px]">def: {col.dflt_value}</Badge>
                                    )}
                                  </td>
                                  <td className="py-1">
                                    {!col.protected && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setConfirm({ kind: "column", table: table.name, column: col.name })}
                                      >
                                        <Trash2 size={12} />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Rows */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                          Righe (prime 100)
                        </p>
                        {loadingRows === table.name ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <Loader2 size={12} className="animate-spin" /> Caricamento...
                          </div>
                        ) : tableRows[table.name] ? (
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs border-collapse">
                              <thead className="sticky top-0 bg-background">
                                <tr className="border-b border-border text-muted-foreground">
                                  <th className="text-left py-1 pr-2 font-medium">ID</th>
                                  {table.columns.slice(0, 6).map((c) => (
                                    <th key={c.name} className="text-left py-1 pr-2 font-medium max-w-[120px] truncate">{c.name}</th>
                                  ))}
                                  {table.columns.length > 6 && <th className="text-left py-1 pr-2 text-muted-foreground">…</th>}
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {tableRows[table.name].map((row, i) => {
                                  const id = (row as any).id;
                                  return (
                                    <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                                      <td className="py-1 pr-2 font-mono text-muted-foreground">{id ?? "—"}</td>
                                      {table.columns.slice(0, 6).map((c) => {
                                        const val = (row as any)[c.name];
                                        const display = val == null ? <span className="text-muted-foreground/40">null</span>
                                          : String(val).length > 30 ? String(val).slice(0, 30) + "…"
                                          : String(val);
                                        return <td key={c.name} className="py-1 pr-2 max-w-[120px] truncate">{display}</td>;
                                      })}
                                      {table.columns.length > 6 && <td className="py-1 pr-2 text-muted-foreground">…</td>}
                                      <td className="py-1">
                                        {id != null && (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => setConfirm({ kind: "row", table: table.name, id })}
                                          >
                                            <Trash2 size={12} />
                                          </Button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {tableRows[table.name].length === 0 && (
                              <p className="text-xs text-muted-foreground py-2">Tabella vuota.</p>
                            )}
                          </div>
                        ) : null}
                      </div>

                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "column") dropColumn.mutate({ table: confirm.table, column: confirm.column });
                else if (confirm.kind === "row") dropRow.mutate({ table: confirm.table, id: confirm.id });
                setConfirm(null);
              }}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
