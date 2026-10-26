import { apiRequest } from "@/lib/queryClient";

export type StoricoEntityType =
  | "us"
  | "giornata"
  | "sas"
  | "ra"
  | "documentazione"
  | "periodo"
  | "persona"
  | "nodo"
  | "allegato"
  | "cantiere";

export type StoricoSource = "manuale" | "ai" | "import" | "sync" | "ripristino";

export type StoricoSummary = {
  id: string;
  entityType: StoricoEntityType;
  entityTypeLabel: string;
  entityId: number;
  cantiereId: number | null;
  label: string;
  action: "update" | "delete";
  source: StoricoSource;
  sourceLabel?: string;
  createdAt: string;
  updatedAt: string;
  changedFields: string[];
  relatedCount: number;
  restoredAt?: string;
};

export type StoricoField = {
  key: string;
  label: string;
  before: string;
  after: string;
  current: string;
  alreadyRestored: boolean;
};

export type StoricoDetail = StoricoSummary & { fields: StoricoField[]; exists: boolean };

export type StoricoRestoreResult = {
  ok: boolean;
  restored: string[];
  filesRecovered: number;
  action: "update" | "delete";
};

export const SOURCE_LABELS: Record<StoricoSource, string> = {
  manuale: "Modifica manuale",
  ai: "Assistente AI",
  import: "Importazione",
  sync: "Sincronizzazione",
  ripristino: "Ripristino",
};

export type StoricoListParams = {
  entityType?: StoricoEntityType;
  entityId?: number;
  cantiereId?: number;
  action?: "update" | "delete";
  limit?: number;
};

export async function fetchStorico(params: StoricoListParams): Promise<StoricoSummary[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) query.set(key, String(value));
  }
  const res = await apiRequest("GET", `/api/storico?${query.toString()}`);
  return (await res.json()).versions as StoricoSummary[];
}

export async function fetchStoricoDetail(id: string): Promise<StoricoDetail> {
  return (await apiRequest("GET", `/api/storico/${encodeURIComponent(id)}`)).json();
}

export async function restoreStorico(id: string, fields?: string[]): Promise<StoricoRestoreResult> {
  const res = await apiRequest("POST", `/api/storico/${encodeURIComponent(id)}/restore`, fields ? { fields } : {});
  return res.json();
}

/** Il server scrive nell'id anche il tipo di scheda, l'azione e l'origine: «us~12~<data>_update_ai». */
export function parseStoricoId(id: string): { type: string; entityId: number; action: string; source: string } {
  const [type = "", entityId = "0", name = ""] = id.split("~");
  const [, action = "", source = ""] = name.split("_");
  return { type, entityId: Number(entityId), action, source };
}

// ── Avviso «Annulla»: il server segnala in X-Storico-Ids le versioni create da ogni richiesta ──

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

export function subscribeStoricoChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let installed = false;

/** Intercetta le risposte dell'API per sapere quando una richiesta ha cambiato delle schede. */
export function installStoricoNotifier() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    const header = res.headers.get("x-storico-ids");
    if (header && res.ok) listeners.forEach((l) => l(header.split(",").filter(Boolean)));
    return res;
  };
}
