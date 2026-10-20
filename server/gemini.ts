import { logger } from "./logger";

let cachedWorkingGeminiModel: string | null = null;

const DEFAULT_GEMINI_MODEL_CANDIDATES = [
  "gemini-flash-latest",
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

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(429|500|502|503|504)/.test(message) || /high demand|overloaded|quota/i.test(message);
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

async function listAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) throw new Error(`ListModels HTTP ${res.status}`);
  const data = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const names = (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(preview|exp|image|tts|live|thinking)/.test(n));
  // Versioni più recenti per prime (es. 3.0 > 2.5), a parità i "lite" per ultimi.
  return names.sort((a, b) => {
    const va = parseFloat(a.match(/gemini-([\d.]+)/)?.[1] || "0");
    const vb = parseFloat(b.match(/gemini-([\d.]+)/)?.[1] || "0");
    return vb - va || Number(a.includes("lite")) - Number(b.includes("lite"));
  });
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
      if (isModelNotFoundError(error) || isTransientError(error)) {
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

  // Tutti i candidati fissi sono falliti (modelli ritirati): chiede a Google i modelli
  // realmente disponibili per questa chiave e prova i "flash" che supportano generateContent.
  try {
    const tried = new Set(candidates);
    for (const modelName of await listAvailableGeminiModels(apiKey)) {
      if (tried.has(modelName)) continue;
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(fullPrompt);
        cachedWorkingGeminiModel = modelName;
        logger.info("Modello Gemini trovato via ListModels", { model: modelName });
        return result.response.text();
      } catch (error) {
        if (!isModelNotFoundError(error) && !isTransientError(error)) throw error;
        lastModelError = error;
      }
    }
  } catch (error) {
    if (!isModelNotFoundError(error)) {
      logger.warn("ListModels Gemini fallita", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const lastMessage = lastModelError instanceof Error ? lastModelError.message : String(lastModelError || "");
  throw new Error(
    `Nessun modello Gemini disponibile. Imposta GEMINI_MODEL con un modello valido. ${lastMessage}`.trim(),
  );
}

