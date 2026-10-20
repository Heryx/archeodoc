import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  SkipForward,
  RefreshCw,
  PlusCircle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Download,
  Table2,
  Ban,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";

// ── Tipi (specchio di server/routes/us_import.ts) ────────────────────────────

type USImportDecision = "create" | "update" | "skip";

type USImportConflictField = {
  campo: string;
  vecchioValore: string | null;
  nuovoValore: string | null;
};

type USImportItem = {
  codiceUS: string;
  campiEstratti: Record<string, unknown>;
  confidenceMedia: "alta" | "media" | "bassa";
  esistente: null | {
    id: number;
    codiceUS: string;
    definizione: string | null;
    descrizione: string | null;
    interpretazione: string | null;
  };
  conflitti: USImportConflictField[];
  decisioneSuggerita: USImportDecision;
};

type USImportPreview = {
  items: USImportItem[];
  testoLunghezza: number;
  avvisi: string[];
};

type USImportApplyItem = {
  codiceUS: string;
  decisione: USImportDecision;
  esistenteId?: number;
  campiEstratti: Record<string, unknown>;
};

type USImportApplyResult = {
  creati: number;
  aggiornati: number;
  saltati: number;
  errori: Array<{ codiceUS: string; errore: string }>;
  report: string;
};

// ── Tipi per il mapping colonne interattivo (xlsx/csv) ────────────────────────

type FieldCandidate = { key: string; label: string };

type USImportColumnSuggestion = {
  header: string;
  match: { key: string; label: string; score: number } | null;
};

type USImportColumnsResult = {
  headers: string[];
  rows: string[][];
  suggestions: USImportColumnSuggestion[];
  knownFields: FieldCandidate[];
  headerRowIndex: number;
  skippedRows: number;
};

type ColumnMappingAction = "use-existing" | "create-new" | "ignore";

type ColumnMappingDecision = {
  action: ColumnMappingAction;
  existingKey?: string;
  label: string;
};

function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

function normalizeSearch(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue; // segni diacritici combinanti
    out += ch;
  }
  return out.toLowerCase().trim();
}

/** Combobox con ricerca per scegliere il campo a cui abbinare una colonna: filtra i campi noti
 * mentre si digita (invece di mostrarli tutti in un elenco lungo e senza ordine), con "Ignora
 * colonna" e "Crea nuovo campo" sempre visibili in cima. */
