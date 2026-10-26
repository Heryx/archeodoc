import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "./projects";

/** File di `ai_config/` con le indicazioni del progetto, nell'ordine in cui vanno date all'AI. */
const GUIDELINE_FILES: Array<{ file: string; title: string }> = [
  { file: "contesto.md", title: "Contesto del sito e metodologia" },
  { file: "schede.md", title: "Regole e convenzioni per le schede US" },
  { file: "stile.md", title: "Tono, lessico e convenzioni redazionali" },
];

const MAX_CHARS_PER_FILE = 4000;

/**
 * Indicazioni scritte dall'utente in `ai_config/` (Impostazioni → AI). Le righe segnaposto create
 * con il progetto («Descrivi qui…») non contano: se un file ne contiene solo quelle, viene saltato.
 */
export function readProjectAiGuidelines(project: ProjectDefinition): string {
  const sections: string[] = [];
  for (const { file, title } of GUIDELINE_FILES) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(project.aiConfigDir, file), "utf8");
    } catch {
      continue;
    }
    const cleaned = text
      .split(/\r?\n/)
      .filter((line) => !/^\s*Descrivi qui\b/i.test(line))
      .join("\n")
      .trim();
    if (!cleaned) continue;
    sections.push(`### ${title}\n${cleaned.slice(0, MAX_CHARS_PER_FILE)}`);
  }
  return sections.join("\n\n");
}
