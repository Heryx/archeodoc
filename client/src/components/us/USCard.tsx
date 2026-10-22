import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatUsCode } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Package,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { buildProjectUrl, getProjectHeader } from "@/lib/project";
import { USAIPanel } from "@/components/us/USAIPanel";
import { USFotoPanel } from "@/components/us/USFotoPanel";

function QcIcon({ status }: { status?: string | null }) {
  if (status === "ok") return <CheckCircle2 size={13} className="text-green-600 shrink-0" />;
  if (status === "error") return <AlertCircle size={13} className="text-red-600 shrink-0" />;
  if (status === "warning") return <AlertTriangle size={13} className="text-amber-500 shrink-0" />;
  return <Clock size={13} className="text-muted-foreground shrink-0" />;
}

type USCardProps = {
  us: any;
  cantiereId?: number;
  modelName?: string;
  completionStatus?: "bozza" | "completa";
  onGenerate: (id: number) => void;
  onAiFill: (us: any) => void;
  onEdit: (us: any) => void;
  onDelete: (us: any) => void;
  onOpenMateriali?: (us: any) => void;
  onExportDocx?: (us: any) => void;
  onRunQc?: (id: number) => void;
  qcPending?: boolean;
  aiAvailable?: boolean;
};

export function USCard({
  us,
  cantiereId,
  modelName,
  completionStatus = "bozza",
  onGenerate,
  onAiFill,
  onEdit,
  onDelete,
  onOpenMateriali,
  onExportDocx,
  onRunQc,
  qcPending,
  aiAvailable,
}: USCardProps) {
  const { settings: codeSettings } = useProjectCodeSettings();
  const [expanded, setExpanded] = useState(false);
  const [, navigateTo] = useLocation();
  const backlinksQuery = useQuery<{ links: Record<string, { id: number; titolo: string }[]> }>({
    queryKey: ["/api/cantieri", String(cantiereId), "relazioni-links"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/relazioni-links`)).json(),
    enabled: cantiereId != null,
  });
  const backlinks = backlinksQuery.data?.links?.[String(us.id)] || [];
  const [showAllIssues, setShowAllIssues] = useState(false);

  const handleExportFormat = async (usId: number, fmt: "pdf" | "odt" | "md") => {
    try {
      const res = await fetch(buildProjectUrl(`/api/us/${usId}/export-${fmt}`), { headers: getProjectHeader() });
      if (!res.ok) throw new Error((await res.json()).error || "Errore export");
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `Scheda_${us.codiceUS}.${fmt}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export error:", err);
    }
  };

  let qcIssues: any[] = [];
  try {
    qcIssues = JSON.parse(us.qcProblemi || "[]");
  } catch {
    qcIssues = [];
  }

  // Count filled relation fields
  const TOP_LEVEL_REL_KEYS = ["copre", "coperto_da", "si_lega_a", "uguale_a"] as const;
  const SCHEDA_REL_KEYS = ["taglia", "tagliatoDa", "riempie", "riempitoDa", "siAppoggiaA", "gliSiAppoggia", "posterioreA", "anterioreA"] as const;
  let relCount = 0;
  for (const k of TOP_LEVEL_REL_KEYS) {
    if (us[k]?.trim()) relCount++;
  }
  try {
    const sd = JSON.parse(us.schedaData || "{}");
    for (const k of SCHEDA_REL_KEYS) {
      if (sd[k]?.trim()) relCount++;
    }
  } catch { /* ignore */ }
  const visibleIssues = showAllIssues ? qcIssues : qcIssues.slice(0, 3);
  const hiddenIssuesCount = Math.max(0, qcIssues.length - visibleIssues.length);

  const borderColor =
    us.qcStatus === "error"
      ? "border-l-red-500"
      : us.qcStatus === "warning"
        ? "border-l-amber-500"
        : us.qcStatus === "ok"
          ? "border-l-green-500"
          : "border-l-border";

  return (
    <div
      data-testid={`card-us-${us.id}`}
      className={cn(
        "rounded-lg border border-border border-l-4 bg-card transition-shadow",
        borderColor,
        expanded ? "shadow-md" : "hover:shadow-sm",
      )}
    >
      {/* ── Riga collassata (sempre visibile) ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />

        <span className="font-mono font-semibold text-primary text-sm w-20 shrink-0">{formatUsCode(us.codiceUS, us.tipo, codeSettings.tombaStyle)}</span>

        {us.tipo && (
          <Badge variant="secondary" className="text-[11px] capitalize hidden sm:inline-flex">
            {us.tipo}
          </Badge>
        )}

        {us.definizione && (
          <span className="text-sm text-muted-foreground truncate flex-1 hidden md:block">
            {us.definizione}
          </span>
        )}
        {!us.definizione && us.descrizione && (
          <span className="text-sm text-muted-foreground truncate flex-1 hidden md:block">
            {us.descrizione}
          </span>
        )}

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {relCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] tabular-nums hidden sm:inline-flex gap-0.5 px-1.5"
              title={`${relCount} relazion${relCount === 1 ? "e" : "i"} stratigrafica${relCount === 1 ? "" : "e"}`}
            >
              R:{relCount}
            </Badge>
          )}
          <QcIcon status={us.qcStatus} />
          {us.daRivedere && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide gap-1 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
              title="Importata dall'elenco US: da rivedere e completare"
            >
              <AlertTriangle size={10} /> Da rivedere
            </Badge>
          )}
          <Badge
            variant={completionStatus === "completa" ? "default" : "secondary"}
            className="text-[10px] uppercase tracking-wide hidden sm:inline-flex"
          >
            {completionStatus === "completa" ? "Completa" : "Bozza"}
          </Badge>
          {modelName && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide hidden lg:inline-flex">
              {modelName}
            </Badge>
          )}
          {/* Azioni rapide sempre visibili */}
          <button
            type="button"
            className="ml-1 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Modifica"
            onClick={(e) => { e.stopPropagation(); onEdit(us); }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-600 transition-colors"
            title="Elimina"
            onClick={(e) => { e.stopPropagation(); onDelete(us); }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Pannello espanso ── */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50">
          <div className="flex items-start gap-4 mt-2">
            {/* Info colonna sinistra */}
            <div className="flex-1 min-w-0 space-y-2">
              {us.descrizione && (
                <p className="text-sm text-muted-foreground">{us.descrizione}</p>
              )}

              {(us.quota != null || us.quotaPianoCampagna != null) && (
                <p className="text-xs text-muted-foreground">
                  {us.quota != null ? `Quota s.l.m.: ${us.quota} m` : "Quota s.l.m.: n.d."}
                  {us.quotaPianoCampagna != null ? ` • Quota da p.c.: ${us.quotaPianoCampagna} m` : ""}
                </p>
              )}

              {us.giornataId && (
                <p className="text-xs text-muted-foreground">Giornata #{us.giornataId}</p>
              )}

              {qcIssues.length > 0 && (
                <div className="space-y-0.5 mt-1">
                  {visibleIssues.map((issue: any, i: number) => (
                    <div
                      key={i}
                      className={cn(
                        "text-xs px-2 py-0.5 rounded",
                        issue.livello === "error"
                          ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                          : issue.livello === "warning"
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
                      )}
                    >
                      {issue.messaggio}
                    </div>
                  ))}
                  {qcIssues.length > 3 && (
                    <div className="flex items-center gap-2 px-1 pt-1">
                      {hiddenIssuesCount > 0 && (
                        <span className="text-xs text-muted-foreground">+{hiddenIssuesCount} altri problemi</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => setShowAllIssues((prev) => !prev)}
                      >
                        {showAllIssues ? "Mostra meno" : "Mostra tutti"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <USAIPanel usId={us.id} schedaAiGenerata={us.schedaAiGenerata} />

              {cantiereId && (
                <div className="mt-2 pt-2 border-t border-border/40">
                  <USFotoPanel usId={us.id} cantiereId={cantiereId} compact />
                </div>
              )}
            </div>

            {/* Azioni colonna destra */}
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={() => onEdit(us)}
              >
                <Pencil size={12} /> Modifica
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={() => onGenerate(us.id)}
                disabled={!aiAvailable}
                title={!aiAvailable ? "Configura una chiave AI nel file .env" : undefined}
              >
                <Wand2 size={12} /> Analizza AI
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={() => onAiFill(us)}
                disabled={!aiAvailable}
                title={!aiAvailable ? "Configura una chiave AI nel file .env" : undefined}
              >
                <Sparkles size={12} /> Compila da diario
              </Button>
              {onRunQc && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  onClick={() => onRunQc(us.id)}
                  disabled={qcPending}
                >
                  <ShieldCheck size={12} /> {qcPending ? "QC..." : "Esegui QC"}
                </Button>
              )}
              {onOpenMateriali && (
                <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onOpenMateriali(us)}>
                  <Package size={12} /> Materiali
                </Button>
              )}
              {backlinks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="gap-1 text-xs">
                      <FileText size={12} /> Citata in {backlinks.length}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {backlinks.map((b) => (
                      <DropdownMenuItem key={b.id} onClick={() => navigateTo(`/cantiere/${cantiereId}/documentazioni?openDocId=${b.id}`)}>
                        {b.titolo}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {onExportDocx && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="gap-1 text-xs">
                      <Download size={12} /> Esporta scheda
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onExportDocx(us)}>
                      <FileText size={13} className="mr-2" /> Scheda .docx
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportFormat(us.id, "pdf")}>
                      <FileText size={13} className="mr-2" /> Scheda .pdf
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportFormat(us.id, "odt")}>
                      <FileText size={13} className="mr-2" /> Scheda .odt
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExportFormat(us.id, "md")}>
                      <FileText size={13} className="mr-2" /> Scheda .md
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-xs text-red-600 hover:text-red-700"
                onClick={() => onDelete(us)}
              >
                <Trash2 size={12} /> Elimina
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
