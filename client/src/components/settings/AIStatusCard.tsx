import { Wand2, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiSettings } from "@/components/settings/types";

type AIStatusCardProps = {
  settings?: AiSettings;
};

const providerLabel: Record<string, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  openai: "OpenAI (GPT)",
  none: "Nessuno",
};

export function AIStatusCard({ settings }: AIStatusCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 size={16} className="text-primary" />
          Stato provider AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Provider attivo</span>
          {settings?.available ? (
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
              <CheckCircle2 size={12} className="mr-1" />
              {providerLabel[settings.currentProvider] ?? settings.currentProvider}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
              <XCircle size={12} className="mr-1" />
              Non configurato
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Chiave Gemini</span>
          {settings?.geminiKeySet ? (
            <span className="font-mono text-xs text-green-700">{settings.geminiKeyPreview}</span>
          ) : (
            <span className="text-xs text-muted-foreground">non impostata</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Chiave Anthropic</span>
          {settings?.anthropicKeySet ? (
            <span className="font-mono text-xs text-green-700">{settings.anthropicKeyPreview}</span>
          ) : (
            <span className="text-xs text-muted-foreground">non impostata</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Chiave OpenAI</span>
          {settings?.openaiKeySet ? (
            <span className="font-mono text-xs text-green-700">{settings.openaiKeyPreview}</span>
          ) : (
            <span className="text-xs text-muted-foreground">non impostata</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
