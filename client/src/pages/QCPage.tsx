import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, AlertCircle, AlertTriangle, Info, RefreshCw, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getCurrentProjectId } from "@/lib/project";

function IssueRow({ issue }: { issue: any }) {
  const map = {
    error: { icon: AlertCircle, cls: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
    warning: { icon: AlertTriangle, cls: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
    info: { icon: Info, cls: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
  } as any;
  const { icon: Icon, cls, bg } = map[issue.livello] || map.info;

  return (
    <div className={cn("flex items-start gap-3 rounded-lg px-4 py-3", bg)}>
      <Icon size={15} className={cn(cls, "mt-0.5 shrink-0")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{issue.messaggio}</p>
        <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
          {issue.categoria && <span className="capitalize">{issue.categoria}</span>}
          {issue.campoInteressato && <span className="font-mono">{issue.campoInteressato}</span>}
        </div>
      </div>
    </div>
  );
}

export function QCPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const { toast } = useToast();
  const qcClient = useQueryClient();

  const { data: giornate = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const runQc = useMutation({
    mutationFn: async (gid: number) => (await apiRequest("POST", `/api/giornate/${gid}/qc`, {})).json(),
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      toast({ title: "QC completato" });
    },
    onError: () => toast({ title: "Errore QC", variant: "destructive" }),
  });

  const runAllQcMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cid}/qc-all`, {})).json(),
    onSuccess: (data) => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      toast({ title: "QC completato", description: `${data.totalOk} OK · ${data.totalWarning} avvisi · ${data.totalError} errori` });
    },
    onError: () => toast({ title: "Errore QC globale", variant: "destructive" }),
  });

  // Statistiche globali
  const stats = { ok: 0, warning: 0, error: 0, pending: 0 };
  for (const g of giornate) {
    const s = (g.qcStatus || "pending") as keyof typeof stats;
    if (s in stats) stats[s]++;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quality Control</h1>
          <p className="text-muted-foreground mt-1">Verifica completezza e coerenza della documentazione</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => runAllQcMutation.mutate()} disabled={giornate.length === 0 || runAllQcMutation.isPending}>
          <RefreshCw size={15} className={runAllQcMutation.isPending ? "animate-spin" : ""} />
          {runAllQcMutation.isPending ? "In corso..." : "Esegui QC su tutto"}
        </Button>
      </div>

      {/* Riepilogo globale */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { key: "ok", label: "Giornate OK", icon: CheckCircle2, cls: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
          { key: "warning", label: "Con avvisi", icon: AlertTriangle, cls: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
          { key: "error", label: "Con errori", icon: AlertCircle, cls: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
          { key: "pending", label: "Non verificate", icon: RefreshCw, cls: "text-muted-foreground", bg: "bg-muted/50" },
        ].map(({ key, label, icon: Icon, cls, bg }) => (
          <Card key={key} className={cn("border-0", bg)}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon size={20} className={cls} />
              <div>
                <div className="text-xl font-bold">{stats[key as keyof typeof stats]}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lista giornate con QC dettagliato */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : giornate.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <ShieldCheck size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nessuna giornata da verificare</p>
        </div>
      ) : (
        <div className="space-y-4">
          {giornate.map((g: any) => {
            let issues: any[] = [];
            try { issues = JSON.parse(g.qcReport || "[]"); } catch {}
            const errCount = issues.filter((i: any) => i.livello === "error").length;
            const warnCount = issues.filter((i: any) => i.livello === "warning").length;
            const infoCount = issues.filter((i: any) => i.livello === "info").length;

            return (
              <Card key={g.id} data-testid={`card-qc-${g.id}`}>
                <CardHeader className="py-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base font-semibold">{g.data}</CardTitle>
                      {g.settore && <span className="text-sm text-muted-foreground">Settore {g.settore}</span>}
                      {g.qcStatus && (
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium",
                          g.qcStatus === "ok" ? "qc-ok" :
                          g.qcStatus === "warning" ? "qc-warning" :
                          g.qcStatus === "error" ? "qc-error" : "qc-pending"
                        )}>
                          {g.qcStatus === "ok" ? "✓ OK" :
                           g.qcStatus === "warning" ? `⚠ ${warnCount} avvisi` :
                           g.qcStatus === "error" ? `✗ ${errCount} errori` : "Non verificata"}
                        </span>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="gap-1"
                      data-testid={`button-run-qc-${g.id}`}
                      onClick={() => runQc.mutate(g.id)}
                      disabled={runQc.isPending}
                    >
                      <RefreshCw size={13} />
                      {runQc.isPending ? "..." : "Riesegui"}
                    </Button>
                  </div>
                </CardHeader>
                {issues.length > 0 && (
                  <CardContent className="pt-0 px-5 pb-4">
                    <div className="space-y-1.5">
                      {issues.map((issue: any, i: number) => (
                        <IssueRow key={i} issue={issue} />
                      ))}
                    </div>
                  </CardContent>
                )}
                {g.qcStatus === "ok" && (
                  <CardContent className="pt-0 px-5 pb-4">
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
                      <CheckCircle2 size={15} />
                      <span>Documentazione completa e coerente</span>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
