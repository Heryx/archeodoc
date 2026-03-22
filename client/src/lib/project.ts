const PROJECT_STORAGE_KEY = "archeodoc.currentProjectId";

export function getCurrentProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PROJECT_STORAGE_KEY);
}

export function setCurrentProjectId(projectId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
}

export function clearCurrentProjectId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROJECT_STORAGE_KEY);
}

export function buildProjectUrl(url: string, projectId?: string | null): string {
  const pid = projectId ?? getCurrentProjectId();
  if (!pid) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(pid)}`;
}

export function getProjectHeader(): Record<string, string> {
  const pid = getCurrentProjectId();
  return pid ? { "x-project-id": pid } : {};
}
