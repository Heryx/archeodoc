import { Suspense, lazy, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Download, FileSpreadsheet, GitBranch, Layers, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { buildProjectUrl, getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { HarrisMatrixMode } from "@/components/us/HarrisMatrix";
import { EmImportDialog, type EmImportPlan } from "@/components/us/EmImportDialog";

const HarrisMatrix = lazy(async () => {
  const module = await import("@/components/us/HarrisMatrix");
  return { default: module.HarrisMatrix };
});

export function MatrixPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<HarrisMatrixMode>("all");
  const [downloadKind, setDownloadKind] = useState<"docx" | "pdf" | "em.json" | null>(null);
  const [pdfPage, setPdfPage] = useState<"libero" | "a4-portrait" | "a4-landscape">("libero");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const emFileInput = useRef<HTMLInputElement>(null);
  const [emImport, setEmImport] = useState<{ fileName: string; text: string; plan: EmImportPlan } | null>(null);
  const [emApplying, setEmApplying] = useState(false);

  const { data: usList = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", "matrix-page", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  async function onEmFileChosen(file: File | undefined) {
    if (!file || !cid) return;
    try {
      const text = await file.text();
      const res = await apiRequest("POST", `/api/cantieri/${cid}/matrix/import-emjson/preview`, { text });
      setEmImport({ fileName: file.name, text, plan: await res.json() });
    } catch (error: any) {
      toast({
        title: "File .em.json non leggibile",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    } finally {
      if (emFileInput.current) emFileInput.current.value = "";
    }
  }

  async function applyEmImport(selected: string[]) {
    if (!emImport || !cid) return;
    setEmApplying(true);
    try {
      const res = await apiRequest("POST", `/api/cantieri/${cid}/matrix/import-emjson/apply`, {
        text: emImport.text,
        selected,
      });
      const r = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      toast({
        title: "Import da EM Studio completato",
        description: `${r.createdUnits} US create, ${r.addedRelations} rapporti aggiunti, ${r.updatedPeriods} periodi aggiornati${
          r.skipped?.length ? `, ${r.skipped.length} saltati` : ""
        }`,
      });
      setEmImport(null);
    } catch (error: any) {
      toast({
        title: "Import non riuscito",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    } finally {
      setEmApplying(false);
    }
  }

  async function exportMatrix(format: "docx" | "pdf" | "em.json") {
    if (!cid) return;
    setDownloadKind(format);
    try {
      const endpoint = buildProjectUrl(`/api/cantieri/${cid}/matrix/export-${format === "em.json" ? "emjson" : format}?mode=${mode}${
          format === "pdf" ? `&page=${pdfPage}` : ""
        }`);
      const response = await fetch(endpoint, { headers: getProjectHeader() });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Export non riuscito");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const pageTag = format === "pdf" && pdfPage !== "libero" ? `_${pdfPage}` : "";
      anchor.download = `Harris_Matrix_${cid}_${mode}${pageTag}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast({ title: `Matrix esportata (${format === "em.json" ? "EM Studio" : format.toUpperCase()})` });
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
          <select
            aria-label="Formato pagina PDF"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={pdfPage}
            onChange={(e) => setPdfPage(e.target.value as typeof pdfPage)}
            disabled={downloadKind !== null}
          >
            <option value="libero">PDF: pagina unica (libero)</option>
            <option value="a4-portrait">PDF: A4 verticale</option>
            <option value="a4-landscape">PDF: A4 orizzontale</option>
          </select>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportMatrix("pdf")}
            disabled={downloadKind !== null || isLoading || usList.length === 0}
          >
            <Download size={15} />
            {downloadKind === "pdf" ? "Esporto..." : "Esporta PDF"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportMatrix("em.json")}
            disabled={downloadKind !== null || isLoading || usList.length === 0}
            title="File .em.json per EM Studio (Extended Matrix)"
          >
            <GitBranch size={15} />
            {downloadKind === "em.json" ? "Esporto..." : "EM Studio"}
          </Button>
          <input
            ref={emFileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => onEmFileChosen(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => emFileInput.current?.click()}
            disabled={isLoading}
            title="Importa un file .em.json salvato da EM Studio"
          >
            <Upload size={15} /> Importa EM
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
          <HarrisMatrix usList={usList} mode={mode} cantiereId={cid} />
        </Suspense>
      )}
      <EmImportDialog
        open={!!emImport}
        fileName={emImport?.fileName ?? ""}
        plan={emImport?.plan ?? null}
        isApplying={emApplying}
        onConfirm={applyEmImport}
        onClose={() => setEmImport(null)}
      />
    </div>
  );
}
