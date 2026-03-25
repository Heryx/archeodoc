import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type QFieldUploaderProps = {
  selectedFile: File | null;
  onSelectFile: (file: File | null) => void;
  onUpload: () => void;
  uploadPending: boolean;
};

export function QFieldUploader({ selectedFile, onSelectFile, onUpload, uploadPending }: QFieldUploaderProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sincronizzazione QFieldSync (ZIP)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="file"
          accept=".zip"
          onChange={(event) => onSelectFile(event.target.files?.[0] || null)}
        />
        <div className="text-xs text-muted-foreground">
          Carica la cartella ZIP del progetto QFieldSync (contiene `.gpkg`, `.qgz`, `DCIM/`, `media/`).
        </div>
        <Button className="gap-2" onClick={onUpload} disabled={!selectedFile || uploadPending}>
          <UploadCloud size={14} />
          {uploadPending ? "Analisi in corso..." : "Analizza ZIP"}
        </Button>
      </CardContent>
    </Card>
  );
}
