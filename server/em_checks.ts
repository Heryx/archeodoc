/**
 * Controlli di coerenza su unita' virtuali e paradati del cantiere: cicli che
 * passano per le unita' virtuali e completezza dei paradati (fonti,
 * estrattori, combinatori, proprieta' con la loro provenienza).
 *
 * I cicli fra sole US restano nel QC delle US.
 */
import { normalizeUSCode } from "@shared/normalize_us_code";
import type { IStorage } from "./storage";
import { coveringCycles, type CycleEdge } from "./graph_cycles";
import { buildMatrixEdges } from "./matrix_export";
import { EM_VIRTUAL_TYPES, listEmNodes, loadEmGraph, type EmNodeView } from "./em_native";

export type EmCheckIssue = {
  livello: "error" | "warning" | "info";
  /** Nome del nodo interessato, se c'e' un nodo preciso. */
  nodo?: string;
  messaggio: string;
};

const EDGE_LABEL: Record<string, string> = {
  copre: "copre",
  taglia: "taglia",
  riempie: "riempie",
  appoggia: "si appoggia a",
  posteriore: "è posteriore a",
};

const natural = (a: string, b: string) => a.localeCompare(b, "it", { numeric: true });

export function checkParadati(storage: IStorage, cantiereId: number): EmCheckIssue[] {
  const usList = storage.getUSList(cantiereId);
  const nodes = listEmNodes(storage, cantiereId);
  const graph = loadEmGraph(storage, cantiereId);
  const issues: EmCheckIssue[] = [];
  const byUid = new Map(nodes.map((n) => [n.uid, n]));

  // ── Cicli che coinvolgono unita' virtuali ───────────────────────────────
  const usLabel = new Map<string, string>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (code) usLabel.set(`us:${normalizeUSCode(code)}`, code);
  }
  const label = (key: string) => (key.startsWith("em:") ? key.slice(3) : (usLabel.get(key) ?? key.slice(3)));
  const keyOfEnd = (end: { kind: "us" | "em"; ref: string }) => `${end.kind}:${end.ref}`;

  const edges: CycleEdge[] = [];
  for (const e of buildMatrixEdges(usList, "all")) {
    if (!e.directed) continue;
    edges.push({ from: `us:${normalizeUSCode(e.from)}`, to: `us:${normalizeUSCode(e.to)}`, label: EDGE_LABEL[e.type] ?? e.type });
  }
  for (const e of graph.edges) {
    if (e.edgeType !== "is_after") continue;
    const from = keyOfEnd(e.source);
    const to = keyOfEnd(e.target);
    // is_after: la sorgente sta sopra alla destinazione
    edges.push({ from, to, label: "sta sopra a" });
  }
  const isVirtualKey = (key: string) => key.startsWith("em:") && EM_VIRTUAL_TYPES.has(byUid.get(key.slice(3))?.nodeType ?? "");
  for (const cycle of coveringCycles(edges, (a, b) => natural(label(a), label(b)))) {
    const members = Array.from(new Set(cycle.map((e) => e.from)));
    if (!members.some(isVirtualKey)) continue; // solo US: lo segnala il QC delle US
    const shown = cycle.slice(0, 8).map((e) => `${label(e.from)} ${e.label} ${label(e.to)}`).join("; ");
    issues.push({
      livello: "error",
      nodo: members.filter(isVirtualKey).map(label)[0],
      messaggio:
        `Ciclo nella sequenza tra ${members.map(label).sort(natural).join(", ")} (${shown}${cycle.length > 8 ? "; ..." : ""}). ` +
        "Un'unità non può stare insieme sopra e sotto un'altra: correggi uno dei rapporti.",
    });
  }

  // ── Unita' virtuali ─────────────────────────────────────────────────────
  const hasSequence = (n: EmNodeView) => (n.links.sopraA?.length ?? 0) + (n.links.sottoA?.length ?? 0) > 0;
  for (const n of nodes) {
    if (EM_VIRTUAL_TYPES.has(n.nodeType) && !hasSequence(n)) {
      issues.push({
        livello: "warning",
        nodo: n.uid,
        messaggio: `${n.uid} non è collegata alla sequenza: indica sopra o sotto quale US o unità sta, altrimenti resta isolata nella matrix.`,
      });
    }
  }

  // ── Paradati ────────────────────────────────────────────────────────────
  const usedAsSource = new Set<string>(); // documenti/US da cui si estrae
  const usedExtractor = new Set<string>(); // estrattori usati da un combinatore o da una proprieta'
  const usedProvenance = new Set<string>(); // estrattori/combinatori usati come provenienza
  for (const n of nodes) {
    for (const f of n.links.fonti ?? []) usedAsSource.add(f);
    for (const x of n.links.estrattori ?? []) usedExtractor.add(x);
    for (const p of n.links.provenienza ?? []) usedProvenance.add(p);
  }
  for (const n of nodes) {
    if (n.nodeType === "property") {
      if (!(n.links.appartieneA?.length ?? 0)) {
        issues.push({ livello: "warning", nodo: n.uid, messaggio: `La proprietà ${n.uid} non appartiene a nessuna US, unità virtuale o documento.` });
      }
      if (!(n.links.provenienza?.length ?? 0)) {
        issues.push({
          livello: "warning",
          nodo: n.uid,
          messaggio: `La proprietà ${n.uid}${n.descrizione ? ` («${n.descrizione}»)` : ""} non ha provenienza: indica l'estrattore o il combinatore che la sostiene.`,
        });
      }
    } else if (n.nodeType === "extractor") {
      if (!(n.links.fonti?.length ?? 0)) {
        issues.push({ livello: "warning", nodo: n.uid, messaggio: `L'estrattore ${n.uid} non indica da quale fonte estrae.` });
      }
      if (!usedProvenance.has(n.uid) && !usedExtractor.has(n.uid)) {
        issues.push({ livello: "info", nodo: n.uid, messaggio: `L'estrattore ${n.uid} non è usato da nessuna proprietà né da un combinatore.` });
      }
    } else if (n.nodeType === "combiner") {
      if (!(n.links.estrattori?.length ?? 0)) {
        issues.push({ livello: "warning", nodo: n.uid, messaggio: `Il combinatore ${n.uid} non combina nessun estrattore.` });
      }
      if (!usedProvenance.has(n.uid)) {
        issues.push({ livello: "info", nodo: n.uid, messaggio: `Il combinatore ${n.uid} non è usato come provenienza da nessuna proprietà.` });
      }
    } else if (n.nodeType === "document" && !usedAsSource.has(n.uid)) {
      issues.push({ livello: "info", nodo: n.uid, messaggio: `Il documento ${n.uid} non è la fonte di nessun estrattore.` });
    }
  }

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return issues.sort((a, b) => rank[a.livello] - rank[b.livello] || natural(a.nodo ?? "", b.nodo ?? ""));
}
