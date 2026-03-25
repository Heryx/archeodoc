import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DiarioSourceTab = "giornata" | "docx" | "google";

type DiarioSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitGiornata: () => void;
  onSubmitDocx: (file: File) => void;
  onSubmitGoogleDoc: (url?: string) => void;
  isSubmitting?: boolean;
  defaultGoogleDocUrl?: string;
  hasLinkedGoogleDoc?: boolean;
  usCode?: string;
};

export function DiarioSourceDialog({
  open,
  onOpenChange,
  onSubmitGiornata,
  onSubmitDocx,
  onSubmitGoogleDoc,
  isSubmitting = false,
  defaultGoogleDocUrl = "",
  hasLinkedGoogleDoc = false,
  usCode,
}: DiarioSourceDialogProps) {
  const [tab, setTab] = useState<DiarioSourceTab>("giornata");
  const [selectedDocx, setSelectedDocx] = useState<File | null>(null);
  const [googleUrl, setGoogleUrl] = useState(defaultGoogleDocUrl);

  useEffect(() => {
    if (!open) return;
    setTab("giornata");
    setSelectedDocx(null);
    setGoogleUrl(defaultGoogleDocUrl);
  }, [open, defaultGoogleDocUrl]);

  const canSubmit =
    (tab === "giornata") ||
    (tab === "docx" && !!selectedDocx) ||
    (tab === "google" && (googleUrl.trim().length > 0 || hasLinkedGoogleDoc));

  const submitLabel =
    tab === "giornata"
      ? "Usa giornata collegata"
      : tab === "docx"
        ? "Analizza file DOCX"
        : "Analizza Google Docs";

  const handleSubmit = () => {
    if (tab === "giornata") {
      onSubmitGiornata();
      return;
    }
    if (tab === "docx" && selectedDocx) {
      onSubmitDocx(selectedDocx);
      return;
    }
    if (tab === "google") {
      const url = googleUrl.trim();
      onSubmitGoogleDoc(url || undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compila da diario{usCode ? ` - ${usCode}` : ""}</DialogTitle>
          <DialogDescription>
            Scegli la sorgente del testo da usare per la compilazione assistita della scheda US.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as DiarioSourceTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="giornata" className="flex-1">Giornata</TabsTrigger>
            <TabsTrigger value="docx" className="flex-1">DOCX</TabsTrigger>
            <TabsTrigger value="google" className="flex-1">Google Docs</TabsTrigger>
          </TabsList>

          <TabsContent value="giornata" className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Usa il testo gia presente: descrizione US + note della giornata collegata.
            </p>
          </TabsContent>

          <TabsContent value="docx" className="space-y-3">
            <div>
              <Label htmlFor="ai-docx-file">Carica file .docx</Label>
              <Input
                id="ai-docx-file"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
                  setSelectedDocx(file);
                }}
              />
            </div>
            {selectedDocx && (
              <p className="text-xs text-muted-foreground">
                File selezionato: {selectedDocx.name}
              </p>
            )}
          </TabsContent>

          <TabsContent value="google" className="space-y-3">
            <div>
              <Label htmlFor="ai-google-url">URL Google Docs (opzionale)</Label>
              <Input
                id="ai-google-url"
                placeholder="https://docs.google.com/document/d/..."
                value={googleUrl}
                onChange={(event) => setGoogleUrl(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Se lasci vuoto, viene usato il documento Google gia collegato al cantiere.
            </p>
            {!hasLinkedGoogleDoc && !googleUrl.trim() && (
              <p className="text-xs text-destructive">
                Nessun documento Google collegato al cantiere: inserisci un URL.
              </p>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "Analisi..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

