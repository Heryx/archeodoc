import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId, getProjectHeader } from "@/lib/project";
import { AllegatiList } from "@/components/upload/AllegatiList";
import { GeoPackageImportCard } from "@/components/upload/GeoPackageImportCard";
import { SelectedFilesPanel } from "@/components/upload/SelectedFilesPanel";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { UploadMetadataFields } from "@/components/upload/UploadMetadataFields";
import { USImportFromJournalDialog } from "@/components/us/USImportFromJournalDialog";
import { QFieldUploader } from "@/components/qfield/QFieldUploader";
import { SyncPreviewPanel } from "@/components/qfield/SyncPreviewPanel";
import type {
  AllegatoItem,
  GeoPackageImportPayload,
  GeoPackagePreviewPayload,
  GiornataOption,
  USOption,
} from "@/components/upload/types";
import type { QFieldApplyResult, QFieldSyncPreview } from "@/components/qfield/types";

export function UploadPage() {
  const { cid } = useParams<{ cid: string }>();
  const activeProjectId = getCurrentProjectId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedGeoPackage, setSelectedGeoPackage] = useState<File | null>(null);
  const [geoPackagePreview, setGeoPackagePreview] = useState<GeoPackagePreviewPayload | null>(null);
  const [selectedGeoPackageTable, setSelectedGeoPackageTable] = useState<string>("");
  const [importUnknownGeoColumns, setImportUnknownGeoColumns] = useState(true);
  const [selectedGiornata, setSelectedGiornata] = useState("");
  const [selectedUS, setSelectedUS] = useState("");
  const [operatore, setOperatore] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [showDescFor, setShowDescFor] = useState<number | null>(null);
  const [importUsDialogOpen, setImportUsDialogOpen] = useState(false);
  const [qfieldZipFile, setQfieldZipFile] = useState<File | null>(null);
  const [qfieldPreview, setQfieldPreview] = useState<QFieldSyncPreview | null>(null);

  const { data: giornate = [] } = useQuery<GiornataOption[]>({
    queryKey: ["/api/cantieri", cid, "giornate", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/giornate`)).json(),
    enabled: !!cid,
  });

  const { data: usList = [] } = useQuery<USOption[]>({
    queryKey: ["/api/cantieri", cid, "us", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });

  const { data: allegati = [], refetch } = useQuery<AllegatoItem[]>({
    queryKey: ["/api/cantieri", cid, "allegati", activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/allegati`)).json(),
    enabled: !!cid,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("cantiereId", cid);
      if (activeProjectId) formData.append("projectId", activeProjectId);
      if (selectedGiornata) formData.append("giornataId", selectedGiornata);
      if (selectedUS) formData.append("usId", selectedUS);
      if (operatore) formData.append("operatore", operatore);
      if (descrizione) formData.append("descrizione", descrizione);

      selectedFiles.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/allegati/upload", {
        method: "POST",
        body: formData,
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        throw new Error("Upload fallito");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati", activeProjectId] });
      setSelectedFiles([]);
      toast({ title: `${selectedFiles.length} file caricati` });
      refetch();
    },
    onError: (error: any) =>
      toast({
        title: "Errore upload",
        description: error.message,
        variant: "destructive",
      }),
  });

  const geopackageImportMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGeoPackage) {
        throw new Error("Seleziona prima un file .gpkg");
      }

      const formData = new FormData();
      formData.append("file", selectedGeoPackage);
      if (selectedGiornata) {
        formData.append("giornataId", selectedGiornata);
      }
      if (selectedGeoPackageTable) {
        formData.append("tableName", selectedGeoPackageTable);
      }
      formData.append("importUnknownColumns", importUnknownGeoColumns ? "true" : "false");

      const response = await fetch(`/api/cantieri/${cid}/import-geopackage`, {
        method: "POST",
        body: formData,
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        let errorMessage = "Import GeoPackage fallito";
        try {
          const payload = await response.json();
          if (typeof payload?.error === "string" && payload.error.trim()) {
            errorMessage = payload.error.trim();
          }
        } catch {
          // keep fallback message
        }

        throw new Error(errorMessage);
      }

      return response.json() as Promise<GeoPackageImportPayload>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", activeProjectId] });
      setSelectedGeoPackage(null);
      setGeoPackagePreview(null);
      setSelectedGeoPackageTable("");

      const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
      toast({
        title: "Import GeoPackage completato",
        description:
          `US create: ${result.created}. ` +
          (result.tablesImported?.length ? `Tabelle importate: ${result.tablesImported.join(", ")}. ` : "") +
          `Senza codice: ${result.skippedWithoutCode}. ` +
          `Duplicate: ${result.skippedDuplicateCode}.` +
          (warningCount > 0 ? ` Avvisi: ${warningCount}.` : ""),
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore import GeoPackage",
        description: error?.message || "Import non riuscito",
        variant: "destructive",
      }),
  });

  const geopackagePreviewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGeoPackage) {
        throw new Error("Seleziona prima un file .gpkg");
      }

      const formData = new FormData();
      formData.append("file", selectedGeoPackage);

      const response = await fetch(`/api/cantieri/${cid}/import-geopackage/preview`, {
        method: "POST",
        body: formData,
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        let errorMessage = "Analisi GeoPackage fallita";
        try {
          const payload = await response.json();
          if (typeof payload?.error === "string" && payload.error.trim()) {
            errorMessage = payload.error.trim();
          }
        } catch {
          // keep fallback
        }
        throw new Error(errorMessage);
      }

      return response.json() as Promise<GeoPackagePreviewPayload>;
    },
    onSuccess: (result) => {
      setGeoPackagePreview(result);
      const bestTable =
        result.tables.find((table) => Boolean(table.autoMap?.codiceUS))?.tableName ||
        result.tables[0]?.tableName ||
        "";
      setSelectedGeoPackageTable(bestTable);
      toast({
        title: "Struttura GeoPackage analizzata",
        description: `${result.tables.length} tabelle trovate.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore analisi GeoPackage",
        description: error?.message || "Analisi non riuscita",
        variant: "destructive",
      }),
  });

  const qfieldUploadMutation = useMutation({
    mutationFn: async () => {
      if (!qfieldZipFile) throw new Error("Seleziona prima il file ZIP di QFieldSync");

      const formData = new FormData();
      formData.append("file", qfieldZipFile);

      const response = await fetch(`/api/cantieri/${cid}/qfield/upload-project`, {
        method: "POST",
        body: formData,
        headers: getProjectHeader(),
      });

      if (!response.ok) {
        let errorMessage = "Analisi QFieldSync fallita";
        try {
          const payload = await response.json();
          if (typeof payload?.error === "string" && payload.error.trim()) errorMessage = payload.error.trim();
        } catch {
          // keep fallback
        }
        throw new Error(errorMessage);
      }

      return response.json() as Promise<QFieldSyncPreview>;
    },
    onSuccess: (preview) => {
      setQfieldPreview(preview);
      toast({
        title: "Preview QField pronta",
        description: `${preview.totalIncoming} US trovate, ${preview.matchedUS} già presenti nel DB.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore import QFieldSync",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      }),
  });

  const qfieldApplyMutation = useMutation({
    mutationFn: async (payload: {
      approvals: Array<{ usId: number | null; codiceUS: string; field: string; value: string | number | null }>;
      includeNonConflicts: boolean;
      attachPhotos: boolean;
    }) => {
      if (!qfieldPreview) throw new Error("Nessuna preview QField disponibile");
      const response = await apiRequest(
        "POST",
        `/api/cantieri/${cid}/qfield/sync-apply/${qfieldPreview.uploadId}`,
        payload,
      );
      return response.json() as Promise<QFieldApplyResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "allegati", activeProjectId] });
      toast({
        title: "Sincronizzazione applicata",
        description:
          `US aggiornate: ${result.updated}, create: ${result.created}, foto allegate: ${result.photosAttached}, conflitti saltati: ${result.skippedConflicts}.`,
      });
    },
    onError: (error: any) =>
      toast({
        title: "Errore applicazione sync",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      }),
  });

  const { data: cantiere } = useQuery<any>({
    queryKey: ["/api/cantieri", cid, activeProjectId],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}`)).json(),
    enabled: !!cid,
  });

  const giornataSelezionata = selectedGiornata
    ? giornate.find((g) => String(g.id) === String(selectedGiornata))
    : null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Carica documentazione</h1>
        <p className="text-muted-foreground mt-1">Foto, planimetrie, disegni, CSV, PDF - fino a 50 MB per file</p>
        <div className="mt-3">
          <Button asChild variant="outline" size="sm">
            <Link href={`/cantiere/${cid}/webmap`}>Apri WebMap GeoPackage</Link>
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-5 space-y-4">
          <UploadMetadataFields
            giornate={giornate}
            usList={usList}
            selectedGiornata={selectedGiornata}
            setSelectedGiornata={setSelectedGiornata}
            selectedUS={selectedUS}
            setSelectedUS={setSelectedUS}
            operatore={operatore}
            setOperatore={setOperatore}
            descrizione={descrizione}
            setDescrizione={setDescrizione}
          />

          <div className="flex justify-end">
            <Button
              variant="outline"
              className="gap-2"
              disabled={!selectedGiornata}
              onClick={() => setImportUsDialogOpen(true)}
              title={!selectedGiornata ? "Seleziona prima una giornata per importare le US" : undefined}
            >
              <Sparkles size={15} /> Importa US da giornale
            </Button>
          </div>

          <UploadDropzone
            onFilesAdded={(files) => {
              setSelectedFiles((prev) => [...prev, ...files]);
            }}
          />

          <SelectedFilesPanel
            selectedFiles={selectedFiles}
            onRemoveFile={(index) => {
              setSelectedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
            }}
            onUpload={() => uploadMutation.mutate()}
            uploadPending={uploadMutation.isPending}
          />
        </CardContent>
      </Card>

      <GeoPackageImportCard
        selectedGeoPackage={selectedGeoPackage}
        onSelectGeoPackage={(file) => {
          setSelectedGeoPackage(file);
          setGeoPackagePreview(null);
          setSelectedGeoPackageTable("");
        }}
        onPreview={() => geopackagePreviewMutation.mutate()}
        previewPending={geopackagePreviewMutation.isPending}
        previewData={geoPackagePreview}
        selectedTable={selectedGeoPackageTable}
        onSelectTable={setSelectedGeoPackageTable}
        importUnknownColumns={importUnknownGeoColumns}
        onImportUnknownColumnsChange={setImportUnknownGeoColumns}
        onImport={() => geopackageImportMutation.mutate()}
        importPending={geopackageImportMutation.isPending}
      />

      <div className="space-y-4 my-6">
        <QFieldUploader
          selectedFile={qfieldZipFile}
          onSelectFile={(file) => {
            setQfieldZipFile(file);
            setQfieldPreview(null);
          }}
          onUpload={() => qfieldUploadMutation.mutate()}
          uploadPending={qfieldUploadMutation.isPending}
        />

        {qfieldPreview && (
          <SyncPreviewPanel
            cantiereId={Number(cid)}
            preview={qfieldPreview}
            onApply={(payload) => qfieldApplyMutation.mutate(payload)}
            applyPending={qfieldApplyMutation.isPending}
          />
        )}
      </div>

      <AllegatiList
        allegati={allegati}
        showDescFor={showDescFor}
        onToggleDescription={(id) => {
          setShowDescFor((prev) => (prev === id ? null : id));
        }}
      />

      {selectedGiornata && (
        <USImportFromJournalDialog
          open={importUsDialogOpen}
          onOpenChange={setImportUsDialogOpen}
          cantiereId={Number(cid)}
          giornataId={Number(selectedGiornata)}
          giornataDate={giornataSelezionata?.data}
          linkedGoogleDocId={cantiere?.googleDocId}
          onImported={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
            queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us", activeProjectId] });
            queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "giornate", activeProjectId] });
          }}
        />
      )}
    </div>
  );
}
