import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LogsCardProps = {
  logLines: string[];
  logPath: string;
  onRefresh: () => void;
  onDownload: () => void;
  onClear: () => void;
  clearPending?: boolean;
};

export function LogsCard({ logLines, logPath, onRefresh, onDownload, onClear, clearPending }: LogsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText size={16} className="text-primary" />
          Log di sistema
        </CardTitle>
        {logPath && <p className="text-xs text-muted-foreground">{logPath}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={onRefresh}>
            <RefreshCw size={13} />
            Aggiorna
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={onDownload}>
            <Download size={13} />
            Scarica log
          </Button>
          <Button variant="destructive" size="sm" className="gap-1" onClick={onClear} disabled={!!clearPending}>
            <Trash2 size={13} />
            {clearPending ? "Svuoto..." : "Svuota log"}
          </Button>
        </div>
        {logLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun log disponibile.</p>
        ) : (
          <div className="font-mono text-xs max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3">
            {logLines.map((line, index) => {
              let className = "";
              if (line.includes("[ERROR]")) className = "text-red-500";
              else if (line.includes("[WARN]")) className = "text-amber-500";
              else if (line.includes("[INFO]")) className = "text-green-600";
              else if (line.includes("[DEBUG]")) className = "text-gray-400";

              return (
                <div key={index} className={className}>
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
