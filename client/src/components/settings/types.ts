export type AiSettings = {
  geminiKeySet: boolean;
  anthropicKeySet: boolean;
  openaiKeySet: boolean;
  geminiKeyPreview: string;
  anthropicKeyPreview: string;
  openaiKeyPreview: string;
  aiProvider: "auto" | "gemini" | "claude" | "openai";
  currentProvider: "gemini" | "claude" | "openai" | "none";
  available: boolean;
};

export type AiPromptSetting = {
  key: string;
  value: string;
  label: string | null;
  description: string | null;
};

export type GoogleStatus = {
  hasCredentials: boolean;
  hasToken: boolean;
  credentialsPath: string;
  requiredScopes?: string[];
  missingScopes?: string[];
};
