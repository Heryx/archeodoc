import { useState } from "react";
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
import { Layers, Plus, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";
import { GiornataDeleteImpactDetails } from "@/components/giornata/GiornataDeleteImpact";
import { GiornataFormDialog } from "@/components/giornata/GiornataFormDialog";
import { GiornataList } from "@/components/giornata/GiornataList";
import { GooglePanel } from "@/components/giornata/GooglePanel";
import { GoogleSyncReviewDialog } from "@/components/giornata/GoogleSyncReviewDialog";
import { USImportFromJournalDialog } from "@/components/us/USImportFromJournalDialog";
import {
  parseLastSyncSummary,
  seedGoogleDecisionState,
  withGoogleDecisionAction,
  withGoogleSchedaOverride,
  withGoogleTopFieldOverride,
} from "@/components/giornata/googleSyncState";
import {
  emptyForm,
  operatoriToPayload,
  parseOperatori,
  type GiornataDeleteImpact,
  type GiornataForm,
  type GoogleSyncApplyReport,
  type GoogleSyncDecisionState,
  type GoogleSyncPreview,
} from "@/components/giornata/types";

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
  const [googleReviewOpen, setGoogleReviewOpen] = useState(false);
  const [googlePreview, setGooglePreview] = useState<GoogleSyncPreview | null>(null);
  const [googleDecisions, setGoogleDecisions] = useState<Record<string, GoogleSyncDecisionState>>({});
  const [importUsDialogOpen, setImportUsDialogOpen] = useState(false);

  const { data: cantieri = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });
  const cantiere = cantieri.find((c: any) => String(c.id) === cid);

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

  function setGoogleDecisionAction(itemKey: string, action: "confirm" | "skip" | "edit") {
    setGoogleDecisions((prev) => withGoogleDecisionAction(prev, itemKey, action));
  }

  function setGoogleTopFieldOverride(
    itemKey: string,
    field: Exclude<keyof GoogleSyncPreview["items"][number]["proposed"], "schedaData">,
    value: string,
  ) {
    setGoogleDecisions((prev) => withGoogleTopFieldOverride(prev, itemKey, field, value));
  }

  function setGoogleSchedaOverride(itemKey: string, fieldKey: string, value: string) {
    setGoogleDecisions((prev) => withGoogleSchedaOverride(prev, itemKey, fieldKey, value));
  }

  const createGiornata = useMutation({
    mutationFn: async (data: GiornataForm) => {
      const r = await apiRequest("POST", `/api/cantieri/${cid}/giornate`, {
        ...data,
        operatori: operatoriToPayload(data.operatori),
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

  const runQc = useMutation({
    mutationFn: async (gidValue: number) => {
      const r = await apiRequest("POST", `/api/giornate/${gidValue}/qc`, {});
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      toast({ title: "QC completato" });
    },
    onError: () => toast({ title: "Errore QC", variant: "destructive" }),
  });

  const setupGoogle = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/cantieri/${cid}/google/setup`, {});
      return response.json() as Promise<{
        ok: boolean;
        reused: boolean;
        folderUrl: string;
        docUrl: string;
      }>;
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      toast({
        title: data.reused ? "Collegamento Google gia presente" : "Google configurato per il cantiere",
        description: "Documento giornale pronto su Google Docs.",
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore setup Google",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const previewGoogleSync = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/cantieri/${cid}/google/sync`, { apply: false });
      return response.json() as Promise<{ mode: "preview"; preview: GoogleSyncPreview }>;
    },
    onSuccess: (payload) => {
      setGooglePreview(payload.preview);
      setGoogleDecisions(seedGoogleDecisionState(payload.preview));
      setGoogleReviewOpen(true);
      toast({
        title: "Anteprima sincronizzazione pronta",
        description: `${payload.preview.items.length} schede US da revisionare.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore lettura Google Docs",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const applyGoogleSync = useMutation({
    mutationFn: async () => {
      const payload = {
        apply: true,
        preview: googlePreview,
        decisions: googleDecisions,
      };
      const response = await apiRequest("POST", `/api/cantieri/${cid}/google/sync`, payload);
      return response.json() as Promise<{
        mode: "applied";
        lastSyncAt: string;
        report: GoogleSyncApplyReport;
      }>;
    },
    onSuccess: async (payload) => {
      await qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      await qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
      await qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      setGoogleReviewOpen(false);
      toast({
        title: "Sync Google completato",
        description:
          `Create: ${payload.report.created}, ` +
          `Aggiornate: ${payload.report.updated}, ` +
          `Invariate: ${payload.report.unchanged}, ` +
          `Saltate: ${payload.report.skipped}.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore apply sync",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const openEditDialog = (giornata: any) => {
    setEditingId(giornata.id);
    setEditForm({
      data: giornata.data || "",
      operatori: parseOperatori(giornata.operatori),
      condMeteo: giornata.condMeteo || "",
      settore: giornata.settore || "",
      note: giornata.note || "",
    });
    setOpenEdit(true);
  };

  const lastSyncSummary = parseLastSyncSummary(cantiere?.lastSyncReport);
  const giornataSelezionata = gid ? giornate.find((g: any) => String(g.id) === String(gid)) : null;

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
              onClick={() => navigate(`/cantiere/${cid}/us${gid ? `?giornataId=${gid}` : ""}`)}
            >
              <Layers size={15} /> Vai alle US
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={!gid}
              onClick={() => setImportUsDialogOpen(true)}
              title={!gid ? "Apri prima una giornata specifica per importare le US" : undefined}
            >
              <Sparkles size={15} /> Importa US da giornale
            </Button>
            <Button data-testid="button-nuova-giornata" className="gap-2" onClick={() => setOpenCreate(true)}>
              <Plus size={16} /> Nuova giornata
            </Button>
          </div>
        </div>
      </div>

      <GooglePanel
        cantiere={cantiere}
        setupPending={setupGoogle.isPending}
        syncPending={previewGoogleSync.isPending}
        onSetup={() => setupGoogle.mutate()}
        onSync={() => previewGoogleSync.mutate()}
        lastSyncSummary={lastSyncSummary}
      />

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

      <GoogleSyncReviewDialog
        open={googleReviewOpen}
        preview={googlePreview}
        decisions={googleDecisions}
        applyPending={applyGoogleSync.isPending}
        onOpenChange={setGoogleReviewOpen}
        onActionChange={setGoogleDecisionAction}
        onTopFieldOverride={setGoogleTopFieldOverride}
        onSchedaOverride={setGoogleSchedaOverride}
        onApply={() => applyGoogleSync.mutate()}
      />

      {gid && (
        <USImportFromJournalDialog
          open={importUsDialogOpen}
          onOpenChange={setImportUsDialogOpen}
          cantiereId={Number(cid)}
          giornataId={Number(gid)}
          giornataDate={giornataSelezionata?.data}
          linkedGoogleDocId={cantiere?.googleDocId}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
            qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", activeProjectId] });
            qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
          }}
        />
      )}

      <GiornataList
        cid={String(cid)}
        gid={gid}
        giornate={giornate}
        isLoading={isLoading}
        runQcPending={runQc.isPending}
        deletePending={deleteGiornata.isPending}
        onNavigate={navigate}
        onRunQc={(id) => runQc.mutate(id)}
        onEdit={openEditDialog}
        onDelete={(g) => {
          void openDeleteDialog(g);
        }}
      />
    </div>
  );
}
