import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Image, FileText, Eye, FileArchive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getCurrentProjectId, getProjectHeader } from "@/lib/project";

const tipoIconMap: Record<string, any> = {
  foto: Image, planimetria: FileArchive, disegno: FileArchive,
  pdf: FileText, csv: FileText, altro: FileArchive,
};

function FileIcon({ tipo }: { tipo: string }) {
  const Icon = tipoIconMap[tipo] || FileArchive;
  return <Icon size={14} className="text-muted-foreground" />;
}

export function UploadPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const qcClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedGiornata, setSelectedGiornata] = useState("");
  const [selectedUS, setSelectedUS] = useState("");
  const [operatore, setOperatore] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [showDescFor, setShowDescFor] = useState<number | null>(null);

  const { data: giornate = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const { data: usList = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  const { data: allegati = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "allegati", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/allegati`)).json(),
    enabled: !!cid,
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(prev => [...prev, ...files]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("cantiereId", cid);
      if (activeProjectId) formData.append("projectId", activeProjectId);
      if (selectedGiornata) formData.append("giornataId", selectedGiornata);
      if (selectedUS) formData.append("usId", selectedUS);
      if (operatore) formData.append("operatore", operatore);
      if (descrizione) formData.append("descrizione", descrizione);
      selectedFiles.forEach(f => formData.append("files", f));
      const res = await fetch("/api/allegati/upload", { method: "POST", body: formData, headers: getProjectHeader() });
      if (!res.ok) throw new Error("Upload fallito");
      return res.json();
    },
    onSuccess: () => {
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati"] });
      qcClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati", activeProjectId] });
      setSelectedFiles([]);
      toast({ title: `${selectedFiles.length} file caricati` });
      refetch();
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Carica documentazione</h1>
        <p className="text-muted-foreground mt-1">Foto, planimetrie, disegni, CSV, PDF — fino a 50 MB per file</p>
      </div>

      {/* Upload form */}
      <Card className="mb-6">
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Associa a giornata</Label>
              <Select value={selectedGiornata} onValueChange={setSelectedGiornata}>
                <SelectTrigger data-testid="select-giornata-upload">
                  <SelectValue placeholder="Seleziona giornata..." />
                </SelectTrigger>
                <SelectContent>
                  {giornate.map((g: any) => <SelectItem key={g.id} value={String(g.id)}>{g.data}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Associa a US (opzionale)</Label>
              <Select value={selectedUS} onValueChange={setSelectedUS}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona US..." />
                </SelectTrigger>
                <SelectContent>
                  {usList.map((us: any) => <SelectItem key={us.id} value={String(us.id)}>{us.codiceUS}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Operatore</Label>
              <Input value={operatore} onChange={e => setOperatore(e.target.value)} placeholder="Nome operatore" />
            </div>
            <div>
              <Label>Descrizione</Label>
              <Input value={descrizione} onChange={e => setDescrizione(e.target.value)} placeholder="Note sui file" />
            </div>
          </div>

          {/* Drop zone */}
          <div
            className={cn("dropzone", dragActive && "active")}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">Trascina i file qui o clicca per selezionare</p>
            <p className="text-sm text-muted-foreground mt-1">Immagini, PDF, CSV, DXF, SVG — max 50 MB ciascuno</p>
          </div>

          {/* Preview file selezionati */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{selectedFiles.length} file pronti per il caricamento</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-3 py-1.5">
                    <FileIcon tipo={f.type.startsWith("image/") ? "foto" : "pdf"} />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground text-xs">{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => setSelectedFiles(p => p.filter((_, j) => j !== i))}>
                      <X size={13} className="text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                data-testid="button-carica-file"
                className="w-full gap-2"
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending}
              >
                <Upload size={15} />
                {uploadMutation.isPending ? "Caricamento..." : `Carica ${selectedFiles.length} file`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista allegati già caricati */}
      <h2 className="text-lg font-semibold mb-3">Documenti caricati ({allegati.length})</h2>
      {allegati.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-border rounded-lg text-muted-foreground text-sm">
          Nessun documento ancora caricato
        </div>
      ) : (
        <div className="space-y-2">
          {allegati.map((a: any) => (
            <Card key={a.id} data-testid={`card-allegato-${a.id}`}>
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <FileIcon tipo={a.tipo} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{a.nomeFile}</span>
                    <Badge variant="secondary" className="text-xs capitalize">{a.tipo}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                    {a.operatore && <span>{a.operatore}</span>}
                    {a.dimensione && <span>{(a.dimensione / 1024).toFixed(0)} KB</span>}
                    {a.descrizioneAi && <span className="text-green-600 dark:text-green-400">✓ Analizzato AI</span>}
                  </div>
                  {showDescFor === a.id && a.descrizione && (
                    <div className="mt-2 text-xs bg-muted/50 rounded p-2">
                      {a.descrizione}
                    </div>
                  )}
                </div>
                {a.descrizione && (
                  <Button size="sm" variant="ghost" className="gap-1 text-xs"
                    onClick={() => setShowDescFor(showDescFor === a.id ? null : a.id)}
                  >
                    <Eye size={12} />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
