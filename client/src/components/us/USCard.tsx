import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Package, Pencil, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { USAIPanel } from "@/components/us/USAIPanel";

function QcIcon({ status }: { status?: string | null }) {
  if (status === "ok") return <CheckCircle2 size={14} className="text-green-600" />;
  if (status === "error") return <AlertCircle size={14} className="text-red-600" />;
  if (status === "warning") return <AlertTriangle size={14} className="text-amber-500" />;
  return <Clock size={14} className="text-muted-foreground" />;
}

type USCardProps = {
  us: any;
  modelName?: string;
  completionStatus?: "bozza" | "completa";
  onGenerate: (id: number) => void;
  onAiFill: (us: any) => void;
  onEdit: (us: any) => void;
  onDelete: (us: any) => void;
  onOpenMateriali?: (us: any) => void;
  aiAvailable?: boolean;
};

export function USCard({
  us,
  modelName,
  completionStatus = "bozza",
  onGenerate,
  onAiFill,
  onEdit,
  onDelete,
  onOpenMateriali,
  aiAvailable,
}: USCardProps) {
  const [showAllIssues, setShowAllIssues] = useState(false);

  let qcIssues: any[] = [];
  try {
    qcIssues = JSON.parse(us.qcProblemi || "[]");
  } catch {
    qcIssues = [];
  }
  const visibleIssues = showAllIssues ? qcIssues : qcIssues.slice(0, 3);
  const hiddenIssuesCount = Math.max(0, qcIssues.length - visibleIssues.length);

  return (
    <Card
      data-testid={`card-us-${us.id}`}
      className={cn(
        "border-l-4",
        us.qcStatus === "error"
          ? "border-l-red-500"
          : us.qcStatus === "warning"
            ? "border-l-amber-500"
            : us.qcStatus === "ok"
              ? "border-l-green-500"
              : "border-l-border",
      )}
    >
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono font-semibold text-primary">{us.codiceUS}</span>
              {us.tipo && (
                <Badge variant="secondary" className="text-xs capitalize">
                  {us.tipo}
                </Badge>
              )}
              {modelName && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {modelName}
                </Badge>
              )}
              <Badge
                variant={completionStatus === "completa" ? "default" : "secondary"}
                className="text-[10px] uppercase tracking-wide"
              >
                {completionStatus === "completa" ? "Completa" : "Bozza"}
              </Badge>
              <QcIcon status={us.qcStatus} />
              {us.giornataId && <span className="text-xs text-muted-foreground">Giornata #{us.giornataId}</span>}
            </div>
            {us.descrizione && <p className="text-sm text-muted-foreground line-clamp-2">{us.descrizione}</p>}
            {(us.quota != null || us.quotaPianoCampagna != null) && (
              <p className="text-xs text-muted-foreground mt-1">
                {us.quota != null ? `Quota s.l.m.: ${us.quota} m` : "Quota s.l.m.: n.d."}
                {us.quotaPianoCampagna != null ? ` • Quota da p.c.: ${us.quotaPianoCampagna} m` : ""}
              </p>
            )}
            {qcIssues.length > 0 && (
              <div className="mt-2 space-y-0.5">
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
                      <div className="text-xs text-muted-foreground px-1">+{hiddenIssuesCount} altri problemi</div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setShowAllIssues((prev) => !prev)}
                    >
                      {showAllIssues ? "Mostra meno" : "Mostra tutti i problemi"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => onGenerate(us.id)}
              disabled={!aiAvailable}
              title={!aiAvailable ? "Configura GEMINI_API_KEY o ANTHROPIC_API_KEY nel file .env per usare l'AI" : undefined}
            >
              <Wand2 size={12} /> Analizza AI
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => onAiFill(us)}
              disabled={!aiAvailable}
              title={!aiAvailable ? "Configura GEMINI_API_KEY o ANTHROPIC_API_KEY nel file .env per usare l'AI" : undefined}
            >
              <Sparkles size={12} /> Compila da diario
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onEdit(us)}>
              <Pencil size={12} /> Modifica
            </Button>
            {onOpenMateriali && (
              <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onOpenMateriali(us)}>
                <Package size={12} /> Materiali
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1 text-xs text-red-600 hover:text-red-700" onClick={() => onDelete(us)}>
              <Trash2 size={12} /> Elimina
            </Button>
          </div>
        </div>
        <USAIPanel usId={us.id} schedaAiGenerata={us.schedaAiGenerata} />
      </CardContent>
    </Card>
  );
}
