import { useSyncExternalStore } from "react";

/**
 * Gestore globale dei job IA.
 *
 * Vive fuori dall'albero React: un job continua anche se la pagina o il pannello
 * (Sheet QC/Report, assistente) che l'ha lanciato viene chiuso. Gli stati sono
 * mostrati nella barra in basso (AiJobsBar).
 *
 * Politica di esecuzione:
 *  - stessa `key` => un solo job alla volta (una seconda richiesta identica viene ignorata);
 *  - job "batch" (report, QC IA, compilazioni): al massimo MAX_PARALLEL in contemporanea,
 *    gli altri restano "in coda" e partono appena si libera un posto
 *    (i provider IA locali/limitati reggono male molte richieste parallele);
 *  - job `interactive` (assistente chat): partono subito, non occupano posti in coda.
 */

export type AiJobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type AiJob = {
  id: number;
  key: string;
  label: string;
  status: AiJobStatus;
  /** 0..100 oppure null se indeterminato. */
  progress: number | null;
  detail?: string;
  error?: string;
  interactive: boolean;
  startedAt: number | null;
  finishedAt: number | null;
};

export type AiJobContext = {
  signal: AbortSignal;
  setProgress: (percent: number | null, detail?: string) => void;
};

export type StartAiJobOptions<T> = {
  /** Identificativo logico: impedisce duplicati contemporanei (es. "report-giornata:12"). */
  key: string;
  label: string;
  run: (ctx: AiJobContext) => Promise<T>;
  onSuccess?: (result: T) => void | Promise<void>;
  /** Non chiamato per annullamento volontario. */
  onError?: (err: any) => void;
  onCancel?: () => void;
  interactive?: boolean;
};

const MAX_PARALLEL = 2;
const FINISHED_TTL_MS = 8000;

type Internal = AiJob & {
  controller: AbortController;
  start: () => void;
  onCancel?: () => void;
};

let nextId = 1;
let jobs: Internal[] = [];
let snapshot: AiJob[] = [];
const listeners = new Set<() => void>();

function publish() {
  snapshot = jobs.map(({ controller: _c, start: _s, onCancel: _o, ...pub }) => pub);
  listeners.forEach((l) => l());
}

function pump() {
  const running = jobs.filter((j) => !j.interactive && j.status === "running").length;
  let free = MAX_PARALLEL - running;
  for (const j of jobs) {
    if (free <= 0) break;
    if (j.status === "queued") {
      j.start();
      free--;
    }
  }
}

function scheduleRemoval(job: Internal) {
  setTimeout(() => {
    jobs = jobs.filter((j) => j !== job);
    publish();
  }, job.status === "error" ? FINISHED_TTL_MS * 4 : FINISHED_TTL_MS);
}

export function isAiJobActive(key: string): boolean {
  return jobs.some((j) => j.key === key && (j.status === "queued" || j.status === "running"));
}

export function startAiJob<T>(opts: StartAiJobOptions<T>): number | null {
  if (isAiJobActive(opts.key)) return null;

  const controller = new AbortController();
  const job: Internal = {
    id: nextId++,
    key: opts.key,
    label: opts.label,
    status: "queued",
    progress: null,
    interactive: !!opts.interactive,
    startedAt: null,
    finishedAt: null,
    controller,
    onCancel: opts.onCancel,
    start: () => {
      job.status = "running";
      job.startedAt = Date.now();
      publish();
      const ctx: AiJobContext = {
        signal: controller.signal,
        setProgress: (percent, detail) => {
          if (job.status !== "running") return;
          job.progress = percent;
          if (detail !== undefined) job.detail = detail;
          publish();
        },
      };
      opts
        .run(ctx)
        .then(async (result) => {
          if (job.status === "cancelled") return;
          job.status = "done";
          job.progress = 100;
          job.finishedAt = Date.now();
          publish();
          try {
            await opts.onSuccess?.(result);
          } catch (e) {
            console.error("[aiJobs] onSuccess fallito", e);
          }
        })
        .catch((err: any) => {
          const aborted = err?.name === "AbortError" || controller.signal.aborted;
          job.finishedAt = Date.now();
          if (aborted) {
            job.status = "cancelled";
            opts.onCancel?.();
          } else {
            job.status = "error";
            job.error = err?.message || String(err);
            opts.onError?.(err);
          }
          publish();
        })
        .finally(() => {
          scheduleRemoval(job);
          publish();
          pump();
        });
    },
  };

  jobs = [...jobs, job];
  publish();
  if (job.interactive) job.start();
  else pump();
  return job.id;
}

export function cancelAiJob(id: number) {
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = Date.now();
    publish();
    job.onCancel?.();
    scheduleRemoval(job);
    return;
  }
  if (job.status === "running") job.controller.abort();
}

export function dismissAiJob(id: number) {
  jobs = jobs.filter((j) => !(j.id === id && j.status !== "running" && j.status !== "queued"));
  publish();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAiJobs(): AiJob[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/**
 * Sostituto di useMutation per le chiamate IA: stessa forma (`mutate`, `isPending`),
 * ma l'esecuzione passa dal gestore globale e sopravvive allo smontaggio del componente.
 * `prefix` raggruppa i job per calcolare `isPending`.
 */
export function useAiJobMutation<V, R>(opts: {
  prefix: string;
  keyOf: (vars: V) => string;
  labelOf: (vars: V) => string;
  run: (vars: V, ctx: AiJobContext) => Promise<R>;
  onSuccess?: (result: R, vars: V) => void | Promise<void>;
  onError?: (err: any, vars: V) => void;
}) {
  const isPending = useAiJobPrefixActive(opts.prefix);
  return {
    isPending,
    mutate: (vars: V) => {
      startAiJob<R>({
        key: opts.keyOf(vars),
        label: opts.labelOf(vars),
        run: (ctx) => opts.run(vars, ctx),
        onSuccess: (r) => opts.onSuccess?.(r, vars),
        onError: (e) => opts.onError?.(e, vars),
      });
    },
  };
}

// Risultati dei job conclusi, conservati finché non vengono letti/scartati
// (servono quando il pannello che li mostra era chiuso al momento del termine).
const results = new Map<string, unknown>();
const resultListeners = new Set<() => void>();

export function setAiJobResult(key: string, value: unknown | null) {
  if (value == null) results.delete(key);
  else results.set(key, value);
  resultListeners.forEach((l) => l());
}

export function useAiJobResult<T>(key: string): T | null {
  return useSyncExternalStore(
    (cb) => {
      resultListeners.add(cb);
      return () => resultListeners.delete(cb);
    },
    () => (results.has(key) ? (results.get(key) as T) : null),
    () => null,
  );
}

/** True se esiste un job attivo con la key indicata (per disabilitare i pulsanti). */
export function useAiJobActive(key: string): boolean {
  const list = useAiJobs();
  return list.some((j) => j.key === key && (j.status === "queued" || j.status === "running"));
}

/** True se esiste un job attivo la cui key inizia per il prefisso. */
export function useAiJobPrefixActive(prefix: string): boolean {
  const list = useAiJobs();
  return list.some((j) => j.key.startsWith(prefix) && (j.status === "queued" || j.status === "running"));
}
