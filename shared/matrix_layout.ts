/**
 * Motore di layout della Harris Matrix, condiviso da client (vista a schermo)
 * e server (export PDF / SVG / DOCX).
 *
 * Schema a strati: livelli stratigrafici (longest-path), riordino baricentrico
 * per ridurre gli incroci, assegnazione delle x per allineare i nodi ai vicini.
 * Con `maxCols` i livelli troppo larghi vengono spezzati in piu' righe, cosi'
 * il disegno resta entro una larghezza massima (es. pagina A4 verticale).
 */

export type LayoutNodeInput = { key: string; label: string };
export type LayoutEdgeInput = { from: string; to: string; directed: boolean };

export type LayoutOptions = {
  nodeWidth: number;
  nodeHeight: number;
  xGap: number;
  yGap: number;
  /** Margine attorno al disegno (default 0). */
  margin?: number;
  /** Numero massimo di nodi per riga; i livelli piu' larghi vengono spezzati. */
  maxCols?: number;
};

export type LayoutPosition = {
  x: number;
  y: number;
  /** Livello stratigrafico (0 = in cima). Le US isolate stanno dopo l'ultimo. */
  level: number;
  /** Indice di riga nel disegno (un livello spezzato occupa piu' righe). */
  row: number;
};

export type LayoutRow = { keys: string[]; y: number; isolated: boolean };

export type LayoutResult = {
  positions: Map<string, LayoutPosition>;
  rows: LayoutRow[];
  width: number;
  height: number;
};

/** Ordinamento naturale: US 2 prima di US 10. */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "it", { numeric: true, sensitivity: "base" });
}

