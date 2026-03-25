import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiSettings } from "@/components/settings/types";

type AIKeysCardProps = {
  settings?: AiSettings;
  aiProvider: "auto" | "gemini" | "claude" | "openai";
  setAiProvider: (value: "auto" | "gemini" | "claude" | "openai") => void;
  geminiKey: string;
  setGeminiKey: (value: string) => void;
  anthropicKey: string;
  setAnthropicKey: (value: string) => void;
  openaiKey: string;
  setOpenaiKey: (value: string) => void;
  showGemini: boolean;
  setShowGemini: (value: boolean) => void;
  showAnthropic: boolean;
  setShowAnthropic: (value: boolean) => void;
  showOpenai: boolean;
  setShowOpenai: (value: boolean) => void;
  savePending: boolean;
  clearPending: boolean;
  onSave: () => void;
  onClearKey: (key: "gemini" | "anthropic" | "openai") => void;
};

export function AIKeysCard({
  settings,
  aiProvider,
  setAiProvider,
  geminiKey,
  setGeminiKey,
  anthropicKey,
  setAnthropicKey,
  openaiKey,
  setOpenaiKey,
  showGemini,
  setShowGemini,
  showAnthropic,
  setShowAnthropic,
  showOpenai,
  setShowOpenai,
  savePending,
  clearPending,
  onSave,
  onClearKey,
}: AIKeysCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chiavi API</CardTitle>
        <CardDescription>
          Le chiavi vengono salvate nel file <code className="bg-muted px-1 rounded text-xs">.env</code> nella cartella
          dell'applicazione e non vengono mai inviate a terze parti ne incluse nel repository.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="gemini-key" className="flex items-center gap-2">
            Google Gemini API Key
            <Badge variant="secondary" className="text-[10px] py-0">
              Gratuita
            </Badge>
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="gemini-key"
                type={showGemini ? "text" : "password"}
                placeholder={
                  settings?.geminiKeySet
                    ? `Attuale: ${settings.geminiKeyPreview} - lascia vuoto per non modificare`
                    : "Incolla qui la tua chiave Gemini"
                }
                value={geminiKey}
                onChange={(event) => setGeminiKey(event.target.value)}
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowGemini(!showGemini)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showGemini ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {settings?.geminiKeySet && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => onClearKey("gemini")}
                disabled={clearPending}
              >
                Rimuovi
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Ottieni la chiave gratuita su{" "}
            <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="underline text-primary">
              aistudio.google.com
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="anthropic-key" className="flex items-center gap-2">
            Anthropic Claude API Key
            <Badge variant="secondary" className="text-[10px] py-0">
              A pagamento
            </Badge>
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="anthropic-key"
                type={showAnthropic ? "text" : "password"}
                placeholder={
                  settings?.anthropicKeySet
                    ? `Attuale: ${settings.anthropicKeyPreview} - lascia vuoto per non modificare`
                    : "Incolla qui la tua chiave Anthropic (opzionale)"
                }
                value={anthropicKey}
                onChange={(event) => setAnthropicKey(event.target.value)}
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowAnthropic(!showAnthropic)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showAnthropic ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {settings?.anthropicKeySet && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => onClearKey("anthropic")}
                disabled={clearPending}
              >
                Rimuovi
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Ottieni la chiave su{" "}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">
              console.anthropic.com
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="openai-key" className="flex items-center gap-2">
            OpenAI API Key
            <Badge variant="secondary" className="text-[10px] py-0">
              A pagamento
            </Badge>
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="openai-key"
                type={showOpenai ? "text" : "password"}
                placeholder={
                  settings?.openaiKeySet
                    ? `Attuale: ${settings.openaiKeyPreview} - lascia vuoto per non modificare`
                    : "sk-..."
                }
                value={openaiKey}
                onChange={(event) => setOpenaiKey(event.target.value)}
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowOpenai(!showOpenai)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showOpenai ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {settings?.openaiKeySet && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => onClearKey("openai")}
                disabled={clearPending}
              >
                Rimuovi
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Ottieni la chiave su{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline text-primary">
              platform.openai.com
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Provider preferito</Label>
          <div className="flex gap-2 flex-wrap">
            {(["auto", "gemini", "openai", "claude"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => setAiProvider(provider)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  aiProvider === provider
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {provider === "auto" ? "Auto (consigliato)" : provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI (GPT)" : "Claude"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            In modalita <strong>Auto</strong>, la priorità è: Gemini → OpenAI → Claude.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <RefreshCw size={13} className="mt-0.5 shrink-0" />
          <span>Il provider AI viene aggiornato immediatamente dopo il salvataggio, senza riavviare il server.</span>
        </div>

        <Button className="w-full" onClick={onSave} disabled={savePending}>
          {savePending ? (
            <>
              <RefreshCw size={14} className="mr-2 animate-spin" /> Salvataggio...
            </>
          ) : (
            <>
              <Save size={14} className="mr-2" /> Salva impostazioni
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
