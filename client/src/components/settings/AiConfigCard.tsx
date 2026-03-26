import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type AiConfigFile = {
  name: string;
  content: string;
  updatedAt: string;
  size: number;
};

type AiConfigCardProps = {
  files: AiConfigFile[];
  selectedFile: string;
  value: string;
  onSelectFile: (fileName: string) => void;
  onChangeValue: (next: string) => void;
  onReload: () => void;
  onSave: () => void;
  loading: boolean;
  saving: boolean;
};

export function AiConfigCard({
  files,
  selectedFile,
  value,
  onSelectFile,
  onChangeValue,
  onReload,
  onSave,
  loading,
  saving,
}: AiConfigCardProps) {
  const selectedMeta = useMemo(
    () => files.find((file) => file.name === selectedFile) || null,
    [files, selectedFile],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI Config Di Progetto</CardTitle>
        <CardDescription>
          Modifica i file in `ai_config/` usati dall&apos;AI per contesto, schede e relazione.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={selectedFile} onValueChange={onSelectFile} disabled={loading || files.length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Seleziona file..." />
            </SelectTrigger>
            <SelectContent>
              {files.map((file) => (
                <SelectItem key={file.name} value={file.name}>
                  {file.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onReload} disabled={loading || saving}>
            Ricarica
          </Button>
          <Button size="sm" onClick={onSave} disabled={loading || saving || !selectedFile}>
            {saving ? "Salvataggio..." : "Salva"}
          </Button>
        </div>

        {selectedMeta && (
          <p className="text-xs text-muted-foreground">
            Ultimo aggiornamento: {new Date(selectedMeta.updatedAt).toLocaleString("it-IT")} · {selectedMeta.size} bytes
          </p>
        )}

        <Textarea
          value={value}
          onChange={(event) => onChangeValue(event.target.value)}
          placeholder={loading ? "Caricamento..." : "Inserisci istruzioni AI per il progetto..."}
          className="min-h-64 font-mono text-sm"
          disabled={loading || !selectedFile}
        />
      </CardContent>
    </Card>
  );
}
