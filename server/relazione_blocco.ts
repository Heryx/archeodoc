import type { Cantiere, Giornata, Periodo, RaRecord, SasRecord, UnitaStratigrafica } from "@shared/schema";
import { AI_AVAILABLE, callAI } from "./ai";
import { getSetting } from "./ai_settings";
import type { PmNode } from "./relazione_export";
import { buildStructured, buildUsIndex, markdownToNodes, usLabel } from "./relazione_generate";

// Fonti scelte per un blocco IA dell'editor
export type BloccoFonti = {
  us: "nessuna" | "tutte" | "selezione";
  usIds: number[];
  usSettore: string;
  usPeriodo: string;
  giornate: "nessuna" | "tutte" | "periodo" | "documento"; // "documento": il periodo del documento che contiene il blocco
  da: string | null;
  a: string | null;
  periodi: boolean;
  reperti: boolean;
  saggi: boolean;
};

export type GeneraBloccoInput = {
  cantiere: Cantiere;
  prompt: string;
  fonti: BloccoFonti;
  useAI: boolean;
  usList: UnitaStratigrafica[];
  giornate: Giornata[];
  periodi: Periodo[];
  reperti: RaRecord[];
  saggi: SasRecord[];
};

const MAX_US = 80;
const MAX_GIORNATE = 31;
const MAX_FIELD = 320;

const clip = (t: unknown, max = MAX_FIELD) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export function normalizeFonti(raw: any): BloccoFonti {
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  return {
    us: pick(raw?.us, ["nessuna", "tutte", "selezione"] as const, "nessuna"),
    usIds: Array.isArray(raw?.usIds) ? raw.usIds.map(Number).filter(Number.isFinite) : [],
    usSettore: String(raw?.usSettore || ""),
    usPeriodo: String(raw?.usPeriodo || ""),
    giornate: pick(raw?.giornate, ["nessuna", "tutte", "periodo", "documento"] as const, "nessuna"),
    da: date(raw?.da),
    a: date(raw?.a),
    periodi: raw?.periodi === true,
    reperti: raw?.reperti === true,
    saggi: raw?.saggi === true,
  };
}

// US scelte: quelle citate per codice nel prompt, più quelle indicate dalle fonti
function selectUs(input: GeneraBloccoInput, warnings: string[]): UnitaStratigrafica[] {
  const { fonti, usList, prompt } = input;
  const index = buildUsIndex(usList);
  const chosen = new Map<number, UnitaStratigrafica>();

  const re = /\b(US|T|SB|SF)\.?\s?(\d{1,4})\b/g;
  for (let m = re.exec(prompt); m; m = re.exec(prompt)) {
    const us = index.get(`${m[1]}:${Number(m[2])}`);
    if (us) chosen.set(us.id, us);
  }

  if (fonti.us === "selezione") {
    const ids = new Set(fonti.usIds);
    usList.filter((u) => ids.has(u.id)).forEach((u) => chosen.set(u.id, u));
  } else if (fonti.us === "tutte") {
    usList
      .filter((u) => !fonti.usSettore || u.settore === fonti.usSettore || u.area === fonti.usSettore)
      .filter((u) => !fonti.usPeriodo || [u.periodoIniziale, u.periodoFinale, u.periodoFase].includes(fonti.usPeriodo))
      .forEach((u) => chosen.set(u.id, u));
  }

  const list = Array.from(chosen.values()).sort((a, b) =>
    a.codiceUS.localeCompare(b.codiceUS, "it", { numeric: true }),
  );
  if (list.length > MAX_US) {
    warnings.push(`Usate le prime ${MAX_US} US su ${list.length}: restringi la selezione per il resto.`);
    return list.slice(0, MAX_US);
  }
  return list;
}

