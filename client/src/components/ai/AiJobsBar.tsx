import { useEffect, useState } from "react";
import { Check, Clock, Loader2, Sparkles, Square, X, AlertTriangle } from "lucide-react";
import { cancelAiJob, dismissAiJob, useAiJobs, type AiJob } from "@/lib/aiJobs";
import { cn } from "@/lib/utils";

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function JobItem({ job, now }: { job: AiJob; now: number }) {
  const active = job.status === "running" || job.status === "queued";
  const elapsed = job.startedAt ? (job.finishedAt ?? now) - job.startedAt : 0;
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-1 text-xs",
        job.status === "error" && "border-destructive/50 bg-destructive/10",
        job.status === "done" && "border-emerald-500/40 bg-emerald-500/10",
        active && "border-border bg-background",
        job.status === "cancelled" && "border-border bg-muted text-muted-foreground",
      )}
      title={job.error || job.detail || job.label}
    >
      {job.status === "running" && <Loader2 size={13} className="shrink-0 animate-spin text-primary" />}
      {job.status === "queued" && <Clock size={13} className="shrink-0 text-muted-foreground" />}
      {job.status === "done" && <Check size={13} className="shrink-0 text-emerald-600" />}
      {job.status === "error" && <AlertTriangle size={13} className="shrink-0 text-destructive" />}
      {job.status === "cancelled" && <Square size={12} className="shrink-0" />}

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-tight">{job.label}</div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground">
          {job.status === "queued" && "In coda"}
          {job.status === "running" && (job.detail ? `${job.detail} · ` : "") + formatElapsed(elapsed)}
          {job.status === "done" && `Completato · ${formatElapsed(elapsed)}`}
          {job.status === "error" && (job.error || "Errore")}
          {job.status === "cancelled" && "Annullato"}
        </div>
        {job.status === "running" && (
          <div className="mt-0.5 h-1 overflow-hidden rounded bg-muted">
            {job.progress == null ? (
              <div className="h-full w-1/3 animate-[aijob-slide_1.2s_ease-in-out_infinite] rounded bg-primary" />
            ) : (
              <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${job.progress}%` }} />
            )}
          </div>
        )}
      </div>

      {active ? (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Annulla"
          onClick={() => cancelAiJob(job.id)}
        >
          <Square size={12} />
        </button>
      ) : (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Chiudi"
          onClick={() => dismissAiJob(job.id)}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** Barra in basso con l'avanzamento di tutte le operazioni IA in corso, in coda o appena concluse. */
export function AiJobsBar() {
  const jobs = useAiJobs();
  const [now, setNow] = useState(() => Date.now());
  const hasRunning = jobs.some((j) => j.status === "running");

  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  if (jobs.length === 0) return null;

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Sparkles size={12} className="text-primary" /> Operazioni IA
      </div>
      <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
        {jobs.map((job) => (
          <JobItem key={job.id} job={job} now={now} />
        ))}
      </div>
      <style>{`@keyframes aijob-slide { 0% { margin-left: -33%; } 100% { margin-left: 100%; } }`}</style>
    </div>
  );
}
