import { CheckCircle2, Database, Download, ExternalLink, FolderOpen, Settings2, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ProjectItem } from "@/components/projects/types";

type ProjectContentStats = {
  cantieri: number;
  giornate: number;
  us: number;
  allegati: number;
  dbSizeBytes: number;
  mediaSizeBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type CantiereCardProps = {
  project: ProjectItem;
  isCurrent: boolean;
  presetLabel?: string;
  onOpenSchema: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onDeleted: () => void;
  isSelecting: boolean;
};

export function CantiereCard({
  project,
  isCurrent,
  presetLabel,
  onOpenSchema,
  onOpenProject,
  onDeleted,
  isSelecting,
}: CantiereCardProps) {
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const openFolderMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${project.id}/open-folder`, {})).json(),
    onSuccess: () => toast({ title: "Cartella aperta in Esplora risorse" }),
    onError: (error: any) =>
      toast({ title: "Impossibile aprire la cartella", description: error?.message, variant: "destructive" }),
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ProjectContentStats>({
    queryKey: ["/api/projects", project.id, "stats"],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${project.id}/stats`)).json(),
    enabled: showStats || deleteDialogOpen,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteFiles }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore eliminazione");
      return res.json();
    },
    onSuccess: () => {
      setDeleteDialogOpen(false);
      toast({ title: "Progetto rimosso" });
      onDeleted();
    },
    onError: (error: any) =>
      toast({ title: "Errore eliminazione progetto", description: error?.message, variant: "destructive" }),
  });

  const handleDownloadBackup = async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/backup`);
      if (!response.ok) throw new Error((await response.json()).error || "Errore backup");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `backup_${project.id}.tar.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Backup scaricato" });
    } catch (error: any) {
      toast({ title: "Errore backup", description: error?.message, variant: "destructive" });
    }
  };

  const modeLabel = project.documentationMode === "iccd" ? "ICCD" : "Custom";
  const createdDate = project.createdAt ? new Date(project.createdAt).toLocaleDateString("it-IT") : null;
  const updatedDate = project.updatedAt ? new Date(project.updatedAt).toLocaleDateString("it-IT") : null;

  return (
    <>
      <Card className={isCurrent ? "border-primary/50" : ""}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base truncate">{project.name}</CardTitle>
                <Badge variant="outline">{modeLabel}</Badge>
                {isCurrent && (
                  <Badge className="gap-1 shrink-0">
                    <CheckCircle2 size={12} /> Attivo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{project.id}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              <Button
                size="sm"
                variant="ghost"
                title="Apri cartella progetto"
                className="gap-1 h-8 px-2"
                onClick={() => openFolderMutation.mutate()}
                disabled={openFolderMutation.isPending}
              >
                <ExternalLink size={13} />
                <span className="hidden sm:inline">Percorso</span>
              </Button>
              <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => onOpenSchema(project.id)}>
                <Settings2 size={13} /> Schema
              </Button>
              <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleDownloadBackup}>
                <Download size={13} /> Backup
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 h-8"
                onClick={() => setShowStats((v) => !v)}
              >
                <Database size={13} /> {showStats ? "Nascondi" : "Analisi"}
              </Button>
              {!isCurrent && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-8"
                  data-testid={`button-seleziona-progetto-${project.id}`}
                  onClick={() => onOpenProject(project.id)}
                  disabled={isSelecting}
                >
                  <FolderOpen size={13} /> Attiva
                </Button>
              )}
              {!isCurrent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-8 text-red-600 hover:text-red-700"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 size={13} /> Elimina
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-foreground">Percorso:</span>
            <span className="text-muted-foreground font-mono truncate" title={project.projectRoot}>
              {project.projectRoot}
            </span>

            <span className="font-medium text-foreground">Database:</span>
            <span className="text-muted-foreground font-mono truncate" title={project.dbPath}>
              {project.dbPath}
            </span>

            <span className="font-medium text-foreground">Schema:</span>
            <span className="text-muted-foreground">{presetLabel || project.schemaKey}</span>

            {createdDate && (
              <>
                <span className="font-medium text-foreground">Creato:</span>
                <span className="text-muted-foreground">{createdDate}{updatedDate && updatedDate !== createdDate ? ` · aggiornato ${updatedDate}` : ""}</span>
              </>
            )}
          </div>

          {showStats && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
              {statsLoading ? (
                <p className="text-xs text-muted-foreground">Analisi in corso...</p>
              ) : stats ? (
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{stats.cantieri}</div>
                    <div className="text-muted-foreground">Cantieri</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{stats.giornate}</div>
                    <div className="text-muted-foreground">Giornate</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{stats.us}</div>
                    <div className="text-muted-foreground">Schede US</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{stats.allegati}</div>
                    <div className="text-muted-foreground">Allegati</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{formatBytes(stats.dbSizeBytes)}</div>
                    <div className="text-muted-foreground">Database</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{formatBytes(stats.mediaSizeBytes)}</div>
                    <div className="text-muted-foreground">Media</div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il progetto?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per rimuovere <strong>{project.name}</strong> ({project.id}) dalla lista progetti.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {stats && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">Contenuto del progetto:</p>
              <p className="text-muted-foreground">
                {stats.cantieri} cantieri · {stats.giornate} giornate · {stats.us} schede US · {stats.allegati} allegati
              </p>
              <p className="text-muted-foreground">
                Database: {formatBytes(stats.dbSizeBytes)} · Media: {formatBytes(stats.mediaSizeBytes)}
              </p>
            </div>
          )}

          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
              />
              <span>
                <strong className="text-destructive">Elimina anche i file su disco</strong>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Database, media e tutti i file della cartella progetto. Irreversibile.
                </span>
              </span>
            </label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Eliminazione..." : deleteFiles ? "Elimina con file" : "Rimuovi dalla lista"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
