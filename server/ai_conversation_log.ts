import fs from "fs";
import path from "path";
import { logger } from "./logger";

// Backup delle conversazioni con l'assistente IA (JSON Lines, una voce per riga).
// Serve a ricostruire cosa è stato chiesto/proposto e cosa è stato poi applicato alle schede US.

export const AI_CONVERSATION_LOG_NAME = "assistant_conversations.jsonl";

export function aiConversationLogPath(project: { projectRoot: string }): string {
  return path.join(project.projectRoot, "ai_logs", AI_CONVERSATION_LOG_NAME);
}

export function appendAiConversationLog(
  project: { projectRoot: string },
  entry: Record<string, unknown>,
): void {
  try {
    const file = aiConversationLogPath(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf-8");
  } catch (error) {
    // Il log non deve mai bloccare l'assistente.
    logger.warn("Scrittura log conversazioni AI fallita", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
