import { Suspense, lazy } from "react";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { extractPathFromLocation, extractSearchFromLocation } from "@/lib/location";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Sidebar } from "@/components/Sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CantieriPage } from "@/pages/CantieriPage";
import { GiornataPage } from "@/pages/GiornataPage";
import NotFound from "@/pages/not-found";

const USPage = lazy(async () => {
  const mod = await import("@/pages/USPage");
  return { default: mod.USPage };
});
const MaterialiPage = lazy(async () => {
  const mod = await import("@/pages/MaterialiPage");
  return { default: mod.MaterialiPage };
});
const MatrixPage = lazy(async () => {
  const mod = await import("@/pages/MatrixPage");
  return { default: mod.MatrixPage };
});
const UploadPage = lazy(async () => {
  const mod = await import("@/pages/UploadPage");
  return { default: mod.UploadPage };
});
const QCPage = lazy(async () => {
  const mod = await import("@/pages/QCPage");
  return { default: mod.QCPage };
});
const ReportPage = lazy(async () => {
  const mod = await import("@/pages/ReportPage");
  return { default: mod.ReportPage };
});
const ProjectsPage = lazy(async () => {
  const mod = await import("@/pages/ProjectsPage");
  return { default: mod.ProjectsPage };
});
const ImpostazioniPage = lazy(async () => {
  const mod = await import("@/pages/ImpostazioniPage");
  return { default: mod.ImpostazioniPage };
});
const StatsPage = lazy(async () => {
  const mod = await import("@/pages/StatsPage");
  return { default: mod.StatsPage };
});
const ThesaurusPage = lazy(async () => {
  const mod = await import("@/pages/ThesaurusPage");
  return { default: mod.ThesaurusPage };
});
const WebMapPage = lazy(async () => {
  const mod = await import("@/pages/WebMapPage");
  return { default: mod.WebMapPage };
});

type SidePanel = "settings" | "qc" | "stats" | "thesaurus" | "report";

function parsePanel(raw: string | null): SidePanel | null {
  const normalized = (raw || "").trim().toLowerCase();
  if (
    normalized === "settings" ||
    normalized === "qc" ||
    normalized === "stats" ||
    normalized === "thesaurus" ||
    normalized === "report"
  ) {
    return normalized as SidePanel;
  }
  return null;
}

function AppShell() {
  const [location] = useLocation();
  const cleanLocation = extractPathFromLocation(location);
  const search = extractSearchFromLocation(location);
  const params = new URLSearchParams(search);
  const panel = parsePanel(params.get("panel"));
  const cidMatch = cleanLocation.match(/^\/cantiere\/(\d+)/);
  const cid = cidMatch?.[1];

  function closePanel() {
    const next = new URLSearchParams(search);
    next.delete("panel");
    const qs = next.toString();
    // Naviga dentro il hash per evitare che i query params finiscano prima del #
    window.location.hash = `${cleanLocation}${qs ? `?${qs}` : ""}`;
  }

  const panelTitle =
    panel === "settings" ? "Impostazioni"
      : panel === "qc" ? "QC Check"
      : panel === "thesaurus" ? "Thesaurus"
      : panel === "report" ? "Report AI"
      : panel === "stats" ? "Statistiche"
      : "";

  const panelDescription =
    panel === "settings"
      ? "Configurazione applicativa e integrazioni."
      : panel === "qc"
        ? "Controlli di qualita su cantiere, giornata o singola US."
      : panel === "thesaurus"
          ? "Vocabolari controllati per i campi US."
        : panel === "report"
          ? "Generazione report giornalieri assistita da AI."
        : panel === "stats"
          ? "Panoramica sintetica del cantiere attivo."
          : "";

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Caricamento pagina...</div>}>
          <Switch>
            <Route path="/" component={CantieriPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/cantiere/:cid" component={GiornataPage} />
            <Route path="/cantiere/:cid/giornata/:gid" component={GiornataPage} />
            <Route path="/cantiere/:cid/us" component={USPage} />
            <Route path="/cantiere/:cid/materiali" component={MaterialiPage} />
            <Route path="/cantiere/:cid/matrix" component={MatrixPage} />
            <Route path="/cantiere/:cid/webmap" component={WebMapPage} />
            <Route path="/cantiere/:cid/upload" component={UploadPage} />
            <Route path="/cantiere/:cid/thesaurus">
              {() => <ThesaurusPage />}
            </Route>
            <Route path="/cantiere/:cid/qc">
              {() => <QCPage />}
            </Route>
            <Route path="/cantiere/:cid/report">
              {() => <ReportPage />}
            </Route>
            <Route path="/cantiere/:cid/stats">
              {() => <StatsPage />}
            </Route>
            <Route path="/impostazioni">
              {() => <ImpostazioniPage />}
            </Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>

      <Sheet open={!!panel} onOpenChange={(open) => { if (!open) closePanel(); }}>
        <SheetContent side="right" className="p-0 w-[92vw] sm:max-w-3xl">
          <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
            <SheetTitle>{panelTitle}</SheetTitle>
            <SheetDescription>{panelDescription}</SheetDescription>
          </SheetHeader>

          <div className="h-[calc(100%-72px)] overflow-y-auto">
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Caricamento pannello...</div>}>
              {panel === "settings" && <ImpostazioniPage embedded />}
              {panel === "qc" && <QCPage cidOverride={cid} embedded />}
              {panel === "thesaurus" && <ThesaurusPage embedded />}
              {panel === "report" && <ReportPage cidOverride={cid} embedded />}
              {panel === "stats" && <StatsPage cidOverride={cid} embedded />}
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AppLayout() {
  return (
    <Router hook={useHashLocation}>
      <AppShell />
    </Router>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppLayout />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
