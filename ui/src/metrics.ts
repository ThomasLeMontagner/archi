import { compareSites, siteKey, type Index } from "./graph";
import type { Edge, Graph, GraphNode, Site, ViewEdge } from "./types";

export interface PackageContributor {
  node: GraphNode;
  dependency: ViewEdge;
}

/** MET-01/02: fixed package-subtree boundary, independent of map projection. */
export function packageMetrics(graph: Graph, index: Index, packageId: string) {
  const node = index.nodes.get(packageId);
  if (!node || node.kind !== "group" || packageId === index.root) return null;
  const contained = new Set<string>();
  const pending = [packageId];
  while (pending.length) {
    const id = pending.pop()!;
    if (contained.has(id)) continue;
    contained.add(id);
    for (const child of index.children.get(id) ?? []) pending.push(child.id);
  }

  function owner(id: string): GraphNode | null {
    let current = index.nodes.get(id);
    while (current && current.kind !== "group")
      current = current.parent_id
        ? index.nodes.get(current.parent_id)
        : undefined;
    return current && current.id !== index.root ? current : null;
  }

  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  const ungroupedSites = new Map<string, Site>();
  for (const edge of index.edges) {
    const sourceInside = contained.has(edge.source);
    const targetInside = contained.has(edge.target);
    if (sourceInside === targetInside) continue;
    const peer = owner(sourceInside ? edge.target : edge.source);
    if (!peer) {
      for (const site of edge.evidence) ungroupedSites.set(siteKey(site), site);
      continue;
    }
    const direction = sourceInside ? outgoing : incoming;
    const edges = direction.get(peer.id) ?? [];
    edges.push(edge);
    direction.set(peer.id, edges);
  }

  function contributors(
    groups: Map<string, Edge[]>,
    incoming: boolean,
  ): PackageContributor[] {
    return [...groups]
      .map(([id, edges]) => {
        const source = incoming ? id : packageId;
        const target = incoming ? packageId : id;
        const sites = new Map<string, Site>();
        for (const edge of edges)
          for (const site of edge.evidence) sites.set(siteKey(site), site);
        return {
          node: index.nodes.get(id)!,
          dependency: {
            id: JSON.stringify(["package-metric", source, target]),
            source,
            target,
            evidence: [...sites.values()].sort(compareSites),
            underlying: [...edges].sort((a, b) => a.id.localeCompare(b.id)),
            cyclic: edges.some((e) => index.cycleEdges.has(e.id)),
          },
        };
      })
      .sort(
        (a, b) =>
          a.node.name.localeCompare(b.node.name) ||
          a.node.id.localeCompare(b.node.id),
      );
  }

  const total = incoming.size + outgoing.size;
  const excludedReferences = graph.unresolved.filter((r) =>
    contained.has(r.source),
  );
  return {
    incoming: contributors(incoming, true),
    outgoing: contributors(outgoing, false),
    instability: total ? outgoing.size / total : null,
    excluded: {
      external: excludedReferences.filter((r) => r.status === "external")
        .length,
      uncertain: excludedReferences.filter((r) => r.status === "uncertain")
        .length,
      unresolved: excludedReferences.filter((r) => r.status === "unresolved")
        .length,
    },
    ungroupedSites: [...ungroupedSites.values()].sort(compareSites),
    complete: graph.complete,
  };
}

export type PackageMetrics = NonNullable<ReturnType<typeof packageMetrics>>;
