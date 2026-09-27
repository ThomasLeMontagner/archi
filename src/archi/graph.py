"""Aggregation depends only on the neutral node hierarchy (IR-02)."""

from collections import defaultdict
from dataclasses import replace

from archi.model import Edge, Node, stable_id


def owner(node: Node, nodes: dict[str, Node]) -> str:
    return node.id if node.kind == "group" else (node.parent_id or node.id)


def aggregate_dependencies(nodes: list[Node], edges: list[Edge], depth: int | None = None) -> list[Edge]:
    """Collapse edges to owning groups, or a depth below the root (root=0).

    Internal edges disappear. Count distinct statement sites, retaining links
    to every underlying import edge, even when one site imports many targets.
    """
    if depth is not None and depth < 0:
        raise ValueError("depth must be nonnegative")
    index = {n.id: n for n in nodes}

    def group(node_id: str) -> str:
        current = owner(index[node_id], index)
        if depth is None:
            return current
        chain = [current]
        while index[current].parent_id is not None:
            current = index[current].parent_id
            chain.append(current)
        chain.reverse()
        return chain[min(depth, len(chain) - 1)]

    sites, supporting = defaultdict(set), defaultdict(set)
    for edge in edges:
        if edge.kind != "imports":
            continue
        pair = group(edge.source), group(edge.target)
        if pair[0] == pair[1]:
            continue
        sites[pair].update(edge.evidence)
        supporting[pair].add(edge.id)
    return [Edge(stable_id("edge", "group_dependency", *pair), "group_dependency", *pair,
                 tuple(sorted(sites[pair])), tuple(sorted(supporting[pair]))) for pair in sorted(sites)]


def without_type_only(nodes: list[Node], edges: list[Edge]) -> list[Edge]:
    """Filter individual sites, then rebuild aggregate evidence and support IDs."""
    direct = [replace(edge, evidence=tuple(s for s in edge.evidence if not s.type_only))
              for edge in edges if edge.kind != "group_dependency"]
    direct = [edge for edge in direct if edge.evidence]
    return direct + aggregate_dependencies(nodes, direct)
