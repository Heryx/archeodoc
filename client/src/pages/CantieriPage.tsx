import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { getCurrentProjectId } from "@/lib/project";
import { CantiereFormFields } from "@/components/cantieri/CantiereFormFields";
import { CantiereDeleteImpactDetails } from "@/components/cantieri/CantiereDeleteImpact";
import { CantiereGrid } from "@/components/cantieri/CantiereGrid";
import { CantiereTransferDialog } from "@/components/cantieri/CantiereTransferDialog";
import {
  emptyForm,
  mapCantiereToForm,
  type CantiereDeleteImpact,
  type CantiereForm,
  type CantiereTransferResult,
  type ProjectsResponse,
} from "@/components/cantieri/types";

export function CantieriPage() {
  const activeProjectId = getCurrentProjectId();
  const { data: cantieri = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });
  const { data: projectsData, isLoading: isProjectsLoading } = useQuery<ProjectsResponse>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    staleTime: 0,
    refetchOnMount: true,
  });
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [createForm, setCreateForm] = useState<CantiereForm>(emptyForm);
  const [editForm, setEditForm] = useState<CantiereForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<CantiereDeleteImpact | null>(null);
  const [isLoadingDeleteImpact, setIsLoadingDeleteImpact] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<any | null>(null);
  const [transferProjectId, setTransferProjectId] = useState("");
  const [transferMode, setTransferMode] = useState<"copy" | "move">("copy");

  const sourceProjectId = activeProjectId || projectsData?.currentProjectId || null;
  const otherProjects = (projectsData?.projects || []).filter((p) => p.id !== sourceProjectId);

  useEffect(() => {
    if (!transferDialogOpen) return;
    if (otherProjects.length === 0) {
      setTransferProjectId("");
      return;
    }

    if (!transferProjectId || !otherProjects.some((p) => p.id === transferProjectId)) {
      setTransferProjectId(otherProjects[0].id);
    }
  }, [transferDialogOpen, transferProjectId, otherProjects]);

  const createCantiere = useMutation({
    mutationFn: async (data: CantiereForm) => (await apiRequest("POST", "/api/cantieri", data)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      setOpenCreate(false);
      setCreateForm(emptyForm);
      toast({ title: "Cantiere creato" });
    },
    onError: () => toast({ title: "Errore nella creazione", variant: "destructive" }),
  });

  const updateCantiere = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CantiereForm }) =>
      (await apiRequest("PATCH", `/api/cantieri/${id}`, data)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      setOpenEdit(false);
      setEditingId(null);
      toast({ title: "Cantiere aggiornato" });
    },
    onError: () => toast({ title: "Errore durante la modifica", variant: "destructive" }),
  });

  const deleteCantiere = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/cantieri/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
      toast({ title: "Cantiere eliminato" });
    },
    onError: () => toast({ title: "Errore eliminazione cantiere", variant: "destructive" }),
  });

  const transferCantiere = useMutation({
    mutationFn: async ({
      cantiereId,
      targetProjectId,
      mode,
    }: {
      cantiereId: number;
      targetProjectId: string;
      mode: "copy" | "move";
    }) => {
      const response = await apiRequest("POST", `/api/cantieri/${cantiereId}/transfer`, {
        targetProjectId,
        mode,
      });
      return response.json() as Promise<CantiereTransferResult>;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", activeProjectId] });
      setTransferDialogOpen(false);
      setTransferTarget(null);
      setTransferMode("copy");

      const actionLabel = result.mode === "move" ? "spostato" : "copiato";
      const renamedText = result.codiceRenamed ? ` Codice destinazione: ${result.targetCodice}.` : "";
      const missingText =
        result.filesMissing > 0 ? ` Allegati non trovati su disco: ${result.filesMissing}.` : "";

      toast({
        title: `Cantiere ${actionLabel}`,
        description: `Giornate ${result.counts.giornate}, US ${result.counts.us}, allegati ${result.counts.allegati}.${renamedText}${missingText}`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore trasferimento cantiere",
        description: error?.message,
        variant: "destructive",
      }),
  });

  const openTransferDialog = (cantiere: any) => {
    if (isProjectsLoading) {
      toast({
        title: "Caricamento progetti in corso",
        description: "Riprova tra un secondo.",
      });
      return;
    }

    if (otherProjects.length === 0) {
      toast({
        title: "Nessun progetto destinazione disponibile",
        description: "Crea prima un altro progetto dalla sezione Progetti.",
        variant: "destructive",
      });
      return;
    }

    setTransferTarget(cantiere);
    setTransferMode("copy");
    setTransferDialogOpen(true);
  };

  const openDeleteDialog = async (c: any) => {
    setDeleteTarget(c);
    setDeleteImpact(null);
    setDeleteDialogOpen(true);
    setIsLoadingDeleteImpact(true);

    try {
      const impact: CantiereDeleteImpact = await (await apiRequest("GET", `/api/cantieri/${c.id}/delete-impact`)).json();
      setDeleteImpact(impact);
    } catch {
      toast({
        title: "Impossibile calcolare l'impatto eliminazione",
        description: "Verifica di essere nel progetto corretto prima di eliminare il cantiere.",
        variant: "destructive",
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteImpact(null);
    } finally {
      setIsLoadingDeleteImpact(false);
    }
  };

  const openEditDialog = (cantiere: any) => {
    setEditingId(cantiere.id);
    setEditForm(mapCantiereToForm(cantiere));
    setOpenEdit(true);
  };

  const createDisabled = !createForm.codice || !createForm.nome || !createForm.localita || createCantiere.isPending;
  const editDisabled = !editForm.codice || !editForm.nome || !editForm.localita || updateCantiere.isPending || !editingId;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cantieri di scavo</h1>
          <p className="text-muted-foreground mt-1">Gestisci i cantieri e la documentazione di scavo</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-nuovo-cantiere" className="gap-2">
              <Plus size={16} /> Nuovo cantiere
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuovo cantiere</DialogTitle>
            </DialogHeader>
            <CantiereFormFields form={createForm} setForm={setCreateForm} />
            <Button
              data-testid="button-salva-cantiere"
              className="w-full"
              onClick={() => createCantiere.mutate(createForm)}
              disabled={createDisabled}
            >
              {createCantiere.isPending ? "Salvataggio..." : "Crea cantiere"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={openEdit}
        onOpenChange={(value) => {
          setOpenEdit(value);
          if (!value) {
            setEditingId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica cantiere</DialogTitle>
          </DialogHeader>
          <CantiereFormFields form={editForm} setForm={setEditForm} />
          <Button
            className="w-full"
            onClick={() => {
              if (editingId) updateCantiere.mutate({ id: editingId, data: editForm });
            }}
            disabled={editDisabled}
          >
            {updateCantiere.isPending ? "Aggiornamento..." : "Salva modifiche"}
          </Button>
        </DialogContent>
      </Dialog>

      <CantiereTransferDialog
        open={transferDialogOpen}
        pending={transferCantiere.isPending}
        target={transferTarget}
        transferProjectId={transferProjectId}
        transferMode={transferMode}
        otherProjects={otherProjects}
        onOpenChange={(value) => {
          setTransferDialogOpen(value);
          if (!value && !transferCantiere.isPending) {
            setTransferTarget(null);
            setTransferMode("copy");
          }
        }}
        onProjectChange={setTransferProjectId}
        onModeChange={setTransferMode}
        onConfirm={() => {
          if (!transferTarget || !transferProjectId) return;
          transferCantiere.mutate({
            cantiereId: transferTarget.id,
            targetProjectId: transferProjectId,
            mode: transferMode,
          });
        }}
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(value) => {
          setDeleteDialogOpen(value);
          if (!value && !deleteCantiere.isPending) {
            setDeleteTarget(null);
            setDeleteImpact(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il cantiere?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Stai per eliminare "${deleteTarget.nome}".` : "Stai per eliminare un cantiere."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <CantiereDeleteImpactDetails isLoading={isLoadingDeleteImpact} impact={deleteImpact} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCantiere.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              disabled={!deleteTarget || !deleteImpact || deleteCantiere.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteCantiere.mutate(deleteTarget.id);
              }}
            >
              {deleteCantiere.isPending ? "Eliminazione..." : "Elimina cantiere"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CantiereGrid
        cantieri={cantieri}
        isLoading={isLoading}
        deletePending={deleteCantiere.isPending}
        transferPending={transferCantiere.isPending}
        onNavigate={navigate}
        onEdit={openEditDialog}
        onDelete={(c) => {
          void openDeleteDialog(c);
        }}
        onTransfer={openTransferDialog}
      />

      <div className="mt-12">
        <PerplexityAttribution />
      </div>
    </div>
  );
}
