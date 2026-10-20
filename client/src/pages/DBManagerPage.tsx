import { useState, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  TableProperties,
  ChevronRight,
  ChevronDown,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Info,
  Rows3,
  Loader2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

type ActiveView = { table: string; tab: "info" | "data" };

type EditingCell = { table: string; rowId: number; column: string; value: string };

const ROW_LIMIT = 200;

export function DBManagerPage() {
  const { cid } = useParams<{ cid: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<ActiveView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [tableRows, setTableRows] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingRows, setLoadingRows] = useState<string | null>(null);
  const [rowOffset, setRowOffset] = useState<Record<string, number>>({});
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const { data: tables = [], isLoading, refetch } = useQuery<TableInfo[]>({
    queryKey: ["/api/db/tables", cid],
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
      toast({ title: `Colonna "${column}" eliminata da "${table}"` });
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

  const updateCell = useMutation({
    mutationFn: async ({ table, id, column, value }: { table: string; id: number; column: string; value: string | null }) => {
      const r = await apiRequest("PATCH", `/api/db/tables/${table}/rows/${id}`, { column, value });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      return r.json() as Promise<{ ok: boolean; row: Record<string, unknown> }>;
    },
    onSuccess: (data, { table }) => {
      setTableRows((prev) => ({
        ...prev,
        [table]: (prev[table] || []).map((r) =>
          (r as any).id === (data.row as any).id ? data.row : r,
        ),
      }));
    },
    onError: (e: Error) => toast({ title: "Errore salvataggio", description: e.message, variant: "destructive" }),
  });

  async function loadRows(table: string, offset = 0) {
    setLoadingRows(table);
    try {
      const r = await apiRequest("GET", `/api/db/tables/${table}/rows?limit=${ROW_LIMIT}&offset=${offset}`);
      const data: Record<string, unknown>[] = await r.json();
      setTableRows((prev) => ({ ...prev, [table]: data }));
      setRowOffset((prev) => ({ ...prev, [table]: offset }));
    } catch {
      toast({ title: "Errore caricamento righe", variant: "destructive" });
    } finally {
      setLoadingRows(null);
    }
  }

  function selectTable(name: string, tab: "info" | "data" = "info") {
    setActiveView({ table: name, tab });
    if (tab === "data" && !tableRows[name]) loadRows(name, 0);
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  }

  function startEdit(table: string, rowId: number, column: string, currentValue: unknown) {
    const value = currentValue == null ? "" : String(currentValue);
    setEditingCell({ table, rowId, column, value });
    // focus after render
    setTimeout(() => editInputRef.current?.select(), 30);
  }

  function commitEdit() {
    if (!editingCell) return;
    const { table, rowId, column, value } = editingCell;
    setEditingCell(null);

    // find original value to detect no-op
    const row = (tableRows[table] || []).find((r) => (r as any).id === rowId);
    const original = row ? (row as any)[column] : undefined;
    const originalStr = original == null ? "" : String(original);
    if (value === originalStr) return; // nessun cambiamento

    updateCell.mutate({ table, id: rowId, column, value: value === "" ? null : value });
  }

  function cancelEdit() {
    setEditingCell(null);
  }

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }, [editingCell]);

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
      setTableRows({});
      refetch();
    } catch (err: any) {
      toast({ title: "Errore ripristino", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  }

  const activeTable = activeView ? tables.find((t) => t.name === activeView.table) : null;
  const rows = activeView ? (tableRows[activeView.table] || []) : [];
  const currentOffset = activeView ? (rowOffset[activeView.table] || 0) : 0;

  const confirmMessage =
    confirm?.kind === "column"
      ? `Eliminare la colonna "${confirm.column}" dalla tabella "${confirm.table}"?\nTutti i dati in quella colonna saranno persi irreversibilmente.`
      : confirm?.kind === "row"
        ? `Eliminare la riga #${confirm.id} dalla tabella "${confirm.table}"? L'operazione è irreversibile.`
        : "";

  return (
    <div className="flex h-screen bg-background">

      {/* ── Pannello sinistro: albero tabelle ── */}
      <aside className="w-60 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Database size={15} className="text-muted-foreground" />
            DB Manager
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Aggiorna"
            onClick={() => { refetch(); setTableRows({}); }}
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Caricamento...
            </div>
          ) : (
            <ul>
              {tables.map((t) => (
                <li key={t.name}>
                  <button
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-muted/60 transition-colors",
                      activeView?.table === t.name && "bg-primary/10 text-primary font-medium",
                    )}
                    onClick={() => {
                      selectTable(t.name, "info");
                      toggleExpand(t.name);
                    }}
                  >
                    {expanded.has(t.name)
                      ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                      : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                    }
                    <TableProperties size={13} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{t.name}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0 shrink-0">
                      {t.rowCount}
                    </Badge>
                  </button>

                  {expanded.has(t.name) && (
                    <ul className="ml-5 border-l border-border/50 pl-2">
                      {t.columns.map((col) => (
                        <li key={col.name}>
                          <button
                            className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                            onClick={() => selectTable(t.name, "info")}
                          >
                            <span className="font-mono truncate">{col.name}</span>
                            {col.pk && <Badge className="text-[9px] px-1 py-0 ml-auto">PK</Badge>}
                            {!col.pk && col.type && (
                              <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">{col.type}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-2 py-2 flex gap-1">
          <Button size="sm" variant="outline" className="flex-1 gap-1 text-xs h-7" onClick={handleBackup}>
            <Download size={12} /> Backup
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1 text-xs h-7"
            onClick={() => restoreRef.current?.click()}
          >
            <Upload size={12} /> Ripristina
          </Button>
          <input ref={restoreRef} type="file" accept=".sqlite,.db" className="hidden" onChange={handleRestore} />
        </div>
      </aside>

      {/* ── Pannello destro: dettaglio tabella ── */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!activeView ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Database size={40} strokeWidth={1} />
            <p className="text-sm">Seleziona una tabella dalla lista a sinistra</p>
          </div>
        ) : (
          <>
            {/* Header tabella + tab */}
            <div className="border-b border-border px-4 py-2 flex items-center gap-4 bg-card shrink-0">
              <span className="font-mono font-semibold text-sm">{activeView.table}</span>
              {activeTable && (
                <Badge variant="secondary" className="text-xs">{activeTable.rowCount} righe</Badge>
              )}
              <div className="flex gap-0 ml-4 border border-border rounded-md overflow-hidden">
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                    activeView.tab === "info"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setActiveView((v) => v ? { ...v, tab: "info" } : v)}
                >
                  <Info size={12} /> Struttura
                </button>
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs border-l border-border transition-colors",
                    activeView.tab === "data"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    setActiveView((v) => v ? { ...v, tab: "data" } : v);
                    if (!tableRows[activeView.table]) loadRows(activeView.table, 0);
                  }}
                >
                  <Rows3 size={12} /> Dati
                </button>
              </div>
              {activeView.tab === "data" && (
                <p className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1">
                  <Pencil size={11} /> Doppio clic su una cella per modificarla
                </p>
              )}
            </div>

            <div className="flex-1 overflow-auto">

              {/* ── Tab Struttura ── */}
              {activeView.tab === "info" && activeTable && (
                <div className="p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8 text-xs">#</TableHead>
                        <TableHead className="text-xs">Nome colonna</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs">Flag</TableHead>
                        <TableHead className="text-xs">Default</TableHead>
                        <TableHead className="w-16 text-xs">Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTable.columns.map((col) => (
                        <TableRow key={col.name}>
                          <TableCell className="text-xs text-muted-foreground">{col.cid}</TableCell>
                          <TableCell className="font-mono text-xs font-medium">{col.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{col.type || "—"}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex gap-1 flex-wrap">
                              {col.pk && <Badge className="text-[10px] px-1.5 py-0">PK</Badge>}
                              {col.notnull && <Badge variant="outline" className="text-[10px] px-1.5 py-0">NOT NULL</Badge>}
                              {col.protected && !col.pk && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">protetta</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {col.dflt_value ?? "—"}
                          </TableCell>
                          <TableCell>
                            {!col.protected && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={`Elimina colonna "${col.name}"`}
                                onClick={() => setConfirm({ kind: "column", table: activeTable.name, column: col.name })}
                              >
                                <Trash2 size={13} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* ── Tab Dati ── */}
              {activeView.tab === "data" && activeTable && (
                <div className="p-4 space-y-3">
                  {loadingRows === activeView.table ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                      <Loader2 size={16} className="animate-spin" /> Caricamento dati...
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {activeTable.columns.map((c) => (
                                <TableHead key={c.name} className="text-xs font-mono whitespace-nowrap">
                                  {c.name}
                                  {c.pk && <span className="ml-1 text-[9px] opacity-50">PK</span>}
                                </TableHead>
                              ))}
                              <TableHead className="w-12" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={activeTable.columns.length + 1} className="text-center text-xs text-muted-foreground py-8">
                                  Tabella vuota
                                </TableCell>
                              </TableRow>
                            ) : (
                              rows.map((row, i) => {
                                const id = (row as any).id;
                                return (
                                  <TableRow key={i} className="hover:bg-muted/30 group">
                                    {activeTable.columns.map((c) => {
                                      const val = (row as any)[c.name];
                                      const isNull = val == null;
                                      const isEditing =
                                        editingCell?.table === activeView.table &&
                                        editingCell.rowId === id &&
                                        editingCell.column === c.name;
                                      const canEdit = !c.pk && id != null;

                                      return (
                                        <TableCell
                                          key={c.name}
                                          className={cn(
                                            "text-xs font-mono p-0",
                                            canEdit && !isEditing && "cursor-pointer",
                                          )}
                                          onDoubleClick={() => {
                                            if (canEdit && !isEditing) startEdit(activeView.table, id, c.name, val);
                                          }}
                                          title={canEdit && !isEditing ? "Doppio clic per modificare" : undefined}
                                        >
                                          {isEditing ? (
                                            <input
                                              ref={editInputRef}
                                              className="w-full min-w-[80px] px-2 py-1.5 text-xs font-mono bg-background border border-primary outline-none ring-1 ring-primary"
                                              value={editingCell.value}
                                              onChange={(e) =>
                                                setEditingCell((prev) => prev ? { ...prev, value: e.target.value } : prev)
                                              }
                                              onKeyDown={handleCellKeyDown}
                                              onBlur={commitEdit}
                                              autoFocus
                                            />
                                          ) : (
                                            <span className={cn(
                                              "block px-2 py-1.5 max-w-[200px] truncate",
                                              isNull ? "text-muted-foreground/40 italic" : "",
                                              canEdit && "group-hover:bg-muted/20",
                                            )}>
                                              {isNull ? "NULL" : String(val).length > 60 ? String(val).slice(0, 60) + "…" : String(val)}
                                            </span>
                                          )}
                                        </TableCell>
                                      );
                                    })}
                                    <TableCell className="w-12 p-1">
                                      {id != null && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                          onClick={() => setConfirm({ kind: "row", table: activeTable.name, id })}
                                        >
                                          <Trash2 size={12} />
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Paginazione */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          Righe {currentOffset + 1}–{currentOffset + rows.length} su {activeTable.rowCount}
                        </span>
                        <div className="flex gap-1 ml-auto">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={currentOffset === 0}
                            onClick={() => loadRows(activeView.table, Math.max(0, currentOffset - ROW_LIMIT))}
                          >
                            Precedenti
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={currentOffset + rows.length >= activeTable.rowCount}
                            onClick={() => loadRows(activeView.table, currentOffset + ROW_LIMIT)}
                          >
                            Successivi
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </main>

      {/* ── Confirm dialog ── */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "column") dropColumn.mutate({ table: confirm.table, column: confirm.column });
                else dropRow.mutate({ table: confirm.table, id: confirm.id });
                setConfirm(null);
              }}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
