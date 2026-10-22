import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";
import { StatsAIProgress } from "@/components/stats/StatsAIProgress";
import { StatsBreakdownRow } from "@/components/stats/StatsBreakdownRow";
import { StatsHeader } from "@/components/stats/StatsHeader";
import { StatsSummaryGrid } from "@/components/stats/StatsSummaryGrid";
import type { Stats } from "@/components/stats/types";

type StatsPageProps = {
  cidOverride?: string;
  embedded?: boolean;
};

export function StatsPage({ cidOverride, embedded = false }: StatsPageProps = {}) {
  const params = useParams<{ cid: string }>();
  const cid = cidOverride || params.cid;
  const activeProjectId = getCurrentProjectId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const runAllQc = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cid}/qc-all`, {})).json(),
    onSuccess: (data) => {
      toast({
        title: "QC completato",
        description: `${data.totalOk} OK · ${data.totalWarning} avvisi · ${data.totalError} errori`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "statistiche", activeProjectId] });
    },
    onError: () => toast({ title: "Errore QC", variant: "destructive" }),
  });

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/cantieri", cid, "statistiche", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/statistiche`)).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className={embedded ? "p-4" : "p-8 max-w-4xl mx-auto"}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-28 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className={embedded ? "p-4" : "p-8 max-w-4xl mx-auto"}>
        <p className="text-sm text-muted-foreground">Seleziona prima un cantiere per visualizzare le statistiche.</p>
      </div>
    );
  }

  return (
    <div className={embedded ? "p-4 space-y-4" : "p-8 max-w-4xl mx-auto space-y-6"}>
      <StatsHeader
        stats={stats}
        runQcPending={runAllQc.isPending}
        onRunQc={() => runAllQc.mutate()}
      />

      <StatsSummaryGrid stats={stats} />
      <StatsBreakdownRow stats={stats} />
      <StatsAIProgress stats={stats} />
    </div>
  );
}

