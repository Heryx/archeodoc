import { FileArchive, FileText, Image } from "lucide-react";

const tipoIconMap: Record<string, any> = {
  foto: Image,
  planimetria: FileArchive,
  disegno: FileArchive,
  pdf: FileText,
  csv: FileText,
  altro: FileArchive,
};

type UploadFileIconProps = {
  tipo: string;
};

export function UploadFileIcon({ tipo }: UploadFileIconProps) {
  const Icon = tipoIconMap[tipo] || FileArchive;
  return <Icon size={14} className="text-muted-foreground" />;
}
