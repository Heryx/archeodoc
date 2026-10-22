import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useAiJobMutation } from "@/lib/aiJobs";
import { useToast } from "@/hooks/use-toast";
import { getCurrentProjectId } from "@/lib/project";
import type { USModelDefinition } from "@shared/us_models";
import { Upload, Trash2, FileCheck, Sparkles, RotateCcw } from "lucide-react";

type TemplateInfo = { exists: boolean; sizeBytes?: number; updatedAt?: string };
type RepairInfo = {
  plan: { orphanRows: string[]; unknownPlaceholders: { key: string; suggestion: { key: string; label: string } | null }[]; needsRepair: boolean } | null;
  summary: string[];
  choice: { mode: "repaired" | "as-is"; repairs: string[]; decidedAt: string } | null;
  canRestore: boolean;
};

type FieldMatch = { key: string; label: string; score: number };
type FieldSuggestion = { placeholder: string; status: "new" | "possible" | "certain"; match: FieldMatch | null };
type AIFieldMatch = { key: string; label: string; confidence: "alta" | "media" | "bassa" };
type FieldDecision = { action: "use-existing" | "create-new"; existingKey?: string; label: string };
type ApplyResult = {
  ok: boolean;
  rewritten: string[];
  modelUpdated?: USModelDefinition;
  errors: { placeholder: string; error: string }[];
};

const BASE_PLACEHOLDER_KEYS = [
  "codiceUS", "descrizione", "definizione", "interpretazione", "tipo",
  "settore", "area", "saggio", "quadrati", "quota", "quotaPianoCampagna",
  "periodoIniziale", "periodoFinale", "materialiRinvenuti", "campioni",
];

function humanizeClientKey(key: string): string {
  return (
    key
      .replace(/^chk/, "")
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || key
  );
}

type USElencoTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: string | undefined;
  activeModel?: USModelDefinition;
};

