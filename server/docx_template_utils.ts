import fs from "fs";

/** Rileva tutti i placeholder ({tag}) presenti in un template DOCX tramite docxtemplater. */
export async function detectTemplatePlaceholders(templatePath: string): Promise<Record<string, unknown>> {
  const PizZip = (await import("pizzip")).default;
  const Docxtemplater = (await import("docxtemplater")).default;
  const InspectModule = (await import("docxtemplater/js/inspect-module.js")).default;
  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const iModule = new InspectModule();
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "", modules: [iModule] });
  doc.compile();
  return iModule.getAllTags();
}

/** Trasforma una chiave placeholder camelCase (es. "chkArtificiale", "codiceUS") in un'etichetta leggibile. */
export function humanizeFieldKey(key: string): string {
  return (
    key
      .replace(/^chk/, "")
      // Spazio solo al confine minuscola→maiuscola, per non separare sigle come "US" o "SABAP".
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || key
  );
}
