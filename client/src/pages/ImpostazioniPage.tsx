import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Save, CheckCircle2, XCircle, Wand2, RefreshCw, Download, FileText, ExternalLink, Unlink } from "lucide-react";
import { PromptEditor } from "@/components/PromptEditor";

type AiSettings = {
  geminiKeySet: boolean;
  anthropicKeySet: boolean;
  geminiKeyPreview: string;
  anthropicKeyPreview: string;
  aiProvider: "auto" | "gemini" | "claude";
  currentProvider: "gemini" | "claude" | "none";
  available: boolean;
};

export function ImpostazioniPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery<AiSettings>({
    queryKey: ["/api/settings/ai"],
    queryFn: async () => (await apiRequest("GET", "/api/settings/ai")).json(),
    staleTime: 0,
  });

  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [aiProvider, setAiProvider] = useState<"auto" | "gemini" | "claude">("auto");
  const [showGemini, setShowGemini] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [initialized, setInitialized] = useState(false);

  type AiPromptSetting = { key: string; value: string; label: string | null; description: string | null };
  const [aiPrompts, setAiPrompts] = useState<AiPromptSetting[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);

  useEffect(() => {
    fetch("/api/settings/ai-prompts")
      .then((r) => r.json())
      .then((data) => setAiPrompts(data))
      .catch(() => {})
      .finally(() => setLoadingPrompts(false));
  }, []);

  // ─── Log di sistema ─────────────────────────────────────────────────────
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPath, setLogPath] = useState("");

  // ─── Google Docs ───────────────────────────────────────────────────────
  type GoogleStatus = { hasCredentials: boolean; hasToken: boolean; credentialsPath: string };
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);

  const fetchGoogleStatus = useCallback(() => {
    setGoogleLoading(true);
    fetch("/api/google/status")
      .then(r => r.json())
      .then(d => setGoogleStatus(d))
      .catch(() => setGoogleStatus(null))
      .finally(() => setGoogleLoading(false));
  }, []);

  useEffect(() => { fetchGoogleStatus(); }, [fetchGoogleStatus]);

  const fetchLogs = useCallback(() => {
    fetch("/api/logs")
      .then((r) => r.json())
      .then((data: { lines: string[]; path: string }) => {
        setLogLines(data.lines ?? []);
        setLogPath(data.path ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Inizializza i valori del form dalla risposta server (solo la prima volta)
  if (settings && !initialized) {
    setAiProvider(settings.aiProvider || "auto");
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { aiProvider };
      // Invia la chiave solo se l'utente ha digitato qualcosa
      if (geminiKey !== "") body.geminiKey = geminiKey;
      if (anthropicKey !== "") body.anthropicKey = anthropicKey;
      const res = await apiRequest("POST", "/api/settings/ai", body);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Impostazioni salvate", description: data.message });
      setGeminiKey("");
      setAnthropicKey("");
      setInitialized(false);
      qc.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Errore salvataggio", description: err.message, variant: "destructive" });
    },
  });

  const clearKeyMutation = useMutation({
    mutationFn: async (key: "gemini" | "anthropic") => {
      const body = key === "gemini" ? { geminiKey: "" } : { anthropicKey: "" };
      const res = await apiRequest("POST", "/api/settings/ai", body);
      return res.json();
    },
    onSuccess: (_data, key) => {
      toast({ title: `Chiave ${key === "gemini" ? "Gemini" : "Anthropic"} rimossa` });
      setInitialized(false);
      qc.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-48 bg-muted rounded" />
        </div>
      </div>
    );
  }

  const providerLabel: Record<string, string> = {
    gemini: "Google Gemini",
    claude: "Anthropic Claude",
    none: "Nessuno",
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Impostazioni</h1>
        <p className="text-muted-foreground mt-1">Configura le chiavi API per le funzioni AI.</p>
      </div>

      {/* Stato attuale */}
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
        </CardContent>
      </Card>

      {/* Form chiavi */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Chiavi API</CardTitle>
          <CardDescription>
            Le chiavi vengono salvate nel file <code className="bg-muted px-1 rounded text-xs">.env</code> nella
            cartella dell'applicazione e non vengono mai inviate a terze parti né incluse nel repository.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Gemini */}
          <div className="space-y-1.5">
            <Label htmlFor="gemini-key" className="flex items-center gap-2">
              Google Gemini API Key
              <Badge variant="secondary" className="text-[10px] py-0">Gratuita</Badge>
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="gemini-key"
                  type={showGemini ? "text" : "password"}
                  placeholder={settings?.geminiKeySet ? `Attuale: ${settings.geminiKeyPreview}  — lascia vuoto per non modificare` : "Incolla qui la tua chiave Gemini"}
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGemini(v => !v)}
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
                  onClick={() => clearKeyMutation.mutate("gemini")}
                  disabled={clearKeyMutation.isPending}
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

          {/* Anthropic */}
          <div className="space-y-1.5">
            <Label htmlFor="anthropic-key" className="flex items-center gap-2">
              Anthropic Claude API Key
              <Badge variant="secondary" className="text-[10px] py-0">A pagamento</Badge>
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="anthropic-key"
                  type={showAnthropic ? "text" : "password"}
                  placeholder={settings?.anthropicKeySet ? `Attuale: ${settings.anthropicKeyPreview}  — lascia vuoto per non modificare` : "Incolla qui la tua chiave Anthropic (opzionale)"}
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropic(v => !v)}
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
                  onClick={() => clearKeyMutation.mutate("anthropic")}
                  disabled={clearKeyMutation.isPending}
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

          {/* Provider */}
          <div className="space-y-1.5">
            <Label>Provider preferito</Label>
            <div className="flex gap-2">
              {(["auto", "gemini", "claude"] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAiProvider(p)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    aiProvider === p
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {p === "auto" ? "Auto (consigliato)" : p === "gemini" ? "Gemini" : "Claude"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              In modalità <strong>Auto</strong>, Gemini viene preferito se la chiave è presente (è gratuito).
            </p>
          </div>

          {/* Info aggiornamento live */}
          <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
            <RefreshCw size={13} className="mt-0.5 shrink-0" />
            <span>
              Il provider AI viene aggiornato immediatamente dopo il salvataggio, senza riavviare il server.
            </span>
          </div>

          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <><RefreshCw size={14} className="mr-2 animate-spin" /> Salvataggio...</>
            ) : (
              <><Save size={14} className="mr-2" /> Salva impostazioni</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Istruzioni AI personalizzabili */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Istruzioni AI</CardTitle>
          <CardDescription>
            Personalizza i prompt e le istruzioni usate dall'assistente AI per analisi US e giornali di cantiere.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loadingPrompts ? (
            <p className="text-sm text-muted-foreground">Caricamento istruzioni...</p>
          ) : (
            aiPrompts.map((s) => (
              <PromptEditor
                key={s.key}
                settingKey={s.key}
                label={s.label ?? s.key}
                description={s.description ?? undefined}
                initialValue={s.value}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Google Docs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            Google Docs
          </CardTitle>
          <CardDescription>
            Importa testo direttamente dai tuoi documenti Google Docs nelle schede US e giornate.
          </CardDescription>
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
                <li>Vai su <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3 inline" /></a></li>
                <li>Seleziona il progetto e abilita la <strong>Google Docs API</strong></li>
                <li>Crea credenziali <strong>OAuth 2.0</strong> (tipo: App desktop)</li>
                <li>Scarica il JSON e salvalo come <code className="bg-muted px-1 rounded">credentials.json</code></li>
              </ol>
              <p className="text-xs text-muted-foreground">Percorso: <code className="bg-muted px-1 rounded">{googleStatus.credentialsPath}</code></p>
              <Button variant="outline" size="sm" onClick={fetchGoogleStatus}>Ho salvato il file</Button>
            </div>
          ) : !googleStatus.hasToken ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Credenziali presenti. Clicca per collegare il tuo account Google.</p>
              <Button onClick={() => { window.location.href = "/api/google/auth"; }}>
                Collega account Google
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
                <CheckCircle2 size={12} className="mr-1" /> Account Google collegato
              </Badge>
              <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                try {
                  await apiRequest("POST", "/api/google/revoke");
                  fetchGoogleStatus();
                  toast({ title: "Account Google disconnesso" });
                } catch (e: any) {
                  toast({ title: "Errore", description: e.message, variant: "destructive" });
                }
              }}>
                <Unlink size={13} /> Disconnetti
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log di sistema */}
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
            <Button variant="outline" size="sm" className="gap-1" onClick={fetchLogs}>
              <RefreshCw size={13} />
              Aggiorna
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => window.open("/api/logs/download", "_blank")}
            >
              <Download size={13} />
              Scarica log
            </Button>
          </div>
          {logLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun log disponibile.</p>
          ) : (
            <div className="font-mono text-xs max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3">
              {logLines.map((line, i) => {
                let cls = "";
                if (line.includes("[ERROR]")) cls = "text-red-500";
                else if (line.includes("[WARN]")) cls = "text-amber-500";
                else if (line.includes("[INFO]")) cls = "text-green-600";
                else if (line.includes("[DEBUG]")) cls = "text-gray-400";
                return (
                  <div key={i} className={cls}>
                    {line}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
