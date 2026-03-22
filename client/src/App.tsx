import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Sidebar } from "@/components/Sidebar";
import { CantieriPage } from "@/pages/CantieriPage";
import { GiornataPage } from "@/pages/GiornataPage";
import { USPage } from "@/pages/USPage";
import { UploadPage } from "@/pages/UploadPage";
import { QCPage } from "@/pages/QCPage";
import { ReportPage } from "@/pages/ReportPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import NotFound from "@/pages/not-found";

function AppLayout() {
  return (
    <Router hook={useHashLocation}>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/" component={CantieriPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/cantiere/:cid" component={GiornataPage} />
            <Route path="/cantiere/:cid/giornata/:gid" component={GiornataPage} />
            <Route path="/cantiere/:cid/us" component={USPage} />
            <Route path="/cantiere/:cid/upload" component={UploadPage} />
            <Route path="/cantiere/:cid/qc" component={QCPage} />
            <Route path="/cantiere/:cid/report" component={ReportPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
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
