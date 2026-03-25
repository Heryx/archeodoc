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
