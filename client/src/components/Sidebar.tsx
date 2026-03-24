import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { extractPathFromLocation, extractSearchFromLocation } from "@/lib/location";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project";
import { useToast } from "@/hooks/use-toast";
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
  RefreshCw,
  Download,
} from "lucide-react";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  isActive: (path: string) => boolean;
};

type UpdateCheckResponse = {
  checkedAt: string;
  gitAvailable: boolean;
  isRepo: boolean;
  hasUpdates: boolean;
  branch: string | null;
  behind: number;
  ahead: number;
  currentCommit: string | null;
  remoteCommit: string | null;
  remoteUrl: string | null;
  fetchError: string | null;
  message: string | null;
};

type UpdateApplyResponse = {
  ok: boolean;
  branch: string;
  pulled: boolean;
  beforeBehind: number;
  afterBehind: number;
  updatedCommits: number;
  message: string;
  restartRecommended: boolean;
  currentCommit: string | null;
  remoteCommit: string | null;
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
  const { toast } = useToast();
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

  // Costruisce l'href con il # esplicito per il corretto funzionamento con useHashLocation.
  // Con hash routing wouter legge solo ciò che sta dentro #/percorso?query,
  // quindi il ?panel= deve stare DENTRO il hash, non prima del #.
  const panelHrefFull = (panel: "settings" | "qc" | "stats" | "thesaurus" | "report") => {
    const next = new URLSearchParams(search);
    if (currentPanel === panel) {
      next.delete("panel");
    } else {
      next.set("panel", panel);
    }
    const query = next.toString();
    return `#${cleanLocation}${query ? `?${query}` : ""}`;
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

  const checkUpdates = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/app/updates/check")).json() as Promise<UpdateCheckResponse>,
    onSuccess: (data) => {
      if (!data.gitAvailable) {
        toast({
          title: "Git non disponibile",
          description: data.message || "Impossibile verificare aggiornamenti GitHub da questa installazione.",
          variant: "destructive",
        });
        return;
      }
      if (!data.isRepo) {
        toast({
          title: "Controllo non disponibile",
          description: data.message || "Questa installazione non e collegata a un repository Git.",
        });
        return;
      }
      if (data.fetchError) {
        toast({
          title: "Controllo aggiornamenti fallito",
          description: data.fetchError,
          variant: "destructive",
        });
        return;
      }
      if (data.hasUpdates) {
        toast({
          title: "Aggiornamenti disponibili",
          description: `${data.behind} commit disponibili su ${data.branch || "main"}.`,
        });
      } else {
        toast({
          title: "App aggiornata",
          description: `Nessun aggiornamento disponibile su ${data.branch || "main"}.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Errore controllo aggiornamenti",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const applyUpdates = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/app/updates/apply", {})).json() as Promise<UpdateApplyResponse>,
    onSuccess: (data) => {
      if (!data.ok) {
        toast({
          title: "Aggiornamento non completato",
          description: data.message,
          variant: "destructive",
        });
        return;
      }

      if (data.pulled) {
        toast({
          title: "Aggiornamento applicato",
          description: `${data.updatedCommits} commit scaricati. Riavvia l'app per applicare tutte le modifiche.`,
        });
      } else {
        toast({
          title: "Nessun aggiornamento da applicare",
          description: data.message,
        });
      }

      checkUpdates.mutate();
    },
    onError: (error: Error) => {
      toast({
        title: "Errore aggiornamento",
        description: error.message,
        variant: "destructive",
      });
    },
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
  const hasGitUpdates = checkUpdates.data?.hasUpdates === true;
  const updateButtonTitle = checkUpdates.isPending
    ? "Controllo aggiornamenti in corso..."
    : hasGitUpdates
      ? `Aggiornamenti disponibili (${checkUpdates.data?.behind || 0})`
      : "Controlla aggiornamenti GitHub";
  const applyButtonTitle = applyUpdates.isPending
    ? "Aggiornamento in corso..."
    : "Aggiorna ora (git pull --ff-only)";

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

  const analisiItems = cid
    ? [
        {
          href: `/cantiere/${cid}/matrix`,
          icon: GitBranch,
          label: "Harris Matrix",
          isActive: (path: string) => path === `/cantiere/${cid}/matrix` || path.startsWith(`/cantiere/${cid}/matrix/`),
          isPanel: false,
        },
        {
          href: `/cantiere/${cid}/webmap`,
          icon: MapIcon,
          label: "WebMap",
          isActive: (path: string) => path === `/cantiere/${cid}/webmap` || path.startsWith(`/cantiere/${cid}/webmap/`),
          isPanel: false,
        },
        {
          href: `/cantiere/${cid}/upload`,
          icon: Upload,
          label: "Carica doc.",
          isActive: (path: string) => path === `/cantiere/${cid}/upload` || path.startsWith(`/cantiere/${cid}/upload/`),
          isPanel: false,
        },
        {
          href: panelHrefFull("thesaurus"),
          icon: BookOpenText,
          label: "Thesaurus",
          isActive: (path: string) =>
            currentPanel === "thesaurus" ||
            path === `/cantiere/${cid}/thesaurus` ||
            path.startsWith(`/cantiere/${cid}/thesaurus/`),
          isPanel: true,
        },
        {
          href: panelHrefFull("qc"),
          icon: ShieldCheck,
          label: "QC check",
          isActive: (path: string) => currentPanel === "qc" || path === `/cantiere/${cid}/qc` || path.startsWith(`/cantiere/${cid}/qc/`),
          isPanel: true,
        },
        {
          href: panelHrefFull("report"),
          icon: FileText,
          label: "Report AI",
          isActive: (path: string) => currentPanel === "report" || path === `/cantiere/${cid}/report` || path.startsWith(`/cantiere/${cid}/report/`),
          isPanel: true,
        },
        {
          href: panelHrefFull("stats"),
          icon: BarChart3,
          label: "Statistiche",
          isActive: (path: string) => currentPanel === "stats" || path === `/cantiere/${cid}/stats` || path.startsWith(`/cantiere/${cid}/stats/`),
          isPanel: true,
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
            {analisiItems.map(({ href, icon: Icon, label, isActive, isPanel }) => {
              const active = isActive(cleanLocation);
              return (
                <li key={label}>
                  {isPanel ? (
                    // Pannelli laterali: usa <a> con href hash esplicito (#/percorso?panel=x)
                    <a
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
                    </a>
                  ) : (
                    // Pagine normali: usa wouter Link
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
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="px-3 pb-4 mt-auto border-t border-border pt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">v1.0</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => checkUpdates.mutate()}
            disabled={checkUpdates.isPending}
            data-testid="button-check-updates"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              hasGitUpdates
                ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              checkUpdates.isPending && "opacity-80",
            )}
            aria-label="Controlla aggiornamenti"
            title={updateButtonTitle}
          >
            <RefreshCw size={15} className={cn(checkUpdates.isPending && "animate-spin")} />
          </button>
          <button
            onClick={() => applyUpdates.mutate()}
            disabled={applyUpdates.isPending || !hasGitUpdates}
            data-testid="button-apply-updates"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              hasGitUpdates
                ? "text-emerald-700 hover:bg-emerald-500/15"
                : "text-muted-foreground/60",
              (applyUpdates.isPending || !hasGitUpdates) && "opacity-70",
            )}
            aria-label="Aggiorna ora"
            title={applyButtonTitle}
          >
            <Download size={15} className={cn(applyUpdates.isPending && "animate-pulse")} />
          </button>
          <a
            href={panelHrefFull("settings")}
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
          </a>
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
