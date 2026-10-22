/**
 * Unita' virtuali e paradati gestiti in ArcheoDoc: unita' virtuali
 * e paradati (documenti, estrattori, combinatori, proprieta').
 *
 * I collegamenti si scrivono come elenchi di codici (US) o nomi (altri nodi) in
 * campi nominati per tipo di nodo; il salvataggio li traduce negli archi
 * `archi_paradati` e sostituisce solo quelli gestiti da quel campo.
 */
import type { ArcoParadati, NodoParadati, UnitaStratigrafica } from "@shared/schema";
import { normalizeUSCode } from "@shared/normalize_us_code";
import type { IStorage } from "./storage";

export const PARADATI_NODE_TYPES = ["uv_strutturale", "uv_non_strutturale", "reperto_virtuale", "documento", "estrattore", "combinatore", "proprieta"] as const;
export type ParadatiNodeType = (typeof PARADATI_NODE_TYPES)[number];

export const VIRTUAL_NODE_TYPES: ReadonlySet<string> = new Set(["uv_strutturale", "uv_non_strutturale", "reperto_virtuale"]);

export const NODE_TYPE_LABEL: Record<ParadatiNodeType, string> = {
  uv_strutturale: "Unità virtuale strutturale",
  uv_non_strutturale: "Unità virtuale non strutturale",
  reperto_virtuale: "Reperto virtuale",
  documento: "Documento",
  estrattore: "Estrattore",
  combinatore: "Combinatore",
  proprieta: "Proprietà",
};

const UID_PREFIX: Record<ParadatiNodeType, string> = {
  uv_strutturale: "UVS",
  uv_non_strutturale: "UVN",
  reperto_virtuale: "RV",
  documento: "DOC.",
  estrattore: "EST.",
  combinatore: "COMB.",
  proprieta: "PROP.",
};

export type LinkField = "sopraA" | "sottoA" | "fonti" | "estrattori" | "appartieneA" | "provenienza";

type EndSpec = { us: boolean; nodi: ReadonlyArray<ParadatiNodeType> };

type LinkSpec = {
  edgeType: string;
  /** out = questo nodo e' la sorgente dell'arco; in = ne e' la destinazione. */
  direction: "out" | "in";
  other: EndSpec;
  label: string;
};

const VIRTUAL_OR_US: EndSpec = { us: true, nodi: ["uv_strutturale", "uv_non_strutturale", "reperto_virtuale"] };

export const LINK_SPECS: Record<LinkField, LinkSpec> = {
  sopraA: { edgeType: "sequenza", direction: "out", other: VIRTUAL_OR_US, label: "Sta sopra a (più recente di)" },
  sottoA: { edgeType: "sequenza", direction: "in", other: VIRTUAL_OR_US, label: "Sta sotto a (più antica di)" },
  fonti: {
    edgeType: "estratto_da",
    direction: "out",
    other: { us: true, nodi: ["documento", "uv_strutturale", "uv_non_strutturale", "reperto_virtuale"] },
    label: "Estratto da (fonti)",
  },
  estrattori: { edgeType: "combina", direction: "out", other: { us: false, nodi: ["estrattore"] }, label: "Combina gli estrattori" },
  appartieneA: {
    edgeType: "ha_proprieta",
    direction: "in",
    other: { us: true, nodi: ["uv_strutturale", "uv_non_strutturale", "reperto_virtuale", "documento"] },
    label: "Proprietà di",
  },
  provenienza: {
    edgeType: "ha_provenienza",
    direction: "out",
    other: { us: false, nodi: ["estrattore", "combinatore"] },
    label: "Provenienza del dato",
  },
};

export const LINK_FIELDS_BY_TYPE: Record<ParadatiNodeType, LinkField[]> = {
  uv_strutturale: ["sopraA", "sottoA"],
  uv_non_strutturale: ["sopraA", "sottoA"],
  reperto_virtuale: ["sopraA", "sottoA"],
  documento: [],
  estrattore: ["fonti"],
  combinatore: ["estrattori"],
  proprieta: ["appartieneA", "provenienza"],
};