function usText(u: UnitaStratigrafica): string {
  const rel = (label: string, v: string | null) => (v && v.trim() ? `${label}: ${clip(v, 120)}` : "");
  return [
    `- ${usLabel(u)}${u.tipo ? ` (${u.tipo})` : ""}`,
    u.definizione && `definizione: ${clip(u.definizione)}`,
    u.descrizione && `descrizione: ${clip(u.descrizione)}`,
    u.interpretazione && `interpretazione: ${clip(u.interpretazione)}`,
    (u.settore || u.area) && `area/settore: ${clip(u.settore || u.area, 60)}`,
    u.quota != null && `quota: ${u.quota}`,
    u.consistenza && `consistenza: ${clip(u.consistenza, 80)}`,
    u.colore && `colore: ${clip(u.colore, 60)}`,
    u.misure && `misure: ${clip(u.misure, 100)}`,
    u.statoConservazione && `conservazione: ${clip(u.statoConservazione, 80)}`,
    u.materialiRinvenuti && `materiali: ${clip(u.materialiRinvenuti)}`,
    u.elementiDatanti && `elementi datanti: ${clip(u.elementiDatanti)}`,
    (u.datazione || u.epoca) && `datazione: ${clip(u.datazione || u.epoca, 100)}`,
    (u.periodoIniziale || u.periodoFase) && `periodo: ${clip(u.periodoFase || u.periodoIniziale, 80)}`,
    rel("copre", u.copre), rel("coperta da", u.coperto_da), rel("taglia", u.taglia), rel("tagliata da", u.tagliatoDa),
    rel("riempie", u.riempie), rel("riempita da", u.riempitoDa), rel("si lega a", u.si_lega_a), rel("uguale a", u.uguale_a),
    rel("si appoggia a", u.siAppoggia), rel("gli si appoggia", u.gliSiAppoggia),
  ].filter(Boolean).join("; ");
}

function giornataText(g: Giornata): string {
  return [
    `### ${g.data}`,
    g.settore && `Settore: ${g.settore}`,
    g.obiettivo && `Obiettivo: ${g.obiettivo}`,
    g.tipoScavo && `Scavo: ${g.tipoScavo}${g.escavatore ? ` (${g.escavatore})` : ""}`,
    g.condMeteo && `Meteo: ${g.condMeteo}`,
    g.attivitaSvolta && `Attività: ${clip(g.attivitaSvolta, 900)}`,
  ].filter(Boolean).join("\n");
}

function sourcesText(input: GeneraBloccoInput, us: UnitaStratigrafica[], giornate: Giornata[]): string {
  const parts: string[] = [];
  const { fonti } = input;
  if (us.length) parts.push(`UNITÀ STRATIGRAFICHE:\n${us.map(usText).join("\n")}`);
  if (giornate.length) parts.push(`GIORNALE DI SCAVO:\n${giornate.map(giornataText).join("\n\n")}`);
  if (fonti.periodi && input.periodi.length) {
    const rows = [...input.periodi]
      .sort((a, b) => a.ordine - b.ordine)
      .map((p) => `- ${p.nome}${p.descrizione ? `: ${clip(p.descrizione, 240)}` : ""}`);
    parts.push(`PERIODI (dal più antico):\n${rows.join("\n")}`);
  }
  if (fonti.reperti && input.reperti.length) {
    const usById = new Map(input.usList.map((u) => [u.id, u]));
    const rows = input.reperti.slice(0, 120).map((r) => {
      const u = r.usId != null ? usById.get(r.usId) : undefined;
      return `- ${r.codice}${r.tipo ? ` (${r.tipo})` : ""}${u ? `, da ${usLabel(u)}` : ""}${r.descrizione ? `: ${clip(r.descrizione, 160)}` : ""}`;
    });
    parts.push(`REPERTI:\n${rows.join("\n")}`);
  }
  if (fonti.saggi && input.saggi.length) {
    const rows = input.saggi.map((s) => `- ${s.codice}${s.nome ? ` ${s.nome}` : ""}${s.descrizione ? `: ${clip(s.descrizione, 240)}` : ""}`);
    parts.push(`SAGGI / SETTORI:\n${rows.join("\n")}`);
  }
  return parts.join("\n\n");
}

