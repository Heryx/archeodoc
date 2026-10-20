import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId } from "@/lib/project";
import { resolveProjectCodeSettings, type ProjectCodeSettings } from "@shared/us_code";

/** Impostazioni codici US del progetto attivo (default se non ancora caricate). */
export function useProjectCodeSettings(): { projectId: string | null; settings: ProjectCodeSettings } {
  const { data } = useQuery<any>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });
  const projectId: string | null = getCurrentProjectId() || data?.currentProjectId || null;
  const project = data?.projects?.find((p: any) => p.id === projectId);
  return { projectId, settings: resolveProjectCodeSettings(project?.codeSettings) };
}
