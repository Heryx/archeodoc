import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Eye, EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";
import { QcGiornataCard } from "@/components/qc/QcGiornataCard";
import { QcSummaryCards } from "@/components/qc/QcSummaryCards";
import { computeQcStatusStats } from "@/components/qc/types";
import type { QcLog } from "@shared/schema";

type QCPageProps = {
  cidOverride?: string;
  embedded?: boolean;
};

type QcScope = "cantiere" | "giornata" | "us";

type QcResultPayload = {
  status?: "ok" | "warning" | "error";
  issues?: Array<{ livello?: "error" | "warning" | "info" }>;
  codiceUS?: string;
};

function statusFromIssues(payload: QcResultPayload): "ok" | "warning" | "error" {
  if (payload.status) return payload.status;
  const issues = payload.issues || [];
  if (issues.some((issue) => issue.livello === "error")) return "error";
  if (issues.some((issue) => issue.livello === "warning")) return "warning";
  return "ok";
}

export function QCPage({ cidOverride, embedded = false }: QCPageProps = {}) {
  const params = useParams<{ cid: string }>();
  const cid = cidOverride || params.cid;
  const activeProjectId = getCurrentProjectId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showDismissed, setShowDismissed] = useState(false);
  const [qcLogsMap, setQcLogsMap] = useState<Record<number, QcLog[]>>({});
  const [scope, setScope] = useState<QcScope>("cantiere");
  const [selectedGiornataId, setSelectedGiornataId] = useState<string>("all");
  const [selectedUsId, setSelectedUsId] = useState<string>("all");

  const { data: giornate = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: usList = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  const usOptions = useMemo(() => {
    if (selectedGiornataId === "all") return usList;
    return usList.filter((us: any) => String(us.giornataId ?? "") === selectedGiornataId);
  }, [usList, selectedGiornataId]);

  const fetchQcLogs = useCallback(async () => {
    if (!giornate.length) return;

    const entries: Record<number, QcLog[]> = {};

    await Promise.all(
      giornate
        .filter((giornata: any) => giornata.qcStatus && giornata.qcStatus !== "pending")
        .map(async (giornata: any) => {
          try {
            const response = await apiRequest("GET", `/api/giornate/${giornata.id}/qc-logs`);
            entries[giornata.id] = await response.json();
          } catch {
            entries[giornata.id] = [];
          }
        }),
    );

    setQcLogsMap(entries);
  }, [giornate]);

  useEffect(() => {
    void fetchQcLogs();
  }, [fetchQcLogs]);

  useEffect(() => {
    if (selectedGiornataId !== "all" && !giornate.some((g: any) => String(g.id) === selectedGiornataId)) {
      setSelectedGiornataId("all");
    }
  }, [giornate, selectedGiornataId]);

  useEffect(() => {
    if (selectedUsId === "all") return;
    if (!usOptions.some((us: any) => String(us.id) === selectedUsId)) {
      setSelectedUsId("all");
    }
  }, [selectedUsId, usOptions]);

  const runGiornataQc = useMutation({
    mutationFn: async (giornataId: number) => (await apiRequest("POST", `/api/giornate/${giornataId}/qc`, {})).json(),
    onSuccess: (data: QcResultPayload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      const status = statusFromIssues(data);
      toast({ title: `QC giornata completato (${status.toUpperCase()})` });
      void fetchQcLogs();
    },
    onError: () => toast({ title: "Errore QC giornata", variant: "destructive" }),
  });

  const runAllQcMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cid}/qc-all`, {})).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      toast({
        title: "QC cantiere completato",
        description: `${data.totalOk} OK - ${data.totalWarning} avvisi - ${data.totalError} errori`,
      });
      void fetchQcLogs();
    },
    onError: () => toast({ title: "Errore QC globale", variant: "destructive" }),
  });

  const runUsQcMutation = useMutation({
    mutationFn: async (usId: number) => (await apiRequest("POST", `/api/us/${usId}/qc`, {})).json(),
    onSuccess: (data: QcResultPayload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      const status = statusFromIssues(data);
      toast({
        title: `QC US completato (${status.toUpperCase()})`,
        description: data.codiceUS ? `US ${data.codiceUS}` : undefined,
      });
      void fetchQcLogs();
    },
    onError: () => toast({ title: "Errore QC US", variant: "destructive" }),
  });

  async function handleToggleDismiss(logId: number, dismissed: boolean) {
    try {
      await apiRequest("POST", `/api/qc-logs/${logId}/dismiss`, { dismissed });
      setQcLogsMap((previous) => {
        const next = { ...previous };
        for (const giornataId of Object.keys(next)) {
          const id = Number(giornataId);
          next[id] = next[id].map((log) => (log.id === logId ? { ...log, dismissed } : log));
        }
        return next;
      });
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    }
  }

  function runSelectedScope() {
    if (scope === "cantiere") {
      runAllQcMutation.mutate();
      return;
    }

    if (scope === "giornata") {
      if (selectedGiornataId === "all") {
        toast({ title: "Seleziona una giornata", variant: "destructive" });
        return;
      }
      runGiornataQc.mutate(Number(selectedGiornataId));
      return;
    }

    if (selectedUsId === "all") {
      toast({ title: "Seleziona una US", variant: "destructive" });
      return;
    }
    runUsQcMutation.mutate(Number(selectedUsId));
  }

  const allLogs = Object.values(qcLogsMap).flat();
  const dismissedCount = allLogs.filter((log) => log.dismissed).length;
  const stats = computeQcStatusStats(giornate);
  const runPending = runAllQcMutation.isPending || runGiornataQc.isPending || runUsQcMutation.isPending;
  const wrapperClass = embedded ? "p-4 space-y-4" : "p-8 max-w-4xl mx-auto";

  if (!cid) {
    return (
      <div className={wrapperClass}>
        <div className="text-sm text-muted-foreground">
          Seleziona prima un cantiere per eseguire il QC.
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quality Control</h1>
          <p className="text-muted-foreground mt-1">Esecuzione QC su intero cantiere, singola giornata o singola US.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 flex flex-wrap items-end gap-2">
        <div className="min-w-44">
          <div className="text-xs text-muted-foreground mb-1">Ambito</div>
          <Select value={scope} onValueChange={(value) => setScope(value as QcScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cantiere">Intero cantiere</SelectItem>
              <SelectItem value="giornata">Singola giornata</SelectItem>
              <SelectItem value="us">Singola US</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(scope === "giornata" || scope === "us") && (
          <div className="min-w-52">
            <div className="text-xs text-muted-foreground mb-1">Giornata</div>
            <Select value={selectedGiornataId} onValueChange={setSelectedGiornataId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona giornata..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le giornate</SelectItem>
                {giornate.map((giornata: any) => (
                  <SelectItem key={giornata.id} value={String(giornata.id)}>
                    {giornata.data}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "us" && (
          <div className="min-w-56">
            <div className="text-xs text-muted-foreground mb-1">US</div>
            <Select value={selectedUsId} onValueChange={setSelectedUsId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona US..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Seleziona...</SelectItem>
                {usOptions.map((us: any) => (
                  <SelectItem key={us.id} value={String(us.id)}>
                    {us.codiceUS}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button variant="outline" className="gap-2" onClick={runSelectedScope} disabled={runPending}>
          <RefreshCw size={15} className={runPending ? "animate-spin" : ""} />
          {runPending ? "In corso..." : "Esegui QC"}
        </Button>
      </div>

      <QcSummaryCards stats={stats} />

      {dismissedCount > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant={showDismissed ? "secondary" : "outline"}
            size="sm"
            className="gap-1"
            onClick={() => setShowDismissed((value) => !value)}
          >
            {showDismissed ? <Eye size={14} /> : <EyeOff size={14} />}
            Mostra nascosti ({dismissedCount})
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : giornate.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <ShieldCheck size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nessuna giornata da verificare</p>
        </div>
      ) : (
        <div className="space-y-4">
          {giornate.map((giornata: any) => (
            <QcGiornataCard
              key={giornata.id}
              giornata={giornata}
              logs={qcLogsMap[giornata.id] ?? []}
              showDismissed={showDismissed}
              runPending={runGiornataQc.isPending}
              onRunQc={(giornataId) => runGiornataQc.mutate(giornataId)}
              onToggleDismiss={handleToggleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
