import fs from "fs";
import type { ProjectDefinition } from "./projects";
import {
  elencoUsTemplatePath,
  elencoUsTemplateOriginalPath,
  writeElencoTemplateChoice,
} from "./elenco_us_template_path";
import { readDocumentXml, splitCellBlocks, splitCellTexts, splitRows, splitTables, extractCellText } from "./docx_xml_utils";
import { applyCellTokenEdits, type CellTokenEdit } from "./docx_template_rewrite";
import { knownFieldsForCantiere } from "./elenco_columns";
import { getCantiereTemplateFieldKeys } from "./docx_export";
import { findSimilarField, type SimilarFieldMatch } from "./field_similarity";

const META_KEYS = new Set<string>([
  "dataExport", "totaleUS",
  ...getCantiereTemplateFieldKeys(),
]);
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;
const RENAME_MIN_SCORE = 0.6;

export type UnknownPlaceholder = { key: string; suggestion: SimilarFieldMatch | null };

export type TemplateRepairPlan = {
  tag: string;
  /** Righe di tabella con placeholder poste DOPO il tag di chiusura del loop: verrebbero
   * stampate una sola volta invece che per ogni US. */
  orphanRows: string[];
  /** Placeholder (nel blocco loop o nelle righe orfane) che non corrispondono a un campo noto. */
  unknownPlaceholders: UnknownPlaceholder[];
  /** true se la riparazione sposterà il tag di chiusura per includere le righe orfane. */
  willMoveClose: boolean;
  /** Sostituzioni da applicare al template per ripararlo. */
  edits: CellTokenEdit[];
  needsRepair: boolean;
};

function rowText(rowXml: string): string {
  return splitCellTexts(rowXml).join(" ").replace(/\s+/g, " ").trim();
}

function placeholdersIn(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER_RE), (m) => m[1]);
}

/**
 * Analizza il template "Elenco US" e produce un piano di riparazione:
 * - individua le righe con placeholder rimaste fuori dal blocco {#tag}...{/tag}
 *   (tag di chiusura posizionato troppo presto);
 * - individua i placeholder che non corrispondono a nessun campo noto e propone il campo simile.
 * Restituisce null se non c'è un template o non contiene un blocco di loop tabellare.
 */
