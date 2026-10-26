import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StoricoDialog } from "@/components/storico/StoricoDialog";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarDays, Clock, CloudSun, HardHat, User, FileText, History } from "lucide-react";
import { parseOperatori } from "@/components/giornata/types";

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-1.5 w-44 shrink-0 text-muted-foreground text-sm">
        <Icon size={14} />
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export function GiornataDetailPage() {
  const { cid, gid } = useParams<{ cid: string; gid: string }>();
  const [, navigate] = useLocation();
  const activeProjectId = getCurrentProjectId();
  const [storicoOpen, setStoricoOpen] = useState(false);

  const { data: giornata, isLoading } = useQuery<any>({
    queryKey: ["/api/giornate", gid, activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/giornate/${gid}`)).json(),
    enabled: !!gid,
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (!giornata) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-sm text-muted-foreground">
        Giornata non trovata.
      </div>
    );
  }

  const oraRange = [giornata.oraInizio, giornata.oraFine].filter(Boolean).join(" – ");
  const operai = parseOperatori(giornata.scavatori) || parseOperatori(giornata.operatori);
  const archeologi = parseOperatori(giornata.archeologi);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(`/cantiere/${cid}`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> Torna alle giornate
      </button>
      <StoricoDialog
        open={storicoOpen}
        onOpenChange={setStoricoOpen}
        entityType="giornata"
        entityId={giornata.id}
        title={`Cronologia · Giornata ${giornata.data}`}
      />

      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays size={22} />
            {giornata.data}
          </h1>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStoricoOpen(true)}>
            <History size={15} /> Cronologia
          </Button>
        </div>
        {giornata.settore && (
          <p className="text-muted-foreground text-sm mt-1">Settore: {giornata.settore}</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card px-5 py-2 mb-6">
        <InfoRow icon={Clock} label="Orario di lavoro" value={oraRange || null} />
        <InfoRow icon={CloudSun} label="Condizioni meteo" value={giornata.condMeteo} />
        <InfoRow icon={User} label="Direttore di scavo" value={giornata.archeologoCoordinatore} />
        <InfoRow icon={HardHat} label="Topografo" value={giornata.topografo} />
        <InfoRow icon={HardHat} label="Archeologi" value={archeologi || null} />
        <InfoRow icon={HardHat} label="Operai" value={operai || null} />
        {giornata.escavatore && (
          <InfoRow icon={HardHat} label="Escavatore" value={giornata.escavatore} />
        )}
        <InfoRow icon={FileText} label="Tipo scavo" value={giornata.tipoScavo} />
        <InfoRow icon={FileText} label="Obiettivo" value={giornata.obiettivo} />
      </div>

      {giornata.attivitaSvolta && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Descrizione delle attività
          </h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm whitespace-pre-wrap leading-relaxed">
            {giornata.attivitaSvolta}
          </div>
        </div>
      )}

      {giornata.note && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Note</h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm whitespace-pre-wrap leading-relaxed">
            {giornata.note}
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <Button variant="outline" onClick={() => navigate(`/cantiere/${cid}/us`)}>
          Vai alle Schede US
        </Button>
      </div>
    </div>
  );
}
