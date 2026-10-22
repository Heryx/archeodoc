import { formatUsCode } from "@shared/us_code";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Bot, Eye, EyeOff, RefreshCw, ShieldCheck, ShieldOff, Wrench } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { setAiJobResult, startAiJob, useAiJobActive, useAiJobResult } from "@/lib/aiJobs";
import { getCurrentProjectId } from "@/lib/project";
import { QcGiornataCard } from "@/components/qc/QcGiornataCard";
import { QcUSCard } from "@/components/qc/QcUSCard";
import { QcSummaryCards } from "@/components/qc/QcSummaryCards";
import { SequenceRepairDialog } from "@/components/qc/SequenceRepairDialog";
import { computeQcStatusStats } from "@/components/qc/types";
import type { QcLog } from "@shared/schema";

const QC_ENABLED_KEY = "archeodoc_qc_enabled";

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
  const { settings: codeSettings } = useProjectCodeSettings();
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
  const [aiRelazioniResult, setAiRelazioniResult] = useState<string | null>(null);
  const [qcEnabled, setQcEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(QC_ENABLED_KEY);
      return stored === null ? true : stored !== "false";
    } catch {
      return true;
    }
  });

  const toggleQcEnabled = () => {
    setQcEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(QC_ENABLED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

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

  const [usQcLogsMap, setUsQcLogsMap] = useState<Record<number, QcLog[]>>({});

  const fetchQcLogs = useCallback(async (giornateOverride?: any[]) => {
    const list = giornateOverride ?? (queryClient.getQueryData<any[]>(["/api/cantieri", cid, "giornate", activeProjectId]) ?? giornate);
    if (!list.length) return;

    const entries: Record<number, QcLog[]> = {};
    await Promise.all(
      list.map(async (giornata: any) => {
        try {
          const response = await apiRequest("GET", `/api/giornate/${giornata.id}/qc-logs`);
          entries[giornata.id] = await response.json();
        } catch {
          entries[giornata.id] = [];
        }
      }),
    );
    setQcLogsMap(entries);
  }, [giornate, cid, activeProjectId, queryClient]);

  const fetchUsQcLogs = useCallback(async (usListOverride?: any[]) => {
    const list = usListOverride ?? usList;
    if (!list.length) return;

    const entries: Record<number, QcLog[]> = {};
    await Promise.all(
      list.map(async (us: any) => {
        try {
          const response = await apiRequest("GET", `/api/us/${us.id}/qc-logs`);
          entries[us.id] = await response.json();
        } catch {
          entries[us.id] = [];
        }
      }),
    );
    setUsQcLogsMap(entries);
  }, [usList]);

  useEffect(() => {
    void fetchQcLogs();
  }, [fetchQcLogs]);

  useEffect(() => {
    void fetchUsQcLogs();
  }, [fetchUsQcLogs]);

  useEffect(() => {
    if (selectedGiornataId !== "all" && !giornate.some((g: any) => String(g.id) === selectedGiornataId)) {
      setSelectedGiornataId("all");
    }
  }, [giornate, selectedGiornataId]);

  useEffect(() => {
    if (selectedUsId === "all") return;
    if (!usList.some((us: any) => String(us.id) === selectedUsId)) {
      setSelectedUsId("all");
    }
  }, [selectedUsId, usList]);

  const runGiornataQc = useMutation({
    mutationFn: async (giornataId: number) => (await apiRequest("POST", `/api/giornate/${giornataId}/qc`, {})).json(),
    onSuccess: async (data: QcResultPayload) => {
      await queryClient.refetchQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      const status = statusFromIssues(data);
      toast({ title: `QC giornata completato (${status.toUpperCase()})` });
      const fresh = queryClient.getQueryData<any[]>(["/api/cantieri", cid, "giornate", activeProjectId]);
      void fetchQcLogs(fresh);
    },
    onError: () => toast({ title: "Errore QC giornata", variant: "destructive" }),
  });

  const runAllQcMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cid}/qc-all`, {})).json(),
    onSuccess: async (data) => {
      await queryClient.refetchQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      toast({
        title: "QC cantiere completato",
        description: `${data.totalOk} giornate OK · ${data.totalWarning} avvisi · ${data.totalError} errori`,
      });
      const fresh = queryClient.getQueryData<any[]>(["/api/cantieri", cid, "giornate", activeProjectId]);
      void fetchQcLogs(fresh);
      void fetchUsQcLogs();
    },
    onError: () => toast({ title: "Errore QC globale", variant: "destructive" }),
  });

  const [repairOpen, setRepairOpen] = useState(false);

  const runAllUsQcMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cid}/us-qc-all`, {})).json(),
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      toast({
        title: "QC US completato",
        description: `${data.us} US verificate · ${data.totalError} errori · ${data.totalWarning} avvisi`,
      });
      void fetchUsQcLogs();
    },
    onError: () => toast({ title: "Errore QC US", variant: "destructive" }),
  });

  const runUsQcMutation = useMutation({
    mutationFn: async (usId: number) => (await apiRequest("POST", `/api/us/${usId}/qc`, {})).json(),
    onSuccess: async (data: QcResultPayload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] });
      const status = statusFromIssues(data);
      toast({
        title: `QC US completato (${status.toUpperCase()})`,
        description: data.codiceUS ? `US ${data.codiceUS}` : undefined,
      });
      void fetchUsQcLogs();
    },
    onError: () => toast({ title: "Errore QC US", variant: "destructive" }),
  });

  // Gira nel gestore globale dei job IA: continua anche chiudendo il pannello QC.
  // Il risultato resta nello store (aiJobResults) e viene riletto alla riapertura.
  const aiRelazioniKey = `qc-relazioni-ai:${cid}`;
  const aiRelazioniPending = useAiJobActive(aiRelazioniKey);
  const runAiRelazioniQcMutation = {
    isPending: aiRelazioniPending,
    mutate: () => {
      startAiJob<{ testo?: string; error?: string }>({
        key: aiRelazioniKey,
        label: "QC relazioni stratigrafiche (IA)",
        run: async ({ signal }) => (await apiRequest("POST", `/api/cantieri/${cid}/qc-relazioni-ai`, {}, signal)).json(),
        onSuccess: (data) => {
          if (data.error) {
            toast({ title: "Errore QC AI", description: data.error, variant: "destructive" });
          } else {
            setAiJobResult(aiRelazioniKey, data.testo ?? "");
            toast({ title: "QC relazioni IA completato" });
          }
        },
        onError: (err: any) =>
          toast({ title: "Errore QC AI relazioni", description: err?.message, variant: "destructive" }),
      });
    },
  };

  // Riallinea il risultato locale con quello prodotto da un job concluso a pannello chiuso.
  const storedAiRelazioni = useAiJobResult<string>(aiRelazioniKey);
  useEffect(() => {
    if (storedAiRelazioni != null) setAiRelazioniResult(storedAiRelazioni);
  }, [storedAiRelazioni]);

  const clearAiRelazioni = () => {
    setAiRelazioniResult(null);
    setAiJobResult(aiRelazioniKey, null);
  };

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
    if (scope === "cantiere") { runAllQcMutation.mutate(); return; }
    if (scope === "giornata") {
      if (selectedGiornataId === "all") {
        toast({ title: "Seleziona una giornata", variant: "destructive" });
        return;
      }
      runGiornataQc.mutate(Number(selectedGiornataId));
      return;
    }
    if (scope === "us") {
      if (selectedUsId === "all") {
        runAllUsQcMutation.mutate();
      } else {
        runUsQcMutation.mutate(Number(selectedUsId));
      }
    }
  }

  const allLogs = Object.values(qcLogsMap).flat();
  const allUsLogs = Object.values(usQcLogsMap).flat();
  const dismissedCount = [...allLogs, ...allUsLogs].filter((log) => log.dismissed).length;
  const stats = computeQcStatusStats(giornate);
  const runPending = runAllQcMutation.isPending || runGiornataQc.isPending || runUsQcMutation.isPending || runAllUsQcMutation.isPending;
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
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={qcEnabled ? "outline" : "secondary"}
            size="sm"
            className="gap-2"
            onClick={toggleQcEnabled}
            title={qcEnabled ? "Disattiva verifiche QC" : "Attiva verifiche QC"}
          >
            {qcEnabled ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
            {qcEnabled ? "QC attivo" : "QC disattivato"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => { clearAiRelazioni(); runAiRelazioniQcMutation.mutate(); }}
            disabled={runAiRelazioniQcMutation.isPending || !qcEnabled}
          >
            <Bot size={14} className={runAiRelazioniQcMutation.isPending ? "animate-pulse" : ""} />
            {runAiRelazioniQcMutation.isPending ? "Analisi AI..." : "QC AI relazioni"}
          </Button>
        </div>
      </div>

      {!qcEnabled && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
          <ShieldOff size={16} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Le verifiche QC sono disattivate. Riattivale per eseguire controlli sulla qualita dei dati.
          </p>
        </div>
      )}

      {aiRelazioniResult !== null && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold flex items-center gap-2"><Bot size={14} /> Analisi AI relazioni stratigrafiche</p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={clearAiRelazioni}
            >
              Chiudi
            </button>
          </div>
          <pre className="text-sm whitespace-pre-wrap text-foreground">{aiRelazioniResult}</pre>
        </div>
      )}

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

        {scope === "giornata" && (
          <div className="min-w-52">
            <div className="text-xs text-muted-foreground mb-1">Giornata</div>
            <Select value={selectedGiornataId} onValueChange={setSelectedGiornataId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona giornata..." />
              </SelectTrigger>
              <SelectContent>
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
                <SelectItem value="all">Tutte le US</SelectItem>
                {usList.map((us: any) => (
                  <SelectItem key={us.id} value={String(us.id)}>
                    {formatUsCode(us.codiceUS, us.tipo, codeSettings.tombaStyle)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button variant="outline" className="gap-2" onClick={runSelectedScope} disabled={runPending || !qcEnabled}>
          <RefreshCw size={15} className={runPending ? "animate-spin" : ""} />
          {runPending ? "In corso..." : "Esegui QC"}
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => setRepairOpen(true)} title="Toglie le voci di «posteriore a» / «anteriore a» che contraddicono i rapporti fisici">
          <Wrench size={15} /> Ripara sequenza
        </Button>
      </div>

      {cid && (
        <SequenceRepairDialog
          open={repairOpen}
          onClose={() => setRepairOpen(false)}
          cid={cid}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", "qc-page", activeProjectId] })}
        />
      )}

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

      {/* ── Sezione Giornate ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : giornate.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-border rounded-xl">
          <ShieldCheck size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nessuna giornata da verificare</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Giornate</p>
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

      {/* ── Sezione US ── */}
      {usList.length > 0 && (
        <div className="space-y-4 mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unità Stratigrafiche ({usList.length})
          </p>
          {usList.map((us: any) => (
            <QcUSCard
              key={us.id}
              us={us}
              logs={usQcLogsMap[us.id] ?? []}
              showDismissed={showDismissed}
              runPending={runUsQcMutation.isPending}
              onRunQc={(usId) => runUsQcMutation.mutate(usId)}
              onToggleDismiss={handleToggleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
