import { formatUsCode } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { buildPanelHref } from "@/lib/location";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, BookOpen, Download, ExternalLink, Eye, FileSpreadsheet, Settings2, Upload,
  Search, SlidersHorizontal, Plus, Trash2, X, ArrowUp, ArrowDown, ArrowUpDown, Check,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { USElencoTemplateDialog } from "@/components/us/USElencoTemplateDialog";
import { ElencoTemplateRepairDialog } from "@/components/us/ElencoTemplateRepairDialog";
import { USBatchImportDialog } from "@/components/us/USBatchImportDialog";
import { BASE_US_MODEL_KEY, BUILTIN_US_MODELS, type USModelDefinition } from "@shared/us_models";
import { invalidateUsRelatedQueries } from "@/lib/usCache";
import { useAiAssistant } from "@/components/ai/AiAssistantContext";

/** Confronto testuale case/accent-insensitive per ricerca e filtri. */
function normalizeSearch(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue;
    out += ch;
  }
  return out.toLowerCase().trim();
}

type ConditionOperator = "contains" | "equals" | "empty" | "notEmpty";

type AdvancedCondition = { id: string; colKey: string; operator: ConditionOperator; value: string };

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  contains: "contiene",
  equals: "è uguale a",
  empty: "è vuoto",
  notEmpty: "non è vuoto",
};

/** Cella editabile della tabella Elenco US: clic per modificare, salvataggio inline sulla singola US. */
function ElencoCell({ cid, rowId, colKey, value, clamp = false }: { cid: string; rowId: number; colKey: string; value: string; clamp?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const r = await apiRequest("PATCH", `/api/us/${rowId}/field`, { key: colKey, value: next });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us"] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      invalidateUsRelatedQueries(qc, cid);
    },
    onError: (e: any) => {
      toast({ title: "Errore salvataggio campo", description: e?.message, variant: "destructive" });
    },
  });

  const commit = () => {
    setEditing(false);
    if (draft !== value) mutation.mutate(draft);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="w-full min-w-[140px] resize-none rounded border border-primary/50 bg-background px-1.5 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 40) || 1))}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={clamp && value ? value : "Clicca per modificare"}
      className={cn(
        "block w-full text-left rounded px-1.5 -mx-1.5 py-0.5 hover:bg-muted/60 transition-colors",
        clamp && "line-clamp-2",
      )}
    >
      {value ? value : <span className="text-muted-foreground/50 italic">vuoto</span>}
    </button>
  );
}

/** Popup di dettaglio di una riga Elenco US: mostra tutte le colonne come campi verticali
 * ben leggibili (etichetta sopra, valore modificabile sotto), utile quando i testi sono lunghi
 * e la tabella diventerebbe illeggibile. */
