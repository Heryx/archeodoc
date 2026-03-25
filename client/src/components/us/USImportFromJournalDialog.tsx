import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  applyUsImportFromJournal,
  previewUsImportFromDocx,
  previewUsImportFromGoogleDoc,
  previewUsImportFromGiornataText,
  type USImportApplyItem,
  type USImportPreview,
  type USImportSource,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type SourceTab = "text" | "docx" | "google-doc";

type USImportFromJournalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cantiereId: number;
  giornataId: number;
  giornataDate?: string;
  linkedGoogleDocId?: string | null;
  onImported?: () => void;
};

function formatPreviewSource(source: USImportSource): string {
  if (source === "docx") return "DOCX";
  if (source === "google-doc") return "Google Docs";
  return "Testo giornata";
}

function buildDefaultGoogleUrl(linkedGoogleDocId?: string | null): string {
  const docId = String(linkedGoogleDocId || "").trim();
  return docId ? `https://docs.google.com/document/d/${docId}/edit` : "";
}

export function USImportFromJournalDialog({
  open,
  onOpenChange,
  cantiereId,
  giornataId,
  giornataDate,
  linkedGoogleDocId,
  onImported,
}: USImportFromJournalDialogProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<SourceTab>("text");
  const [manualText, setManualText] = useState("");
  const [googleUrl, setGoogleUrl] = useState(buildDefaultGoogleUrl(linkedGoogleDocId));
  const [selectedDocx, setSelectedDocx] = useState<File | null>(null);
  const [preview, setPreview] = useState<USImportPreview | null>(null);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("text");
    setManualText("");
    setGoogleUrl(buildDefaultGoogleUrl(linkedGoogleDocId));
    setSelectedDocx(null);
    setPreview(null);
    setSelectedMap({});
  }, [open, linkedGoogleDocId]);

  const hasLinkedGoogleDoc = !!String(linkedGoogleDocId || "").trim();
  const canRunPreview =
    (tab === "text") ||
    (tab === "docx" && !!selectedDocx) ||
    (tab === "google-doc" && (googleUrl.trim().length > 0 || hasLinkedGoogleDoc));

  const selectableItems = useMemo(
    () => (preview?.items || []).filter((item) => item.status === "ready"),
    [preview],
  );
  const selectedCount = useMemo(
    () => selectableItems.filter((item) => selectedMap[item.tempId]).length,
    [selectableItems, selectedMap],
  );

  function initializeSelection(nextPreview: USImportPreview) {
    const defaults = nextPreview.items.reduce<Record<string, boolean>>((acc, item) => {
      acc[item.tempId] = item.status === "ready";
      return acc;
    }, {});
    setSelectedMap(defaults);
  }

  async function handlePreview() {
    setIsLoadingPreview(true);
    try {
      const payload =
        tab === "docx" && selectedDocx
          ? await previewUsImportFromDocx(cantiereId, giornataId, selectedDocx)
          : tab === "google-doc"
            ? await previewUsImportFromGoogleDoc(cantiereId, giornataId, googleUrl.trim() || undefined)
            : await previewUsImportFromGiornataText(cantiereId, giornataId, manualText.trim() || undefined);

      setPreview(payload.preview);
      initializeSelection(payload.preview);
      toast({
        title: "Anteprima US pronta",
        description: `${payload.preview.items.length} US riconosciute da ${formatPreviewSource(payload.preview.source)}.`,
      });
    } catch (error: any) {
      toast({
        title: "Errore anteprima import US",
        description: String(error?.message || ""),
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleApply() {
    if (!preview) return;

    const items: USImportApplyItem[] = preview.items
      .filter((item) => item.status === "ready" && selectedMap[item.tempId])
      .map((item) => ({
        tempId: item.tempId,
        codiceUS: item.codiceUS,
        tipo: item.tipo,
        definizione: item.definizione,
        descrizione: item.descrizione,
        interpretazione: item.interpretazione,
        quota: item.quota,
        quotaPianoCampagna: item.quotaPianoCampagna,
        settore: item.settore,
        coperto_da: item.coperto_da,
        copre: item.copre,
        si_lega_a: item.si_lega_a,
        uguale_a: item.uguale_a,
        periodoIniziale: item.periodoIniziale,
        periodoFinale: item.periodoFinale,
        materialiRinvenuti: item.materialiRinvenuti,
        campioni: item.campioni,
        schedaData: item.schedaData,
      }));

    if (items.length === 0) {
      toast({
        title: "Nessuna US selezionata",
        description: "Seleziona almeno una US pronta prima di confermare.",
        variant: "destructive",
      });
      return;
    }

    setIsApplying(true);
    try {
      const result = await applyUsImportFromJournal(cantiereId, giornataId, preview.source, items);
      toast({
        title: "Import US completato",
        description: `Create: ${result.created}, saltate: ${result.skipped}.`,
      });
      onImported?.();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Errore conferma import",
        description: String(error?.message || ""),
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import US automatico da giornale</DialogTitle>
          <DialogDescription>
            Giornata {giornataDate || `#${giornataId}`}: genera una preview e conferma le US da creare in bozza.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as SourceTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="text" className="flex-1">Testo giornata</TabsTrigger>
            <TabsTrigger value="docx" className="flex-1">DOCX</TabsTrigger>
            <TabsTrigger value="google-doc" className="flex-1">Google Docs</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Usa automaticamente le note della giornata; opzionalmente puoi incollare un testo alternativo.
            </p>
            <Textarea
              rows={4}
              placeholder="Testo opzionale (se vuoto usa note della giornata)"
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
            />
          </TabsContent>

          <TabsContent value="docx" className="space-y-2">
            <Label htmlFor="import-us-docx">Carica file .docx</Label>
            <Input
              id="import-us-docx"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
                setSelectedDocx(file);
              }}
            />
            {selectedDocx && <p className="text-xs text-muted-foreground">File: {selectedDocx.name}</p>}
          </TabsContent>

          <TabsContent value="google-doc" className="space-y-2">
            <Label htmlFor="import-us-google">URL Google Docs (opzionale)</Label>
            <Input
              id="import-us-google"
              placeholder="https://docs.google.com/document/d/..."
              value={googleUrl}
              onChange={(event) => setGoogleUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se lasci vuoto, viene usato il documento Google collegato al cantiere.
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {preview
              ? `Sorgente: ${formatPreviewSource(preview.source)} • Testo: ${preview.textLength} caratteri • Estratte: ${preview.items.length}`
              : "Genera prima l'anteprima per vedere le US dedotte."}
          </div>
          <Button onClick={handlePreview} disabled={!canRunPreview || isLoadingPreview || isApplying}>
            {isLoadingPreview ? "Analisi..." : "Genera anteprima"}
          </Button>
        </div>

        {preview && (
          <div className="space-y-2">
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {preview.warnings.join(" ")}
              </div>
            )}
            <ScrollArea className="h-[42vh] rounded-md border">
              <div className="space-y-2 p-3">
                {preview.items.map((item) => (
                  <div
                    key={item.tempId}
                    className={cn(
                      "rounded-md border p-3",
                      item.status === "ready" ? "border-emerald-300" : "border-amber-300 bg-amber-50/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={!!selectedMap[item.tempId]}
                          disabled={item.status !== "ready"}
                          onCheckedChange={(checked) => {
                            setSelectedMap((prev) => ({ ...prev, [item.tempId]: checked === true }));
                          }}
                        />
                        <div className="space-y-1">
                          <div className="text-sm font-semibold">{item.codiceUS}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.tipo || "tipo n.d."}
                            {item.settore ? ` • settore ${item.settore}` : ""}
                          </div>
                          {item.descrizione && <p className="text-sm">{item.descrizione}</p>}
                          {!item.descrizione && item.definizione && <p className="text-sm">{item.definizione}</p>}
                          {(item.quota != null || item.quotaPianoCampagna != null) && (
                            <p className="text-xs text-muted-foreground">
                              {item.quota != null ? `Quota s.l.m.: ${item.quota} m` : "Quota s.l.m.: n.d."}
                              {item.quotaPianoCampagna != null ? ` • Quota p.c.: ${item.quotaPianoCampagna} m` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className="capitalize">{item.confidence}</Badge>
                        <Badge variant={item.status === "ready" ? "default" : "secondary"}>
                          {item.status === "ready" ? "Pronta" : "Già presente"}
                        </Badge>
                      </div>
                    </div>
                    {item.reason && <p className="mt-2 text-xs text-amber-700">{item.reason}</p>}
                    {item.source && <p className="mt-1 text-xs text-muted-foreground">Fonte: {item.source}</p>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            Selezionate: {selectedCount} / {selectableItems.length}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoadingPreview || isApplying}>
            Chiudi
          </Button>
          <Button
            onClick={handleApply}
            disabled={!preview || selectedCount === 0 || isLoadingPreview || isApplying}
          >
            {isApplying ? "Creazione..." : "Conferma e crea US"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

