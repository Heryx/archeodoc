import fs from "fs";
import path from "path";
import type { ProjectDefinition } from "./projects";

/** Path del template DOCX tabellare "Elenco US" del cantiere. */
export function elencoUsTemplatePath(project: ProjectDefinition): string {
  return path.join(project.schedeDir, "template_elenco_us.docx");
}

/** Backup dell'originale creato prima di aggiungere colonne al template (per il ripristino). */
export function elencoUsTemplateOriginalPath(project: ProjectDefinition): string {
  return path.join(project.schedeDir, "template_elenco_us.original.docx");
}

/** File con la scelta dell'utente sulle colonne extra non presenti nel template. */
export function elencoUsTemplateChoicePath(project: ProjectDefinition): string {
  return path.join(project.schedeDir, "template_elenco_us.choice.json");
}

export type ElencoTemplateChoice = {
  /** "repaired" = il template è stato corretto automaticamente; "as-is" = si usa così com'è. */
  mode: "repaired" | "as-is";
  /** Riepilogo leggibile delle riparazioni applicate (solo per mode "repaired"). */
  repairs: string[];
  decidedAt: string;
};

export function readElencoTemplateChoice(project: ProjectDefinition): ElencoTemplateChoice | null {
  const p = elencoUsTemplateChoicePath(project);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ElencoTemplateChoice>;
    if (parsed?.mode !== "repaired" && parsed?.mode !== "as-is") return null;
    return {
      mode: parsed.mode,
      repairs: Array.isArray(parsed.repairs) ? parsed.repairs.filter((k): k is string => typeof k === "string") : [],
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeElencoTemplateChoice(project: ProjectDefinition, choice: ElencoTemplateChoice): void {
  fs.writeFileSync(elencoUsTemplateChoicePath(project), JSON.stringify(choice, null, 2), "utf8");
}

/** Rimuove backup e scelta (es. quando si carica/sostituisce/elimina il template). */
export function clearElencoTemplateChoice(project: ProjectDefinition): void {
  for (const p of [elencoUsTemplateChoicePath(project), elencoUsTemplateOriginalPath(project)]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}
