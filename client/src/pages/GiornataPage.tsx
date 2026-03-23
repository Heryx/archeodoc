import { useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { ShieldCheck, Sun, Cloud, CloudRain, ChevronRight, Layers, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getCurrentProjectId } from "@/lib/project";
import GoogleDocsImport from "@/components/GoogleDocsImport";

const meteOptions = [
  { value: "soleggiato", label: "Soleggiato", icon: Sun },
  { value: "nuvoloso", label: "Nuvoloso", icon: Cloud },
  { value: "pioggia", label: "Pioggia", icon: CloudRain },
];

type GiornataForm = {
  data: string;
  operatori: string;
  condMeteo: string;
  settore: string;
  note: string;
};

type GiornataDeleteImpact = {
  usCollegateCount: number;
  allegatiCount: number;
  qcLogsCount: number;
};

const emptyForm: GiornataForm = {
  data: new Date().toISOString().split("T")[0],
  operatori: "",
  condMeteo: "",
  settore: "",
  note: "",
};

function parseOperatori(operatoriRaw: string | null | undefined): string {
  if (!operatoriRaw) return "";
  try {
    const parsed = JSON.parse(operatoriRaw);
    if (Array.isArray(parsed)) return parsed.join(", ");
  } catch {
    // fallback a stringa grezza
  }
  return operatoriRaw;
}

function operatoriToPayload(value: string): string | null {
  const cleaned = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

function QcBadge({ status }: { status?: string | null }) {
  const s = status || "pending";
  const map: Record<string, { label: string; cls: string }> = {
    ok: { label: "OK", cls: "qc-ok" },
    warning: { label: "Avviso", cls: "qc-warning" },
    error: { label: "Errore", cls: "qc-error" },
    pending: { label: "Da verificare", cls: "qc-pending" },
  };
  const { label, cls } = map[s] || map.pending;
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium", cls)}>{label}</span>;
}

function GiornataFormFields({
  form,
  setForm,
}: {
  form: GiornataForm;
  setForm: Dispatch<SetStateAction<GiornataForm>>;
}) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data *</Label>
          <Input
            data-testid="input-data"
            type="date"
            value={form.data}
            onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
          />
        </div>
        <div>
          <Label>Settore</Label>
          <Input
            placeholder="es. A1, Nord"
            value={form.settore}
            onChange={(e) => setForm((f) => ({ ...f, settore: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Operatori (separati da virgola)</Label>
        <Input
          data-testid="input-operatori"
          placeholder="Mario Rossi, Giulia Bianchi"
          value={form.operatori}
          onChange={(e) => setForm((f) => ({ ...f, operatori: e.target.value }))}
        />
      </div>
      <div>
        <Label>Condizioni meteo</Label>
        <Select value={form.condMeteo} onValueChange={(v) => setForm((f) => ({ ...f, condMeteo: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Seleziona..." />
          </SelectTrigger>
          <SelectContent>
            {meteOptions.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Note operative</Label>
        <Textarea
          placeholder="Attivita principali, problematiche, etc."
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </div>
    </div>
  );
}

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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-sm text-muted-foreground mb-1">{cantiere?.nome || `Cantiere #${cid}`}</div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Giornate di scavo</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate(`/cantiere/${cid}/us`)}>
              <Layers size={15} /> Vai alle US
            </Button>
            <Dialog open={openCreate} onOpenChange={setOpenCreate}>
              <DialogTrigger asChild>
                <Button data-testid="button-nuova-giornata" className="gap-2">
                  <Plus size={16} /> Nuova giornata
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Registra giornata di scavo</DialogTitle>
                </DialogHeader>
                <GoogleDocsImport mode="giornata" onImport={(data) => {
                  if (data.mode === "structured") {
                    setCreateForm(prev => ({ ...prev, ...data.mapped }));
                  } else {
                    setCreateForm(prev => ({ ...prev, note: data.text }));
                    toast({ title: "Testo importato nel campo note" });
                  }
                }} />
                <GiornataFormFields form={createForm} setForm={setCreateForm} />
                <Button
                  data-testid="button-salva-giornata"
                  className="w-full"
                  onClick={() => createGiornata.mutate(createForm)}
                  disabled={!createForm.data || createGiornata.isPending}
                >
                  {createGiornata.isPending ? "Salvataggio..." : "Registra giornata"}
                </Button>
              </DialogContent>
            </Dialog>
          </div>
        </div>
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
            <DialogTitle>Modifica giornata</DialogTitle>
          </DialogHeader>
          <GoogleDocsImport mode="giornata" onImport={(data) => {
            if (data.mode === "structured") {
              setEditForm(prev => ({ ...prev, ...data.mapped }));
            } else {
              setEditForm(prev => ({ ...prev, note: data.text }));
              toast({ title: "Testo importato nel campo note" });
            }
          }} />
          <GiornataFormFields form={editForm} setForm={setEditForm} />
          <Button
            className="w-full"
            onClick={() => {
              if (editingId) updateGiornata.mutate({ id: editingId, data: editForm });
            }}
            disabled={!editForm.data || !editingId || updateGiornata.isPending}
          >
            {updateGiornata.isPending ? "Aggiornamento..." : "Salva modifiche"}
          </Button>
        </DialogContent>
      </Dialog>

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

          {isLoadingDeleteImpact ? (
            <div className="text-sm text-muted-foreground">Calcolo impatto in corso...</div>
          ) : deleteImpact ? (
            <div className="text-sm space-y-1">
              <p className="font-medium">Impatto:</p>
              <p>- US collegate (verranno scollegate): {deleteImpact.usCollegateCount}</p>
              <p>- Allegati: {deleteImpact.allegatiCount}</p>
              <p>- Log QC: {deleteImpact.qcLogsCount}</p>
              <p className="text-red-600 mt-2">L'operazione non e reversibile.</p>
            </div>
          ) : null}

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

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : giornate.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <p className="font-medium">Nessuna giornata registrata</p>
          <p className="text-muted-foreground text-sm mt-1">Aggiungi la prima giornata di scavo</p>
        </div>
      ) : (
        <div className="space-y-3">
          {giornate.map((g: any) => {
            const operatoriString = parseOperatori(g.operatori);
            const active = gid && String(g.id) === gid;

            return (
              <Card
                key={g.id}
                data-testid={`card-giornata-${g.id}`}
                className={cn(
                  "hover:border-primary/40 transition-colors cursor-pointer group",
                  active && "border-primary/40 bg-primary/5",
                )}
                onClick={() => navigate(`/cantiere/${cid}/giornata/${g.id}`)}
              >
                <CardContent className="py-4 px-5 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{g.data}</span>
                      <QcBadge status={g.qcStatus} />
                      {g.condMeteo && <span className="text-xs text-muted-foreground capitalize">{g.condMeteo}</span>}
                    </div>
                    <div className="text-sm text-muted-foreground flex gap-4">
                      {g.settore && <span>Settore: {g.settore}</span>}
                      {operatoriString && <span>{operatoriString}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-qc-${g.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        runQc.mutate(g.id);
                      }}
                      disabled={runQc.isPending}
                    >
                      <ShieldCheck size={14} className="mr-1" />
                      QC
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      data-testid={`button-elimina-giornata-${g.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openDeleteDialog(g);
                      }}
                      disabled={deleteGiornata.isPending}
                    >
                      <Trash2 size={14} className="text-red-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      data-testid={`button-modifica-giornata-${g.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(g);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

