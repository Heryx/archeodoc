import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project";
import {
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
} from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const activeProjectId = getCurrentProjectId();

  // Estrai cantiere id corrente dall'URL
  const match = location.match(/\/cantiere\/(\d+)/);
  const cid = match ? match[1] : null;

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

  const navItems = cid
    ? [
        { href: `/cantiere/${cid}`, icon: CalendarDays, label: "Giornate" },
        { href: `/cantiere/${cid}/us`, icon: Layers, label: "Unita Strat." },
        { href: `/cantiere/${cid}/upload`, icon: Upload, label: "Carica Doc." },
        { href: `/cantiere/${cid}/qc`, icon: ShieldCheck, label: "QC Check" },
        { href: `/cantiere/${cid}/report`, icon: FileText, label: "Report AI" },
      ]
    : [];

  return (
    <aside className="w-56 h-full flex flex-col border-r border-border bg-card shrink-0">
      {/* Logo */}
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

      {/* Progetto dati */}
      <div className="px-3 pt-3 pb-2 border-b border-border/60">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Progetto dati</div>
        <Link
          href="/projects"
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            location === "/projects" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground",
          )}
        >
          <FolderOpen size={15} />
          <span className="truncate">{currentProject?.name || "Gestisci progetti"}</span>
        </Link>
        <div className="px-2 pt-1 text-[11px] text-muted-foreground truncate">{currentProject?.projectRoot || "Nessun progetto attivo"}</div>
      </div>

      {/* Link rapido alla lista cantieri */}
      <div className="px-3 pt-3 pb-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Scavo</div>
        <Link
          href="/"
          data-testid="sidebar-cantieri-link"
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            location === "/" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground",
          )}
        >
          <Building2 size={15} />
          <span className="truncate">Cantieri</span>
        </Link>
        {cid && (
          <div className="px-2 pt-2 text-xs text-muted-foreground">
            Attivo: <span className="font-medium text-foreground">{cantiereCorrente?.codice || `#${cid}`}</span>
          </div>
        )}
      </div>

      {/* Nav per cantiere selezionato */}
      {cid && (
        <nav className="px-3 pt-3 flex-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-2">Navigazione</div>
          <ul className="space-y-0.5">
            {navItems.map(({ href, icon: Icon, label }) => {
              const active = location === href || location.startsWith(href + "/");
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

      {/* Footer */}
      <div className="px-3 pb-4 mt-auto border-t border-border pt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">v1.0</span>
        <div className="flex items-center gap-1">
          <Link
            href="/impostazioni"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              location === "/impostazioni"
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