function ElencoRowDetailDialog({
  cid,
  open,
  onOpenChange,
  columns,
  row,
}: {
  cid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: { key: string; label: string }[];
  row: { id: number; daRivedere: boolean; values: Record<string, string> } | null;
}) {
  const { settings: codeSettings } = useProjectCodeSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {row?.values.codiceUS ? <span className="font-mono">{formatUsCode(row.values.codiceUS, row.values.tipo, codeSettings.tombaStyle)}</span> : "Dettaglio US"}
            {row?.daRivedere && (
              <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wide border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                <AlertTriangle size={10} /> Da rivedere
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-3 mt-1">
            {columns.filter((c) => c.key !== "codiceUS").map((col) => (
              <div key={col.key} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{col.label}</p>
                <div className="rounded border border-border bg-muted/20">
                  <ElencoCell cid={cid} rowId={row.id} colKey={col.key} value={row.values[col.key] || ""} />
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ElencoUSPage() {
  const { cid } = useParams<{ cid: string }>();
  const [location] = useLocation();
  const thesaurusHref = buildPanelHref(location, "thesaurus");
  const { toast } = useToast();
  const activeProjectId = getCurrentProjectId();
  const { selectionFilter, setSelectionFilter } = useAiAssistant();

  const [openTemplateDialog, setOpenTemplateDialog] = useState(false);
  const [openImportDialog, setOpenImportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [repairSummary, setRepairSummary] = useState<string[] | null>(null);
  const [detailRowId, setDetailRowId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedConditions, setAdvancedConditions] = useState<AdvancedCondition[]>([]);
  const conditionIdRef = useRef(0);
  const qc = useQueryClient();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "codiceUS", dir: "asc" });
  const [showReview, setShowReview] = useState(false);

  const { data: cantiere } = useQuery<any>({
    queryKey: ["/api/cantieri", cid, activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}`)).json(),
    enabled: !!cid,
  });

  const { data: elencoTable } = useQuery<{ columns: { key: string; label: string }[]; rows: { id: number; daRivedere: boolean; values: Record<string, string> }[] }>({
    queryKey: ["/api/cantieri", cid, "elenco-us", "table", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/elenco-us/table`)).json(),
    enabled: !!cid,
  });
  const columns = elencoTable?.columns || [];
  const rows = elencoTable?.rows || [];

  const filteredRows = useMemo(() => {
    let out = rows;

    if (selectionFilter) {
      const selSet = new Set(selectionFilter);
      out = out.filter((r) => selSet.has(r.id));
    }

    const q = normalizeSearch(searchQuery);
    if (q) {
      out = out.filter((r) => columns.some((c) => normalizeSearch(r.values[c.key] || "").includes(q)));
    }

    for (const cond of advancedConditions) {
      if (!cond.colKey) continue;
      out = out.filter((r) => {
        const raw = r.values[cond.colKey] || "";
        switch (cond.operator) {
          case "contains": return normalizeSearch(raw).includes(normalizeSearch(cond.value));
          case "equals": return normalizeSearch(raw) === normalizeSearch(cond.value);
          case "empty": return !raw.trim();
          case "notEmpty": return !!raw.trim();
          default: return true;
        }
      });
    }

    const collator = new Intl.Collator("it", { numeric: true, sensitivity: "base" });
    const key = sort.key || "codiceUS";
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...out].sort((a, b) => dir * collator.compare(a.values[key] || "", b.values[key] || ""));
  }, [rows, columns, searchQuery, advancedConditions, selectionFilter, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const resolveMutation = useMutation({
    mutationFn: async (ids: number[] | null) =>
      (await apiRequest("POST", `/api/cantieri/${cid}/us/segna-riviste`, ids ? { ids } : {})).json(),
    onSuccess: (r: { count: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us"] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      invalidateUsRelatedQueries(qc, cid);
      toast({ title: `${r.count} US segnate come riviste` });
    },
    onError: (e: any) => toast({ title: "Errore", description: e?.message, variant: "destructive" }),
  });

  const hasActiveFilters = !!searchQuery.trim() || advancedConditions.length > 0;

  const addCondition = () => {
    conditionIdRef.current += 1;
    setAdvancedConditions((prev) => [
      ...prev,
      { id: `c${conditionIdRef.current}`, colKey: columns[0]?.key || "", operator: "contains", value: "" },
    ]);
  };

  const updateCondition = (id: string, patch: Partial<AdvancedCondition>) => {
    setAdvancedConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeCondition = (id: string) => {
    setAdvancedConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const clearFilters = () => {
    setSearchQuery("");
    setAdvancedConditions([]);
  };

  const { data: cantiereModelData } = useQuery<{ model: USModelDefinition; availableModels: USModelDefinition[] }>({
    queryKey: ["/api/cantieri", cid, "us-model", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us-model`)).json(),
    enabled: !!cid,
  });

  const activeModel = cantiereModelData?.model
    || cantiereModelData?.availableModels?.find((m) => m.key === BASE_US_MODEL_KEY)
    || BUILTIN_US_MODELS[0];

  const handleExport = async (format: "docx" | "xlsx" | "csv" = "docx") => {
    setExporting(true);
    try {
      const exportUrl = format === "docx"
        ? `/api/cantieri/${cid}/elenco-us/export-docx`
        : `/api/cantieri/${cid}/elenco-us/export-table?format=${format}`;
      const response = await fetch(buildProjectUrl(exportUrl), {
        headers: getProjectHeader(),
      });
      if (response.status === 409) {
        const payload = await response.json().catch(() => ({}));
        if (payload?.needsTemplateRepair) {
          setRepairSummary((payload.summary as string[]) || []);
          return;
        }
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Errore download");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `Elenco_US_${cid}.${format}`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);

      toast({ title: "Elenco US scaricato" });
    } catch (error: any) {
      toast({
        title: "Errore export elenco US",
        description: error?.message || "Carica prima un template",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 w-full max-w-[1900px] mx-auto">
      <div className="mb-5 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Elenco US</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cantiere?.nome ? <>Cantiere: <span className="font-medium text-foreground">{cantiere.nome}</span> · </> : null}
            {rows.length} US registrate
            {rows.some((r) => r.daRivedere) && (
              <button type="button" onClick={() => setShowReview(true)} title="Mostra le US da rivedere">
                <Badge variant="outline" className="ml-2 gap-1 text-[10px] uppercase tracking-wide border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950">
                  <AlertTriangle size={10} /> {rows.filter((r) => r.daRivedere).length} da rivedere
                </Badge>
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" className="gap-2" asChild>
            <a href={thesaurusHref} title="Apri Indice e Guida (vocabolario e note tecniche ICCD)">
              <BookOpen size={15} /> Guida terminologica
            </a>
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setOpenTemplateDialog(true)}>
            <Settings2 size={15} /> Template elenco US
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setOpenImportDialog(true)}>
            <Upload size={15} /> Importa elenco
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-2" disabled={exporting}>
                <Download size={15} /> {exporting ? "Esportazione..." : "Esporta elenco"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleExport("docx")}>Word (.docx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("csv")}>CSV (.csv)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selectionFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          <SlidersHorizontal size={12} />
          <span>Selezione assistente IA: <strong>{filteredRows.length}</strong> US</span>
          <button type="button" className="ml-auto underline" onClick={() => setSelectionFilter(null)}>
            Mostra tutte
          </button>
        </div>
      )}

      {/* Barra di ricerca e filtri */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca in tutte le colonne..."
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Button
          variant={showAdvanced ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <SlidersHorizontal size={14} /> Filtro avanzato
          {advancedConditions.length > 0 && (
            <Badge variant="outline" className="ml-0.5 h-4 px-1 text-[10px]">{advancedConditions.length}</Badge>
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
            <X size={14} /> Cancella filtri
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {hasActiveFilters ? `${filteredRows.length} di ${rows.length} US` : `${rows.length} US`}
        </span>
      </div>

      {showAdvanced && (
        <div className="mb-3 rounded-md border border-border bg-muted/20 p-3 space-y-2">
          {advancedConditions.length === 0 && (
            <p className="text-xs text-muted-foreground">Nessuna condizione. Aggiungine una per filtrare per campo specifico.</p>
          )}
          {advancedConditions.map((cond) => (
            <div key={cond.id} className="flex items-center gap-2 flex-wrap">
              <Select value={cond.colKey} onValueChange={(v) => updateCondition(cond.id, { colKey: v })}>
                <SelectTrigger className="h-8 text-xs w-[180px]">
                  <SelectValue placeholder="Campo..." />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={cond.operator} onValueChange={(v) => updateCondition(cond.id, { operator: v as ConditionOperator })}>
                <SelectTrigger className="h-8 text-xs w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
                    <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cond.operator !== "empty" && cond.operator !== "notEmpty" && (
                <Input
                  value={cond.value}
                  onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
                  placeholder="Valore..."
                  className="h-8 text-xs flex-1 min-w-[140px]"
                />
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeCondition(cond.id)}>
                <Trash2 size={14} className="text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={addCondition} disabled={columns.length === 0}>
            <Plus size={14} /> Aggiungi condizione
          </Button>
        </div>
      )}

      <div className="rounded-md border border-border">
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="sticky top-0 z-20 bg-muted text-left px-3 py-2 font-medium whitespace-nowrap border-b border-border">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-primary" onClick={() => toggleSort(col.key)} title="Ordina per questa colonna">
                      {col.label}
                      {sort.key === col.key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}
                    </button>
                  </th>
                ))}
                <th className="sticky top-0 right-0 z-30 bg-muted text-left px-3 py-2 font-medium whitespace-nowrap w-0 border-b border-l border-border shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1) + 1} className="px-3 py-8 text-center text-muted-foreground">
                    {rows.length === 0 ? "Nessuna US registrata in questo cantiere." : "Nessuna US corrisponde ai filtri applicati."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className={cn("border-t border-border", row.daRivedere && "bg-amber-50/40 dark:bg-amber-950/10")}>
                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-1.5 align-top",
                          col.key === "codiceUS" ? "font-mono whitespace-nowrap" : "text-muted-foreground max-w-xs",
                        )}
                      >
                        <div className="flex items-start gap-1.5">
                          {i === 0 && row.daRivedere && (
                            <AlertTriangle
                              size={13}
                              className="mt-1 shrink-0 text-amber-600 dark:text-amber-400"
                              aria-label="Importata dall'elenco: da rivedere"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <ElencoCell cid={cid!} rowId={row.id} colKey={col.key} value={row.values[col.key] || ""} clamp={col.key !== "codiceUS"} />
                          </div>
                        </div>
                      </td>
                    ))}
                    <td
                      className={cn(
                        "sticky right-0 z-10 px-3 py-1.5 align-top whitespace-nowrap border-l border-border shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]",
                        row.daRivedere ? "bg-amber-50 dark:bg-amber-950" : "bg-background",
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 gap-1 text-xs"
                          onClick={() => setDetailRowId(row.id)}
                        >
                          <Eye size={13} /> Visualizza
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 gap-1 text-xs"
                          asChild
                        >
                          <a href={`#/cantiere/${cid}/us?openUsId=${row.id}`} title="Apri la scheda US completa">
                            <ExternalLink size={13} /> Scheda
                          </a>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <FileSpreadsheet size={14} className="shrink-0 mt-0.5" />
        <p>
          Clicca su una cella per modificarla direttamente. Le colonne mostrate seguono automaticamente il
          template .docx caricato (o, in assenza di template, i campi già compilati nelle US). Carica un
          template con placeholder nelle celle per definire la struttura precisa da esportare, oppure importa
          in batch le US da un elenco già compilato in formato Word, Excel (.xlsx) o CSV — le schede create o
          aggiornate dall'import vengono segnate "da rivedere" (<AlertTriangle size={11} className="inline text-amber-600 dark:text-amber-400" />)
          finché non vengono salvate come complete dalla scheda US.
        </p>
      </div>

      <USElencoTemplateDialog
        open={openTemplateDialog}
        onOpenChange={setOpenTemplateDialog}
        cid={cid}
        activeModel={activeModel}
      />

      <USBatchImportDialog
        open={openImportDialog}
        onOpenChange={setOpenImportDialog}
        cid={cid}
        source="elenco"
      />

      <ElencoTemplateRepairDialog
        open={repairSummary != null}
        onOpenChange={(next) => { if (!next) setRepairSummary(null); }}
        cid={cid}
        summary={repairSummary || []}
        onResolved={() => { setRepairSummary(null); void handleExport(); }}
      />

      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" /> US da rivedere
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Queste US sono state create o aggiornate da un import dell'elenco e non sono ancora state verificate.
            Il segnale si rimuove salvando la scheda come completa, oppure con "Segna rivista".
          </p>
          {(() => {
            const flagged = filteredRows.filter((r) => r.daRivedere);
            if (flagged.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nessuna US da rivedere.</p>;
            return (
              <>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="gap-1" disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate(null)}>
                    <Check size={13} /> Segna tutte come riviste ({rows.filter((r) => r.daRivedere).length})
                  </Button>
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {flagged.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-mono w-16 shrink-0">{r.values.codiceUS}</span>
                      <span className="flex-1 min-w-0 truncate text-muted-foreground">
                        {[r.values.tipo, r.values.definizione].filter(Boolean).join(" · ") || "—"}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" asChild>
                        <a href={`#/cantiere/${cid}/us?openUsId=${r.id}`}><ExternalLink size={12} /> Scheda</a>
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate([r.id])}>
                        <Check size={12} /> Segna rivista
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <ElencoRowDetailDialog
        cid={cid!}
        open={detailRowId != null}
        onOpenChange={(next) => { if (!next) setDetailRowId(null); }}
        columns={columns}
        row={rows.find((r) => r.id === detailRowId) || null}
      />
    </div>
  );
}
