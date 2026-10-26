import { DEFAULT_ANTHROPIC_MODEL } from "@shared/anthropic_models";

/** Modello Claude scelto dalle Impostazioni (ANTHROPIC_MODEL nel .env); letto a ogni chiamata. */
export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}
