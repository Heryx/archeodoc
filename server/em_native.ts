/**
 * Nodi Extended Matrix gestiti in ArcheoDoc: unita' virtuali (USVs, USVn, VSF)
 * e paradati (documenti, estrattori, combinatori, proprieta').
 *
 * I collegamenti si scrivono come elenchi di codici (US) o nomi (nodi EM) in
 * campi nominati per tipo di nodo; il salvataggio li traduce negli archi
 * `em_archi` e sostituisce solo quelli gestiti da quel campo.
 */
import type { EmArco, EmNodo, UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import type { IStorage } from "./storage";

export const EM_NODE_TYPES = ["USVs", "USVn", "VSF", "document", "extractor", "combiner", "property"] as const;
export type EmNodeType = (typeof EM_NODE_TYPES)[number];

export const EM_VIRTUAL_TYPES: ReadonlySet<string> = new Set(["USVs", "USVn", "VSF"]);

export const EM_TYPE_LABEL: Record<EmNodeType, string> = {
  USVs: "Unità virtuale strutturale (USVs)",
  USVn: "Unità virtuale non strutturale (USVn)",
  VSF: "Virtual special find (VSF)",
  document: "Documento",
  extractor: "Estrattore",
  combiner: "Combinatore",
  property: "Proprietà",
};

const UID_PREFIX: Record<EmNodeType, string> = {
  USVs: "USVs",
  USVn: "USVn",
  VSF: "VSF",
  document: "D.",
  extractor: "X.",
  combiner: "C.",
  property: "P.",
};

export type EmLinkField = "sopraA" | "sottoA" | "fonti" | "estrattori" | "appartieneA" | "provenienza";

type EndSpec = { us: boolean; em: ReadonlyArray<EmNodeType> };

type LinkSpec = {
  edgeType: string;
  /** out = questo nodo e' la sorgente dell'arco; in = ne e' la destinazione. */
  direction: "out" | "in";
  other: EndSpec;
  label: string;
};

const VIRTUAL_OR_US: EndSpec = { us: true, em: ["USVs", "USVn", "VSF"] };

export const EM_LINK_SPECS: Record<EmLinkField, LinkSpec> = {
  sopraA: { edgeType: "is_after", direction: "out", other: VIRTUAL_OR_US, label: "Sta sopra a (più recente di)" },
  sottoA: { edgeType: "is_after", direction: "in", other: VIRTUAL_OR_US, label: "Sta sotto a (più antica di)" },
  fonti: {
    edgeType: "extracted_from",
    direction: "out",
    other: { us: true, em: ["document", "USVs", "USVn", "VSF"] },
    label: "Estratto da (fonti)",
  },
  estrattori: { edgeType: "combines", direction: "out", other: { us: false, em: ["extractor"] }, label: "Combina gli estrattori" },
  appartieneA: {
    edgeType: "has_property",
    direction: "in",
    other: { us: true, em: ["USVs", "USVn", "VSF", "document"] },
    label: "Proprietà di",
  },
  provenienza: {
    edgeType: "has_data_provenance",
    direction: "out",
    other: { us: false, em: ["extractor", "combiner"] },
    label: "Provenienza del dato",
  },
};

export const EM_FIELDS_BY_TYPE: Record<EmNodeType, EmLinkField[]> = {
  USVs: ["sopraA", "sottoA"],
  USVn: ["sopraA", "sottoA"],
  VSF: ["sopraA", "sottoA"],
  document: [],
  extractor: ["fonti"],
  combiner: ["estrattori"],
  property: ["appartieneA", "provenienza"],
};

export class EmError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type EmNodeView = {
  id: number;
  uid: string;
  nodeType: EmNodeType;
  nome: string | null;
  descrizione: string | null;
  dati: Record<string, unknown>;
  links: Partial<Record<EmLinkField, string[]>>;
};

export type EmNodeInput = {
  id?: number;
  nodeType?: string;
  uid?: string;
  nome?: string | null;
  descrizione?: string | null;
  dati?: Record<string, unknown>;
  /** Campi assenti restano invariati; un elenco vuoto li svuota. */
  links?: Partial<Record<EmLinkField, string[]>>;
};

const isNodeType = (value: unknown): value is EmNodeType =>
  typeof value === "string" && (EM_NODE_TYPES as readonly string[]).includes(value);

function parseDati(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const usKey = (code: string) => normalizeUSCode(code);

function usIndex(usList: UnitaStratigrafica[]) {
  const byKey = new Map<string, UnitaStratigrafica>();
  for (const us of usList) {
    const code = us.codiceUS?.trim();
    if (code) byKey.set(usKey(code), us);
  }
  return byKey;
}

/** Proposta di nome per un nuovo nodo (es. USVs3, D.2, X.1). */
export function suggestUid(nodeType: EmNodeType, existing: EmNodo[]): string {
  const prefix = UID_PREFIX[nodeType];
  const used = new Set(existing.map((n) => n.uid));
  let n = existing.filter((x) => x.nodeType === nodeType).length + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function listEmNodes(storage: IStorage, cantiereId: number): EmNodeView[] {
  const nodes = storage.getEmNodi(cantiereId);
  const edges = storage.getEmArchi(cantiereId);
  const usByKey = usIndex(storage.getUSList(cantiereId));
  const display = (kind: string, ref: string) => (kind === "us" ? (usByKey.get(ref)?.codiceUS ?? ref) : ref);

  return nodes.map((node) => {
    const type = node.nodeType as EmNodeType;
    const links: Partial<Record<EmLinkField, string[]>> = {};
    for (const field of EM_FIELDS_BY_TYPE[type] ?? []) {
      const spec = EM_LINK_SPECS[field];
      links[field] = edges
        .filter((e) =>
          e.edgeType === spec.edgeType &&
          (spec.direction === "out"
            ? e.sourceKind === "em" && e.sourceRef === node.uid
            : e.targetKind === "em" && e.targetRef === node.uid),
        )
        .map((e) => (spec.direction === "out" ? display(e.targetKind, e.targetRef) : display(e.sourceKind, e.sourceRef)));
    }
    return {
      id: node.id,
      uid: node.uid,
      nodeType: type,
      nome: node.nome,
      descrizione: node.descrizione,
      dati: parseDati(node.dati),
      links,
    };
  });
}

function resolveRef(
  raw: string,
  spec: EndSpec,
  usByKey: Map<string, UnitaStratigrafica>,
  nodesByUid: Map<string, EmNodo>,
): { kind: "us" | "em"; ref: string } {
  const text = raw.trim();
  const node = nodesByUid.get(text);
  if (node && spec.em.includes(node.nodeType as EmNodeType)) return { kind: "em", ref: node.uid };
  if (spec.us) {
    const us = usByKey.get(usKey(text));
    if (us) return { kind: "us", ref: usKey(us.codiceUS) };
  }
  if (node) throw new EmError(`"${text}" è un nodo di tipo ${node.nodeType}, non ammesso in questo collegamento`);
  throw new EmError(`Nodo o US "${text}" non trovato nel cantiere`);
}

export function saveEmNode(storage: IStorage, cantiereId: number, input: EmNodeInput): EmNodeView {
  const nodes = storage.getEmNodi(cantiereId);
  const existing = input.id ? nodes.find((n) => n.id === input.id) : undefined;
  if (input.id && !existing) throw new EmError("Nodo non trovato", 404);

  const nodeType = existing ? (existing.nodeType as EmNodeType) : input.nodeType;
  if (!isNodeType(nodeType)) throw new EmError("Tipo di nodo non valido");
  if (existing && input.nodeType && input.nodeType !== existing.nodeType) {
    throw new EmError("Il tipo di un nodo non si può cambiare");
  }

  const uid = (input.uid ?? existing?.uid ?? suggestUid(nodeType, nodes)).trim();
  if (!uid) throw new EmError("Il nome del nodo è obbligatorio");
  if (nodes.some((n) => n.uid === uid && n.id !== existing?.id)) throw new EmError(`Esiste già un nodo "${uid}"`, 409);
  const usByKey = usIndex(storage.getUSList(cantiereId));
  if (usByKey.has(usKey(uid))) throw new EmError(`"${uid}" coincide con il codice di una US`, 409);

  const fields: Partial<EmNodo> = {
    uid,
    nome: input.nome !== undefined ? input.nome?.trim() || null : (existing?.nome ?? null),
    descrizione:
      input.descrizione !== undefined ? input.descrizione?.trim() || null : (existing?.descrizione ?? null),
    dati: input.dati !== undefined ? JSON.stringify(input.dati) : (existing?.dati ?? null),
  };

  // Valida tutti i collegamenti prima di scrivere qualcosa.
  const nodesByUid = new Map(nodes.map((n) => [n.uid, n]));
  const resolved: Array<{ field: EmLinkField; refs: Array<{ kind: "us" | "em"; ref: string }> }> = [];
  for (const field of EM_FIELDS_BY_TYPE[nodeType]) {
    const values = input.links?.[field];
    if (values === undefined) continue;
    const refs: Array<{ kind: "us" | "em"; ref: string }> = [];
    for (const raw of values) {
      if (!raw.trim()) continue;
      const found = resolveRef(raw, EM_LINK_SPECS[field].other, usByKey, nodesByUid);
      if (found.kind === "em" && found.ref === uid) throw new EmError("Un nodo non può collegarsi a se stesso");
      if (!refs.some((r) => r.kind === found.kind && r.ref === found.ref)) refs.push(found);
    }
    resolved.push({ field, refs });
  }

  let saved: EmNodo;
  if (existing) {
    saved = storage.updateEmNodo(existing.id, fields as any)!;
    if (uid !== existing.uid) {
      // il nome e' il riferimento negli archi: va propagato
      for (const e of storage.getEmArchi(cantiereId)) {
        const touchesSource = e.sourceKind === "em" && e.sourceRef === existing.uid;
        const touchesTarget = e.targetKind === "em" && e.targetRef === existing.uid;
        if (!touchesSource && !touchesTarget) continue;
        storage.deleteEmArco(e.id);
        storage.createEmArco({
          cantiereId,
          edgeType: e.edgeType,
          sourceKind: e.sourceKind,
          sourceRef: touchesSource ? uid : e.sourceRef,
          targetKind: e.targetKind,
          targetRef: touchesTarget ? uid : e.targetRef,
        });
      }
    }
  } else {
    saved = storage.createEmNodo({ cantiereId, nodeType, ...fields } as any);
  }

  for (const { field, refs } of resolved) {
    const spec = EM_LINK_SPECS[field];
    for (const e of storage.getEmArchi(cantiereId)) {
      const mine =
        spec.direction === "out"
          ? e.sourceKind === "em" && e.sourceRef === saved.uid
          : e.targetKind === "em" && e.targetRef === saved.uid;
      if (e.edgeType === spec.edgeType && mine) storage.deleteEmArco(e.id);
    }
    for (const r of refs) {
      storage.createEmArco({
        cantiereId,
        edgeType: spec.edgeType,
        sourceKind: spec.direction === "out" ? "em" : r.kind,
        sourceRef: spec.direction === "out" ? saved.uid : r.ref,
        targetKind: spec.direction === "out" ? r.kind : "em",
        targetRef: spec.direction === "out" ? r.ref : saved.uid,
      });
    }
  }

  return listEmNodes(storage, cantiereId).find((n) => n.id === saved.id)!;
}

/**
 * Parti del grafo EM per matrix ed export: unita' virtuali con le loro
 * sequenze (is_after) e archi di paradata, con le US indicate per codice.
 */
export type EmGraphParts = {
  nodes: EmNodo[];
  edges: Array<{ edgeType: string; source: { kind: "us" | "em"; ref: string }; target: { kind: "us" | "em"; ref: string } }>;
};

export function loadEmGraph(storage: IStorage, cantiereId: number): EmGraphParts {
  return {
    nodes: storage.getEmNodi(cantiereId),
    edges: storage.getEmArchi(cantiereId).map((e: EmArco) => ({
      edgeType: e.edgeType,
      source: { kind: e.sourceKind as "us" | "em", ref: e.sourceRef },
      target: { kind: e.targetKind as "us" | "em", ref: e.targetRef },
    })),
  };
}
