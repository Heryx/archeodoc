import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface PromptEditorProps {
  settingKey: string;
  label: string;
  description?: string;
  initialValue: string;
  onSaved?: (newValue: string) => void;
}

export function PromptEditor({ settingKey, label, description, initialValue, onSaved }: PromptEditorProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/ai-prompts/${settingKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Errore salvataggio");
      toast({ title: "Salvato", description: `${label} aggiornato.` });
      onSaved?.(value);
    } catch {
      toast({ title: "Errore", description: "Impossibile salvare.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch("/api/settings/ai-prompts/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey }),
      });
      if (!res.ok) throw new Error("Errore reset");
      const data = await res.json();
      setValue(data.value);
      toast({ title: "Ripristinato", description: `${label} ripristinato al valore predefinito.` });
      onSaved?.(data.value);
    } catch {
      toast({ title: "Errore", description: "Impossibile ripristinare.", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        className="font-mono text-sm"
        placeholder={`Inserisci istruzioni per ${label}...`}
      />
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting}>
          {resetting ? "Ripristino..." : "Ripristina default"}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Salvataggio..." : "Salva"}
        </Button>
      </div>
    </div>
  );
}
