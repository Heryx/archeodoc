import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromptEditor } from "@/components/PromptEditor";
import { AIKeysCard } from "@/components/settings/AIKeysCard";
import { AIStatusCard } from "@/components/settings/AIStatusCard";
import { AiConfigCard, type AiConfigFile } from "@/components/settings/AiConfigCard";
import { GoogleDocsCard } from "@/components/settings/GoogleDocsCard";
import { LogsCard } from "@/components/settings/LogsCard";
import type { AiPromptSetting, AiSettings, GoogleStatus } from "@/components/settings/types";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type ImpostazioniPageProps = {
  embedded?: boolean;
};

type AiConfigResponse = {
  projectId: string;
  directory: string;
  files: AiConfigFile[];
};

export function ImpostazioniPage({ embedded = false }: ImpostazioniPageProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<AiSettings>({
    queryKey: ["/api/settings/ai"],
    queryFn: async () => (await apiRequest("GET", "/api/settings/ai")).json(),
    staleTime: 0,
  });

  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<"auto" | "gemini" | "claude" | "openai">("auto");
  const [showGemini, setShowGemini] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const [aiPrompts, setAiPrompts] = useState<AiPromptSetting[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [aiConfigFiles, setAiConfigFiles] = useState<AiConfigFile[]>([]);
  const [aiConfigLoading, setAiConfigLoading] = useState(true);
  const [selectedAiConfigFile, setSelectedAiConfigFile] = useState("");
  const [selectedAiConfigContent, setSelectedAiConfigContent] = useState("");

  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPath, setLogPath] = useState("");

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);

  useEffect(() => {
    if (!settings || initialized) {
      return;
    }

    setAiProvider(settings.aiProvider || "auto");
    setInitialized(true);
  }, [settings, initialized]);

  useEffect(() => {
    fetch("/api/settings/ai-prompts")
      .then((response) => response.json())
      .then((data) => setAiPrompts(data))
      .catch(() => undefined)
      .finally(() => setLoadingPrompts(false));
  }, []);

  const fetchAiConfig = useCallback(() => {
    setAiConfigLoading(true);
    apiRequest("GET", "/api/settings/ai-config")
      .then((response) => response.json() as Promise<AiConfigResponse>)
      .then((data) => {
        const files = data.files || [];
        setAiConfigFiles(files);

        if (files.length === 0) {
          setSelectedAiConfigFile("");
          setSelectedAiConfigContent("");
          return;
        }

        const existing = files.find((file) => file.name === selectedAiConfigFile);
        const selected = existing || files[0];
        setSelectedAiConfigFile(selected.name);
        setSelectedAiConfigContent(selected.content || "");
      })
      .catch(() => undefined)
      .finally(() => setAiConfigLoading(false));
  }, [selectedAiConfigFile]);

  useEffect(() => {
    fetchAiConfig();
  }, [fetchAiConfig]);

  const fetchGoogleStatus = useCallback(() => {
    setGoogleLoading(true);
    fetch("/api/google/status")
      .then((response) => response.json())
      .then((data) => setGoogleStatus(data))
      .catch(() => setGoogleStatus(null))
      .finally(() => setGoogleLoading(false));
  }, []);

  useEffect(() => {
    fetchGoogleStatus();
  }, [fetchGoogleStatus]);

  const fetchLogs = useCallback(() => {
    fetch("/api/logs")
      .then((response) => response.json())
      .then((data: { lines: string[]; path: string }) => {
        setLogLines(data.lines ?? []);
        setLogPath(data.path ?? "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { aiProvider };
      if (geminiKey !== "") {
        body.geminiKey = geminiKey;
      }
      if (anthropicKey !== "") {
        body.anthropicKey = anthropicKey;
      }
      if (openaiKey !== "") {
        body.openaiKey = openaiKey;
      }

      const response = await apiRequest("POST", "/api/settings/ai", body);
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Impostazioni salvate", description: data.message });
      setGeminiKey("");
      setAnthropicKey("");
      setOpenaiKey("");
      setInitialized(false);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/status"] });
    },
    onError: (error: any) => {
      toast({ title: "Errore salvataggio", description: error.message, variant: "destructive" });
    },
  });

  const clearKeyMutation = useMutation({
    mutationFn: async (key: "gemini" | "anthropic" | "openai") => {
      const body = key === "gemini" ? { geminiKey: "" } : key === "anthropic" ? { anthropicKey: "" } : { openaiKey: "" };
      const response = await apiRequest("POST", "/api/settings/ai", body);
      return response.json();
    },
    onSuccess: (_data, key) => {
      toast({ title: `Chiave ${key === "gemini" ? "Gemini" : key === "anthropic" ? "Anthropic" : "OpenAI"} rimossa` });
      setInitialized(false);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/status"] });
    },
    onError: (error: any) => {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/google/revoke");
    },
    onSuccess: () => {
      fetchGoogleStatus();
      toast({ title: "Account Google disconnesso" });
    },
    onError: (error: any) => {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/logs/clear", {});
      return response.json();
    },
    onSuccess: () => {
      setLogLines([]);
      fetchLogs();
      toast({ title: "Log svuotati" });
    },
    onError: (error: any) => {
      toast({
        title: "Errore svuotamento log",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const saveAiConfigMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAiConfigFile) {
        throw new Error("Seleziona un file ai_config");
      }
      await apiRequest("PUT", `/api/settings/ai-config/${encodeURIComponent(selectedAiConfigFile)}`, {
        content: selectedAiConfigContent,
      });
    },
    onSuccess: () => {
      toast({ title: "ai_config salvato" });
      fetchAiConfig();
    },
    onError: (error: any) => {
      toast({
        title: "Errore salvataggio ai_config",
        description: error?.message || "Operazione non riuscita",
        variant: "destructive",
      });
    },
  });

  const aiKeysProps = useMemo(
    () => ({
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
      savePending: saveMutation.isPending,
      clearPending: clearKeyMutation.isPending,
      onSave: () => saveMutation.mutate(),
      onClearKey: (key: "gemini" | "anthropic" | "openai") => clearKeyMutation.mutate(key),
    }),
    [
      settings,
      aiProvider,
      geminiKey,
      anthropicKey,
      openaiKey,
      showGemini,
      showAnthropic,
      showOpenai,
      saveMutation,
      clearKeyMutation,
    ],
  );

  const handleSelectAiConfigFile = useCallback((fileName: string) => {
    setSelectedAiConfigFile(fileName);
    const selected = aiConfigFiles.find((file) => file.name === fileName);
    setSelectedAiConfigContent(selected?.content || "");
  }, [aiConfigFiles]);

  if (isLoading) {
    return (
      <div className={embedded ? "p-4" : "p-8 max-w-2xl mx-auto"}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-48 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "p-4 space-y-4" : "p-8 max-w-2xl mx-auto space-y-6"}>
      <div>
        <h1 className="text-2xl font-bold">Impostazioni</h1>
        <p className="text-muted-foreground mt-1">Configura le chiavi API per le funzioni AI.</p>
      </div>

      <AIStatusCard settings={settings} />

      <AIKeysCard {...aiKeysProps} />

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
            aiPrompts.map((prompt) => (
              <PromptEditor
                key={prompt.key}
                settingKey={prompt.key}
                label={prompt.label ?? prompt.key}
                description={prompt.description ?? undefined}
                initialValue={prompt.value}
              />
            ))
          )}
        </CardContent>
      </Card>

      <AiConfigCard
        files={aiConfigFiles}
        selectedFile={selectedAiConfigFile}
        value={selectedAiConfigContent}
        onSelectFile={handleSelectAiConfigFile}
        onChangeValue={setSelectedAiConfigContent}
        onReload={fetchAiConfig}
        onSave={() => saveAiConfigMutation.mutate()}
        loading={aiConfigLoading}
        saving={saveAiConfigMutation.isPending}
      />

      <GoogleDocsCard
        googleLoading={googleLoading}
        googleStatus={googleStatus}
        onRefresh={fetchGoogleStatus}
        onAuth={() => {
          window.location.href = "/api/google/auth";
        }}
        onRevoke={() => revokeMutation.mutate()}
        revokePending={revokeMutation.isPending}
      />

      <LogsCard
        logLines={logLines}
        logPath={logPath}
        onRefresh={fetchLogs}
        onDownload={() => {
          window.open("/api/logs/download", "_blank");
        }}
        onClear={() => {
          if (clearLogsMutation.isPending) return;
          const confirmed = window.confirm("Confermi di voler svuotare completamente il file di log?");
          if (!confirmed) return;
          clearLogsMutation.mutate();
        }}
        clearPending={clearLogsMutation.isPending}
      />
    </div>
  );
}