// Senza IA: i dati delle fonti elencati così come sono nelle schede
function structuredNodes(input: GeneraBloccoInput, us: UnitaStratigrafica[], giornate: Giornata[]): PmNode[] {
  const index = buildUsIndex(input.usList);
  const out: PmNode[] = [];
  const bullet = (items: PmNode[][]): PmNode => ({
    type: "bulletList",
    content: items.map((children) => ({ type: "listItem", content: [{ type: "paragraph", content: children }] })),
  });
  const text = (t: string): PmNode => ({ type: "text", text: t });

  if (us.length) {
    out.push(bullet(us.map((u) => {
      const desc = [u.definizione, u.descrizione, u.interpretazione].map((x) => clip(x, 400)).filter(Boolean).join(" ");
      return [{ type: "text", text: usLabel(u), marks: [{ type: "usLink", attrs: { usId: u.id } }] }, text(desc ? `: ${desc}` : "")];
    })));
  }
  if (giornate.length) {
    out.push(...buildStructured({ cantiere: input.cantiere, giornate, usList: input.usList, useAI: false, includiUS: false }, index));
  }
  if (input.fonti.periodi && input.periodi.length) {
    out.push(bullet([...input.periodi].sort((a, b) => a.ordine - b.ordine)
      .map((p) => [text(`${p.nome}${p.descrizione ? `: ${clip(p.descrizione, 300)}` : ""}`)])));
  }
  if (input.fonti.reperti && input.reperti.length) {
    out.push(bullet(input.reperti.slice(0, 120).map((r) =>
      [text(`${r.codice}${r.tipo ? ` (${r.tipo})` : ""}${r.descrizione ? `: ${clip(r.descrizione, 200)}` : ""}`)])));
  }
  if (input.fonti.saggi && input.saggi.length) {
    out.push(bullet(input.saggi.map((s) => [text(`${s.codice}${s.nome ? ` ${s.nome}` : ""}${s.descrizione ? `: ${clip(s.descrizione, 300)}` : ""}`)])));
  }
  return out;
}

export async function generaBlocco(input: GeneraBloccoInput): Promise<{ content: PmNode[]; warnings: string[] }> {
  const warnings: string[] = [];
  const us = selectUs(input, warnings);

  let giornate = input.giornate;
  if (giornate.length > MAX_GIORNATE) {
    warnings.push(`Usate le prime ${MAX_GIORNATE} giornate su ${giornate.length}: restringi il periodo per il resto.`);
    giornate = giornate.slice(0, MAX_GIORNATE);
  }

  const sources = sourcesText(input, us, giornate);
  if (!sources) throw new Error("Nessun dato nelle fonti scelte: indica almeno una fonte (US, giornate, periodi…) o cita le US nel prompt.");

  if (input.useAI && !AI_AVAILABLE) {
    warnings.push("Nessun provider IA configurato: inseriti i dati delle schede senza elaborazione.");
  }
  if (!input.useAI || !AI_AVAILABLE) {
    return { content: structuredNodes(input, us, giornate), warnings };
  }
  const instruction = input.prompt.trim();
  if (!instruction) throw new Error("Scrivi il prompt: che cosa deve contenere questa sezione?");

  let systemPrompt = "Sei un archeologo professionista che redige relazioni tecniche per la committenza.";
  try { systemPrompt = getSetting("system_prompt") || systemPrompt; } catch { /* default */ }

  const prompt = `Scrivi una sezione di una relazione archeologica da consegnare alla committenza, seguendo l'istruzione dell'autore e usando solo i dati forniti.

Cantiere: ${input.cantiere.nome}${input.cantiere.localita ? ` (${input.cantiere.localita})` : ""}
Committente: ${input.cantiere.committente || "n.d."}

ISTRUZIONE DELL'AUTORE:
${instruction}

Regole:
- Italiano formale, terza persona, tono tecnico e sobrio; niente formule enfatiche o conclusioni ridondanti.
- Usa SOLO le informazioni fornite: non inventare US, quote, materiali, misure, datazioni o interpretazioni. Se un dato richiesto manca, non citarlo.
- Cita le US sempre con il codice esatto come compare (es. "US 101", "T.12").
- Rispetta la lunghezza e la forma indicate nell'istruzione; se non sono indicate, scrivi prosa in uno o più paragrafi.
- Formato: paragrafi di prosa; titoli "## " solo se l'istruzione li chiede; elenchi "- " solo se servono davvero. Nessuna premessa o commento fuori dal testo.

DATI:
${sources}`;

  const text = await callAI(prompt, 3500, systemPrompt);
  const content = markdownToNodes(text, buildUsIndex(input.usList));
  if (!content.length) throw new Error("L'IA non ha restituito testo");
  return { content, warnings };
}
