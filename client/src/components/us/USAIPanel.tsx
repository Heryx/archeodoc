import { useState } from "react";
import { Download } from "lucide-react";
import { buildProjectUrl } from "@/lib/project";
import { Button } from "@/components/ui/button";

type USAIPanelProps = {
  usId: number;
  schedaAiGenerata?: string | null;
};

export function USAIPanel({ usId, schedaAiGenerata }: USAIPanelProps) {
  const [showScheda, setShowScheda] = useState(false);

  if (!schedaAiGenerata) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-muted-foreground">Scheda AI generata</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() => setShowScheda((prev) => !prev)}
          >
            {showScheda ? "Nascondi" : "Vedi scheda"}
          </Button>
          <a href={buildProjectUrl(`/api/us/${usId}/export-docx`)} download className="text-xs text-primary hover:underline">
            <Download size={12} className="inline mr-1" />
            Scarica .docx
          </a>
        </div>
      </div>
      {showScheda && (
        <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/50 rounded p-3 max-h-64 overflow-y-auto">
          {schedaAiGenerata}
        </pre>
      )}
    </div>
  );
}
