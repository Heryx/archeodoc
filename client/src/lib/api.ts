import { apiRequest } from "@/lib/queryClient";
import { getProjectHeader } from "@/lib/project";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export type AIFillSource = "descrizione" | "diario" | "entrambi" | "text";
export type AiFieldConfidence = "alta" | "media" | "bassa";

export type AiFieldSuggestion = {
  value: string | number | boolean | string[];
  confidence: AiFieldConfidence;
  source: string;
};

export type AiFillResult = Record<string, AiFieldSuggestion>;

export type AiFillSuggestionsResponse = {
  suggestions: AiFillResult;
  sourceUsed?: AIFillSource;
};

export type AiFillBatchItem = {
  usId: number;
  codiceUS: string;
  suggestions: AiFillResult;
};

export type AiFillBatchResponse = {
  results: AiFillBatchItem[];
  sourceUsed?: AIFillSource;
  total?: number;
};

export type USImportSource = "text" | "docx" | "google-doc";
export type USImportStatus = "ready" | "duplicate_existing";

export type USImportPreviewItem = {
  tempId: string;
  codiceUS: string;
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: number | null;
  quotaPianoCampagna: number | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
  schedaData: Record<string, string>;
  confidence: AiFieldConfidence;
  source: string;
  status: USImportStatus;
  reason?: string;
};

export type USImportPreview = {
  source: USImportSource;
  textLength: number;
  extractedCount: number;
  items: USImportPreviewItem[];
  warnings: string[];
};

export type USImportPreviewResponse = {
  mode: "preview";
  preview: USImportPreview;
  filename?: string;
  googleDocTitle?: string;
  googleDocRef?: string;
};

export type USImportApplyResponse = {
  mode: "applied";
  created: number;
  skipped: number;
  errors: string[];
  createdCodes: string[];
};

export type USImportApplyItem = {
  tempId: string;
  codiceUS: string;
  tipo: string | null;
  definizione: string | null;
  descrizione: string | null;
  interpretazione: string | null;
  quota: number | null;
  quotaPianoCampagna: number | null;
  settore: string | null;
  coperto_da: string | null;
  copre: string | null;
  si_lega_a: string | null;
  uguale_a: string | null;
  periodoIniziale: string | null;
  periodoFinale: string | null;
  materialiRinvenuti: string | null;
  campioni: string | null;
  schedaData: Record<string, string>;
};

export async function getAiFillSuggestions(
  usId: number,
  source: AIFillSource = "entrambi",
): Promise<AiFillSuggestionsResponse> {
  const response = await apiRequest("POST", `/api/us/${usId}/ai-fill`, { source });
  return response.json();
}

export async function getAiFillSuggestionsFromText(
  usId: number,
  text: string,
): Promise<AiFillSuggestionsResponse> {
  const response = await apiRequest("POST", `/api/us/${usId}/ai-fill`, { source: "text", text });
  return response.json();
}

export async function getAiFillSuggestionsFromDocx(
  usId: number,
  file: File,
): Promise<AiFillSuggestionsResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/us/${usId}/ai-fill-docx`, {
    method: "POST",
    headers: getProjectHeader(),
    body: formData,
  });

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

export async function getAiFillSuggestionsFromGoogleDoc(
  usId: number,
  url?: string,
): Promise<AiFillSuggestionsResponse> {
  const response = await apiRequest("POST", `/api/us/${usId}/ai-fill-google-doc`, {
    url: String(url || "").trim() || undefined,
  });
  return response.json();
}

export async function applyAiFillFields(
  usId: number,
  fields: Record<string, string | number | boolean | string[]>,
): Promise<{ us: unknown }> {
  const response = await apiRequest("POST", `/api/us/${usId}/ai-fill-apply`, { fields });
  return response.json();
}

export async function getAiFillBatch(
  giornataId: number,
  source: AIFillSource = "entrambi",
): Promise<AiFillBatchResponse> {
  const response = await apiRequest("POST", `/api/giornate/${giornataId}/ai-fill-us`, { source });
  return response.json();
}

export async function previewUsImportFromGiornataText(
  cantiereId: number,
  giornataId: number,
  text?: string,
): Promise<USImportPreviewResponse> {
  const response = await apiRequest("POST", `/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-text`, {
    text,
  });
  return response.json();
}

export async function previewUsImportFromGoogleDoc(
  cantiereId: number,
  giornataId: number,
  url?: string,
): Promise<USImportPreviewResponse> {
  const response = await apiRequest("POST", `/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-google-doc`, {
    url: String(url || "").trim() || undefined,
  });
  return response.json();
}

export async function previewUsImportFromDocx(
  cantiereId: number,
  giornataId: number,
  file: File,
): Promise<USImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-docx`, {
    method: "POST",
    headers: getProjectHeader(),
    body: formData,
  });

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

export async function applyUsImportFromJournal(
  cantiereId: number,
  giornataId: number,
  source: USImportSource,
  items: USImportApplyItem[],
): Promise<USImportApplyResponse> {
  const endpoint =
    source === "docx"
      ? `/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-docx`
      : source === "google-doc"
        ? `/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-google-doc`
        : `/api/cantieri/${cantiereId}/giornate/${giornataId}/import-us-from-text`;

  const response = await apiRequest("POST", endpoint, {
    confirm: true,
    items,
  });
  return response.json();
}
