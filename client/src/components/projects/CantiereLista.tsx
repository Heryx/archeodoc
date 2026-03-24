import { CantiereCard } from "@/components/projects/CantiereCard";
import type { ProjectItem, SchemaPresetSummary } from "@/components/projects/types";

type CantiereListaProps = {
  isLoading: boolean;
  projects: ProjectItem[];
  currentProjectId: string | null;
  schemaPresets: SchemaPresetSummary[];
  isSelecting: boolean;
  onOpenSchema: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
};

export function CantiereLista({
  isLoading,
  projects,
  currentProjectId,
  schemaPresets,
  isSelecting,
  onOpenSchema,
  onOpenProject,
}: CantiereListaProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((index) => (
          <div key={index} className="h-24 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
        <p className="font-medium">Nessun progetto disponibile</p>
        <p className="text-muted-foreground text-sm mt-1">Crea il primo progetto per iniziare</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => {
        const isCurrent = project.id === currentProjectId;
        const presetLabel = schemaPresets.find((item) => item.key === project.schemaKey)?.label;
        return (
          <CantiereCard
            key={project.id}
            project={project}
            isCurrent={isCurrent}
            presetLabel={presetLabel}
            onOpenSchema={onOpenSchema}
            onOpenProject={onOpenProject}
            isSelecting={isSelecting}
          />
        );
      })}
    </div>
  );
}
