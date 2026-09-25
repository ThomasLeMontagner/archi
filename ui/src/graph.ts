import type { Edge, Graph, GraphNode, Position, Site, ViewEdge } from "./types";

export const PAGE_SIZE = 9;
export const EDGE_LIMIT = 120;
export const siteKey = (s: Site) =>
  JSON.stringify([s.path, s.line, s.column, s.text]);
export const compareSites = (a: Site, b: Site) =>
  a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;

export function indexGraph(graph: Graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map<string, GraphNode[]>();
  const counts = new Map(
    graph.nodes.map((n) => [n.id, n.kind === "module" ? 1 : 0]),
  );
  for (const node of graph.nodes) {
    if (node.parent_id) {
      const siblings = children.get(node.parent_id) ?? [];
      siblings.push(node);
      children.set(node.parent_id, siblings);
    }
    if (node.kind === "module") {
      let parent = node.parent_id;
      while (parent) {
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
        parent = nodes.get(parent)?.parent_id ?? null;
      }
    }
  }
  const sort = (a: GraphNode, b: GraphNode) =>
    counts.get(b.id)! - counts.get(a.id)! ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id);
  for (const list of children.values()) list.sort(sort);
  const edges = graph.edges.filter((e) => e.kind === "imports");
  const edgeMap = new Map(graph.edges.map((e) => [e.id, e]));
  const cycleEdges = new Set<string>();
  const cycleNodes = new Set<string>();
  for (const diagnostic of graph.diagnostics.filter(
    (d) => d.rule_code === "no-cycles",
  )) {
    diagnostic.nodes.forEach((n) => cycleNodes.add(n));
    for (const id of diagnostic.edge_ids) {
      const edge = edgeMap.get(id);
      if (edge?.kind === "imports") cycleEdges.add(id);
      edge?.supporting_edges.forEach((e) => cycleEdges.add(e));
    }
  }
  return {
    nodes,
    children,
    counts,
    edges,
    edgeMap,
    cycleEdges,
    cycleNodes,
    root: graph.nodes.find((n) => n.parent_id === null)?.id ?? "",
  };
}
export type Index = ReturnType<typeof indexGraph>;

export function ancestors(id: string, index: Index): string[] {
  const chain: string[] = [];
  let current: string | null = id;
  while (current) {
    chain.unshift(current);
    current = index.nodes.get(current)?.parent_id ?? null;
  }
  return chain;
}

export function projectEdges(
  index: Index,
  scope: string,
  visible: GraphNode[],
): ViewEdge[] {
  const shown = new Set(visible.map((n) => n.id));
  const owners = new Map<string, string | null>();
  function owner(id: string): string | null {
    if (owners.has(id)) return owners.get(id)!;
    let current = index.nodes.get(id);
    while (current && current.parent_id !== scope)
      current = current.parent_id
        ? index.nodes.get(current.parent_id)
        : undefined;
    const result = current && shown.has(current.id) ? current.id : null;
    owners.set(id, result);
    return result;
  }
  const groups = new Map<
    string,
    {
      source: string;
      target: string;
      sites: Map<string, Site>;
      edges: Edge[];
      cyclic: boolean;
    }
  >();
  for (const edge of index.edges) {
    const source = owner(edge.source),
      target = owner(edge.target);
    if (!source || !target || source === target) continue;
    const id = JSON.stringify([source, target]);
    const group = groups.get(id) ?? {
      source,
      target,
      sites: new Map<string, Site>(),
      edges: [] as Edge[],
      cyclic: false,
    };
    edge.evidence.forEach((site) => group.sites.set(siteKey(site), site));
    group.edges.push(edge);
    group.cyclic ||= index.cycleEdges.has(edge.id);
    groups.set(id, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, g]) => ({
      id,
      source: g.source,
      target: g.target,
      evidence: [...g.sites.values()].sort(compareSites),
      underlying: g.edges,
      cyclic: g.cyclic,
    }));
}

export function layout(nodes: GraphNode[], edges: ViewEdge[], columns = 3) {
  // Bounded, deterministic SCC layout. No force simulation or animation loop.
  const adjacency = new Map(nodes.map((n) => [n.id, [] as string[]]));
  edges.forEach((e) => adjacency.get(e.source)?.push(e.target));
  const order = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    active = new Set<string>(),
    components: string[][] = [];
  function visit(id: string) {
    order.set(id, order.size);
    low.set(id, order.get(id)!);
    stack.push(id);
    active.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!order.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id)!, order.get(target)!));
    }
    if (low.get(id) === order.get(id)) {
      const members: string[] = [];
      let item: string;
      do {
        item = stack.pop()!;
        active.delete(item);
        members.push(item);
      } while (item !== id);
      components.push(members);
    }
  }
  nodes.forEach((n) => {
    if (!order.has(n.id)) visit(n.id);
  });
  const inputOrder = new Map(nodes.map((n, i) => [n.id, i]));
  components.forEach((members) =>
    members.sort((a, b) => inputOrder.get(a)! - inputOrder.get(b)!),
  );
  components.sort((a, b) => inputOrder.get(a[0])! - inputOrder.get(b[0])!);
  const positions = new Map<string, Position>();
  const width = Math.min(columns, Math.max(1, nodes.length));
  components.flat().forEach((id, i) => {
    positions.set(id, {
      x: 55 + (i % width) * 290,
      y: 65 + Math.floor(i / width) * 175,
    });
  });
  return {
    positions,
    width: Math.max(360, ...[...positions.values()].map((p) => p.x + 275)),
    height: Math.max(300, ...[...positions.values()].map((p) => p.y + 165)),
  };
}

export function edgePath(a: Position, b: Position, reverse: boolean) {
  const adjacent = b.x > a.x && b.x - a.x < 300 && a.y === b.y;
  if (adjacent) {
    const x1 = a.x + 218,
      x2 = b.x,
      y = a.y + 52;
    return { path: `M ${x1} ${y} L ${x2} ${y}`, x: (x1 + x2) / 2, y };
  }
  const x1 = a.x + 109,
    x2 = b.x + 109;
  if (a.y === b.y) {
    const bottom = b.x < a.x;
    const y = a.y + (bottom ? 104 : 0),
      bend = y + (bottom ? 43 : -35);
    return {
      path: `M ${x1} ${y} C ${x1} ${bend}, ${x1} ${bend}, ${(x1 + x2) / 2} ${bend} S ${x2} ${bend}, ${x2} ${y}`,
      x: (x1 + x2) / 2,
      y: bend,
    };
  }
  const down = b.y > a.y;
  const y1 = a.y + (down ? 104 : 0),
    y2 = b.y + (down ? 0 : 104);
  const middle = (y1 + y2) / 2,
    offset = reverse ? 24 : 0;
  // Put the badge near its importer, away from the midpoint where opposing
  // diagonal edges cross. Evaluate the same cubic used for the visible path.
  const t = 0.25,
    u = 1 - t;
  return {
    path: `M ${x1} ${y1} C ${x1 + offset} ${middle}, ${x2 + offset} ${middle}, ${x2} ${y2}`,
    x:
      u ** 3 * x1 +
      3 * u * u * t * (x1 + offset) +
      3 * u * t * t * (x2 + offset) +
      t ** 3 * x2,
    y: u ** 3 * y1 + 3 * u * t * middle + t ** 3 * y2,
  };
}
