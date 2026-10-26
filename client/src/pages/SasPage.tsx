import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { ChevronDown, Plus, Pencil, Trash2 } from "lucide-react";
import { StoricoButton } from "@/components/storico/StoricoButton";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { USFotoPanel } from "@/components/us/USFotoPanel";

type SasForm = {
  codice: string;
  nome: string;
  descrizione: string;
  data: string;
};

const emptySasForm: SasForm = {
  codice: "",
  nome: "",
  descrizione: "",
  data: "",
};

function mapSasToForm(sas: any): SasForm {
  return {
    codice: sas.codice || "",
    nome: sas.nome || "",
    descrizione: sas.descrizione || "",
    data: sas.data || "",
  };
}

function sasPayload(form: SasForm, cantiereId: number) {
  return {
    cantiereId,
    codice: form.codice.trim(),
    nome: form.nome.trim() || null,
    descrizione: form.descrizione.trim() || null,
    data: form.data.trim() || null,
  };
}

function SasCard({
  sas,
  cantiereId,
  onEdit,
  onDelete,
}: {
  sas: any;
  cantiereId: number;
  onEdit: (sas: any) => void;
  onDelete: (sas: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")}
        />
        <span className="font-mono font-semibold text-primary">{sas.codice}</span>
        {sas.nome && (
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{sas.nome}</span>
        )}
        {sas.data && <span className="text-xs text-muted-foreground">{sas.data}</span>}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button
            type="button"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Modifica"
            onClick={(e) => { e.stopPropagation(); onEdit(sas); }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-600 transition-colors"
            title="Elimina"
            onClick={(e) => { e.stopPropagation(); onDelete(sas); }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <CardContent className="px-4 pb-4 pt-0 border-t border-border/40 space-y-3">
          {sas.descrizione && (
            <p className="text-sm text-muted-foreground mt-2">{sas.descrizione}</p>
          )}
          <USFotoPanel sasId={sas.id} cantiereId={cantiereId} compact />
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => onEdit(sas)}>
              <Pencil size={12} /> Modifica
            </Button>
            <StoricoButton entityType="sas" entityId={sas.id} title={`Cronologia · SAS ${sas.codice}`} />
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(sas)}
            >
              <Trash2 size={12} /> Elimina
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function SasPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [createForm, setCreateForm] = useState<SasForm>(emptySasForm);
  const [editForm, setEditForm] = useState<SasForm>(emptySasForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const cantiereId = cid ? Number(cid) : null;

  const sasQuery = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "sas"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/sas`)).json(),
    enabled: !!cid && !!activeProjectId,
  });

  const sasList = sasQuery.data || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!cantiereId) throw new Error("Cantiere mancante");
      return (await apiRequest("POST", `/api/cantieri/${cid}/sas`, sasPayload(createForm, cantiereId))).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "sas"] });
      setIsCreateOpen(false);
      setCreateForm(emptySasForm);
      toast({ title: "SAS creato" });
    },
    onError: (error: any) =>
      toast({ title: "Errore creazione SAS", description: error?.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingId || !cantiereId) throw new Error("Dati mancanti");
      return (await apiRequest("PATCH", `/api/sas/${editingId}`, sasPayload(editForm, cantiereId))).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "sas"] });
      setIsEditOpen(false);
      setEditingId(null);
      toast({ title: "SAS aggiornato" });
    },
    onError: (error: any) =>
      toast({ title: "Errore aggiornamento SAS", description: error?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/sas/${id}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "sas"] });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      toast({ title: "SAS eliminato" });
    },
    onError: (error: any) =>
      toast({ title: "Errore eliminazione SAS", description: error?.message, variant: "destructive" }),
  });

  function handleOpenEdit(sas: any) {
    setEditForm(mapSasToForm(sas));
    setEditingId(sas.id);
    setIsEditOpen(true);
  }

  function handleOpenDelete(sas: any) {
    setDeleteTarget(sas);
    setDeleteDialogOpen(true);
  }

  const SasFormFields = ({ form, onChange }: { form: SasForm; onChange: (patch: Partial<SasForm>) => void }) => (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Codice SAS *</Label>
          <Input
            placeholder="es. SAS 01"
            value={form.codice}
            onChange={(e) => onChange({ codice: e.target.value })}
          />
        </div>
        <div>
          <Label>Data (opzionale)</Label>
          <Input
            type="date"
            value={form.data}
            onChange={(e) => onChange({ data: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label>Nome / Denominazione</Label>
        <Input
          placeholder="es. Saggio est, Trincea nord..."
          value={form.nome}
          onChange={(e) => onChange({ nome: e.target.value })}
        />
      </div>
      <div>
        <Label>Descrizione</Label>
        <Textarea
          rows={4}
          placeholder="Descrizione del saggio stratigrafico..."
          value={form.descrizione}
          onChange={(e) => onChange({ descrizione: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Saggi di Scavo (SAS)</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Gestione dei saggi e settori di scavo associati al cantiere.
            </p>
          </div>
          <Button className="gap-2 shrink-0" onClick={() => setIsCreateOpen(true)}>
            <Plus size={15} /> Nuovo SAS
          </Button>
        </div>

        {sasQuery.isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : sasList.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
            <p className="font-medium">Nessun saggio registrato</p>
            <p className="text-muted-foreground text-sm mt-1">Aggiungi il primo SAS per questo cantiere</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sasList.map((sas: any) => (
              <SasCard
                key={sas.id}
                sas={sas}
                cantiereId={cantiereId || 0}
                onEdit={handleOpenEdit}
                onDelete={handleOpenDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo SAS</DialogTitle>
          </DialogHeader>
          <SasFormFields form={createForm} onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Annulla</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!createForm.codice.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creazione..." : "Crea SAS"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica SAS</DialogTitle>
          </DialogHeader>
          <SasFormFields form={editForm} onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Annulla</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editForm.codice.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Salvataggio..." : "Salva"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Elimina SAS</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per eliminare il saggio <strong>{deleteTarget?.codice}</strong>. Questa azione non e reversibile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
