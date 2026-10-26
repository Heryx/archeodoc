export const ANTHROPIC_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Il più economico e veloce" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Equilibrio tra costo e qualità" },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Capace, costo medio-alto" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Il più capace, consuma di più" },
] as const;

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export function isValidAnthropicModelId(value: string): boolean {
  return /^claude-[a-z0-9.-]+$/i.test(value);
}
