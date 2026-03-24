import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadDropzoneProps = {
  onFilesAdded: (files: File[]) => void;
};

export function UploadDropzone({ onFilesAdded }: UploadDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files);
    if (picked.length === 0) return;
    onFilesAdded(picked);
  }

  return (
    <div
      className={cn("dropzone", dragActive && "active")}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        addFiles(event.dataTransfer.files);
      }}
      onClick={() => fileInputRef.current?.click()}
      data-testid="dropzone-upload"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => addFiles(event.target.files)}
      />
      <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
      <p className="font-medium">Trascina i file qui o clicca per selezionare</p>
      <p className="text-sm text-muted-foreground mt-1">Immagini, PDF, CSV, DXF, SVG - max 50 MB ciascuno</p>
    </div>
  );
}
