import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FolderPlus } from "lucide-react";
import { CantiereLista } from "@/components/projects/CantiereLista";
import { ProjectSchemaDialog } from "@/components/projects/ProjectSchemaDialog";
import type { ProjectItem } from "@/components/projects/types";
import type { ProjectSchemaPresetSummary } from "@shared/types/schema";

type ProjectsResponse = {
  workspaceRoot: string;
  currentProjectId: string | null;
  projects: ProjectItem[];
  schemaPresets: ProjectSchemaPresetSummary[];
};

type CreateProjectForm = {
  name: string;
  projectId: string;
  basePath: string;
  documentationPresetKey: string;
};

const emptyCreateForm: CreateProjectForm = {
  name: "",
  projectId: "",
  basePath: "",
  documentationPresetKey: "",
};

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const localProjectId = getCurrentProjectId();

  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateProjectForm>(emptyCreateForm);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [schemaProjectId, setSchemaProjectId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ProjectsResponse>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!createForm.documentationPresetKey && data?.schemaPresets?.length) {
      setCreateForm((prev) => ({
        ...prev,
        documentationPresetKey: data.schemaPresets[0].key,
      }));
    }
  }, [createForm.documentationPresetKey, data?.schemaPresets]);

  useEffect(() => {
    if (!data?.currentProjectId) return;
    if (data.currentProjectId !== localProjectId) {
      setCurrentProjectId(data.currentProjectId);
    }
  }, [data?.currentProjectId, localProjectId]);

  const currentProjectId = localProjectId || data?.currentProjectId || null;

  const selectProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/select`, {});
      return projectId;
    },
    onSuccess: (projectId) => {
      setCurrentProjectId(projectId);
      queryClient.clear();
      window.location.hash = "#/";
      window.location.reload();
    },
    onError: () => toast({ title: "Errore selezione progetto", variant: "destructive" }),
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: createForm.name.trim(),
        projectId: createForm.projectId.trim() || null,
        basePath: createForm.basePath.trim() || null,
        documentationPresetKey: createForm.documentationPresetKey || null,
      };
      return (await apiRequest("POST", "/api/projects", payload)).json() as Promise<ProjectItem>;
    },
    onSuccess: (project) => {
      setOpenCreate(false);
      setCreateForm({
        ...emptyCreateForm,
        documentationPresetKey: data?.schemaPresets?.[0]?.key || "",
      });
      toast({ title: "Progetto creato" });
      setCurrentProjectId(project.id);
      queryClient.clear();
      window.location.hash = "#/";
      window.location.reload();
    },
    onError: (error: any) =>
      toast({
        title: "Errore creazione progetto",
        description: error?.message,
        variant: "destructive",
      }),
  });

  function openSchemaEditor(projectId: string) {
    setSchemaProjectId(projectId);
    setSchemaDialogOpen(true);
  }

  const schemaProjectName = data?.projects?.find((project) => project.id === schemaProjectId)?.name;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progetti dati</h1>
          <p className="text-muted-foreground mt-1">
            Ogni progetto usa database SQLite e cartelle dedicate (media, export, backup).
          </p>
        </div>

        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-nuovo-progetto" className="gap-2">
              <FolderPlus size={16} /> Nuovo progetto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crea progetto dati</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div>
                <Label>Nome progetto *</Label>
                <Input
                  placeholder="es. Scavo Via Roma 2026"
                  value={createForm.name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>

              <div>
                <Label>ID progetto (opzionale)</Label>
                <Input
                  placeholder="es. scavo-via-roma-2026"
                  value={createForm.projectId}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, projectId: event.target.value }))}
                />
              </div>

              <div>
                <Label>Percorso base (opzionale)</Label>
                <Input
                  placeholder={data?.workspaceRoot || "es. D:\\Scavi\\ArcheoDoc"}
                  value={createForm.basePath}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, basePath: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se vuoto usa il percorso predefinito: {data?.workspaceRoot || "..."}
                </p>
              </div>

              <div>
                <Label>Schema documentazione</Label>
                <Select
                  value={createForm.documentationPresetKey}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, documentationPresetKey: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona schema..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.schemaPresets || []).map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Puoi scegliere schema ministeriale ICCD oppure schema personalizzato.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={() => createProjectMutation.mutate()}
                disabled={
                  !createForm.name.trim() ||
                  !createForm.documentationPresetKey ||
                  createProjectMutation.isPending
                }
              >
                {createProjectMutation.isPending ? "Creazione..." : "Crea progetto"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <CantiereLista
        isLoading={isLoading}
        projects={data?.projects || []}
        currentProjectId={currentProjectId}
        schemaPresets={data?.schemaPresets || []}
        isSelecting={selectProjectMutation.isPending}
        onOpenSchema={openSchemaEditor}
        onOpenProject={(projectId) => selectProjectMutation.mutate(projectId)}
      />

      <ProjectSchemaDialog
        open={schemaDialogOpen}
        projectId={schemaProjectId}
        projectName={schemaProjectName}
        fallbackPresets={data?.schemaPresets || []}
        onOpenChange={(value) => {
          setSchemaDialogOpen(value);
          if (!value) {
            setSchemaProjectId(null);
          }
        }}
      />

      <div className="mt-6">
        <Button variant="ghost" onClick={() => navigate("/")}>
          Torna ai cantieri
        </Button>
      </div>
    </div>
  );
}
