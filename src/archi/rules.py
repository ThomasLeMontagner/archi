"""Language-independent rule engine (RL-01 through RL-04)."""

from collections import defaultdict, deque

from archi.config import Config, ConfigError
from archi.graph import owner
from archi.model import Diagnostic, Graph, stable_id


def _components(adjacency: dict[str, list[str]]) -> list[tuple[str, ...]]:
    """Iterative Kosaraju: avoid Python recursion limits on large graphs."""
    visited, order = set(), []
    for start in sorted(adjacency):
        if start in visited:
            continue
        visited.add(start)
        stack = [(start, iter(adjacency[start]))]
        while stack:
            node, children = stack[-1]
            target = next(children, None)
            if target is None:
                order.append(node)
                stack.pop()
            elif target not in visited:
                visited.add(target)
                stack.append((target, iter(adjacency[target])))
    reverse = defaultdict(list)
    for node, targets in adjacency.items():
        for target in targets:
            reverse[target].append(node)
    visited.clear()
    components = []
    for start in reversed(order):
        if start in visited:
            continue
        visited.add(start)
        pending, members = [start], []
        while pending:
            node = pending.pop()
            members.append(node)
            for target in reverse[node]:
                if target not in visited:
                    visited.add(target)
                    pending.append(target)
        if len(members) > 1:
            components.append(tuple(sorted(members)))
    return sorted(components)


def _cycle(members: tuple[str, ...], adjacency: dict[str, list[str]]) -> tuple[str, ...]:
    start, allowed = members[0], set(members)
    first = next(n for n in adjacency[start] if n in allowed)
    queue, previous = deque([first]), {first: None}
    while queue:
        node = queue.popleft()
        if node == start:
            route = []
            while node is not None:
                route.append(node)
                node = previous[node]
            return (start, *reversed(route))
        for target in adjacency[node]:
            if target in allowed and target not in previous:
                previous[target] = node
                queue.append(target)
    raise ValueError("Strongly connected component has no cycle")


def check_rules(graph: Graph, config: Config) -> list[Diagnostic]:
    nodes = {n.id: n for n in graph.nodes}
    diagnostics = []
    if config.no_cycles:
        group_edges = {(e.source, e.target): e for e in graph.edges if e.kind == "group_dependency"}
        adjacency = {n: [] for pair in group_edges for n in pair}
        for source, target in sorted(group_edges):
            if source != target:
                adjacency[source].append(target)
        for members in _components(adjacency):
            cycle = _cycle(members, adjacency)
            edges = [group_edges[pair] for pair in zip(cycle, cycle[1:])]
            diagnostics.append(Diagnostic(
                stable_id("diagnostic", "no-cycles", members), "no-cycles",
                "Package dependency cycle: " + " -> ".join(nodes[n].name for n in cycle), members,
                tuple(sorted({site for edge in edges for site in edge.evidence})),
                tuple(sorted(e.id for e in edges)), cycle))
    groups = defaultdict(set)
    for node in graph.nodes:
        if node.kind == "group":
            groups[node.name].add(node.id)
    for rule in config.forbidden:
        for name in (rule.source, rule.target):
            if name not in groups:
                raise ConfigError(f"Forbidden rule names unknown package/group: {name}")

        def matches(node_id: str, name: str) -> bool:
            current = owner(nodes[node_id], nodes)
            while current:
                if current in groups[name]:
                    return True
                if not rule.include_descendants:
                    return False
                current = nodes[current].parent_id
            return False

        for edge in graph.edges:
            if edge.kind == "imports" and matches(edge.source, rule.source) and matches(edge.target, rule.target):
                diagnostics.append(Diagnostic(
                    stable_id("diagnostic", "forbidden-dependency", rule.source, rule.target,
                              rule.include_descendants, edge.id), "forbidden-dependency",
                    f"Forbidden dependency {rule.source} -> {rule.target} "
                    f"(include-descendants={str(rule.include_descendants).lower()})",
                    (edge.source, edge.target), edge.evidence, (edge.id,)))
    return sorted(diagnostics, key=lambda d: d.id)
