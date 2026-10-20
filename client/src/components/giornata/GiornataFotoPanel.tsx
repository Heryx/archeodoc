import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Loader2, Pencil, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";

type Allegato = {
  id: number;
  nomeFile: string;
  percorso: string;
  mimeType: string | null;
  tipo: string | null;
};

function getAllegatoUrl(percorso: string): string {
  return buildProjectUrl(`/uploads/${encodeURI(percorso.replace(/\\/g, "/"))}`);
}

type Props = {
  cantiereId: number;
  giornataId: number;
  giornataData: string;
};

export function GiornataFotoPanel({ cantiereId, giornataId, giornataData }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  const [usCode, setUsCode] = useState("");
  const activeProjectId = getCurrentProjectId();

  const queryKey = ["/api/cantieri", String(cantiereId), "allegati", `giornata-${giornataId}`, activeProjectId];

  const { data: allegati = [], isLoading } = useQuery<Allegato[]>({
    queryKey,
    queryFn: async () =>
      (
        await fetch(buildProjectUrl(`/api/cantieri/${cantiereId}/allegati?giornataId=${giornataId}`), {
          headers: getProjectHeader(),
        })
      ).json(),
    enabled: !!cantiereId && !!giornataId,
    staleTime: 30_000,
  });

  const foto = allegati.filter((a) => a.tipo === "foto" || (a.mimeType ?? "").startsWith("image/"));

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      form.append("cantiereId", String(cantiereId));
      form.append("giornataId", String(giornataId));
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
      toast({ title: "Foto caricate" });
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e.message, variant: "destructive" }),
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
    onSuccess: (_: any, id: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "allegati"] });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Foto rimossa" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e.message, variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ usCode, date }: { usCode: string; date: string }) => {
      const res = await fetch("/api/allegati/batch-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getProjectHeader() },
        body: JSON.stringify({
          cantiereId,
          allegatiIds: Array.from(selected),
          usCode,
          data: date,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore rinomina");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "allegati"] });
      setSelected(new Set());
      setSelectMode(false);
      setRenameOpen(false);
      setUsCode("");
      toast({ title: `${data.renamed?.length ?? 0} foto rinominate` });
    },
    onError: (e: any) => toast({ title: "Errore rinomina", description: e.message, variant: "destructive" }),
  });

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const images = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      toast({ title: "Seleziona solo immagini (JPG, PNG, WEBP)" });
      return;
    }
    uploadMutation.mutate(images);
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const previewNames = usCode.trim()
    ? Array.from(selected)
        .slice(0, 3)
        .map((id, i) => {
          const a = foto.find((f) => f.id === id);
          const ext = a ? (a.nomeFile.match(/\.[^.]+$/)?.[0] ?? ".jpg") : ".jpg";
          return `US${usCode.trim()}_${giornataData}_${String(i + 1).padStart(3, "0")}${ext}`;
        })
    : [];

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Camera size={13} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          Foto {isLoading ? "…" : `(${foto.length})`}
        </span>

        {foto.length > 0 && (
          <button
            type="button"
            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
              selectMode
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            {selectMode ? "Annulla" : "Seleziona"}
          </button>
        )}

        {selectMode && selected.size > 0 && (
          <button
            type="button"
            className="text-xs text-primary hover:underline flex items-center gap-1"
            onClick={() => setRenameOpen(true)}
          >
            <Pencil size={10} />
            Rinomina ({selected.size})
          </button>
        )}

        <button
          type="button"
          className="ml-auto text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          Aggiungi
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

      {/* Galleria o stato vuoto */}
      {foto.length === 0 && !isLoading ? (
        <div
          className={`border-2 border-dashed rounded-md text-center py-5 px-2 text-xs text-muted-foreground cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
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
          className="grid grid-cols-5 gap-1.5 sm:grid-cols-7"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          {foto.map((a) => {
            const isSel = selected.has(a.id);
            return (
              <div
                key={a.id}
                title={a.nomeFile}
                className={`relative group aspect-square rounded overflow-hidden border bg-muted transition-all ${
                  selectMode ? "cursor-pointer" : ""
                } ${isSel ? "border-primary ring-1 ring-primary" : "border-border"}`}
                onClick={() => {
                  if (selectMode) toggleSelect(a.id);
                }}
              >
                <img
                  src={getAllegatoUrl(a.percorso)}
                  alt={a.nomeFile}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />

                {selectMode ? (
                  <div
                    className={`absolute inset-0 flex items-center justify-center transition-colors ${
                      isSel ? "bg-primary/25" : "bg-black/10 hover:bg-black/20"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        isSel ? "bg-primary border-primary" : "bg-white/80 border-white"
                      }`}
                    >
                      {isSel && <Check size={10} className="text-white" />}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(a.id);
                    }}
                    title="Rimuovi foto"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}

          {dragOver && !selectMode && (
            <div className="aspect-square rounded border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center">
              <Upload size={14} className="text-primary" />
            </div>
          )}
        </div>
      )}

      {/* Dialog rinomina batch */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rinomina batch foto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Numero US</label>
              <Input
                placeholder="es. 5 oppure 5A"
                value={usCode}
                onChange={(e) => setUsCode(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Data giornata</label>
              <Input value={giornataData} readOnly className="bg-muted text-muted-foreground" />
            </div>
            {previewNames.length > 0 && (
              <div className="bg-muted/60 rounded px-3 py-2 text-xs font-mono space-y-0.5">
                {previewNames.map((n) => (
                  <div key={n}>{n}</div>
                ))}
                {selected.size > 3 && (
                  <div className="text-muted-foreground">… +{selected.size - 3} altri</div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Annulla
            </Button>
            <Button
              onClick={() => renameMutation.mutate({ usCode: usCode.trim(), date: giornataData })}
              disabled={!usCode.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending && <Loader2 size={13} className="animate-spin mr-1.5" />}
              Rinomina
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
