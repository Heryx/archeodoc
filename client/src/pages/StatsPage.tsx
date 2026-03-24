import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";
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
  const [exportLoading, setExportLoading] = useState(false);

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

  async function handleExportZip() {
    setExportLoading(true);
    try {
      const response = await fetch(buildProjectUrl(`/api/cantieri/${cid}/export-zip`), {
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || "Errore durante l'export");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const slug = stats?.cantiere.codice?.replace(/[\s/\\:*?"<>|]/g, "_") || cid;
      anchor.download = `${slug}_export.zip`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast({ title: "Archivio ZIP scaricato" });
    } catch (error: any) {
      toast({ title: "Errore export ZIP", description: error.message, variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  }

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
        exportLoading={exportLoading}
        onRunQc={() => runAllQc.mutate()}
        onExportZip={handleExportZip}
      />

      <StatsSummaryGrid stats={stats} />
      <StatsBreakdownRow stats={stats} />
      <StatsAIProgress stats={stats} />
    </div>
  );
}

