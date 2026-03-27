import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wand2, Download, CalendarRange, ChevronDown, ChevronUp, Loader2, FileText, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";

type ReportPageProps = {
  cidOverride?: string;
  embedded?: boolean;
};

export function ReportPage({ cidOverride, embedded = false }: ReportPageProps = {}) {
  const params = useParams<{ cid: string }>();
  const cid = cidOverride || params.cid;
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

  const { data: aiStatus } = useQuery<{ available: boolean; provider: string }>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    staleTime: Infinity,
  });
  const aiAvailable = aiStatus?.available ?? false;
  const aiProvider = aiStatus?.provider ?? "none";

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

  const handleWeeklyDownload = async (referenceDate: string) => {
    try {
      const endpoint = buildProjectUrl(
        `/api/cantieri/${cid}/giornale/export-weekly-docx?date=${encodeURIComponent(referenceDate)}`,
      );
      const res = await fetch(endpoint, { headers: getProjectHeader() });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast({
          title: "Export settimanale non disponibile",
          description: String(payload?.error || "Nessun report nella settimana selezionata"),
          variant: "destructive",
        });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Diario_settimanale_${referenceDate}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Errore download settimanale", variant: "destructive" });
    }
  };

  const wrapperClass = embedded ? "p-4 max-w-4xl mx-auto" : "p-8 max-w-4xl mx-auto";

  if (!cid) {
    return (
      <div className={wrapperClass}>
        <p className="text-sm text-muted-foreground">Seleziona prima un cantiere per usare Report AI.</p>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report AI</h1>
        <p className="text-muted-foreground mt-1">
          Genera diari di scavo e schede US formattate con AI.
          L'AI analizza i dati inseriti e i risultati QC per produrre documentazione professionale.
        </p>
      </div>

      {/* Banner provider AI attivo */}
      {aiAvailable && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 text-sm flex items-start gap-3">
          <Wand2 size={16} className="text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-green-800">
              {aiProvider === "gemini" ? "Google Gemini 1.5 Flash attivo (gratuito)" : "Claude Sonnet attivo"}
            </p>
            <p className="text-green-700 mt-1">
              {aiProvider === "gemini"
                ? "L'AI usa Gemini 1.5 Flash tramite la tua GEMINI_API_KEY. Nessun costo per le richieste."
                : "L'AI usa Claude Sonnet tramite la tua ANTHROPIC_API_KEY."}
            </p>
          </div>
        </div>
      )}

      {/* Banner chiave AI mancante */}
      {!aiAvailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm flex items-start gap-3">
          <KeyRound size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-amber-800">Nessuna chiave AI configurata</p>
            <p className="text-amber-700 mt-1">
              Le funzioni AI non sono disponibili. Crea un file <code className="bg-amber-100 px-1 rounded">.env</code> nella
              cartella dell'applicazione con almeno una di queste chiavi:<br />
              <code className="bg-amber-100 px-1 rounded mt-1 inline-block">GEMINI_API_KEY=la-tua-chiave</code> (gratuita da aistudio.google.com)<br />
              <code className="bg-amber-100 px-1 rounded mt-1 inline-block">ANTHROPIC_API_KEY=sk-ant-la-tua-chiave</code> (a pagamento)
            </p>
          </div>
        </div>
      )}

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
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs"
                          data-testid={`button-download-weekly-docx-${g.id}`}
                          onClick={() => handleWeeklyDownload(g.data)}
                        >
                          <CalendarRange size={12} /> Scarica settimana
                        </Button>
                      </>
                    )}
                    <Button size="sm" className="gap-1"
                      data-testid={`button-genera-report-${g.id}`}
                      onClick={() => generateReport(g.id)}
                      disabled={generating === g.id || !aiAvailable}
                      title={!aiAvailable ? "Configura ANTHROPIC_API_KEY nel file .env per usare l'AI" : undefined}
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
