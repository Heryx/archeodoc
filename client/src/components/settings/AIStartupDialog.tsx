import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wand2, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { AiSettings } from "@/components/settings/types";

const STORAGE_KEY = "ai_startup_dismissed_v1";

const providerLabel: Record<string, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  openai: "OpenAI (GPT)",
};

export function AIStartupDialog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [alreadyShown, setAlreadyShown] = useState(true); // defer until we have data

  const { data: settings } = useQuery<AiSettings>({
    queryKey: ["/api/settings/ai"],
    queryFn: async () => (await apiRequest("GET", "/api/settings/ai")).json(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!settings) return;

    // If AI is already connected, nothing to do
    if (settings.available) {
      setAlreadyShown(true);
      return;
    }

    // Count how many keys are configured
    const keyCount = [settings.geminiKeySet, settings.anthropicKeySet, settings.openaiKeySet].filter(Boolean).length;

    // No keys at all — nothing to offer
    if (keyCount === 0) {
      setAlreadyShown(true);
      return;
    }

    // Check if the user already dismissed this session
    const dismissed = sessionStorage.getItem(STORAGE_KEY);
    if (dismissed) {
      setAlreadyShown(true);
      return;
    }

    // Show the dialog
    setAlreadyShown(false);
    setOpen(true);
  }, [settings]);

  const selectMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await apiRequest("POST", "/api/settings/ai", { aiProvider: provider });
      return response.json();
    },
    onSuccess: (_data, provider) => {
      qc.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
      toast({ title: `Provider AI impostato: ${providerLabel[provider] ?? provider}` });
      sessionStorage.setItem(STORAGE_KEY, "1");
      setOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Errore impostazione provider", description: error?.message, variant: "destructive" });
    },
  });

  function dismiss() {
    sessionStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  if (alreadyShown || !settings) return null;

  const availableProviders = [
    settings.geminiKeySet && "gemini",
    settings.anthropicKeySet && "claude",
    settings.openaiKeySet && "openai",
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={18} className="text-primary" />
            Scegli il provider AI
          </DialogTitle>
          <DialogDescription>
            Hai {availableProviders.length > 1 ? `${availableProviders.length} chiavi API configurate` : "una chiave API configurata"}.
            Scegli quale provider usare per questa sessione.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          {availableProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              disabled={selectMutation.isPending}
              onClick={() => selectMutation.mutate(provider)}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm font-medium hover:bg-muted/50 hover:border-primary/40 transition-colors text-left disabled:opacity-50"
            >
              <span>{providerLabel[provider]}</span>
              {settings.currentProvider === provider && (
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
              )}
            </button>
          ))}
        </div>

        <div className="flex justify-end mt-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Salta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
