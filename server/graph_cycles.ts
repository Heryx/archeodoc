/**
 * Cicli in un grafo orientato di rapporti ("A sta sopra a B").
 *
 * Si cercano le componenti fortemente connesse (Tarjan); per ogni nodo
 * coinvolto si restituisce il ciclo piu' corto che lo contiene (BFS), cosi' una
 * contraddizione e' indicata con pochi rapporti anche in una componente grande.
 */

export type CycleEdge = { from: string; to: string; label: string };

/**
 * Un elenco di cicli (ciascuno e' la lista dei suoi archi) che copre tutti i
 * nodi appartenenti a un ciclo. `order` fissa l'ordine di visita dei nodi.
 */
export function coveringCycles(
  edges: CycleEdge[],
  order: (a: string, b: string) => number = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
): CycleEdge[][] {
  const outEdges = new Map<string, CycleEdge[]>();
  for (const e of edges) outEdges.set(e.from, [...(outEdges.get(e.from) ?? []), e]);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;
  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const e of outEdges.get(node) ?? []) {
      if (!index.has(e.to)) {
        visit(e.to);
        low.set(node, Math.min(low.get(node)!, low.get(e.to)!));
      } else if (onStack.has(e.to)) {
        low.set(node, Math.min(low.get(node)!, index.get(e.to)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) components.push(component);
    }
  };
  for (const node of Array.from(outEdges.keys())) if (!index.has(node)) visit(node);

  const shortestCycle = (start: string, members: Set<string>): CycleEdge[] | null => {
    const cameBy = new Map<string, CycleEdge>();
    const queue: string[] = [];
    const push = (from: string) => {
      for (const e of outEdges.get(from) ?? []) {
        if (!members.has(e.to) || cameBy.has(e.to)) continue;
        cameBy.set(e.to, e);
        queue.push(e.to);
      }
    };
    push(start);
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === start) break;
      push(queue[i]);
    }
    if (!cameBy.has(start)) return null;
    const path: CycleEdge[] = [];
    let node = start;
    do {
      const e = cameBy.get(node)!;
      path.unshift(e);
      node = e.from;
    } while (node !== start);
    return path;
  };

  const cycles: CycleEdge[][] = [];
  const covered = new Set<string>();
  for (const component of components) {
    const members = new Set(component);
    for (const node of [...component].sort(order)) {
      if (covered.has(node)) continue;
      const cycle = shortestCycle(node, members);
      if (!cycle) continue;
      for (const e of cycle) covered.add(e.from);
      cycles.push(cycle);
    }
  }
  return cycles;
}
