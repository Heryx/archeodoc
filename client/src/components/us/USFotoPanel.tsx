import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";

type Allegato = {
  id: number;
  nomeFile: string;
  percorso: string;
  mimeType: string | null;
  tipo: string | null;
  descrizione: string | null;
  dimensione: number | null;
};

type USFotoPanelProps = {
  usId?: number;
  sasId?: number;
  cantiereId: number;
  compact?: boolean;
};

function getAllegatoUrl(percorso: string): string {
  return buildProjectUrl(`/uploads/${encodeURI(percorso.replace(/\\/g, "/"))}`);
}

export function USFotoPanel({ usId, sasId, cantiereId, compact = false }: USFotoPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const activeProjectId = getCurrentProjectId();

  const entityKey = usId != null ? `us-${usId}` : sasId != null ? `sas-${sasId}` : "none";
  const queryParam = usId != null ? `usId=${usId}` : sasId != null ? `sasId=${sasId}` : "";

  const { data: allegati = [], isLoading } = useQuery<Allegato[]>({
    queryKey: ["/api/cantieri", String(cantiereId), "allegati", entityKey, activeProjectId],
    queryFn: async () =>
      (await fetch(buildProjectUrl(`/api/cantieri/${cantiereId}/allegati?${queryParam}`), { headers: getProjectHeader() })).json(),
    enabled: (!!usId || !!sasId) && !!cantiereId,
    staleTime: 30_000,
  });

  const foto = allegati.filter((a) => a.tipo === "foto" || (a.mimeType || "").startsWith("image/"));

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      form.append("cantiereId", String(cantiereId));
      if (usId != null) form.append("usId", String(usId));
      if (sasId != null) form.append("sasId", String(sasId));
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/allegati/upload", {
        method: "POST",
        headers: getProjectHeader(),
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore upload");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "allegati"] });
      if (usId != null) queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "us"] });
      toast({ title: "Foto caricate" });
    },
    onError: (e: any) => toast({ title: "Errore upload foto", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/allegati/${id}`, {
        method: "DELETE",
        headers: getProjectHeader(),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore eliminazione");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "allegati"] });
      if (usId != null) queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "us"] });
      toast({ title: "Foto rimossa" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e.message, variant: "destructive" }),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast({ title: "Seleziona solo file immagine (JPG, PNG, WEBP)" });
      return;
    }
    uploadMutation.mutate(imageFiles);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Camera size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Foto ({foto.length})</span>
        <button
          type="button"
          className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Upload size={11} />
          )}
          Aggiungi foto
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {foto.length === 0 && !isLoading ? (
        <div
          className={`border-2 border-dashed rounded-md text-center py-4 px-2 text-xs text-muted-foreground transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <Camera size={18} className="mx-auto mb-1 opacity-40" />
          Trascina foto qui o clicca per selezionare
        </div>
      ) : (
        <div
          className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-6"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          {foto.map((a) => (
            <div key={a.id} className="relative group aspect-square rounded overflow-hidden border border-border bg-muted">
              <img
                src={getAllegatoUrl(a.percorso)}
                alt={a.nomeFile}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => deleteMutation.mutate(a.id)}
                title="Rimuovi foto"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {dragOver && (
            <div className="aspect-square rounded border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center">
              <Upload size={14} className="text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