function computeLayers(keys: string[], directedEdges: LayoutEdgeInput[]): Map<string, number> {
  const layers = new Map<string, number>();
  for (const key of keys) layers.set(key, 0);

  // Longest-path layering: ogni US sta subito sotto la piu profonda che la copre.
  const maxIterations = Math.max(keys.length * 2, 1);
  for (let i = 0; i < maxIterations; i += 1) {
    let changed = false;
    for (const edge of directedEdges) {
      const fromLayer = layers.get(edge.from) ?? 0;
      const toLayer = layers.get(edge.to) ?? 0;
      if (fromLayer + 1 > toLayer) {
        layers.set(edge.to, fromLayer + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Compattazione: tira ogni nodo verso il basso, appena sopra il suo figlio
  // piu alto, cosi le US senza copertura non restano tutte sulla prima riga.
  const childrenLayers = new Map<string, number[]>();
  for (const edge of directedEdges) {
    const list = childrenLayers.get(edge.from) ?? [];
    list.push(layers.get(edge.to) ?? 0);
    childrenLayers.set(edge.from, list);
  }
  for (const key of keys) {
    const kids = childrenLayers.get(key);
    if (!kids || kids.length === 0) continue;
    const target = Math.min(...kids) - 1;
    if (target > (layers.get(key) ?? 0)) layers.set(key, target);
  }

  return layers;
}

/** Divide una lista in blocchi di dimensione quasi uguale, ciascuno <= maxCols. */
function splitBalanced<T>(items: T[], maxCols: number): T[][] {
  if (items.length <= maxCols) return [items];
  const chunks = Math.ceil(items.length / maxCols);
  const size = Math.ceil(items.length / chunks);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function layoutHarrisMatrix(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options: LayoutOptions,
): LayoutResult {
  const margin = options.margin ?? 0;
  const pitch = options.nodeWidth + options.xGap;
  const rowPitch = options.nodeHeight + options.yGap;
  const maxCols =
    options.maxCols && options.maxCols >= 1 ? Math.floor(options.maxCols) : Infinity;

  const labelOf = new Map(nodes.map((node) => [node.key, node.label]));
  const label = (key: string) => labelOf.get(key) ?? key;
  const byLabel = (a: string, b: string) => compareLabels(label(a), label(b)) || (a < b ? -1 : 1);

  const validEdges = edges.filter(
    (edge) => labelOf.has(edge.from) && labelOf.has(edge.to) && edge.from !== edge.to,
  );
  const connectedSet = new Set<string>();
  for (const edge of validEdges) {
    connectedSet.add(edge.from);
    connectedSet.add(edge.to);
  }
  const connected = nodes.map((n) => n.key).filter((key) => connectedSet.has(key));
  const isolated = nodes
    .map((n) => n.key)
    .filter((key) => !connectedSet.has(key))
    .sort(byLabel);

  const positions = new Map<string, LayoutPosition>();
  const rows: LayoutRow[] = [];
  const xPos = new Map<string, number>();

  if (connected.length > 0) {
    const layers = computeLayers(
      connected,
      validEdges.filter((edge) => edge.directed),
    );
    const byLayer = new Map<number, string[]>();
    for (const key of connected) {
      const layer = layers.get(key) ?? 0;
      const list = byLayer.get(layer) ?? [];
      list.push(key);
      byLayer.set(layer, list);
    }
    const layerKeys = Array.from(byLayer.keys()).sort((a, b) => a - b);
    for (const layer of layerKeys) byLayer.get(layer)!.sort(byLabel);

    const adjacency = new Map<string, string[]>();
    const pushAdj = (a: string, b: string) => {
      const list = adjacency.get(a) ?? [];
      list.push(b);
      adjacency.set(a, list);
    };
    for (const edge of validEdges) {
      pushAdj(edge.from, edge.to);
      pushAdj(edge.to, edge.from);
    }

    // Riordino baricentrico per ridurre gli incroci.
    const posOf = new Map<string, number>();
    const reindex = () => {
      for (const layer of layerKeys) {
        byLayer.get(layer)!.forEach((key, index) => posOf.set(key, index));
      }
    };
    reindex();
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const order = iteration % 2 === 0 ? layerKeys : [...layerKeys].reverse();
      for (const layer of order) {
        const layerNodes = byLayer.get(layer)!;
        const bary = new Map<string, number>();
        for (const key of layerNodes) {
          const values = (adjacency.get(key) ?? [])
            .map((other) => posOf.get(other))
            .filter((value): value is number => value !== undefined);
          bary.set(
            key,
            values.length ? values.reduce((s, v) => s + v, 0) / values.length : posOf.get(key) ?? 0,
          );
        }
        layerNodes.sort((a, b) => bary.get(a)! - bary.get(b)! || byLabel(a, b));
        reindex();
      }
    }

    // Righe: un livello piu' largo di maxCols si spezza in piu' righe.
    const layerRows: Array<{ layer: number; keys: string[] }> = [];
    for (const layer of layerKeys) {
      for (const chunk of splitBalanced(byLayer.get(layer)!, maxCols)) {
        layerRows.push({ layer, keys: chunk });
      }
    }

    // Ogni riga resta compatta (passo fisso) e scorre in orizzontale per
    // allinearsi ai vicini; la riga piu popolosa fa da ancora.
    for (const row of layerRows) {
      row.keys.forEach((key, index) => xPos.set(key, index * pitch));
    }
    let anchor = layerRows[0];
    for (const row of layerRows) {
      if (row.keys.length > anchor.keys.length) anchor = row;
    }
    const maxSpan = Number.isFinite(maxCols) ? (maxCols - 1) * pitch : Infinity;

    for (let pass = 0; pass < 8; pass += 1) {
      const order = pass % 2 === 0 ? layerRows : [...layerRows].reverse();
      for (const row of order) {
        if (row === anchor) continue;
        let shiftSum = 0;
        let shiftCount = 0;
        for (const key of row.keys) {
          const neighbours = (adjacency.get(key) ?? [])
            .map((other) => xPos.get(other))
            .filter((value): value is number => value !== undefined);
          if (!neighbours.length) continue;
          const target = neighbours.reduce((s, v) => s + v, 0) / neighbours.length;
          shiftSum += target - xPos.get(key)!;
          shiftCount += 1;
        }
        if (!shiftCount) continue;
        let shift = shiftSum / shiftCount;
        if (Number.isFinite(maxSpan)) {
          // La riga non deve uscire dalla fascia [0, maxSpan].
          const rowMin = Math.min(...row.keys.map((key) => xPos.get(key)!));
          const rowMax = Math.max(...row.keys.map((key) => xPos.get(key)!));
          shift = Math.max(-rowMin, Math.min(maxSpan - rowMax, shift));
        }
        for (const key of row.keys) xPos.set(key, xPos.get(key)! + shift);
      }
    }

    const minX = Math.min(...Array.from(xPos.values()));
    layerRows.forEach((row, rowIndex) => {
      const y = margin + rowIndex * rowPitch;
      rows.push({ keys: row.keys, y, isolated: false });
      for (const key of row.keys) {
        positions.set(key, {
          x: margin + xPos.get(key)! - minX,
          y,
          level: row.layer,
          row: rowIndex,
        });
      }
    });
  }

  // US senza relazioni: griglia in fondo, separata dal resto.
  if (isolated.length > 0) {
    const widest = rows.reduce((m, row) => Math.max(m, row.keys.length), 0);
    const cols = Number.isFinite(maxCols) ? maxCols : Math.max(widest, 8);
    const lastLevel = rows.length ? Math.max(...rows.map((r) => positions.get(r.keys[0])!.level)) : -1;
    const extraGap = rows.length ? options.yGap : 0;
    for (const chunk of splitBalanced(isolated, cols)) {
      const rowIndex = rows.length;
      const y = margin + rowIndex * rowPitch + extraGap;
      rows.push({ keys: chunk, y, isolated: true });
      chunk.forEach((key, index) => {
        positions.set(key, { x: margin + index * pitch, y, level: lastLevel + 1, row: rowIndex });
      });
    }
  }

  let maxRight = 0;
  let maxBottom = 0;
  positions.forEach((pos) => {
    maxRight = Math.max(maxRight, pos.x + options.nodeWidth);
    maxBottom = Math.max(maxBottom, pos.y + options.nodeHeight);
  });

  return { positions, rows, width: maxRight + margin, height: maxBottom + margin };
}
