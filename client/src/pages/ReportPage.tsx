import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wand2, Download, ChevronDown, ChevronUp, Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";

export function ReportPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const { toast } = useToast();
  const qcClient = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [generating, setGenerating] = useState<number | null>(null);

  const { data: giornate = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const generateReport = async (gid: number) => {
    setGenerating(gid);
    try {
      await (await apiRequest("POST", `/api/giornate/${gid}/analizza-ai`, {})).json();
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      setExpanded(gid);
      toast({ title: "Report giornaliero generato" });
    } catch {
      toast({ title: "Errore generazione report", variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  };

  const handleDownload = async (gid: number, data: string) => {
    try {
      const res = await fetch(buildProjectUrl(`/api/giornate/${gid}/export-docx`), { headers: getProjectHeader() });
      if (!res.ok) { toast({ title: "Genera prima il report AI", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Diario_${data}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Errore download", variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report AI</h1>
        <p className="text-muted-foreground mt-1">
          Genera diari di scavo e schede US formattate con Claude AI.
          L'AI analizza i dati inseriti, le immagini e i risultati QC.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6 text-sm">
        <div className="flex items-start gap-2">
          <Wand2 size={16} className="text-primary mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Come funziona</p>
            <p className="text-muted-foreground mt-1">
              Per ogni giornata, l'AI analizza il testo inserito, lo formatta in forma professionale, identifica i
              campi mancanti o insufficienti e produce un diario di scavo in formato soprintendenza italiana.
              Il documento viene esportato direttamente in formato .docx.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : giornate.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <FileText size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nessuna giornata disponibile</p>
          <p className="text-muted-foreground text-sm mt-1">Aggiungi giornate e documenta le US prima di generare i report</p>
        </div>
      ) : (
        <div className="space-y-3">
          {giornate.map((g: any) => (
            <Card key={g.id} data-testid={`card-report-${g.id}`}>
              <CardHeader className="py-4 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">{g.data}</CardTitle>
                    {g.settore && <span className="text-sm text-muted-foreground">Settore {g.settore}</span>}
                    {g.aiReportText && (
                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Report generato
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {g.aiReportText && (
                      <>
                        <Button size="sm" variant="ghost"
                          onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                          className="gap-1 text-xs"
                        >
                          {expanded === g.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          {expanded === g.id ? "Nascondi" : "Visualizza"}
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1 text-xs"
                          data-testid={`button-download-docx-${g.id}`}
                          onClick={() => handleDownload(g.id, g.data)}
                        >
                          <Download size={12} /> Scarica .docx
                        </Button>
                      </>
                    )}
                    <Button size="sm" className="gap-1"
                      data-testid={`button-genera-report-${g.id}`}
                      onClick={() => generateReport(g.id)}
                      disabled={generating === g.id}
                    >
                      {generating === g.id ? (
                        <><Loader2 size={13} className="animate-spin" /> Generazione...</>
                      ) : (
                        <><Wand2 size={13} /> {g.aiReportText ? "Rigenera" : "Genera report"}</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expanded === g.id && g.aiReportText && (
                <CardContent className="pt-0 px-5 pb-5">
                  <div className="border-t border-border pt-4">
                    <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/40 rounded-lg p-4 max-h-96 overflow-y-auto leading-relaxed">
                      {g.aiReportText}
                    </pre>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
