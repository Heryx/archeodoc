export type AiSettings = {
  geminiKeySet: boolean;
  anthropicKeySet: boolean;
  geminiKeyPreview: string;
  anthropicKeyPreview: string;
  aiProvider: "auto" | "gemini" | "claude";
  currentProvider: "gemini" | "claude" | "none";
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
