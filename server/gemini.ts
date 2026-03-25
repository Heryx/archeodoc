import { logger } from "./logger";

let cachedWorkingGeminiModel: string | null = null;

const DEFAULT_GEMINI_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
] as const;

function isModelNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /\b404\b/.test(message) &&
    /models\//i.test(message) &&
    /(not found|not supported)/i.test(message)
  );
}

function uniqueModelCandidates(): string[] {
  const configuredModel = String(process.env.GEMINI_MODEL || "").trim();
  const list = [
    cachedWorkingGeminiModel || "",
    configuredModel,
    ...DEFAULT_GEMINI_MODEL_CANDIDATES,
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(list));
}

export async function generateWithGemini(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY non configurata");
  }

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const candidates = uniqueModelCandidates();

  let lastModelError: unknown = null;
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(fullPrompt);
      cachedWorkingGeminiModel = modelName;
      return result.response.text();
    } catch (error) {
      if (isModelNotFoundError(error)) {
        lastModelError = error;
        logger.warn("Modello Gemini non disponibile, provo fallback", {
          model: modelName,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      throw error;
    }
  }

  const lastMessage = lastModelError instanceof Error ? lastModelError.message : String(lastModelError || "");
  throw new Error(
    `Nessun modello Gemini disponibile. Imposta GEMINI_MODEL con un modello valido. ${lastMessage}`.trim(),
  );
}

