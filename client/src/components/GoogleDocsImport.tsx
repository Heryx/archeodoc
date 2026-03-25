import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GoogleDocsImportProps {
  mode: "us" | "giornata";
  onImport: (data: { mapped: Record<string, string>; text: string; mode: "structured" | "ai" }) => void;
  disabled?: boolean;
}

type GoogleStatus = {
  hasCredentials: boolean;
  hasToken: boolean;
  credentialsPath: string;
};

type ImportResult = {
  mode: "structured" | "ai";
  title: string;
  mapped: Record<string, string>;
  text: string;
};

type Phase = "idle" | "loading" | "preview" | "error";

export default function GoogleDocsImport({ mode, onImport, disabled }: GoogleDocsImportProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (open) {
      setStatusLoading(true);
      fetch("/api/google/status")
        .then(r => r.json())
        .then(d => setStatus(d))
        .catch(() => setStatus(null))
        .finally(() => setStatusLoading(false));
      // Reset state on open
      setUrl("");
      setPhase("idle");
      setResult(null);
      setErrorMsg("");
    }
  }, [open]);

  async function handleImport() {
    if (!url.trim()) return;
    setPhase("loading");
    setErrorMsg("");
    try {
      const res = await apiRequest("POST", `/api/google/import/${mode}`, { url: url.trim() });
      const data: ImportResult = await res.json();
      setResult(data);
      setPhase("preview");
    } catch (e: any) {
      setErrorMsg(e.message || "Errore importazione");
      setPhase("error");
      toast({ title: "Errore importazione", description: e.message, variant: "destructive" });
    }
  }

  function handleApply() {
    if (!result) return;
    onImport({ mapped: result.mapped, text: result.text, mode: result.mode });
    setOpen(false);
    toast({ title: result.mode === "structured" ? "Campi importati da Google Docs" : "Testo importato da Google Docs" });
  }

  function renderContent() {
    if (statusLoading) {
      return <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Verifica connessione Google...</div>;
    }

    if (!status) {
      return <p className="text-sm text-muted-foreground py-4">Impossibile verificare lo stato di Google Docs.</p>;
    }

    // No credentials.json
    if (!status.hasCredentials) {
      return (
        <div className="space-y-3 py-2">
          <p className="text-sm font-medium">Configurazione richiesta</p>
          <p className="text-sm text-muted-foreground">
            Per importare da Google Docs, è necessario configurare le credenziali OAuth:
          </p>
          <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
            <li>Vai su <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></li>
            <li>Abilita la <strong>Google Docs API</strong></li>
            <li>Crea credenziali <strong>OAuth 2.0</strong> (tipo: App desktop)</li>
            <li>Scarica il JSON e salvalo come <code className="bg-muted px-1 rounded">credentials.json</code> nella cartella di ArcheoDoc</li>
          </ol>
          <p className="text-xs text-muted-foreground">Percorso: <code className="bg-muted px-1 rounded">{status.credentialsPath}</code></p>
        </div>
      );
    }

    // Credentials present but no token
    if (!status.hasToken) {
      return (
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">Credenziali presenti. Collega il tuo account Google per continuare.</p>
          <Button onClick={() => { window.location.href = "/api/google/auth"; }}>
            Collega account Google
          </Button>
        </div>
      );
    }

    // Authenticated — show import form
    if (phase === "idle" || phase === "error") {
      return (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Google collegato</Badge>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">URL del documento Google Docs</label>
            <Input
              placeholder="https://docs.google.com/document/d/..."
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </div>
          {phase === "error" && errorMsg && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}
          <Button onClick={handleImport} disabled={!url.trim()}>Importa</Button>
        </div>
      );
    }

    if (phase === "loading") {
      return (
        <div className="flex items-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Importazione in corso...
        </div>
      );
    }

    // Preview
    if (phase === "preview" && result) {
      return (
        <div className="space-y-3 py-2">
          <p className="text-sm font-medium">Documento: {result.title}</p>
          {result.mode === "structured" ? (
            <>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Mappatura automatica</Badge>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {Object.entries(result.mapped).map(([key, val]) => (
                  <div key={key} className="text-sm">
                    <span className="font-medium">{key}:</span>{" "}
                    <span className="text-muted-foreground">{val.length > 100 ? val.slice(0, 100) + "…" : val}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Testo libero — verrà importato nella descrizione</Badge>
              <div className="text-sm text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap">
                {result.text.length > 500 ? result.text.slice(0, 500) + "…" : result.text}
              </div>
              <p className="text-sm text-amber-700">
                Dopo aver cliccato "Applica", salva la scheda e usa "Analisi AI" per compilare i campi automaticamente.
              </p>
            </>
          )}
          <div className="flex gap-2">
            <Button onClick={handleApply}>Applica</Button>
            <Button variant="outline" onClick={() => { setPhase("idle"); setResult(null); }}>Annulla</Button>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileText className="h-4 w-4 mr-1" />
          Importa da Google Docs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importa da Google Docs</DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
