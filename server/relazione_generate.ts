import { expectedUsPrefix, parseUsCode } from "@shared/us_code";
import type { Cantiere, Giornata, UnitaStratigrafica } from "@shared/schema";
import { AI_AVAILABLE, callAI } from "./ai";
import { getSetting } from "./ai_settings";
import type { PmNode } from "./relazione_export";

export type GenerateTestoInput = {
  cantiere: Cantiere;
  giornate: Giornata[]; // già filtrate e ordinate per data crescente
  usList: UnitaStratigrafica[]; // tutte le US del cantiere
  useAI: boolean;
  includiUS: boolean;
};

const MAX_AI_GIORNATE = 31;

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean);
  } catch { /* testo semplice */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Toglie spazi e punti finali (i campi del giornale spesso ne hanno già)
const trimEnd = (t: string) => t.replace(/[\s.]+$/, "").trim();

function usKey(codice: string, tipo: string | null | undefined): string | null {
  const parsed = parseUsCode(codice);
  if (!parsed) return null;
  return `${parsed.prefix ?? expectedUsPrefix(tipo)}:${Number(parsed.number)}`;
}

function usLabel(us: UnitaStratigrafica): string {
  const parsed = parseUsCode(us.codiceUS);
  if (!parsed) return us.codiceUS;
  const prefix = parsed.prefix ?? expectedUsPrefix(us.tipo);
  return prefix === "T" ? `T.${parsed.number}` : `${prefix} ${parsed.number}`;
}

function usMark(id: number) {
  return [{ type: "usLink", attrs: { usId: id } }];
}

// Trasforma un testo in nodi inline, collegando ogni US citata ("US 101", "T.12") a [[link]]
function linkify(text: string, index: Map<string, UnitaStratigrafica>): PmNode[] {
  const out: PmNode[] = [];
  const re = /\b(US|T|SB|SF)\.?\s?(\d{1,4})\b/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const us = index.get(`${m[1]}:${Number(m[2])}`);
    if (!us) continue;
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "text", text: m[0], marks: usMark(us.id) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.length ? out : [{ type: "text", text }];
}

const p = (children: PmNode[]): PmNode => ({ type: "paragraph", content: children });
const h = (level: number, text: string): PmNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

// ─── Senza IA: riepilogo strutturato giornata per giornata ────────────────────

function buildStructured(input: GenerateTestoInput, index: Map<string, UnitaStratigrafica>): PmNode[] {
  const out: PmNode[] = [];
  for (const g of input.giornate) {
    out.push(h(2, `Giornata del ${longDate(g.data)}`));

    const meta: string[] = [];
    if (g.settore) meta.push(`Settore: ${trimEnd(g.settore)}`);
    if (g.obiettivo) meta.push(`Obiettivo: ${trimEnd(g.obiettivo)}`);
    if (g.tipoScavo) meta.push(`Tipo di scavo: ${trimEnd(g.tipoScavo)}${g.escavatore ? ` (${trimEnd(g.escavatore)})` : ""}`);
    if (g.condMeteo) meta.push(`Condizioni meteo: ${trimEnd(g.condMeteo)}`);
    const archeologi = parseList(g.archeologi).map(trimEnd).filter(Boolean);
    const scavatori = parseList(g.scavatori || g.operatori).map(trimEnd).filter(Boolean);
    if (archeologi.length) meta.push(`Archeologi: ${archeologi.join(", ")}`);
    if (scavatori.length) meta.push(`Operai: ${scavatori.join(", ")}`);
    if (meta.length) out.push(p([{ type: "text", text: meta.join(". ") + "." }]));

    const narrativa = String(g.attivitaSvolta || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    for (const par of narrativa) out.push(p(linkify(par, index)));

    if (input.includiUS) {
      const usDelGiorno = input.usList.filter((u) => u.giornataId === g.id);
      if (usDelGiorno.length) {
        const children: PmNode[] = [{ type: "text", text: "US documentate: " }];
        usDelGiorno.forEach((u, i) => {
          if (i > 0) children.push({ type: "text", text: ", " });
          children.push({ type: "text", text: usLabel(u), marks: usMark(u.id) });
        });
        out.push(p(children));
      }
    }
  }
  return out;
}

// ─── Con IA: testo narrativo da relazione ─────────────────────────────────────

function aiSource(input: GenerateTestoInput): string {
  return input.giornate
    .map((g) => {
      const usDelGiorno = input.includiUS ? input.usList.filter((u) => u.giornataId === g.id) : [];
      const righe = [
        `### ${g.data}`,
        g.settore ? `Settore: ${g.settore}` : "",
        g.obiettivo ? `Obiettivo: ${g.obiettivo}` : "",
        g.tipoScavo ? `Scavo: ${g.tipoScavo}${g.escavatore ? ` (${g.escavatore})` : ""}` : "",
        g.condMeteo ? `Meteo: ${g.condMeteo}` : "",
        g.attivitaSvolta ? `Attività: ${g.attivitaSvolta}` : "",
        ...usDelGiorno.map((u) =>
          `- ${usLabel(u)} (${u.tipo || "tipo n.d."}): ${[u.definizione, u.interpretazione].filter(Boolean).join(" — ").slice(0, 220)}`,
        ),
      ];
      return righe.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

// Markdown minimale (titoli, elenchi, paragrafi) -> nodi dell'editor
function markdownToNodes(md: string, index: Map<string, UnitaStratigrafica>): PmNode[] {
  const out: PmNode[] = [];
  let list: PmNode | null = null;
  const clean = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").trim();
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      list = null;
      out.push(h(Math.min(Math.max(head[1].length, 2), 3), clean(head[2])));
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = { type: "bulletList", content: [] }; out.push(list); }
      list.content!.push({ type: "listItem", content: [p(linkify(clean(bullet[1]), index))] });
      continue;
    }
    list = null;
    out.push(p(linkify(clean(line), index)));
  }
  return out;
}

async function buildWithAI(input: GenerateTestoInput, index: Map<string, UnitaStratigrafica>): Promise<PmNode[]> {
  let systemPrompt = "Sei un archeologo professionista che redige relazioni tecniche per la committenza.";
  try { systemPrompt = getSetting("system_prompt") || systemPrompt; } catch { /* default */ }

  const prompt = `Redigi il testo di una relazione archeologica da consegnare alla ditta appaltante, a partire dal giornale di scavo seguente.

Cantiere: ${input.cantiere.nome}${input.cantiere.localita ? ` (${input.cantiere.localita})` : ""}
Committente: ${input.cantiere.committente || "n.d."}

Regole:
- Italiano formale, terza persona, tono tecnico e sobrio; niente formule enfatiche o conclusioni ridondanti.
- Usa SOLO le informazioni fornite: non inventare US, quote, materiali, misure o interpretazioni.
- Raggruppa le giornate per attività o area quando ha senso, invece di elencarle meccanicamente; indica le date.
- Cita le US sempre con il codice esatto come compare (es. "US 101", "T.12").
- Formato: titoli con "## ", paragrafi di prosa; elenchi "- " solo se servono davvero. Nessun titolo di primo livello, nessuna premessa o commento fuori dal testo.

GIORNALE DI SCAVO:
${aiSource(input)}`;

  const text = await callAI(prompt, 4000, systemPrompt);
  return markdownToNodes(text, index);
}

export async function generateRelazioneTesto(
  input: GenerateTestoInput,
): Promise<{ content: PmNode[]; warnings: string[] }> {
  const warnings: string[] = [];
  const index = new Map<string, UnitaStratigrafica>();
  for (const u of input.usList) {
    const key = usKey(u.codiceUS, u.tipo);
    if (key && !index.has(key)) index.set(key, u);
  }

  if (input.giornate.length === 0) throw new Error("Nessuna giornata nel periodo selezionato");

  if (input.useAI) {
    if (!AI_AVAILABLE) throw new Error("Nessun provider AI configurato");
    if (input.giornate.length > MAX_AI_GIORNATE) {
      warnings.push(`Usate le prime ${MAX_AI_GIORNATE} giornate su ${input.giornate.length}: restringi il periodo per il resto.`);
      input = { ...input, giornate: input.giornate.slice(0, MAX_AI_GIORNATE) };
    }
    return { content: await buildWithAI(input, index), warnings };
  }

  return { content: buildStructured(input, index), warnings };
}
