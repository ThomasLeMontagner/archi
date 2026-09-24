"""Version 1 language-neutral interchange model (IR-01, IR-03).

No absolute host paths, timestamps, or Python AST objects enter this model.
The strict decoder also serves as a dependency-free schema validator.
"""

from dataclasses import asdict, dataclass, fields, is_dataclass
import hashlib
import json
from pathlib import PurePosixPath
from types import UnionType
from typing import get_args, get_origin, get_type_hints

SCHEMA_VERSION = "1.0"


def stable_id(kind: str, *parts: object) -> str:
    content = json.dumps(parts, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return kind + ":" + hashlib.sha256(content.encode()).hexdigest()[:24]


@dataclass(frozen=True, order=True)
class Evidence:
    path: str
    line: int
    column: int
    text: str


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    name: str
    parent_id: str | None
    path: str


@dataclass(frozen=True)
class Edge:
    id: str
    kind: str
    source: str
    target: str
    evidence: tuple[Evidence, ...]
    supporting_edges: tuple[str, ...] = ()

    @property
    def count(self) -> int:
        return len(self.evidence)


@dataclass(frozen=True)
class UnresolvedImport:
    id: str
    source: str
    reference: str
    status: str
    reason: str
    evidence: Evidence
    candidates: tuple[str, ...] = ()


@dataclass(frozen=True)
class Issue:
    code: str
    path: str
    message: str
    line: int | None = None


@dataclass(frozen=True)
class Diagnostic:
    id: str
    rule_code: str
    message: str
    nodes: tuple[str, ...]
    evidence: tuple[Evidence, ...]
    edge_ids: tuple[str, ...]
    cycle: tuple[str, ...] = ()


@dataclass
class Graph:
    schema_version: str
    analyzer: dict[str, str]
    nodes: list[Node]
    edges: list[Edge]
    unresolved: list[UnresolvedImport]
    issues: list[Issue]
    diagnostics: list[Diagnostic]

    @property
    def complete(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict:
        data = asdict(self)
        for key in ("nodes", "edges", "unresolved", "diagnostics"):
            data[key].sort(key=lambda record: record["id"])
        data["issues"].sort(key=lambda x: (x["path"], x["line"] or 0, x["code"], x["message"]))
        for key in ("edges", "diagnostics"):
            for record in data[key]:
                record["evidence"] = sorted(record["evidence"], key=lambda e: (e["path"], e["line"], e["column"], e["text"]))
                if key == "edges":
                    record["count"] = len(record["evidence"])
        data["complete"] = self.complete
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, indent=2, ensure_ascii=True) + "\n"

    @classmethod
    def from_json(cls, content: str) -> "Graph":
        data = json.loads(content)
        if not isinstance(data, dict) or data.get("schema_version") != SCHEMA_VERSION:
            raise ValueError("Unsupported graph schema_version")
        complete = data.pop("complete", None)
        if type(complete) is not bool:
            raise ValueError("Graph.complete must be boolean")
        if not isinstance(data.get("edges"), list):
            raise ValueError("Graph.edges must be an array")
        for edge in data["edges"]:
            if not isinstance(edge, dict):
                raise ValueError("Edge must be an object")
            count = edge.pop("count", None)
            if (type(count) is not int or not isinstance(edge.get("evidence"), list)
                    or count != len(edge["evidence"])):
                raise ValueError("Edge count does not match evidence")
        graph = _decode(cls, data)
        if graph.complete != complete:
            raise ValueError("Graph.complete does not match analysis issues")
        graph.validate()
        return graph

    def validate(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError("Unsupported graph schema_version")
        nodes = {n.id: n for n in self.nodes}
        edges = {e.id: e for e in self.edges}
        for records in (self.nodes, self.edges, self.unresolved, self.diagnostics):
            if len({r.id for r in records}) != len(records):
                raise ValueError("Duplicate graph IDs")
        for node in self.nodes:
            _path(node.path)
            seen = {node.id}
            parent = node.parent_id
            while parent is not None:
                if parent not in nodes or parent in seen:
                    raise ValueError("Invalid node hierarchy")
                seen.add(parent)
                parent = nodes[parent].parent_id
        for edge in self.edges:
            if edge.source not in nodes or edge.target not in nodes:
                raise ValueError("Unknown edge endpoint")
            if any(ref not in edges or ref == edge.id for ref in edge.supporting_edges):
                raise ValueError("Unknown or self-referencing supporting edge")
            _evidence(edge.evidence)
        for record in self.unresolved:
            if (record.source not in nodes or record.status not in {"external", "unresolved", "uncertain"}
                    or any(n not in nodes for n in record.candidates)):
                raise ValueError("Invalid unresolved reference")
            _evidence((record.evidence,))
        for issue in self.issues:
            _path(issue.path)
            if issue.line is not None and issue.line < 1:
                raise ValueError("Invalid issue line")
        for diagnostic in self.diagnostics:
            if (any(n not in nodes for n in diagnostic.nodes + diagnostic.cycle)
                    or any(e not in edges for e in diagnostic.edge_ids)):
                raise ValueError("Invalid diagnostic references")
            _evidence(diagnostic.evidence)


def _path(value: str) -> None:
    if (not value or PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts
            or "\\" in value or ":" in value):
        raise ValueError("Graph paths must be relative POSIX paths")


def _evidence(items: tuple[Evidence, ...]) -> None:
    for item in items:
        _path(item.path)
        if item.line < 1 or item.column < 0:
            raise ValueError("Invalid source location")


def _decode(expected: type, value):
    """Decode JSON using the public dataclasses as the normative v1 schema."""
    origin, args = get_origin(expected), get_args(expected)
    if origin is UnionType:
        for choice in args:
            try:
                return _decode(choice, value)
            except ValueError:
                pass
        raise ValueError("Invalid optional value")
    if origin in (list, tuple):
        if not isinstance(value, list):
            raise ValueError("Expected JSON array")
        result = [_decode(args[0], v) for v in value]
        return tuple(result) if origin is tuple else result
    if origin is dict:
        if not isinstance(value, dict):
            raise ValueError("Expected JSON object")
        return {_decode(args[0], k): _decode(args[1], v) for k, v in value.items()}
    if is_dataclass(expected):
        if not isinstance(value, dict) or set(value) != {f.name for f in fields(expected)}:
            raise ValueError(f"Invalid fields for {expected.__name__}")
        hints = get_type_hints(expected)
        return expected(**{k: _decode(hints[k], v) for k, v in value.items()})
    if type(value) is not expected:
        raise ValueError(f"Expected {expected.__name__}")
    return value
