import { apiRequest } from "@/lib/queryClient";

export type AIFillSource = "descrizione" | "diario" | "entrambi";
export type AiFieldConfidence = "alta" | "media" | "bassa";

export type AiFieldSuggestion = {
  value: string | boolean | string[];
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

export async function applyAiFillFields(
  usId: number,
  fields: Record<string, string | boolean | string[]>,
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

