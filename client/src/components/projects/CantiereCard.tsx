import { CheckCircle2, FolderOpen, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectItem } from "@/components/projects/types";

type CantiereCardProps = {
  project: ProjectItem;
  isCurrent: boolean;
  presetLabel?: string;
  onOpenSchema: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  isSelecting: boolean;
};

export function CantiereCard({
  project,
  isCurrent,
  presetLabel,
  onOpenSchema,
  onOpenProject,
  isSelecting,
}: CantiereCardProps) {
  return (
    <Card className={isCurrent ? "border-primary/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{project.name}</CardTitle>
              <Badge variant="outline">{project.documentationMode === "iccd" ? "ICCD" : "Custom"}</Badge>
              {isCurrent && (
                <Badge className="gap-1">
                  <CheckCircle2 size={12} /> Attivo
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">{project.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onOpenSchema(project.id)}>
              <Settings2 size={13} /> Schema
            </Button>
            {!isCurrent && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                data-testid={`button-seleziona-progetto-${project.id}`}
                onClick={() => onOpenProject(project.id)}
                disabled={isSelecting}
              >
                <FolderOpen size={13} /> Apri
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-1">
        <div>
          <span className="font-medium text-foreground">Root:</span> {project.projectRoot}
        </div>
        <div>
          <span className="font-medium text-foreground">Database:</span> {project.dbPath}
        </div>
        <div>
          <span className="font-medium text-foreground">Media:</span> {project.mediaDir}
        </div>
        <div>
          <span className="font-medium text-foreground">Schema:</span> {presetLabel || project.schemaKey}
        </div>
        <div>
          <span className="font-medium text-foreground">Export mode:</span> {project.exportMode}
        </div>
      </CardContent>
    </Card>
  );
}
