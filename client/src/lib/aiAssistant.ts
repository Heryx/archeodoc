import { apiRequest } from "@/lib/queryClient";

export type AssistantChatRole = "user" | "assistant";
export type AssistantChatMessage = { role: AssistantChatRole; content: string };

export type AssistantSelectionItem = { id: number; codiceUS: string; reason?: string };

export type AssistantProposedEdit = {
  id: number;
  codiceUS: string;
  field: string;
  label: string;
  currentValue: string;
  newValue: string;
  reason?: string;
};

export type AssistantResult = {
  answer: string;
  selection: AssistantSelectionItem[];
  proposedEdits: AssistantProposedEdit[];
  truncated: boolean;
  contextInfo?: { total: number; included: number; filtered: boolean; first?: string; last?: string };
};

export type AssistantAskPayload = {
  prompt: string;
  history?: AssistantChatMessage[];
  pageContext?: string;
  giornataId?: number;
  /** Filtro esplicito sui codici US, es. "177-188, 200". */
  usRange?: string;
};

export async function askAssistant(
  cid: string | number,
  payload: AssistantAskPayload,
  signal?: AbortSignal,
): Promise<AssistantResult> {
  const res = await apiRequest("POST", `/api/cantieri/${cid}/ai-assistant`, payload, signal);
  return res.json();
}

export type AssistantApplyEdit = { id: number; field: string; value: string };

export type AssistantApplyResult = {
  applied: Array<{ id: number; field: string; codiceUS: string }>;
  failed: Array<{ id: number; field: string; error: string }>;
};

export async function applyAssistantEdits(
  cid: string | number,
  edits: AssistantApplyEdit[],
  conversationId?: string,
): Promise<AssistantApplyResult> {
  const res = await apiRequest("POST", `/api/cantieri/${cid}/ai-assistant/apply-edits`, { edits, conversationId });
  return res.json();
}
