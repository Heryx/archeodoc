import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { extractPathFromLocation, extractSearchFromLocation } from "@/lib/location";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project";
import {
  type LucideIcon,
  Layers,
  CalendarDays,
  Upload,
  ShieldCheck,
  FileText,
  Building2,
  FolderOpen,
  Sun,
  Moon,
  Settings,
  BarChart3,
  GitBranch,
  Package,
  BookOpenText,
  Map as MapIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  isActive: (path: string) => boolean;
};

function parseNumericParam(value: string | null): string | null {
  if (!value) return null;
  return /^\d+$/.test(value) ? value : null;
}

function panelFromValue(value: string | null): "settings" | "qc" | "stats" | "thesaurus" | "report" | null {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "settings" ||
    normalized === "qc" ||
    normalized === "stats" ||
    normalized === "thesaurus" ||
    normalized === "report"
  ) {
    return normalized;
  }
  return null;
}

export function Sidebar() {
  const [location] = useLocation();
  const cleanLocation = extractPathFromLocation(location);
  const { theme, toggle } = useTheme();
  const activeProjectId = getCurrentProjectId();

  const cantiereMatch = cleanLocation.match(/^\/cantiere\/(\d+)(?:\/giornata\/(\d+))?/);
  const cid = cantiereMatch?.[1] || null;
  const gidFromPath = parseNumericParam(cantiereMatch?.[2] || null);
  const search = extractSearchFromLocation(location);
  const params = new URLSearchParams(search);
  const currentPanel = panelFromValue(params.get("panel"));
  const gidFromQuery = parseNumericParam(params.get("giornataId"));
  const giornataContextId = gidFromPath || gidFromQuery;
  const giornataQuery = giornataContextId ? `?giornataId=${giornataContextId}` : "";
  const panelHref = (panel: "settings" | "qc" | "stats" | "thesaurus" | "report") => {
    const next = new URLSearchParams(search);
    if (currentPanel === panel) {
      next.delete("panel");
    } else {
      next.set("panel", panel);
    }
    const query = next.toString();
    return `${cleanLocation}${query ? `?${query}` : ""}`;
  };

  const { data: cantieri = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", activeProjectId],
    queryFn: async () => (await apiRequest("GET", "/api/cantieri")).json(),
  });

  const { data: projectsData } = useQuery<any>({
    queryKey: ["/api/projects"],
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    const serverProjectId = projectsData?.currentProjectId;
    if (serverProjectId && serverProjectId !== activeProjectId) {
      setCurrentProjectId(serverProjectId);
    }
  }, [projectsData?.currentProjectId, activeProjectId]);

  const cantiereCorrente = cid ? cantieri.find((c: any) => String(c.id) === cid) : null;
  const selectedProjectId = activeProjectId || projectsData?.currentProjectId;
  const currentProject = projectsData?.projects?.find((p: any) => p.id === selectedProjectId);

  const compilazioneItems: NavItem[] = cid
    ? [
        {
          href: giornataContextId ? `/cantiere/${cid}/giornata/${giornataContextId}` : `/cantiere/${cid}`,
          icon: CalendarDays,
          label: "Giornate",
          isActive: (path) => path === `/cantiere/${cid}` || path.startsWith(`/cantiere/${cid}/giornata/`),
        },
        {
          href: `/cantiere/${cid}/us${giornataQuery}`,
          icon: Layers,
          label: "Unita strat.",
          isActive: (path) => path === `/cantiere/${cid}/us` || path.startsWith(`/cantiere/${cid}/us/`),
        },
        {
          href: `/cantiere/${cid}/materiali${giornataQuery}`,
          icon: Package,
          label: "Materiali (RA)",
          isActive: (path) => path === `/cantiere/${cid}/materiali` || path.startsWith(`/cantiere/${cid}/materiali/`),
        },
      ]
    : [];

  const analisiItems: NavItem[] = cid
    ? [
        {
          href: `/cantiere/${cid}/matrix`,
          icon: GitBranch,
          label: "Harris Matrix",
          isActive: (path) => path === `/cantiere/${cid}/matrix` || path.startsWith(`/cantiere/${cid}/matrix/`),
        },
        {
          href: `/cantiere/${cid}/webmap`,
          icon: MapIcon,
          label: "WebMap",
          isActive: (path) => path === `/cantiere/${cid}/webmap` || path.startsWith(`/cantiere/${cid}/webmap/`),
        },
        {
          href: `/cantiere/${cid}/upload`,
          icon: Upload,
          label: "Carica doc.",
          isActive: (path) => path === `/cantiere/${cid}/upload` || path.startsWith(`/cantiere/${cid}/upload/`),
        },
        {
          href: panelHref("thesaurus"),
          icon: BookOpenText,
          label: "Thesaurus",
          isActive: (path) =>
            currentPanel === "thesaurus" ||
            path === `/cantiere/${cid}/thesaurus` ||
            path.startsWith(`/cantiere/${cid}/thesaurus/`),
        },
        {
          href: panelHref("qc"),
          icon: ShieldCheck,
          label: "QC check",
          isActive: (path) => currentPanel === "qc" || path === `/cantiere/${cid}/qc` || path.startsWith(`/cantiere/${cid}/qc/`),
        },
        {
          href: panelHref("report"),
          icon: FileText,
          label: "Report AI",
          isActive: (path) => currentPanel === "report" || path === `/cantiere/${cid}/report` || path.startsWith(`/cantiere/${cid}/report/`),
        },
        {
          href: panelHref("stats"),
          icon: BarChart3,
          label: "Statistiche",
          isActive: (path) => currentPanel === "stats" || path === `/cantiere/${cid}/stats` || path.startsWith(`/cantiere/${cid}/stats/`),
        },
      ]
    : [];

  return (
    <aside className="w-56 h-full flex flex-col border-r border-border bg-card shrink-0">
      <div className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <svg aria-label="ArcheoDoc" viewBox="0 0 32 32" width="28" height="28" fill="none">
            <rect x="4" y="20" width="24" height="4" rx="1" fill="currentColor" opacity="0.7" />
            <rect x="6" y="14" width="20" height="4" rx="1" fill="currentColor" opacity="0.55" />
            <rect x="9" y="8" width="14" height="4" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="12" y="3" width="8" height="4" rx="1" fill="currentColor" opacity="0.3" />
            <circle cx="16" cy="28" r="2" fill="hsl(var(--primary))" />
          </svg>
          <div>
            <div className="font-semibold text-sm leading-tight">ArcheoDoc</div>
            <div className="text-xs text-muted-foreground">Documentazione Scavo</div>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3 pb-2 border-b border-border/60">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Progetto dati</div>
        <Link
          href="/projects"
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            cleanLocation === "/projects" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground",
          )}
        >
          <FolderOpen size={15} />
          <span className="truncate">{currentProject?.name || "Gestisci progetti"}</span>
        </Link>
        <div className="px-2 pt-1 text-[11px] text-muted-foreground truncate">{currentProject?.projectRoot || "Nessun progetto attivo"}</div>
      </div>

      <div className="px-3 pt-3 pb-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Scavo</div>
        <Link
          href="/"
          data-testid="sidebar-cantieri-link"
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            cleanLocation === "/" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground",
          )}
        >
          <Building2 size={15} />
          <span className="truncate">Cantieri</span>
        </Link>
        {cid && (
          <div className="px-2 pt-2 text-xs text-muted-foreground">
            Attivo: <span className="font-medium text-foreground">{cantiereCorrente?.codice || `#${cid}`}</span>
            {giornataContextId && (
              <span className="ml-2">
                Giornata: <span className="font-medium text-foreground">#{giornataContextId}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {cid && (
        <nav className="px-3 pt-3 flex-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Compilazione</div>
          <ul className="space-y-0.5">
            {compilazioneItems.map(({ href, icon: Icon, label, isActive }) => {
              const active = isActive(cleanLocation);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-4 mb-1 px-2">
            Analisi e strumenti
          </div>
          <ul className="space-y-0.5">
            {analisiItems.map(({ href, icon: Icon, label, isActive }) => {
              const active = isActive(cleanLocation);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="px-3 pb-4 mt-auto border-t border-border pt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">v1.0</span>
        <div className="flex items-center gap-1">
          <Link
            href={panelHref("settings")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              currentPanel === "settings" || cleanLocation === "/impostazioni"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-label="Impostazioni"
            title="Impostazioni"
          >
            <Settings size={15} />
          </Link>
          <button
            onClick={toggle}
            data-testid="button-theme-toggle"
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cambia tema"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
