import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Layers, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { extractSearchFromLocation } from "@/lib/location";
import { getCurrentProjectId } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaterialeFormDialog } from "@/components/materiali/MaterialeFormDialog";
import { MaterialiList } from "@/components/materiali/MaterialiList";
import {
  emptyMaterialeForm,
  mapMaterialeToForm,
  materialePayload,
  type MaterialeForm,
} from "@/components/materiali/types";

function extractErrorDescription(error: unknown): string {
  const raw = (error as any)?.message || "";
  try {
    const body = JSON.parse(String(raw).replace(/^\d+: /, ""));
    return body.error || raw;
  } catch {
    return String(raw);
  }
}

function filterUsFromLocation(location: string): string {
  const search = extractSearchFromLocation(location);
  if (!search) return "all";
  const usId = new URLSearchParams(search).get("usId");
  if (!usId) return "all";
  return /^\d+$/.test(usId) ? usId : "all";
}

function filterGiornataFromLocation(location: string): string {
  const search = extractSearchFromLocation(location);
  if (!search) return "all";
  const giornataId = new URLSearchParams(search).get("giornataId");
  if (!giornataId) return "all";
  return /^\d+$/.test(giornataId) ? giornataId : "all";
}

export function MaterialiPage() {
  const { cid } = useParams<{ cid: string }>();
  const [location, navigate] = useLocation();
  const activeProjectId = getCurrentProjectId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filterUs, setFilterUs] = useState<string>(() => filterUsFromLocation(location));
  const [filterGiornata, setFilterGiornata] = useState<string>(() => filterGiornataFromLocation(location));
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [createForm, setCreateForm] = useState<MaterialeForm>(emptyMaterialeForm);
  const [editForm, setEditForm] = useState<MaterialeForm>(emptyMaterialeForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const navigateWithFilters = useCallback((nextUs: string, nextGiornata: string) => {
    if (!cid) return;
    const params = new URLSearchParams();
    if (nextUs !== "all") params.set("usId", nextUs);
    if (nextGiornata !== "all") params.set("giornataId", nextGiornata);
    const query = params.toString();
    navigate(`/cantiere/${cid}/materiali${query ? `?${query}` : ""}`);
  }, [cid, navigate]);

  const { data: cantieri = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });
  const cantiere = cantieri.find((c: any) => String(c.id) === String(cid));

  const { data: giornate = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const { data: usList = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", "materiali-page", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  const { data: materiali = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "ra", filterUs, filterGiornata, activeProjectId],
    queryFn: async () => {
      const query = filterUs !== "all" ? `?usId=${filterUs}` : "";
      return (await apiRequest("GET", `/api/cantieri/${cid}/ra${query}`)).json();
    },
    enabled: !!cid,
  });

  const usById = useMemo(() => new Map<number, any>(usList.map((us: any) => [us.id, us])), [usList]);
  const usListFilteredByGiornata = useMemo(
    () =>
      filterGiornata === "all"
        ? usList
        : usList.filter((us: any) => String(us.giornataId ?? "") === filterGiornata),
    [usList, filterGiornata],
  );
  const materialiVisibili = useMemo(() => {
    if (filterUs !== "all" || filterGiornata === "all") return materiali;
    const allowedUs = new Set<number>(usListFilteredByGiornata.map((us: any) => us.id));
    return materiali.filter((item: any) => item.usId != null && allowedUs.has(item.usId));
  }, [materiali, filterUs, filterGiornata, usListFilteredByGiornata]);

  useEffect(() => {
    const nextUs = filterUsFromLocation(location);
    const nextGiornata = filterGiornataFromLocation(location);
    setFilterUs(nextUs);
    setFilterGiornata(nextGiornata);
  }, [location]);

  useEffect(() => {
    if (filterUs === "all") return;
    const exists = usListFilteredByGiornata.some((us: any) => String(us.id) === filterUs);
    if (!exists) {
      setFilterUs("all");
      navigateWithFilters("all", filterGiornata);
    }
  }, [filterUs, filterGiornata, navigateWithFilters, usListFilteredByGiornata]);

  const createMateriale = useMutation({
    mutationFn: async (data: MaterialeForm) => {
      const response = await apiRequest("POST", `/api/cantieri/${cid}/ra`, materialePayload(data));
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "ra"] });
      setOpenCreate(false);
      setCreateForm(emptyMaterialeForm);
      toast({ title: "Scheda materiale creata" });
    },
    onError: (error) =>
      toast({
        title: "Errore creazione materiale",
        description: extractErrorDescription(error),
        variant: "destructive",
      }),
  });

  const updateMateriale = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: MaterialeForm }) => {
      const response = await apiRequest("PATCH", `/api/ra/${id}`, materialePayload(data));
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "ra"] });
      setOpenEdit(false);
      setEditingId(null);
      toast({ title: "Scheda materiale aggiornata" });
    },
    onError: (error) =>
      toast({
        title: "Errore aggiornamento materiale",
        description: extractErrorDescription(error),
        variant: "destructive",
      }),
  });

  const deleteMateriale = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ra/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "ra"] });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      toast({ title: "Scheda materiale eliminata" });
    },
    onError: () =>
      toast({
        title: "Errore eliminazione materiale",
        variant: "destructive",
      }),
  });

  function openEditDialog(materiale: any) {
    setEditingId(materiale.id);
    setEditForm(mapMaterialeToForm(materiale));
    setOpenEdit(true);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-sm text-muted-foreground mb-1">{cantiere?.nome || `Cantiere #${cid}`}</div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Schede materiali (RA)</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate(`/cantiere/${cid}/us${filterGiornata !== "all" ? `?giornataId=${filterGiornata}` : ""}`)}
            >
              <Layers size={15} /> Torna alle US
            </Button>
            <div className="min-w-52">
              <Select
                value={filterGiornata}
                onValueChange={(value) => {
                  setFilterGiornata(value);
                  navigateWithFilters(filterUs, value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filtra per giornata" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutte le giornate</SelectItem>
                  {giornate.map((g: any) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.data}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-52">
              <Select
                value={filterUs}
                onValueChange={(value) => {
                  setFilterUs(value);
                  navigateWithFilters(value, filterGiornata);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filtra per US" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutte le US</SelectItem>
                  {usListFilteredByGiornata.map((us: any) => (
                    <SelectItem key={us.id} value={String(us.id)}>
                      {us.codiceUS}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="gap-2" onClick={() => setOpenCreate(true)}>
              <Plus size={16} /> Nuova scheda RA
            </Button>
          </div>
        </div>
      </div>

      <MaterialeFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        title="Nuova scheda materiale (RA)"
        form={createForm}
        setForm={setCreateForm}
        usList={usListFilteredByGiornata}
        onSubmit={() => createMateriale.mutate(createForm)}
        submitPending={createMateriale.isPending}
        submitLabelIdle="Crea scheda materiale"
        submitLabelPending="Creazione..."
        submitDisabled={!createForm.codice.trim() || createMateriale.isPending}
      />

      <MaterialeFormDialog
        open={openEdit}
        onOpenChange={(value) => {
          setOpenEdit(value);
          if (!value) setEditingId(null);
        }}
        title="Modifica scheda materiale (RA)"
        form={editForm}
        setForm={setEditForm}
        usList={usList}
        onSubmit={() => {
          if (!editingId) return;
          updateMateriale.mutate({ id: editingId, data: editForm });
        }}
        submitPending={updateMateriale.isPending}
        submitLabelIdle="Salva modifiche"
        submitLabelPending="Aggiornamento..."
        submitDisabled={!editForm.codice.trim() || !editingId || updateMateriale.isPending}
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(value) => {
          setDeleteDialogOpen(value);
          if (!value && !deleteMateriale.isPending) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la scheda materiale?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Stai per eliminare la scheda ${deleteTarget.codice}.`
                : "Stai per eliminare una scheda materiale."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMateriale.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              disabled={!deleteTarget || deleteMateriale.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMateriale.mutate(deleteTarget.id);
              }}
            >
              {deleteMateriale.isPending ? "Eliminazione..." : "Elimina scheda"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MaterialiList
        materiali={materialiVisibili}
        usById={usById}
        isLoading={isLoading}
        onEdit={openEditDialog}
        onDelete={(materiale) => {
          setDeleteTarget(materiale);
          setDeleteDialogOpen(true);
        }}
      />
    </div>
  );
}
