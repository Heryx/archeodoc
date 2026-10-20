import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "./projects";

/** Path del template DOCX per un modello specifico o il template generico. */
export function usTemplatePath(project: ProjectDefinition, modelKey?: string): string {
  if (modelKey && modelKey !== "generic") {
    const safe = modelKey.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return path.join(project.schedeDir, `template_us_${safe}.docx`);
  }
  return path.join(project.schedeDir, "template_us.docx");
}

/**
 * Risolve il template DOCX migliore per l'export di una US:
 * 1. Template specifico del modello (template_us_{modelKey}.docx)
 * 2. Template generico (template_us.docx)
 * 3. null → usa export builtin
 */
export function resolveUSTemplatePath(project: ProjectDefinition, modelKey?: string): string | null {
  if (modelKey) {
    const perModel = usTemplatePath(project, modelKey);
    if (fs.existsSync(perModel)) return perModel;
  }
  const generic = usTemplatePath(project);
  if (fs.existsSync(generic)) return generic;
  return null;
}
