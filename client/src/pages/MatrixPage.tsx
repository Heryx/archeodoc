import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Download, FileSpreadsheet, GitBranch, Layers } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { HarrisMatrixMode } from "@/components/us/HarrisMatrix";

const HarrisMatrix = lazy(async () => {
  const module = await import("@/components/us/HarrisMatrix");
  return { default: module.HarrisMatrix };
});

export function MatrixPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<HarrisMatrixMode>("all");
  const [downloadKind, setDownloadKind] = useState<"docx" | "pdf" | null>(null);
  const { toast } = useToast();

  const { data: usList = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", "matrix-page", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  async function exportMatrix(format: "docx" | "pdf") {
    if (!cid) return;
    setDownloadKind(format);
    try {
      const endpoint = buildProjectUrl(`/api/cantieri/${cid}/matrix/export-${format}?mode=${mode}`);
      const response = await fetch(endpoint, { headers: getProjectHeader() });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Export non riuscito");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Harris_Matrix_${cid}_${mode}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast({ title: `Matrix esportata (${format.toUpperCase()})` });
    } catch (error: any) {
      toast({
        title: `Errore export ${format.toUpperCase()}`,
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    } finally {
      setDownloadKind(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch size={22} className="text-primary" /> Harris Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sezione dedicata ai rapporti stratigrafici e fisici delle US.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportMatrix("docx")}
            disabled={downloadKind !== null || isLoading || usList.length === 0}
          >
            <FileSpreadsheet size={15} />
            {downloadKind === "docx" ? "Esporto..." : "Esporta DOCX"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportMatrix("pdf")}
            disabled={downloadKind !== null || isLoading || usList.length === 0}
          >
            <Download size={15} />
            {downloadKind === "pdf" ? "Esporto..." : "Esporta PDF"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate(`/cantiere/${cid}/us`)}>
            <Layers size={15} /> Torna alle schede US
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "all" ? "default" : "outline"} size="sm" onClick={() => setMode("all")}>
          Tutto
        </Button>
        <Button variant={mode === "fisica" ? "default" : "outline"} size="sm" onClick={() => setMode("fisica")}>
          Sequenza fisica
        </Button>
        <Button
          variant={mode === "stratigrafica" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("stratigrafica")}
        >
          Sequenza stratigrafica
        </Button>
      </div>

      {isLoading ? (
        <div className="h-40 rounded-lg bg-muted animate-pulse" />
      ) : usList.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-muted-foreground">
          Nessuna US disponibile per costruire la matrix.
        </div>
      ) : (
        <Suspense fallback={<div className="h-40 rounded-lg bg-muted animate-pulse" />}>
          <HarrisMatrix usList={usList} mode={mode} />
        </Suspense>
      )}
    </div>
  );
}
