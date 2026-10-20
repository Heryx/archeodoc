import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";
import { GiornataDeleteImpactDetails } from "@/components/giornata/GiornataDeleteImpact";
import { GiornataFormDialog } from "@/components/giornata/GiornataFormDialog";
import { GiornataList } from "@/components/giornata/GiornataList";
import {
  emptyForm,
  operatoriToPayload,
  parseOperatori,
  type GiornataDeleteImpact,
  type GiornataForm,
} from "@/components/giornata/types";
import { useGiornatePerSettimana } from "@/hooks/useGiornatePerSettimana";
import type { GiornataSuggestions } from "@/components/giornata/GiornataFormFields";

export function GiornataPage() {
  const { cid, gid } = useParams<{ cid: string; gid?: string }>();
  const activeProjectId = getCurrentProjectId();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [createForm, setCreateForm] = useState<GiornataForm>(emptyForm);
  const [editForm, setEditForm] = useState<GiornataForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<GiornataDeleteImpact | null>(null);
  const [isLoadingDeleteImpact, setIsLoadingDeleteImpact] = useState(false);
  const { data: cantieri = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });
  const cantiere = cantieri.find((c: any) => String(c.id) === cid);

  const { data: giornateAc } = useQuery<GiornataSuggestions>({
    queryKey: ["/api/cantieri", cid, "giornate", "autocomplete", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate/autocomplete`)).json(),
    enabled: !!cid,
    staleTime: 30_000,
  });

  const { data: giornate = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/cantieri/${cid}/giornate`);
      return r.json();
    },
    enabled: !!cid,
    staleTime: 0,
    refetchOnMount: true,
  });

  const {
    settimane,
    selectedWeek,
    selectWeek,
    giornateDellaSettimana,
    selectedGiornataId,
    setSelectedGiornataId,
  } = useGiornatePerSettimana(
    (giornate || []).map((g: any) => ({
      ...g,
      id: Number(g.id),
      data: String(g.data || ""),
      settore: g.settore || null,
    })),
  );

  useEffect(() => {
    if (!gid) return;
    const id = Number(gid);
    if (!Number.isFinite(id)) return;
    setSelectedGiornataId(id);
  }, [gid, setSelectedGiornataId]);

  const createGiornata = useMutation({
    mutationFn: async (data: GiornataForm) => {
      const r = await apiRequest("POST", `/api/cantieri/${cid}/giornate`, {
        ...data,
        operatori: operatoriToPayload(data.operatori),
        scavatori: operatoriToPayload(data.scavatori),
        archeologi: operatoriToPayload(data.archeologi),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      setOpenCreate(false);
      setCreateForm(emptyForm);
      toast({ title: "Giornata aggiunta" });
    },
    onError: () => toast({ title: "Errore salvataggio giornata", variant: "destructive" }),
  });

  const updateGiornata = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: GiornataForm }) => {
      const r = await apiRequest("PATCH", `/api/giornate/${id}`, {
        ...data,
        operatori: operatoriToPayload(data.operatori),
        scavatori: operatoriToPayload(data.scavatori),
        archeologi: operatoriToPayload(data.archeologi),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      setOpenEdit(false);
      setEditingId(null);
      toast({ title: "Giornata aggiornata" });
    },
    onError: () => toast({ title: "Errore modifica giornata", variant: "destructive" }),
  });

  const deleteGiornata = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/giornate/${id}`);
      return id;
    },
    onSuccess: (deletedId) => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
      if (gid && Number(gid) === deletedId) navigate(`/cantiere/${cid}`);
      toast({ title: "Giornata eliminata" });
    },
    onError: () => toast({ title: "Errore eliminazione giornata", variant: "destructive" }),
  });

  const openDeleteDialog = async (g: any) => {
    setDeleteTarget(g);
    setDeleteImpact(null);
    setDeleteDialogOpen(true);
    setIsLoadingDeleteImpact(true);

    try {
      const impact: GiornataDeleteImpact = await (await apiRequest("GET", `/api/giornate/${g.id}/delete-impact`)).json();
      setDeleteImpact(impact);
    } catch {
      toast({
        title: "Impossibile calcolare l'impatto eliminazione",
        description: "Verifica di essere nel progetto corretto prima di eliminare la giornata.",
        variant: "destructive",
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
    } finally {
      setIsLoadingDeleteImpact(false);
    }
  };

  const [qcLogsMap, setQcLogsMap] = useState<Record<number, any[]>>({});

  const runQcAll = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/cantieri/${cid}/qc-all`, {});
      return r.json() as Promise<{ giornate?: number; totalOk?: number; totalWarning?: number; totalError?: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      const parts = [];
      if (data?.totalOk) parts.push(`${data.totalOk} OK`);
      if (data?.totalWarning) parts.push(`${data.totalWarning} avvisi`);
      if (data?.totalError) parts.push(`${data.totalError} errori`);
      toast({
        title: `QC completato su ${data?.giornate ?? 0} giornate`,
        description: parts.length > 0 ? parts.join(", ") : undefined,
        variant: data?.totalError && data.totalError > 0 ? "destructive" : "default",
      });
    },
    onError: () => toast({ title: "Errore QC giornate", variant: "destructive" }),
  });

  const runQc = useMutation({
    mutationFn: async (gidValue: number) => {
      const r = await apiRequest("POST", `/api/giornate/${gidValue}/qc`, {});
      return r.json() as Promise<{ status?: string; issues?: Array<{ livello?: string; messaggio?: string; campoInteressato?: string }> }>;
    },
    onSuccess: async (data, gidValue) => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      try {
        const logsRes = await apiRequest("GET", `/api/giornate/${gidValue}/qc-logs`);
        const logs: any[] = await logsRes.json();
        setQcLogsMap((prev) => ({ ...prev, [gidValue]: logs }));
        const active = logs.filter((l) => !l.dismissed);
        const errors = active.filter((l) => l.livello === "error");
        const warnings = active.filter((l) => l.livello === "warning");
        if (active.length === 0) {
          toast({ title: "QC completato", description: "Nessun problema rilevato." });
        } else {
          const first = active[0];
          const more = active.length - 1;
          toast({
            title: `QC: ${errors.length > 0 ? `${errors.length} errori` : ""}${errors.length > 0 && warnings.length > 0 ? ", " : ""}${warnings.length > 0 ? `${warnings.length} avvisi` : ""}`.trim(),
            description: first.messaggio + (more > 0 ? ` (+${more} altri)` : ""),
            variant: errors.length > 0 ? "destructive" : "default",
          });
        }
      } catch {
        toast({ title: "QC completato" });
      }
    },
    onError: () => toast({ title: "Errore QC", variant: "destructive" }),
  });

  const openEditDialog = (giornata: any) => {
    setEditingId(giornata.id);
    setEditForm({
      data: giornata.data || "",
      oraInizio: giornata.oraInizio || "",
      oraFine: giornata.oraFine || "",
      operatori: parseOperatori(giornata.operatori),
      scavatori: parseOperatori(giornata.scavatori),
      archeologi: parseOperatori(giornata.archeologi),
      topografo: giornata.topografo || "",
      direttoreScavo: giornata.direttoreScavo || "",
      antropologo: giornata.antropologo || "",
      respMateriali: giornata.respMateriali || "",
      funzionarioSabap: giornata.funzionarioSabap || "",
      archeologoSorveglianza: giornata.archeologoSorveglianza || "",
      archeologoCoordinatore: giornata.archeologoCoordinatore || "",
      escavatore: giornata.escavatore || "",
      tipoScavo: giornata.tipoScavo || "",
      obiettivo: giornata.obiettivo || "",
      condMeteo: giornata.condMeteo || "",
      settore: giornata.settore || "",
      attivitaSvolta: giornata.attivitaSvolta || "",
      note: giornata.note || "",
    });
    setOpenEdit(true);
  };

  const weekCorrente = useMemo(
    () => settimane.find((week) => week.weekNumber === selectedWeek),
    [settimane, selectedWeek],
  );
  const giornateVisibili = settimane.length > 0 ? giornateDellaSettimana : giornate;
  const gidAttivo = gid && giornateVisibili.some((g: any) => String(g.id) === String(gid)) ? gid : undefined;
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-sm text-muted-foreground mb-1">{cantiere?.nome || `Cantiere #${cid}`}</div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Giornate di scavo</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => runQcAll.mutate()}
              disabled={runQcAll.isPending || giornate.length === 0}
            >
              <ShieldCheck size={15} />
              {runQcAll.isPending ? "QC in corso..." : "QC tutte"}
            </Button>
            <Button data-testid="button-nuova-giornata" className="gap-2" onClick={() => setOpenCreate(true)}>
              <Plus size={16} /> Nuova giornata
            </Button>
          </div>
        </div>
      </div>

      <GiornataFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        title="Registra giornata di scavo"
        form={createForm}
        setForm={setCreateForm}
        onSubmit={() => createGiornata.mutate(createForm)}
        submitPending={createGiornata.isPending}
        submitLabelIdle="Registra giornata"
        submitLabelPending="Salvataggio..."
        submitDisabled={!createForm.data || createGiornata.isPending}
        suggestions={giornateAc}
        cantiereId={Number(cid)}
        onImportedTextNotice={() => {
          toast({ title: "Testo importato nel campo note" });
        }}
      />

      <GiornataFormDialog
        open={openEdit}
        onOpenChange={(value) => {
          setOpenEdit(value);
          if (!value) {
            setEditingId(null);
          }
        }}
        title="Modifica giornata"
        form={editForm}
        setForm={setEditForm}
        onSubmit={() => {
          if (editingId) updateGiornata.mutate({ id: editingId, data: editForm });
        }}
        submitPending={updateGiornata.isPending}
        submitLabelIdle="Salva modifiche"
        submitLabelPending="Aggiornamento..."
        submitDisabled={!editForm.data || !editingId || updateGiornata.isPending}
        suggestions={giornateAc}
        cantiereId={Number(cid)}
        onImportedTextNotice={() => {
          toast({ title: "Testo importato nel campo note" });
        }}
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(value) => {
          setDeleteDialogOpen(value);
          if (!value && !deleteGiornata.isPending) {
            setDeleteTarget(null);
            setDeleteImpact(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la giornata?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Stai per eliminare la giornata ${deleteTarget.data}.` : "Stai per eliminare una giornata."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <GiornataDeleteImpactDetails isLoading={isLoadingDeleteImpact} impact={deleteImpact} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGiornata.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              disabled={!deleteTarget || !deleteImpact || deleteGiornata.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteGiornata.mutate(deleteTarget.id);
              }}
            >
              {deleteGiornata.isPending ? "Eliminazione..." : "Elimina giornata"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {settimane.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Settimana:</span>
            {settimane.map((week) => (
              <button
                key={week.weekNumber}
                type="button"
                onClick={() => {
                  selectWeek(week.weekNumber);
                  if (gid) navigate(`/cantiere/${cid}`);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                  selectedWeek === week.weekNumber
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                W{week.weekNumber}
                <span className="ml-1.5 opacity-70 font-normal">({week.giornateIds.length}gg)</span>
              </button>
            ))}
          </div>
          {weekCorrente && (
            <div className="text-xs text-muted-foreground">
              {weekCorrente.label} | {giornateVisibili.length} giornata/e
            </div>
          )}
        </div>
      )}

      <GiornataList
        cid={String(cid)}
        gid={gidAttivo}
        giornate={giornateVisibili}
        isLoading={isLoading}
        runQcPending={runQc.isPending}
        deletePending={deleteGiornata.isPending}
        qcLogsMap={qcLogsMap}
        onNavigate={(path) => {
          const match = path.match(/\/giornata\/(\d+)/);
          if (match) {
            const id = Number(match[1]);
            if (Number.isFinite(id)) setSelectedGiornataId(id);
          }
          navigate(path);
        }}
        onOpenDetail={(giornataId) => navigate(`/cantiere/${cid}/giornata/${giornataId}`)}
        onRunQc={(id) => runQc.mutate(id)}
        onEdit={openEditDialog}
        onDelete={(g) => {
          void openDeleteDialog(g);
        }}
      />
    </div>
  );
}

