import { CheckCircle2, ExternalLink, FileText, Unlink, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GoogleStatus } from "@/components/settings/types";

type GoogleDocsCardProps = {
  googleLoading: boolean;
  googleStatus: GoogleStatus | null;
  onRefresh: () => void;
  onAuth: () => void;
  onRevoke: () => void;
  revokePending?: boolean;
};

export function GoogleDocsCard({
  googleLoading,
  googleStatus,
  onRefresh,
  onAuth,
  onRevoke,
  revokePending = false,
}: GoogleDocsCardProps) {
  const missingScopes = googleStatus?.missingScopes || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText size={16} className="text-primary" />
          Google Docs
        </CardTitle>
        <CardDescription>Importa testo direttamente dai documenti Google Docs nelle schede US e giornate.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {googleLoading ? (
          <p className="text-sm text-muted-foreground">Verifica connessione Google...</p>
        ) : !googleStatus ? (
          <p className="text-sm text-muted-foreground">Impossibile verificare lo stato di Google Docs.</p>
        ) : !googleStatus.hasCredentials ? (
          <div className="space-y-3">
            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
              <XCircle size={12} className="mr-1" /> Configurazione richiesta
            </Badge>
            <p className="text-sm text-muted-foreground">Per abilitare l'importazione da Google Docs:</p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
              <li>
                Vai su{" "}
                <a
                  href="https://console.cloud.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-1"
                >
                  Google Cloud Console <ExternalLink className="h-3 w-3 inline" />
                </a>
              </li>
              <li>Seleziona il progetto e abilita la <strong>Google Docs API</strong></li>
              <li>Crea credenziali <strong>OAuth 2.0</strong> (tipo: App desktop)</li>
              <li>
                Scarica il JSON e salvalo come <code className="bg-muted px-1 rounded">credentials.json</code>
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Percorso: <code className="bg-muted px-1 rounded">{googleStatus.credentialsPath}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              URI redirect da aggiungere su Google Cloud: {" "}
              <code className="bg-muted px-1 rounded">http://localhost:5000/api/google/callback</code>
            </p>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Ho salvato il file
            </Button>
          </div>
        ) : !googleStatus.hasToken ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Credenziali presenti. Clicca per collegare il tuo account Google.</p>
            <p className="text-xs text-muted-foreground">
              URI redirect da aggiungere su Google Cloud: {" "}
              <code className="bg-muted px-1 rounded">http://localhost:5000/api/google/callback</code>
            </p>
            <Button onClick={onAuth}>Collega account Google</Button>
          </div>
        ) : missingScopes.length > 0 ? (
          <div className="space-y-3">
            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
              <XCircle size={12} className="mr-1" /> Permessi Google incompleti
            </Badge>
            <p className="text-sm text-muted-foreground">
              Il token Google attuale non include tutti i permessi richiesti. Disconnetti e ricollega l&apos;account.
            </p>
            <p className="text-xs text-muted-foreground">
              Scope mancanti: <code className="bg-muted px-1 rounded">{missingScopes.join(", ")}</code>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={onRevoke} disabled={revokePending}>
                <Unlink size={13} /> Disconnetti
              </Button>
              <Button size="sm" onClick={onAuth}>Ricollega account</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
              <CheckCircle2 size={12} className="mr-1" /> Account Google collegato
            </Badge>
            <Button variant="outline" size="sm" className="gap-1" onClick={onRevoke} disabled={revokePending}>
              <Unlink size={13} /> Disconnetti
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