export async function analyzeElencoTemplate(
  project: ProjectDefinition,
  cantiere: { usModelKey?: string | null },
): Promise<TemplateRepairPlan | null> {
  const templatePath = elencoUsTemplatePath(project);
  if (!fs.existsSync(templatePath)) return null;

  const xml = await readDocumentXml(templatePath);
  const openRe = /\{#([a-zA-Z0-9_]+)\}/;

  let tag = "";
  let rows: string[] = [];
  let openIdx = -1;
  let closeIdx = -1;
  for (const tableXml of splitTables(xml)) {
    const trs = splitRows(tableXml);
    const oi = trs.findIndex((r) => openRe.test(rowText(r)));
    if (oi === -1) continue;
    const t = rowText(trs[oi]).match(openRe)?.[1];
    if (!t) continue;
    const closeRe = new RegExp(`\\{/${t}\\}`);
    const ci = trs.findIndex((r, j) => j >= oi && closeRe.test(rowText(r)));
    if (ci === -1) continue;
    tag = t;
    rows = trs;
    openIdx = oi;
    closeIdx = ci;
    break;
  }
  if (!tag) return null;

  // Righe orfane: dopo il tag di chiusura, ma ancora con placeholder dati.
  const orphanIdx: number[] = [];
  for (let r = closeIdx + 1; r < rows.length; r += 1) {
    if (placeholdersIn(rowText(rows[r])).length > 0) orphanIdx.push(r);
  }
  const lastBlockRow = orphanIdx.length > 0 ? orphanIdx[orphanIdx.length - 1] : closeIdx;

  // Tutti i placeholder del blocco "finale" (loop attuale + righe orfane assorbite).
  const blockKeys = new Set<string>();
  for (let r = openIdx; r <= lastBlockRow; r += 1) {
    for (const k of placeholdersIn(rowText(rows[r]))) blockKeys.add(k);
  }

  const knownFields = knownFieldsForCantiere(project, cantiere);
  const knownSet = new Set<string>([...knownFields.map((f) => f.key), ...Array.from(META_KEYS), tag]);
  const unknownPlaceholders: UnknownPlaceholder[] = [];
  const renames = new Map<string, string>();
  for (const key of Array.from(blockKeys)) {
    if (knownSet.has(key)) continue;
    const suggestion = findSimilarField(key, knownFields);
    unknownPlaceholders.push({ key, suggestion });
    if (suggestion && suggestion.score >= RENAME_MIN_SCORE && suggestion.key !== key) {
      renames.set(key, suggestion.key);
    }
  }

  // Costruzione edit.
  const edits: CellTokenEdit[] = [];
  const willMoveClose = orphanIdx.length > 0;
  let closeTargetKey: string | null = null;

  if (willMoveClose) {
    // rimuove il tag di chiusura dalla cella in cui si trova ora
    edits.push({ cellMustContain: `{/${tag}}`, from: `{/${tag}}`, to: "" });
    // cella bersaglio: la cella con placeholder più a destra dell'ultima riga orfana
    const lastOrphanRow = rows[orphanIdx[orphanIdx.length - 1]];
    const cellsText = splitCellBlocks(lastOrphanRow).map(extractCellText);
    for (let c = cellsText.length - 1; c >= 0; c -= 1) {
      const ph = placeholdersIn(cellsText[c]);
      if (ph.length > 0) { closeTargetKey = ph[ph.length - 1]; break; }
    }
  }

  for (const [oldKey, newKey] of Array.from(renames)) {
    if (oldKey === closeTargetKey) {
      edits.push({ cellMustContain: `{${oldKey}}`, from: `{${oldKey}}`, to: `{${newKey}}{/${tag}}` });
    } else {
      edits.push({ cellMustContain: `{${oldKey}}`, from: `{${oldKey}}`, to: `{${newKey}}` });
    }
  }
  if (closeTargetKey && !renames.has(closeTargetKey)) {
    edits.push({ cellMustContain: `{${closeTargetKey}}`, from: `{${closeTargetKey}}`, to: `{${closeTargetKey}}{/${tag}}` });
  }

  return {
    tag,
    orphanRows: orphanIdx.map((r) => rowText(rows[r])),
    unknownPlaceholders,
    willMoveClose,
    edits,
    needsRepair: edits.length > 0,
  };
}

/** Riepilogo leggibile delle riparazioni previste (per il dialog e per la scelta salvata). */
export function describeRepairs(plan: TemplateRepairPlan): string[] {
  const out: string[] = [];
  if (plan.willMoveClose) {
    out.push(
      `Il tag di chiusura del ciclo verrà spostato per includere ${plan.orphanRows.length} riga/e ` +
      `ora fuori dal blocco ripetuto (es. "${plan.orphanRows[0] || ""}").`,
    );
  }
  for (const u of plan.unknownPlaceholders) {
    if (u.suggestion && u.suggestion.score >= RENAME_MIN_SCORE) {
      out.push(`Campo {${u.key}} → {${u.suggestion.key}} (${u.suggestion.label}).`);
    } else {
      out.push(`Campo {${u.key}} non corrisponde a nessun campo noto: resterà vuoto nell'export.`);
    }
  }
  return out;
}

export async function repairElencoTemplate(
  project: ProjectDefinition,
  cantiere: { usModelKey?: string | null },
): Promise<{ applied: string[] }> {
  const plan = await analyzeElencoTemplate(project, cantiere);
  if (!plan || !plan.needsRepair) {
    writeElencoTemplateChoice(project, { mode: "repaired", repairs: [], decidedAt: new Date().toISOString() });
    return { applied: [] };
  }
  const templatePath = elencoUsTemplatePath(project);
  const originalPath = elencoUsTemplateOriginalPath(project);
  if (!fs.existsSync(originalPath)) fs.copyFileSync(templatePath, originalPath);

  await applyCellTokenEdits(templatePath, plan.edits);

  const applied = describeRepairs(plan);
  writeElencoTemplateChoice(project, { mode: "repaired", repairs: applied, decidedAt: new Date().toISOString() });
  return { applied };
}
