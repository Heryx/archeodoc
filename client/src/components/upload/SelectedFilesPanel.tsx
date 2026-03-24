import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadFileIcon } from "@/components/upload/UploadFileIcon";

type SelectedFilesPanelProps = {
  selectedFiles: File[];
  onRemoveFile: (index: number) => void;
  onUpload: () => void;
  uploadPending: boolean;
};

export function SelectedFilesPanel({ selectedFiles, onRemoveFile, onUpload, uploadPending }: SelectedFilesPanelProps) {
  if (selectedFiles.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{selectedFiles.length} file pronti per il caricamento</p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {selectedFiles.map((file, index) => (
          <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-3 py-1.5">
            <UploadFileIcon tipo={file.type.startsWith("image/") ? "foto" : "pdf"} />
            <span className="flex-1 truncate">{file.name}</span>
            <span className="text-muted-foreground text-xs">{(file.size / 1024).toFixed(0)} KB</span>
            <button type="button" onClick={() => onRemoveFile(index)}>
              <X size={13} className="text-muted-foreground hover:text-foreground" />
            </button>
          </div>
        ))}
      </div>
      <Button data-testid="button-carica-file" className="w-full gap-2" onClick={onUpload} disabled={uploadPending}>
        <Upload size={15} />
        {uploadPending ? "Caricamento..." : `Carica ${selectedFiles.length} file`}
      </Button>
    </div>
  );
}
