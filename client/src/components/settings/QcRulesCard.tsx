import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { QcRuleDef, QcRuleLevel } from "@shared/qc_us_rules";

type QcUsConfig = {
  levels: Record<string, QcRuleLevel>;
  thresholds: Record<string, number>;
};

type ApiPayload = {
  rules: QcRuleDef[];
  config: QcUsConfig;
};

const LEVEL_OPTIONS: { value: QcRuleLevel; label: string }[] = [
  { value: "error", label: "Errore" },
  { value: "warning", label: "Avviso" },
  { value: "info", label: "Info" },
  { value: "off", label: "Disattivato" },
];

const CATEGORY_LABELS: Record<QcRuleDef["categoria"], string> = {
  completezza: "Completezza",
  coerenza: "Coerenza",
  nomenclatura: "Nomenclatura",
  associazione: "Associazione allegati",
};

export function QcRulesCard() {
  const { toast } = useToast();
  const [rules, setRules] = useState<QcRuleDef[]>([]);
  const [levels, setLevels] = useState<Record<string, QcRuleLevel>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dirty, setDirty] = useState(false);

  function applyPayload(data: ApiPayload) {
    setRules(data.rules);
    setLevels({ ...data.config.levels });
    setThresholds({ ...data.config.thresholds });
    setDirty(false);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/qc-us-rules");
      if (!res.ok) throw new Error("load");
      applyPayload((await res.json()) as ApiPayload);
    } catch {
      toast({ title: "Errore", description: "Impossibile caricare le regole QC.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<QcRuleDef["categoria"], QcRuleDef[]>();
    for (const rule of rules) {
      const list = map.get(rule.categoria) ?? [];
      list.push(rule);
      map.set(rule.categoria, list);
    }
    return Array.from(map.entries());
  }, [rules]);

  function setLevel(ruleId: string, value: QcRuleLevel) {
    setLevels((prev) => ({ ...prev, [ruleId]: value }));
    setDirty(true);
  }

  function setThreshold(key: string, value: number) {
    setThresholds((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/qc-us-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels, thresholds }),
      });
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { config: QcUsConfig };
      setLevels({ ...data.config.levels });
      setThresholds({ ...data.config.thresholds });
      setDirty(false);
      toast({ title: "Salvato", description: "Regole di controllo qualità aggiornate." });
    } catch {
      toast({ title: "Errore", description: "Impossibile salvare le regole QC.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch("/api/settings/qc-us-rules/reset", { method: "POST" });
      if (!res.ok) throw new Error("reset");
      const data = (await res.json()) as { config: QcUsConfig };
      setLevels({ ...data.config.levels });
      setThresholds({ ...data.config.thresholds });
      setDirty(false);
      toast({ title: "Ripristinato", description: "Regole QC riportate ai valori predefiniti." });
    } catch {
      toast({ title: "Errore", description: "Impossibile ripristinare le regole QC.", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck size={16} className="text-primary" />
          Controllo qualità schede US
        </CardTitle>
        <CardDescription>
          Decidi come il controllo qualità deve segnalare ogni verifica sulle schede US: errore, avviso, info oppure
          disattivata. Le modifiche valgono per tutti i cantieri e si applicano al prossimo controllo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Caricamento regole...</p>
        ) : (
          <>
            {grouped.map(([categoria, list]) => (
              <div key={categoria} className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[categoria]}
                </h4>
                <div className="space-y-3">
                  {list.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <Label className="text-sm font-medium">{rule.label}</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">{rule.description}</p>
                        {rule.thresholds && rule.thresholds.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-3">
                            {rule.thresholds.map((th) => (
                              <label key={th.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                {th.label}
                                <Input
                                  type="number"
                                  className="h-7 w-20"
                                  value={thresholds[th.key] ?? th.default}
                                  min={th.min}
                                  max={th.max}
                                  step={th.step ?? 1}
                                  onChange={(e) => setThreshold(th.key, Number(e.target.value))}
                                />
                                {th.suffix && <span>{th.suffix}</span>}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      <Select
                        value={levels[rule.id] ?? rule.defaultLevel}
                        onValueChange={(v) => setLevel(rule.id, v as QcRuleLevel)}
                      >
                        <SelectTrigger className="w-full shrink-0 sm:w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEVEL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting || saving}>
                {resetting ? "Ripristino..." : "Ripristina default"}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || resetting || !dirty}>
                {saving ? "Salvataggio..." : "Salva"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
