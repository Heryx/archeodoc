import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays, Layers, Image, ShieldCheck, Wand2,
  AlertCircle, AlertTriangle, CheckCircle2, Clock, Download, BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Stats = {
  cantiere: { nome: string; codice: string; localita: string };
  giornate: { totale: number; qcStatus: Record<string, number>; reportGenerati: number };
  us: { totale: number; perTipo: Record<string, number>; schedeGenerate: number };
  allegati: { totale: number; perTipo: Record<string, number> };
  qc: { erroriAperti: number; warningAperti: number };
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "default",
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "green" | "red" | "amber";
}) {
  const colorCls = {
    default: "text-primary",
    green: "text-green-600",
    red: "text-red-600",
    amber: "text-amber-600",
  }[color];
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={cn("text-3xl font-bold mt-1", colorCls)}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon size={20} className={cn("mt-1 opacity-50", colorCls)} />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const { toast } = useToast();
  const [exportLoading, setExportLoading] = useState(false);

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/cantieri", cid, "statistiche", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/statistiche`)).json(),
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const handleExportZip = async () => {
    setExportLoading(true);
    try {
      const res = await fetch(buildProjectUrl(`/api/cantieri/${cid}/export-zip`), {
        headers: getProjectHeader(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Errore durante l'export");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = stats?.cantiere.codice?.replace(/[\s/\\:*?"<>|]/g, "_") || cid;
      a.download = `${slug}_export.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Archivio ZIP scaricato" });
    } catch (e: any) {
      toast({ title: "Errore export ZIP", description: e.message, variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { cantiere, giornate, us, allegati, qc } = stats;

  const tipiUS = Object.entries(us.perTipo).sort((a, b) => b[1] - a[1]);
  const tipiAllegati = Object.entries(allegati.perTipo).sort((a, b) => b[1] - a[1]);

  const qcColors: Record<string, string> = {
    ok: "bg-green-500",
    warning: "bg-amber-400",
    error: "bg-red-500",
    pending: "bg-gray-300",
  };
  const qcLabels: Record<string, string> = {
    ok: "OK", warning: "Avvisi", error: "Errori", pending: "Da verificare",
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 size={22} className="text-primary" />
            {cantiere.nome}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {cantiere.codice} — {cantiere.localita}
          </p>
        </div>
        <Button onClick={handleExportZip} disabled={exportLoading} className="gap-2 shrink-0">
          <Download size={15} />
          {exportLoading ? "Preparazione..." : "Esporta tutto ZIP"}
        </Button>
      </div>

      {/* KPI principali */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={CalendarDays}
          label="Giornate"
          value={giornate.totale}
          sub={`${giornate.reportGenerati} con report AI`}
        />
        <StatCard
          icon={Layers}
          label="Unità Strat."
          value={us.totale}
          sub={`${us.schedeGenerate} schede AI generate`}
        />
        <StatCard
          icon={Image}
          label="Allegati"
          value={allegati.totale}
        />
        <StatCard
          icon={qc.erroriAperti > 0 ? AlertCircle : CheckCircle2}
          label="Problemi QC"
          value={qc.erroriAperti + qc.warningAperti}
          sub={`${qc.erroriAperti} errori · ${qc.warningAperti} avvisi`}
          color={qc.erroriAperti > 0 ? "red" : qc.warningAperti > 0 ? "amber" : "green"}
        />
      </div>

      {/* Riga dettagli */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* QC Giornate — barre */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-primary" /> Stato QC Giornate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(giornate.qcStatus).map(([stato, n]) => {
              if (n === 0) return null;
              const pct = giornate.totale > 0 ? Math.round((n / giornate.totale) * 100) : 0;
              return (
                <div key={stato}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{qcLabels[stato] || stato}</span>
                    <span className="font-medium">{n} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", qcColors[stato] || "bg-gray-400")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {giornate.totale === 0 && <p className="text-xs text-muted-foreground">Nessuna giornata registrata</p>}
          </CardContent>
        </Card>

        {/* US per tipo */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Layers size={14} className="text-primary" /> US per tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tipiUS.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessuna US registrata</p>
            ) : (
              <div className="space-y-1.5">
                {tipiUS.map(([tipo, n]) => (
                  <div key={tipo} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-muted-foreground">{tipo}</span>
                    <Badge variant="secondary" className="tabular-nums">{n}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Allegati per tipo */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Image size={14} className="text-primary" /> Allegati per tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tipiAllegati.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessun allegato caricato</p>
            ) : (
              <div className="space-y-1.5">
                {tipiAllegati.map(([tipo, n]) => (
                  <div key={tipo} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-muted-foreground">{tipo}</span>
                    <Badge variant="secondary" className="tabular-nums">{n}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stato AI */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Wand2 size={14} className="text-primary" /> Avanzamento AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Report giornalieri */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Report giornalieri generati</span>
              <span className="font-medium">{giornate.reportGenerati}/{giornate.totale}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: giornate.totale > 0 ? `${Math.round((giornate.reportGenerati / giornate.totale) * 100)}%` : "0%" }}
              />
            </div>
          </div>
          {/* Schede US */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Schede US generate</span>
              <span className="font-medium">{us.schedeGenerate}/{us.totale}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: us.totale > 0 ? `${Math.round((us.schedeGenerate / us.totale) * 100)}%` : "0%" }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
