import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useProjectCodeSettings } from "@/hooks/useProjectCodeSettings";
import { formatUsCode, type ProjectCodeSettings } from "@shared/us_code";

export function CodeSettingsCard() {
  const { projectId, settings } = useProjectCodeSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: async (patch: Partial<ProjectCodeSettings>) =>
      (await apiRequest("PUT", `/api/projects/${projectId}/code-settings`, patch)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
    onError: (e: any) =>
      toast({ title: "Salvataggio non riuscito", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Codici US del progetto</CardTitle>
        <CardDescription>
          Come mostrare il prefisso nell'anteprima: gli strati e gli altri tipi usano "US", le tombe "T".
          Se nel codice non c'è prefisso viene dedotto dal tipo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="tomba-style">Stile prefisso tombe</Label>
          <Select
            value={settings.tombaStyle}
            onValueChange={(v) => save.mutate({ tombaStyle: v as ProjectCodeSettings["tombaStyle"] })}
            disabled={!projectId}
          >
            <SelectTrigger id="tomba-style" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="T.001">T.001</SelectItem>
              <SelectItem value="T 001">T 001</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-muted-foreground">
          Esempio: {formatUsCode("100", "strato", settings.tombaStyle)} · {formatUsCode("5", "tomba", settings.tombaStyle)}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="flag-mismatch">Segnala prefissi incoerenti</Label>
            <p className="text-xs text-muted-foreground">
              Nel controllo qualità avvisa se il prefisso non corrisponde al tipo (es. tomba con "US").
            </p>
          </div>
          <Switch
            id="flag-mismatch"
            checked={settings.flagPrefixMismatch}
            onCheckedChange={(v) => save.mutate({ flagPrefixMismatch: v })}
            disabled={!projectId}
          />
        </div>
      </CardContent>
    </Card>
  );
}