function FieldPicker({
  knownFields,
  decision,
  onChange,
}: {
  knownFields: FieldCandidate[];
  decision: ColumnMappingDecision;
  onChange: (next: ColumnMappingDecision) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? knownFields.filter((f) => {
        const q = normalizeSearch(search);
        return normalizeSearch(f.label).includes(q) || normalizeSearch(f.key).includes(q);
      })
    : knownFields;

  const triggerLabel =
    decision.action === "use-existing" ? (knownFields.find((f) => f.key === decision.existingKey)?.label || decision.existingKey || "Campo esistente")
    : decision.action === "create-new" ? "+ Crea nuovo campo"
    : "Ignora colonna";

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 text-xs flex-1 min-w-[200px] justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown size={12} className="opacity-50 shrink-0 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Cerca campo..." value={search} onValueChange={setSearch} className="text-xs" />
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange({ action: "ignore", label: decision.label }); setOpen(false); }} className="text-xs gap-2">
                <Ban size={12} className="text-muted-foreground" /> Ignora colonna
              </CommandItem>
              <CommandItem
                onSelect={() => { onChange({ action: "create-new", label: search.trim() || decision.label }); setOpen(false); }}
                className="text-xs gap-2"
              >
                <PlusCircle size={12} className="text-muted-foreground" />
                Crea nuovo campo{search.trim() ? `: "${search.trim()}"` : ""}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Campi esistenti">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">Nessun campo corrispondente.</p>
              )}
              {filtered.map((f) => (
                <CommandItem
                  key={f.key}
                  onSelect={() => { onChange({ action: "use-existing", existingKey: f.key, label: f.label }); setOpen(false); }}
                  className="text-xs gap-2 justify-between"
                >
                  <span className="truncate">{f.label}</span>
                  <span className="text-muted-foreground font-mono text-[10px] shrink-0">{f.key}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidenceBadge(c: "alta" | "media" | "bassa") {
  if (c === "alta") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-[10px]">alta</Badge>;
  if (c === "bassa") return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-[10px]">bassa</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-[10px]">media</Badge>;
}

function decisionLabel(d: USImportDecision) {
  if (d === "create") return { label: "Crea", icon: <PlusCircle size={12} />, cls: "text-green-700 dark:text-green-400" };
  if (d === "update") return { label: "Aggiorna", icon: <RefreshCw size={12} />, cls: "text-blue-700 dark:text-blue-400" };
  return { label: "Salta", icon: <SkipForward size={12} />, cls: "text-muted-foreground" };
}

// ── Componente singola US in anteprima ────────────────────────────────────────

function USPreviewRow({
  item,
  decisione,
  onDecisione,
}: {
  item: USImportItem;
  decisione: USImportDecision;
  onDecisione: (d: USImportDecision) => void;
}) {
  const [expanded, setExpanded] = useState(item.conflitti.length > 0);
  const hasConflitti = item.conflitti.length > 0;
  const dec = decisionLabel(decisione);

  return (
    <div className={cn(
      "rounded-md border p-3 space-y-2",
      decisione === "skip" ? "border-border opacity-60" :
      item.esistente ? "border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20" :
      "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/20",
    )}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-sm">{item.codiceUS}</span>
          {confidenceBadge(item.confidenceMedia)}
          {item.esistente && (
            <Badge variant="outline" className="text-[10px]">esistente</Badge>
          )}
          {hasConflitti && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-[10px]">
              {item.conflitti.length} diff
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Pulsanti decisione */}
          <Button
            size="sm"
            variant={decisione === "create" ? "default" : "ghost"}
            className="h-6 px-2 text-xs gap-1"
            onClick={() => onDecisione("create")}
            disabled={!!item.esistente}
            title={item.esistente ? "US già esistente" : "Crea nuova US"}
          >
            <PlusCircle size={11} /> Crea
          </Button>
          <Button
            size="sm"
            variant={decisione === "update" ? "default" : "ghost"}
            className="h-6 px-2 text-xs gap-1"
            onClick={() => onDecisione("update")}
            disabled={!item.esistente}
            title={!item.esistente ? "Nessuna US esistente da aggiornare" : "Aggiorna US esistente"}
          >
            <RefreshCw size={11} /> Aggiorna
          </Button>
          <Button
            size="sm"
            variant={decisione === "skip" ? "default" : "ghost"}
            className="h-6 px-2 text-xs gap-1"
            onClick={() => onDecisione("skip")}
          >
            <SkipForward size={11} /> Salta
          </Button>
        </div>
      </div>

      {/* Definizione/descrizione estratta */}
      {!!item.campiEstratti.definizione && (
        <p className="text-xs text-muted-foreground truncate">
          <span className="font-medium">Definizione:</span> {String(item.campiEstratti.definizione)}
        </p>
      )}
      {!!item.campiEstratti.descrizione && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          <span className="font-medium">Descrizione:</span> {String(item.campiEstratti.descrizione)}
        </p>
      )}

      {/* Conflitti */}
      {hasConflitti && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400 hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {item.conflitti.length} campo/i con valori diversi dall'esistente
          </button>
          {expanded && (
            <div className="mt-2 rounded border border-orange-200 dark:border-orange-800 overflow-hidden text-xs">
              <table className="w-full">
                <thead className="bg-orange-50 dark:bg-orange-950/40">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Campo</th>
                    <th className="text-left px-2 py-1 font-medium text-muted-foreground">Nel DB</th>
                    <th className="text-left px-2 py-1 font-medium text-orange-700 dark:text-orange-400">Dal documento</th>
                  </tr>
                </thead>
                <tbody>
                  {item.conflitti.map((c) => (
                    <tr key={c.campo} className="border-t border-orange-100 dark:border-orange-900">
                      <td className="px-2 py-1 font-mono">{c.campo}</td>
                      <td className="px-2 py-1 text-muted-foreground max-w-[120px] truncate">{c.vecchioValore ?? "—"}</td>
                      <td className="px-2 py-1 text-orange-700 dark:text-orange-300 max-w-[120px] truncate">{c.nuovoValore ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Campi estratti (collassato) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
          {Object.keys(item.campiEstratti).length} campi estratti
        </summary>
        <div className="mt-1 flex flex-wrap gap-1">
          {Object.entries(item.campiEstratti).map(([k, v]) => (
            <span key={k} className="bg-muted border border-border rounded px-1 py-0.5">
              <span className="font-medium">{k}:</span>{" "}
              <span className="text-muted-foreground">{Array.isArray(v) ? v.join(", ") : String(v ?? "")}</span>
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Dialog principale ─────────────────────────────────────────────────────────

type Step = "upload" | "mapping" | "preview" | "done";

export function USBatchImportDialog({
  open,
  onOpenChange,
  cid,
  source = "documento",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: string | undefined;
  /** "documento": estrazione AI da testo libero. "elenco": lettura strutturata della tabella del template Elenco US. */
  source?: "documento" | "elenco";
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeProjectId = getCurrentProjectId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewEndpoint = source === "elenco"
    ? `/api/cantieri/${cid}/elenco-us/import/preview`
    : `/api/cantieri/${cid}/us/import/preview`;

  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<USImportPreview | null>(null);
  const [decisioni, setDecisioni] = useState<Record<string, USImportDecision>>({});
  const [result, setResult] = useState<USImportApplyResult | null>(null);

  // ── Mapping colonne (solo xlsx/csv) ──
  const [columnData, setColumnData] = useState<USImportColumnsResult | null>(null);
  const [columnDecisions, setColumnDecisions] = useState<Record<string, ColumnMappingDecision>>({});

  // ── Preview mutation ──
  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("documento", file);
      const url = `${previewEndpoint}?projectId=${encodeURIComponent(activeProjectId || "")}`;
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error || "Errore durante l'analisi del documento"));
      }
      return res.json() as Promise<USImportPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      // Imposta decisioni suggerite
      const init: Record<string, USImportDecision> = {};
      for (const item of data.items) {
        init[item.codiceUS] = item.decisioneSuggerita;
      }
      setDecisioni(init);
      setStep("preview");
    },
    onError: (e: any) => {
      toast({ title: "Errore analisi documento", description: e?.message, variant: "destructive" });
    },
  });

  // ── Mapping colonne mutation (xlsx/csv): rileva intestazioni e propone abbinamenti ──
  const columnsMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("documento", file);
      const url = `/api/cantieri/${cid}/elenco-us/import/columns?projectId=${encodeURIComponent(activeProjectId || "")}`;
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error || "Errore durante la lettura del file"));
      }
      return res.json() as Promise<USImportColumnsResult>;
    },
    onSuccess: (data) => {
      setColumnData(data);
      const init: Record<string, ColumnMappingDecision> = {};
      for (const s of data.suggestions) {
        if (!s.header) continue;
        if (s.match && s.match.score >= 0.75) {
          init[s.header] = { action: "use-existing", existingKey: s.match.key, label: s.header };
        } else {
          init[s.header] = { action: "create-new", label: s.header };
        }
      }
      setColumnDecisions(init);
      setStep("mapping");
    },
    onError: (e: any) => {
      toast({ title: "Errore lettura file", description: e?.message, variant: "destructive" });
    },
  });

  // ── Applica mapping colonne → genera anteprima import ──
  const applyColumnsMutation = useMutation({
    mutationFn: async () => {
      if (!columnData) throw new Error("Nessun file analizzato");
      const decisions = columnData.headers
        .filter((h) => !!h)
        .map((header) => {
          const d = columnDecisions[header] || { action: "ignore" as const, label: header };
          return {
            header,
            action: d.action,
            existingKey: d.action === "use-existing" ? d.existingKey : undefined,
            label: d.action === "create-new" ? d.label : undefined,
          };
        });
      const res = await fetch(
        `/api/cantieri/${cid}/elenco-us/import/apply-columns?projectId=${encodeURIComponent(activeProjectId || "")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headers: columnData.headers, rows: columnData.rows, decisions }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error || "Errore durante l'applicazione del mapping"));
      }
      return res.json() as Promise<USImportPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      const init: Record<string, USImportDecision> = {};
      for (const item of data.items) {
        init[item.codiceUS] = item.decisioneSuggerita;
      }
      setDecisioni(init);
      setStep("preview");
    },
    onError: (e: any) => {
      toast({ title: "Errore mapping colonne", description: e?.message, variant: "destructive" });
    },
  });

  // ── Apply mutation ──
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Nessun preview disponibile");
      const items: USImportApplyItem[] = preview.items.map((item) => ({
        codiceUS: item.codiceUS,
        decisione: decisioni[item.codiceUS] ?? item.decisioneSuggerita,
        esistenteId: item.esistente?.id,
        campiEstratti: item.campiEstratti,
      }));
      const res = await fetch(
        `/api/cantieri/${cid}/us/import/apply?projectId=${encodeURIComponent(activeProjectId || "")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, source }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error || "Errore durante l'applicazione"));
      }
      return res.json() as Promise<USImportApplyResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      // Invalida tutte le query US del cantiere (la chiave include filterGiornata che non conosciamo qui)
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us"] });
      toast({
        title: "Import completato",
        description: source === "elenco"
          ? `${data.creati} create · ${data.aggiornati} aggiornate · ${data.saltati} saltate. Le schede sono segnate "da rivedere": completa e verifica i campi mancanti.`
          : `${data.creati} create · ${data.aggiornati} aggiornate · ${data.saltati} saltate`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Errore import", description: e?.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (source === "elenco" && isSpreadsheetFile(f)) {
        columnsMutation.mutate(f);
      } else {
        previewMutation.mutate(f);
      }
      e.target.value = "";
    }
  };

  const handleDownloadReport = () => {
    if (!result?.report) return;
    const blob = new Blob([result.report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import_us_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    if (applyMutation.isPending || previewMutation.isPending || columnsMutation.isPending || applyColumnsMutation.isPending) return;
    onOpenChange(false);
    // Reset dopo chiusura
    setTimeout(() => {
      setStep("upload");
      setPreview(null);
      setDecisioni({});
      setResult(null);
      setColumnData(null);
      setColumnDecisions({});
    }, 300);
  };

  const countByDecisione = (d: USImportDecision) =>
    Object.values(decisioni).filter((v) => v === d).length;

  // ── Step: upload ──────────────────────────────────────────────────────────
  const renderUpload = () => (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        {source === "elenco"
          ? "Carica l'elenco US compilato in formato .docx (stessa tabella del template Elenco US), oppure .xlsx/.csv con un'intestazione per colonna (es. \"Codice US\", \"Descrizione\"...). I valori vengono letti direttamente, senza AI."
          : "Carica un documento (.docx, .odt, .txt) contenente descrizioni di US — può essere un giornale di scavo, una relazione o testo libero. L'AI identificherà le US e proporrà la compilazione dei campi."}
      </p>
      <div
        className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        {previewMutation.isPending || columnsMutation.isPending ? (
          <>
            <Loader2 size={32} className="animate-spin text-primary" />
            <p className="text-sm font-medium">
              {columnsMutation.isPending ? "Lettura intestazioni in corso..." : source === "elenco" ? "Lettura tabella in corso..." : "Analisi AI in corso..."}
            </p>
            <p className="text-xs text-muted-foreground">Potrebbe richiedere qualche secondo</p>
          </>
        ) : (
          <>
            <Upload size={32} className="text-muted-foreground" />
            <p className="text-sm font-medium">Clicca per selezionare un file</p>
            <p className="text-xs text-muted-foreground">{source === "elenco" ? ".docx · .xlsx · .csv" : ".docx · .odt · .txt"}</p>
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={source === "elenco"
          ? ".docx,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          : ".docx,.odt,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain"}
        className="hidden"
        onChange={handleFileChange}
        disabled={previewMutation.isPending || columnsMutation.isPending}
      />
    </div>
  );

  // ── Step: mapping colonne (xlsx/csv) ─────────────────────────────────────────
  const renderMapping = () => {
    if (!columnData) return null;
    const usedHeaders = columnData.headers.filter((h) => !!h);
    const hasCodiceMapping = usedHeaders.some((h) => columnDecisions[h]?.action === "use-existing" && columnDecisions[h]?.existingKey === "codiceUS");

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Abbina ogni colonna del file a un campo esistente, scegli di crearne uno nuovo, oppure ignorala.
          {" "}{columnData.rows.length} righe dati rilevate.
          {columnData.skippedRows > 0 && (
            <> Intestazioni trovate alla riga {columnData.headerRowIndex + 1} del foglio ({columnData.skippedRows} riga/righe iniziali ignorate).</>
          )}
        </p>

        {!hasCodiceMapping && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20 p-3 text-xs text-yellow-800 dark:text-yellow-200">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            Nessuna colonna è abbinata al "Codice US": seleziona quale colonna lo contiene prima di continuare.
          </div>
        )}

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {usedHeaders.map((header) => {
            const decision = columnDecisions[header] || { action: "ignore" as const, label: header };
            const suggestion = columnData.suggestions.find((s) => s.header === header)?.match || null;
            const sampleValue = columnData.rows.find((r) => {
              const idx = columnData.headers.indexOf(header);
              return idx >= 0 && r[idx];
            });
            const sampleIdx = columnData.headers.indexOf(header);
            const sample = sampleValue && sampleIdx >= 0 ? sampleValue[sampleIdx] : "";

            return (
              <div key={header} className="rounded-md border border-border p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{header}</span>
                    {sample && (
                      <span className="block text-xs text-muted-foreground truncate max-w-[280px]">es. "{sample}"</span>
                    )}
                  </div>
                  {suggestion && decision.action === "use-existing" && (
                    <span className="text-[11px] text-muted-foreground">
                      suggerito: <strong>{suggestion.label}</strong>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <FieldPicker
                    knownFields={columnData.knownFields}
                    decision={decision}
                    onChange={(next) => setColumnDecisions((prev) => ({ ...prev, [header]: next }))}
                  />
                  {decision.action === "create-new" && (
                    <Input
                      className="h-8 text-xs flex-1 min-w-[160px]"
                      value={decision.label}
                      onChange={(e) => setColumnDecisions((prev) => ({
                        ...prev,
                        [header]: { ...(prev[header] as ColumnMappingDecision), label: e.target.value },
                      }))}
                      placeholder="Nome del nuovo campo"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Step: preview ─────────────────────────────────────────────────────────
  const renderPreview = () => {
    if (!preview) return null;
    const nuove = preview.items.filter((i) => !i.esistente).length;
    const conConflitti = preview.items.filter((i) => i.conflitti.length > 0).length;

    return (
      <div className="space-y-4">
        {/* Sommario */}
        <div className="rounded-md bg-muted/40 border border-border p-3 flex flex-wrap gap-4 text-sm">
          <span><span className="font-semibold">{preview.items.length}</span> US identificate</span>
          <span className="text-green-700 dark:text-green-400"><span className="font-semibold">{nuove}</span> nuove</span>
          {conConflitti > 0 && (
            <span className="text-orange-700 dark:text-orange-400"><span className="font-semibold">{conConflitti}</span> con differenze</span>
          )}
          {source !== "elenco" && (
            <span className="text-muted-foreground text-xs ml-auto">
              {(preview.testoLunghezza / 1000).toFixed(1)}k caratteri analizzati
            </span>
          )}
        </div>

        {/* Avvisi */}
        {preview.avvisi.map((a, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20 p-3 text-xs text-yellow-800 dark:text-yellow-200">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {a}
          </div>
        ))}

        {/* Azioni globali */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>Seleziona tutto:</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
            onClick={() => setDecisioni(Object.fromEntries(preview.items.map((i) => [i.codiceUS, i.decisioneSuggerita])))}>
            Suggerito
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
            onClick={() => setDecisioni(Object.fromEntries(preview.items.map((i) => [i.codiceUS, i.esistente ? "update" : "create"])))}>
            Tutto
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
            onClick={() => setDecisioni(Object.fromEntries(preview.items.map((i) => [i.codiceUS, "skip"])))}>
            Salta tutto
          </Button>
          <span className="ml-auto">
            {countByDecisione("create")} crea · {countByDecisione("update")} aggiorna · {countByDecisione("skip")} salta
          </span>
        </div>

        {/* Lista US */}
        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
          {preview.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nessuna US identificata nel documento.
            </p>
          ) : (
            preview.items.map((item) => (
              <USPreviewRow
                key={item.codiceUS}
                item={item}
                decisione={decisioni[item.codiceUS] ?? item.decisioneSuggerita}
                onDecisione={(d) => setDecisioni((prev) => ({ ...prev, [item.codiceUS]: d }))}
              />
            ))
          )}
        </div>
      </div>
    );
  };

  // ── Step: done ────────────────────────────────────────────────────────────
  const renderDone = () => {
    if (!result) return null;
    const allZero = result.creati === 0 && result.aggiornati === 0;
    return (
      <div className="space-y-4 py-2">
        <div className="flex items-center gap-3">
          {allZero && result.errori.length === 0
            ? <AlertTriangle size={28} className="text-yellow-500 shrink-0" />
            : <CheckCircle2 size={28} className="text-green-600 dark:text-green-400 shrink-0" />
          }
          <div>
            <p className="font-semibold">{allZero ? "Nessuna US importata" : "Import completato"}</p>
            <p className="text-sm text-muted-foreground">
              {result.creati} create · {result.aggiornati} aggiornate · {result.saltati} saltate
              {result.errori.length > 0 && ` · ${result.errori.length} errori`}
            </p>
          </div>
        </div>
        {result.errori.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20 p-3 space-y-1">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">Errori:</p>
            {result.errori.map((e) => (
              <p key={e.codiceUS} className="text-xs text-red-700 dark:text-red-300">
                <span className="font-mono">{e.codiceUS}</span>: {e.errore}
              </p>
            ))}
          </div>
        )}
        {/* Report inline scrollabile */}
        <details open={allZero}>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
            Dettaglio operazioni
          </summary>
          <pre className="mt-2 text-[11px] bg-muted/40 border border-border rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {result.report}
          </pre>
        </details>
        <Button variant="outline" className="gap-2 w-full" onClick={handleDownloadReport}>
          <Download size={14} /> Scarica report (.md)
        </Button>
      </div>
    );
  };

  const stepTitle: Record<Step, string> = {
    upload: source === "elenco" ? "Import da elenco US" : "Import US da documento",
    mapping: "Abbina colonne ai campi",
    preview: "Anteprima import US",
    done: "Import completato",
  };

  const mappingHasCodice = columnData
    ? columnData.headers.some((h) => !!h && columnDecisions[h]?.action === "use-existing" && columnDecisions[h]?.existingKey === "codiceUS")
    : false;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "mapping" ? <Table2 size={18} /> : <FileText size={18} />}
            {stepTitle[step]}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && renderUpload()}
        {step === "mapping" && renderMapping()}
        {step === "preview" && renderPreview()}
        {step === "done" && renderDone()}

        <DialogFooter className="mt-2">
          {step === "upload" && (
            <Button variant="ghost" onClick={handleClose}>Annulla</Button>
          )}
          {step === "mapping" && (
            <>
              <Button variant="ghost" onClick={() => { setStep("upload"); setColumnData(null); setColumnDecisions({}); }}>
                ← Ricarica file
              </Button>
              <Button
                onClick={() => applyColumnsMutation.mutate()}
                disabled={applyColumnsMutation.isPending || !mappingHasCodice}
              >
                {applyColumnsMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Applicazione mapping...</>
                ) : (
                  "Continua"
                )}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => { setStep(columnData ? "mapping" : "upload"); setPreview(null); }}>
                ← {columnData ? "Modifica mapping" : "Ricarica file"}
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || countByDecisione("create") + countByDecisione("update") === 0}
              >
                {applyMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Applicazione...</>
                ) : (
                  `Applica (${countByDecisione("create") + countByDecisione("update")} US)`
                )}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Chiudi</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
