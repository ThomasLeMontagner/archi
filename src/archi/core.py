"""Adapter-independent analysis pipeline."""

from pathlib import Path

from archi.adapter import Analyzer
from archi.python_analyzer import PythonAnalyzer
from archi.config import Config, load_config
from archi.graph import aggregate_dependencies
from archi.model import Graph
from archi.rules import check_rules


def analyze(path: str | Path, *, adapter: Analyzer | None = None, config: Config | None = None) -> Graph:
    root = Path(path).resolve()
    if not root.is_dir():
        raise ValueError(f"Target is not an existing directory: {path}")
    config = config if config is not None else load_config(root)
    graph = (adapter or PythonAnalyzer()).analyze(root, config)
    graph.edges = [e for e in graph.edges if e.kind != "group_dependency"]
    graph.edges.extend(aggregate_dependencies(graph.nodes, graph.edges))
    graph.diagnostics = check_rules(graph, config)
    graph.validate()
    return graph