export function USElencoTemplateDialog({ open, onOpenChange, cid, activeModel }: USElencoTemplateDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeProjectId = getCurrentProjectId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<FieldSuggestion[] | null>(null);
  const [aiMatches, setAiMatches] = useState<Record<string, AIFieldMatch | null>>({});
  const [decisions, setDecisions] = useState<Record<string, FieldDecision>>({});

  const endpoint = `/api/cantieri/${cid}/elenco-template`;

  const { data: templateInfo, refetch: refetchTemplate } = useQuery<TemplateInfo>({
    queryKey: ["elenco-template", cid],
    queryFn: async () => (await apiRequest("GET", endpoint)).json(),
    enabled: open && !!cid,
    staleTime: 0,
  });

  const { data: repairInfo, refetch: refetchRepair } = useQuery<RepairInfo>({
    queryKey: ["elenco-template-repair", cid],
    queryFn: async () => (await apiRequest("GET", `${endpoint}/repair`)).json(),
    enabled: open && !!cid,
    staleTime: 0,
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${endpoint}/restore-original`);
      if (!res.ok) throw new Error((await res.json()).error || "Errore ripristino");
      return res.json();
    },
    onSuccess: () => {
      void refetchTemplate();
      void refetchRepair();
      setDetectedPlaceholders(null);
      qc.invalidateQueries({ queryKey: ["elenco-template", cid] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us", "table"] });
      toast({ title: "Template originale ripristinato" });
    },
    onError: (e: any) => toast({ title: "Errore ripristino", description: e.message, variant: "destructive" }),
  });

  const { data: aiStatus } = useQuery<{ available: boolean }>({
    queryKey: ["ai-status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    enabled: open,
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("template", file);
      const res = await fetch(`${endpoint}?projectId=${encodeURIComponent(activeProjectId || "")}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Errore upload");
      return res.json();
    },
    onSuccess: () => {
      void refetchTemplate();
      void refetchRepair();
      qc.invalidateQueries({ queryKey: ["elenco-template", cid] });
      qc.invalidateQueries({ queryKey: ["elenco-template-repair", cid] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us", "table"] });
      setSuggestions(null);
      setDecisions({});
      setAiMatches({});
      toast({ title: "Template elenco US caricato" });
      setTimeout(() => { void fetchPlaceholders(); }, 600);
    },
    onError: (e: any) => toast({ title: "Errore upload", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", endpoint);
      if (!res.ok) throw new Error((await res.json()).error || "Errore eliminazione");
      return res.json();
    },
    onSuccess: () => {
      void refetchTemplate();
      void refetchRepair();
      qc.invalidateQueries({ queryKey: ["elenco-template-repair", cid] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "elenco-us", "table"] });
      setDetectedPlaceholders(null);
      setSuggestions(null);
      setDecisions({});
      setAiMatches({});
      toast({ title: "Template rimosso" });
    },
    onError: (e: any) => toast({ title: "Errore eliminazione", description: e.message, variant: "destructive" }),
  });

  const fetchPlaceholders = async () => {
    try {
      const res = await apiRequest("GET", `${endpoint}/placeholders`);
      const data = await res.json() as { tags: Record<string, unknown> };
      setDetectedPlaceholders(Object.keys(data.tags || {}));
    } catch {
      setDetectedPlaceholders(null);
    }
  };

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `${endpoint}/field-suggestions`);
      if (!res.ok) throw new Error((await res.json()).error || "Errore verifica campi");
      return res.json() as Promise<{ suggestions: FieldSuggestion[] }>;
    },
    onSuccess: (data) => {
      setSuggestions(data.suggestions);
      setAiMatches({});
      const init: Record<string, FieldDecision> = {};
      for (const s of data.suggestions) {
        init[s.placeholder] = s.match
          ? { action: "use-existing", existingKey: s.match.key, label: humanizeClientKey(s.placeholder) }
          : { action: "create-new", label: humanizeClientKey(s.placeholder) };
      }
      setDecisions(init);
      if (data.suggestions.length === 0) {
        toast({ title: "Nessun campo da verificare", description: "Tutti i placeholder corrispondono già a campi esistenti." });
      }
    },
    onError: (e: any) => toast({ title: "Errore verifica campi", description: e.message, variant: "destructive" }),
  });

  const aiCheckMutation = useAiJobMutation<void, { suggestions: { placeholder: string; match: AIFieldMatch | null }[] }>({
    prefix: `template-ai-check:${endpoint}`,
    keyOf: () => `template-ai-check:${endpoint}`,
    labelOf: () => "Verifica campi template (IA)",
    run: async (_vars, { signal }) => {
      const targets = (suggestions || []).filter((s) => s.status === "new").map((s) => s.placeholder);
      if (targets.length === 0) return { suggestions: [] as { placeholder: string; match: AIFieldMatch | null }[] };
      const res = await apiRequest("POST", `${endpoint}/field-suggestions/ai-check`, { placeholders: targets }, signal);
      if (!res.ok) throw new Error((await res.json()).error || "Errore verifica AI");
      return res.json() as Promise<{ suggestions: { placeholder: string; match: AIFieldMatch | null }[] }>;
    },
    onSuccess: (data) => {
      const matches: Record<string, AIFieldMatch | null> = {};
      for (const s of data.suggestions) matches[s.placeholder] = s.match;
      setAiMatches((prev) => ({ ...prev, ...matches }));
      setDecisions((prev) => {
        const next = { ...prev };
        for (const s of data.suggestions) {
          if (s.match) {
            next[s.placeholder] = {
              action: "use-existing",
              existingKey: s.match.key,
              label: next[s.placeholder]?.label || humanizeClientKey(s.placeholder),
            };
          }
        }
        return next;
      });
    },
    onError: (e: any) => toast({ title: "Errore verifica AI", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const decisionsPayload = Object.entries(decisions).map(([placeholder, d]) => ({
        placeholder,
        action: d.action,
        existingKey: d.action === "use-existing" ? d.existingKey : undefined,
        label: d.action === "create-new" ? d.label : undefined,
      }));
      const res = await apiRequest("POST", `${endpoint}/apply-field-decisions`, { decisions: decisionsPayload });
      if (!res.ok) throw new Error((await res.json()).error || "Errore applicazione");
      return res.json() as Promise<ApplyResult>;
    },
    onSuccess: (data) => {
      setSuggestions(null);
      setDecisions({});
      setAiMatches({});
      setDetectedPlaceholders(null);
      qc.invalidateQueries({ queryKey: ["elenco-template", cid] });
      qc.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us-model", activeProjectId] });
      qc.invalidateQueries({ queryKey: ["/api/us-models", activeProjectId] });
      toast({
        title: data.errors.length === 0 ? "Campi aggiornati" : "Applicato con alcuni errori",
        description: `${data.rewritten.length} placeholder riscritti nel template${data.errors.length ? ` · ${data.errors.length} errori` : ""}`,
        variant: data.errors.length > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Errore applicazione campi", description: e.message, variant: "destructive" }),
  });

  const referenceKeys = [
    ...BASE_PLACEHOLDER_KEYS,
    ...(activeModel?.fields.map((f) => f.key) || []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Template elenco US (tabella)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p>
              Nella riga dati della tabella, la <strong>prima cella</strong> deve contenere sia il tag di apertura
              sia il placeholder del codice, es. <code className="bg-muted px-1 rounded">{"{#us}{codiceUS}"}</code> —
              non solo <code className="bg-muted px-1 rounded">{"{#us}"}</code> da solo, altrimenti il codice US non
              viene mai stampato. L'<strong>ultima cella</strong> deve chiudere il tag, es.{" "}
              <code className="bg-muted px-1 rounded">{"{ultimoCampo}{/us}"}</code>. Nelle celle intermedie inserisci
              gli altri placeholder (es. <code className="bg-muted px-1 rounded">{"{descrizione}"}</code>).
            </p>
            <p>
              Se un US occupa <strong>più righe fisiche</strong> della tabella (es. una riga con "copre/taglia/riempie"
              e una seconda con "coperto da/tagliato da/riempito da"), metti tutti gli header sopra ed entrambe le
              righe dati una sotto l'altra: <code className="bg-muted px-1 rounded">{"{#us}"}</code> nella prima cella
              della prima riga dati, <code className="bg-muted px-1 rounded">{"{/us}"}</code> nell'ultima cella
              dell'ultima riga dati — l'intero blocco viene ripetuto per ogni US.
            </p>
          </div>

          {templateInfo?.exists ? (
            <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileCheck size={16} className="text-green-600 dark:text-green-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">template_elenco_us.docx</p>
                  {templateInfo.sizeBytes && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {(templateInfo.sizeBytes / 1024).toFixed(1)} KB
                      {templateInfo.updatedAt && ` · ${new Date(templateInfo.updatedAt).toLocaleDateString("it-IT")}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                  <Upload size={13} className="mr-1" /> Sostituisci
                </Button>
                <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
              <Upload size={14} />
              {uploadMutation.isPending ? "Caricamento..." : "Carica template .docx"}
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { uploadMutation.mutate(f); e.target.value = ""; }
            }}
          />

          {templateInfo?.exists && (repairInfo?.choice || repairInfo?.canRestore || repairInfo?.plan?.needsRepair) && (
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-xs">
              <p className="font-medium">Stato del template</p>
              {repairInfo?.choice?.mode === "repaired" && (
                <div className="text-muted-foreground space-y-1">
                  <p>Template corretto automaticamente:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {repairInfo.choice.repairs.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {repairInfo?.choice?.mode === "as-is" && (
                <p className="text-muted-foreground">L'export usa il template così com'è (nessuna correzione).</p>
              )}
              {!repairInfo?.choice && repairInfo?.plan?.needsRepair && (
                <div className="text-muted-foreground space-y-1">
                  <p>Il template va corretto (la scelta viene chiesta al primo export):</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {repairInfo.summary.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {repairInfo?.canRestore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] gap-1"
                  disabled={restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate()}
                >
                  <RotateCcw size={12} />
                  {restoreMutation.isPending ? "Ripristino…" : "Ripristina template originale"}
                </Button>
              )}
            </div>
          )}

          {templateInfo?.exists && (
            <div className="space-y-3">
              {detectedPlaceholders === null ? (
                <Button variant="ghost" size="sm" className="text-xs w-full" onClick={() => void fetchPlaceholders()}>
                  Rileva placeholder dal template
                </Button>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium">Placeholder rilevati ({detectedPlaceholders.length}):</p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {detectedPlaceholders.map((p) => (
                      <code key={p} className="bg-muted border border-border rounded px-1 text-[10px]">{"{" + p + "}"}</code>
                    ))}
                  </div>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="text-xs w-full"
                onClick={() => suggestionsMutation.mutate()}
                disabled={suggestionsMutation.isPending}
              >
                {suggestionsMutation.isPending ? "Verifica in corso..." : "Verifica campi mancanti"}
              </Button>
            </div>
          )}

          {suggestions && suggestions.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">Campi da verificare ({suggestions.length})</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] gap-1"
                  disabled={!aiStatus?.available || aiCheckMutation.isPending}
                  title={aiStatus?.available ? "Chiede all'AI se qualche placeholder è un sinonimo di un campo esistente" : "Nessun provider AI configurato"}
                  onClick={() => aiCheckMutation.mutate()}
                >
                  <Sparkles size={12} />
                  {aiCheckMutation.isPending ? "Verifica AI..." : "Verifica anche con AI"}
                </Button>
              </div>

              {suggestions.map((s) => {
                const decision = decisions[s.placeholder];
                const aiMatch = aiMatches[s.placeholder];
                const bestMatch = s.match || aiMatch;
                return (
                  <div key={s.placeholder} className="rounded border border-border bg-background p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <code className="text-xs">{"{" + s.placeholder + "}"}</code>
                      {s.match && (
                        <span className="text-[11px] text-muted-foreground">
                          {s.status === "certain" ? "molto simile a" : "forse simile a"} <strong>{s.match.label}</strong>{" "}
                          (<code>{s.match.key}</code>)
                        </span>
                      )}
                      {aiMatch && !s.match && (
                        <span className="text-[11px] text-blue-700 dark:text-blue-400 flex items-center gap-1">
                          <Sparkles size={10} /> AI: <strong>{aiMatch.label}</strong> (<code>{aiMatch.key}</code>) · {aiMatch.confidence}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {bestMatch && (
                        <Button
                          size="sm"
                          variant={decision?.action === "use-existing" ? "default" : "outline"}
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setDecisions((prev) => ({
                            ...prev,
                            [s.placeholder]: { action: "use-existing", existingKey: bestMatch.key, label: prev[s.placeholder]?.label || humanizeClientKey(s.placeholder) },
                          }))}
                        >
                          Usa {bestMatch.key}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={decision?.action === "create-new" ? "default" : "outline"}
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setDecisions((prev) => ({
                          ...prev,
                          [s.placeholder]: { action: "create-new", label: prev[s.placeholder]?.label || humanizeClientKey(s.placeholder) },
                        }))}
                      >
                        Crea nuovo campo
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] text-muted-foreground"
                        onClick={() => setDecisions((prev) => {
                          const next = { ...prev };
                          delete next[s.placeholder];
                          return next;
                        })}
                      >
                        Ignora
                      </Button>
                    </div>
                    {decision?.action === "create-new" && (
                      <Input
                        className="h-7 text-xs"
                        value={decision.label}
                        onChange={(e) => setDecisions((prev) => ({
                          ...prev,
                          [s.placeholder]: { ...(prev[s.placeholder] as FieldDecision), label: e.target.value },
                        }))}
                        placeholder="Etichetta campo"
                      />
                    )}
                  </div>
                );
              })}

              <Button
                size="sm"
                className="w-full"
                disabled={applyMutation.isPending || Object.keys(decisions).length === 0}
                onClick={() => applyMutation.mutate()}
              >
                {applyMutation.isPending ? "Applicazione..." : `Applica (${Object.keys(decisions).length})`}
              </Button>
            </div>
          )}

          <div className="rounded-md border border-border p-3 space-y-2">
            <p className="text-xs font-medium">Placeholder disponibili per riga (campi US)</p>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {referenceKeys.map((k) => (
                <code key={k} className="bg-muted border border-border rounded px-1 text-[10px]">{"{" + k + "}"}</code>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Fuori dal loop puoi usare anche <code className="bg-muted px-1 rounded">{"{cantiereNome}"}</code>,{" "}
              <code className="bg-muted px-1 rounded">{"{cantiereCodice}"}</code>,{" "}
              <code className="bg-muted px-1 rounded">{"{dataExport}"}</code> e{" "}
              <code className="bg-muted px-1 rounded">{"{totaleUS}"}</code>.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