export class ParadatiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type NodeView = {
  id: number;
  uid: string;
  nodeType: ParadatiNodeType;
  nome: string | null;
  descrizione: string | null;
  dati: Record<string, unknown>;
  links: Partial<Record<LinkField, string[]>>;
};

export type NodeInput = {
  id?: number;
  nodeType?: string;
  uid?: string;
  nome?: string | null;
  descrizione?: string | null;
  dati?: Record<string, unknown>;
  /** Campi assenti restano invariati; un elenco vuoto li svuota. */
  links?: Partial<Record<LinkField, string[]>>;
};

const isNodeType = (value: unknown): value is ParadatiNodeType =>
  typeof value === "string" && (PARADATI_NODE_TYPES as readonly string[]).includes(value);

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

/** Proposta di nome per un nuovo nodo (es. UVS3, DOC.2, EST.1). */
export function suggestUid(nodeType: ParadatiNodeType, existing: NodoParadati[]): string {
  const prefix = UID_PREFIX[nodeType];
  const used = new Set(existing.map((n) => n.uid));
  let n = existing.filter((x) => x.nodeType === nodeType).length + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function listNodes(storage: IStorage, cantiereId: number): NodeView[] {
  const nodes = storage.getNodiParadati(cantiereId);
  const edges = storage.getArchiParadati(cantiereId);
  const usByKey = usIndex(storage.getUSList(cantiereId));
  const display = (kind: string, ref: string) => (kind === "us" ? (usByKey.get(ref)?.codiceUS ?? ref) : ref);

  return nodes.map((node) => {
    const type = node.nodeType as ParadatiNodeType;
    const links: Partial<Record<LinkField, string[]>> = {};
    for (const field of LINK_FIELDS_BY_TYPE[type] ?? []) {
      const spec = LINK_SPECS[field];
      links[field] = edges
        .filter((e) =>
          e.edgeType === spec.edgeType &&
          (spec.direction === "out"
            ? e.sourceKind === "nodo" && e.sourceRef === node.uid
            : e.targetKind === "nodo" && e.targetRef === node.uid),
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
  nodesByUid: Map<string, NodoParadati>,
): { kind: "us" | "nodo"; ref: string } {
  const text = raw.trim();
  const node = nodesByUid.get(text);
  if (node && spec.nodi.includes(node.nodeType as ParadatiNodeType)) return { kind: "nodo", ref: node.uid };
  if (spec.us) {
    const us = usByKey.get(usKey(text));
    if (us) return { kind: "us", ref: usKey(us.codiceUS) };
  }
  if (node) throw new ParadatiError(`"${text}" è un nodo di tipo ${node.nodeType}, non ammesso in questo collegamento`);
  throw new ParadatiError(`Nodo o US "${text}" non trovato nel cantiere`);
}

export function saveNode(storage: IStorage, cantiereId: number, input: NodeInput): NodeView {
  const nodes = storage.getNodiParadati(cantiereId);
  const existing = input.id ? nodes.find((n) => n.id === input.id) : undefined;
  if (input.id && !existing) throw new ParadatiError("Nodo non trovato", 404);

  const nodeType = existing ? (existing.nodeType as ParadatiNodeType) : input.nodeType;
  if (!isNodeType(nodeType)) throw new ParadatiError("Tipo di nodo non valido");
  if (existing && input.nodeType && input.nodeType !== existing.nodeType) {
    throw new ParadatiError("Il tipo di un nodo non si può cambiare");
  }

  const uid = (input.uid ?? existing?.uid ?? suggestUid(nodeType, nodes)).trim();
  if (!uid) throw new ParadatiError("Il nome del nodo è obbligatorio");
  if (nodes.some((n) => n.uid === uid && n.id !== existing?.id)) throw new ParadatiError(`Esiste già un nodo "${uid}"`, 409);
  const usByKey = usIndex(storage.getUSList(cantiereId));
  if (usByKey.has(usKey(uid))) throw new ParadatiError(`"${uid}" coincide con il codice di una US`, 409);

  const fields: Partial<NodoParadati> = {
    uid,
    nome: input.nome !== undefined ? input.nome?.trim() || null : (existing?.nome ?? null),
    descrizione:
      input.descrizione !== undefined ? input.descrizione?.trim() || null : (existing?.descrizione ?? null),
    dati: input.dati !== undefined ? JSON.stringify(input.dati) : (existing?.dati ?? null),
  };

  // Valida tutti i collegamenti prima di scrivere qualcosa.
  const nodesByUid = new Map(nodes.map((n) => [n.uid, n]));
  const resolved: Array<{ field: LinkField; refs: Array<{ kind: "us" | "nodo"; ref: string }> }> = [];
  for (const field of LINK_FIELDS_BY_TYPE[nodeType]) {
    const values = input.links?.[field];
    if (values === undefined) continue;
    const refs: Array<{ kind: "us" | "nodo"; ref: string }> = [];
    for (const raw of values) {
      if (!raw.trim()) continue;
      const found = resolveRef(raw, LINK_SPECS[field].other, usByKey, nodesByUid);
      if (found.kind === "nodo" && found.ref === uid) throw new ParadatiError("Un nodo non può collegarsi a se stesso");
      if (!refs.some((r) => r.kind === found.kind && r.ref === found.ref)) refs.push(found);
    }
    resolved.push({ field, refs });
  }

  let saved: NodoParadati;
  if (existing) {
    saved = storage.updateNodoParadati(existing.id, fields as any)!;
    if (uid !== existing.uid) {
      // il nome e' il riferimento negli archi: va propagato
      for (const e of storage.getArchiParadati(cantiereId)) {
        const touchesSource = e.sourceKind === "nodo" && e.sourceRef === existing.uid;
        const touchesTarget = e.targetKind === "nodo" && e.targetRef === existing.uid;
        if (!touchesSource && !touchesTarget) continue;
        storage.deleteArcoParadati(e.id);
        storage.createArcoParadati({
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
    saved = storage.createNodoParadati({ cantiereId, nodeType, ...fields } as any);
  }

  for (const { field, refs } of resolved) {
    const spec = LINK_SPECS[field];
    for (const e of storage.getArchiParadati(cantiereId)) {
      const mine =
        spec.direction === "out"
          ? e.sourceKind === "nodo" && e.sourceRef === saved.uid
          : e.targetKind === "nodo" && e.targetRef === saved.uid;
      if (e.edgeType === spec.edgeType && mine) storage.deleteArcoParadati(e.id);
    }
    for (const r of refs) {
      storage.createArcoParadati({
        cantiereId,
        edgeType: spec.edgeType,
        sourceKind: spec.direction === "out" ? "nodo" : r.kind,
        sourceRef: spec.direction === "out" ? saved.uid : r.ref,
        targetKind: spec.direction === "out" ? r.kind : "nodo",
        targetRef: spec.direction === "out" ? r.ref : saved.uid,
      });
    }
  }

  return listNodes(storage, cantiereId).find((n) => n.id === saved.id)!;
}

/**
 * Parti del grafo per matrix ed export: unita' virtuali con le loro
 * sequenze e archi di paradata, con le US indicate per codice.
 */
export type GraphParts = {
  nodes: NodoParadati[];
  edges: Array<{ edgeType: string; source: { kind: "us" | "nodo"; ref: string }; target: { kind: "us" | "nodo"; ref: string } }>;
};

export function loadGraph(storage: IStorage, cantiereId: number): GraphParts {
  return {
    nodes: storage.getNodiParadati(cantiereId),
    edges: storage.getArchiParadati(cantiereId).map((e: ArcoParadati) => ({
      edgeType: e.edgeType,
      source: { kind: e.sourceKind as "us" | "nodo", ref: e.sourceRef },
      target: { kind: e.targetKind as "us" | "nodo", ref: e.targetRef },
    })),
  };
}
