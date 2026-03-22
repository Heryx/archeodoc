import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, User, CalendarDays, ArrowRight, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { getCurrentProjectId } from "@/lib/project";

type CantiereForm = {
  codice: string;
  nome: string;
  localita: string;
  committente: string;
  responsabile: string;
  dataInizio: string;
  dataFine: string;
  note: string;
};

type CantiereDeleteImpact = {
  giornateCount: number;
  usCount: number;
  allegatiCount: number;
  qcLogsCount: number;
};

type ProjectItem = {
  id: string;
  name: string;
};

type ProjectsResponse = {
  currentProjectId: string | null;
  projects: ProjectItem[];
};

type CantiereTransferResult = {
  mode: "copy" | "move";
  targetProjectId: string;
  targetCantiereId: number;
  targetCodice: string;
  codiceRenamed: boolean;
  sourceDeleted: boolean;
  filesCopied: number;
  filesMissing: number;
  counts: {
    giornate: number;
    us: number;
    allegati: number;
    qcLogs: number;
  };
};

const emptyForm: CantiereForm = {
  codice: "",
  nome: "",
  localita: "",
  committente: "",
  responsabile: "",
  dataInizio: "",
  dataFine: "",
  note: "",
};

function mapCantiereToForm(c: any): CantiereForm {
  return {
    codice: c.codice || "",
    nome: c.nome || "",
    localita: c.localita || "",
    committente: c.committente || "",
    responsabile: c.responsabile || "",
    dataInizio: c.dataInizio || "",
    dataFine: c.dataFine || "",
    note: c.note || "",
  };
}

function CantiereFormFields({
  form,
  setForm,
}: {
  form: CantiereForm;
  setForm: Dispatch<SetStateAction<CantiereForm>>;
}) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Codice *</Label>
          <Input
            data-testid="input-codice"
            placeholder="es. ITA-BO-2026-01"
            value={form.codice}
            onChange={(e) => setForm((f) => ({ ...f, codice: e.target.value }))}
          />
        </div>
        <div>
          <Label>Committente</Label>
          <Input
            value={form.committente}
            onChange={(e) => setForm((f) => ({ ...f, committente: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Nome cantiere *</Label>
        <Input
          data-testid="input-nome"
          placeholder="es. Necropoli di via Roma - Bologna"
          value={form.nome}
          onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Localita *</Label>
          <Input
            placeholder="Comune, Provincia"
            value={form.localita}
            onChange={(e) => setForm((f) => ({ ...f, localita: e.target.value }))}
          />
        </div>
        <div>
          <Label>Responsabile</Label>
          <Input
            value={form.responsabile}
            onChange={(e) => setForm((f) => ({ ...f, responsabile: e.target.value }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data inizio</Label>
          <Input
            type="date"
            value={form.dataInizio}
            onChange={(e) => setForm((f) => ({ ...f, dataInizio: e.target.value }))}
          />
        </div>
        <div>
          <Label>Data fine</Label>
          <Input
            type="date"
            value={form.dataFine}
            onChange={(e) => setForm((f) => ({ ...f, dataFine: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Note</Label>
        <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </div>
    </div>
  );
}

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

      <Dialog
        open={transferDialogOpen}
        onOpenChange={(value) => {
          setTransferDialogOpen(value);
          if (!value && !transferCantiere.isPending) {
            setTransferTarget(null);
            setTransferMode("copy");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trasferisci cantiere su altro progetto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              {transferTarget
                ? `Cantiere selezionato: ${transferTarget.codice} - ${transferTarget.nome}`
                : "Seleziona un cantiere da trasferire."}
            </p>
            <div>
              <Label>Progetto destinazione</Label>
              <Select value={transferProjectId} onValueChange={setTransferProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona progetto..." />
                </SelectTrigger>
                <SelectContent>
                  {otherProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Operazione</Label>
              <Select value={transferMode} onValueChange={(value) => setTransferMode(value as "copy" | "move")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="copy">Copia (mantieni anche nel progetto corrente)</SelectItem>
                  <SelectItem value="move">Sposta (rimuovi dal progetto corrente)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Lo spostamento copia prima tutti i dati e poi elimina il cantiere dal progetto corrente.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={() => {
                if (!transferTarget || !transferProjectId) return;
                transferCantiere.mutate({
                  cantiereId: transferTarget.id,
                  targetProjectId: transferProjectId,
                  mode: transferMode,
                });
              }}
              disabled={!transferTarget || !transferProjectId || transferCantiere.isPending}
            >
              {transferCantiere.isPending
                ? "Trasferimento in corso..."
                : transferMode === "move"
                  ? "Sposta cantiere"
                  : "Copia cantiere"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

          {isLoadingDeleteImpact ? (
            <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>
          ) : deleteImpact ? (
            <div className="text-sm space-y-1">
              <p className="font-medium">Impatto:</p>
              <p>- Giornate: {deleteImpact.giornateCount}</p>
              <p>- US: {deleteImpact.usCount}</p>
              <p>- Allegati: {deleteImpact.allegatiCount}</p>
              <p>- Log QC: {deleteImpact.qcLogsCount}</p>
              <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
            </div>
          ) : null}

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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : cantieri.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-border rounded-xl">
          <div className="text-4xl mb-3">🏺</div>
          <p className="font-medium text-foreground">Nessun cantiere</p>
          <p className="text-muted-foreground text-sm mt-1">Crea il primo cantiere per iniziare</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cantieri.map((c: any) => (
            <Card
              key={c.id}
              data-testid={`card-cantiere-${c.id}`}
              className="hover:border-primary/50 transition-colors cursor-pointer group"
              onClick={() => navigate(`/cantiere/${c.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Badge variant="secondary" className="mb-2 font-mono text-xs">
                      {c.codice}
                    </Badge>
                    <CardTitle className="text-base">{c.nome}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-600 hover:text-red-700"
                      data-testid={`button-elimina-cantiere-${c.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openDeleteDialog(c);
                      }}
                      disabled={deleteCantiere.isPending}
                    >
                      <Trash2 size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      data-testid={`button-trasferisci-cantiere-${c.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTransferDialog(c);
                      }}
                      disabled={transferCantiere.isPending}
                    >
                      <ArrowRightLeft size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      data-testid={`button-modifica-cantiere-${c.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(c);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5">
                  <MapPin size={13} />
                  {c.localita}
                </div>
                {c.responsabile && (
                  <div className="flex items-center gap-1.5">
                    <User size={13} />
                    {c.responsabile}
                  </div>
                )}
                {c.dataInizio && (
                  <div className="flex items-center gap-1.5">
                    <CalendarDays size={13} />
                    Dal {c.dataInizio}
                    {c.dataFine ? ` al ${c.dataFine}` : ""}
                  </div>
                )}
                <div className="text-xs mt-1 opacity-70">{c.committente}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="mt-12">
        <PerplexityAttribution />
      </div>
    </div>
  );
}



