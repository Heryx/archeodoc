import { ExternalLink, FolderCog, RefreshCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type LastSyncSummary = {
  created?: number;
  updated?: number;
  unchanged?: number;
  skipped?: number;
};

type GooglePanelProps = {
  cantiere: any;
  setupPending: boolean;
  syncPending: boolean;
  onSetup: () => void;
  onSync: () => void;
  lastSyncSummary: LastSyncSummary | null;
};

export function GooglePanel({
  cantiere,
  setupPending,
  syncPending,
  onSetup,
  onSync,
  lastSyncSummary,
}: GooglePanelProps) {
  return (
    <Card className="mb-6">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Google Drive</p>
            <p className="text-sm text-muted-foreground">
              Collega il cantiere a un giornale Google Docs strutturato e sincronizza le US.
            </p>
          </div>
          {!cantiere?.googleDocId ? (
            <Button variant="outline" className="gap-2" onClick={onSetup} disabled={setupPending}>
              <FolderCog size={14} />
              {setupPending ? "Setup..." : "Setup Google"}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={onSync} disabled={syncPending}>
                <RefreshCcw size={14} />
                {syncPending ? "Sync..." : "Sincronizza ora"}
              </Button>
              <a
                href={`https://docs.google.com/document/d/${cantiere.googleDocId}/edit`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="ghost" className="gap-2">
                  <ExternalLink size={14} />
                  Apri documento
                </Button>
              </a>
            </div>
          )}
        </div>

        {cantiere?.googleFolderId && (
          <p className="text-sm">
            Cartella:{" "}
            <a
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
              href={`https://drive.google.com/drive/folders/${cantiere.googleFolderId}`}
            >
              apri su Drive
            </a>
          </p>
        )}

        {cantiere?.googleDocId && (
          <p className="text-sm">
            Documento:{" "}
            <a
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
              href={`https://docs.google.com/document/d/${cantiere.googleDocId}/edit`}
            >
              apri su Google Docs
            </a>
          </p>
        )}

        {cantiere?.lastSyncAt && (
          <p className="text-sm text-muted-foreground">
            Ultimo sync: {new Date(cantiere.lastSyncAt).toLocaleString("it-IT")}
          </p>
        )}

        {lastSyncSummary && (
          <p className="text-sm text-muted-foreground">
            Ultimo report: {lastSyncSummary.created || 0} create · {lastSyncSummary.updated || 0} aggiornate ·{" "}
            {lastSyncSummary.skipped || 0} saltate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
