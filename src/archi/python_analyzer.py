"""AST-only Python adapter: AN-01 through AN-05. Never imports target code."""

import ast
from collections import defaultdict
from dataclasses import dataclass
from fnmatch import fnmatchcase
import os
from pathlib import Path
import tokenize

from archi import __version__
from archi.config import Config
from archi.model import Edge, Evidence, Graph, Issue, Node, SCHEMA_VERSION, UnresolvedImport, stable_id

EXCLUDED = frozenset({
    ".git", ".hg", ".svn", ".venv", "venv", "env", ".env", "__pycache__",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".nox", ".cache",
    "build", "dist", "node_modules", "site-packages", ".eggs",
})


@dataclass(frozen=True)
class Module:
    node: Node
    name: str
    package: str


class PythonAnalyzer:
    def analyze(self, root: Path, config: Config) -> Graph:
        root = root.resolve()
        graph = Graph(SCHEMA_VERSION, {"name": "archi-python", "version": __version__, "language": "python"},
                      [], [], [], [], [])
        roots = config.source_roots
        if roots is None:
            roots = (".", "src") if (root / "src").is_dir() and not (root / "src").is_symlink() else (".",)
        import_roots = sorted((root / p for p in roots), key=lambda p: (-len(p.parts), p.as_posix()))
        files = self._discover(root, config, graph.issues)
        file_set = set(files)
        nodes = {"group:.": Node("group:.", "group", ".", None, ".")}
        modules = []
        # Lookup maps a dotted name to *all* candidates; filesystem order never wins.
        index = defaultdict(set)
        packages = {}
        for path in files:
            source_root = next((p for p in import_roots if path.is_relative_to(p)), None)
            if source_root is None:
                continue
            relative = path.relative_to(source_root)
            prefix = source_root.name if (source_root / "__init__.py") in file_set else ""
            components = ([prefix] if prefix else []) + list(relative.parts[:-1])
            parent = "group:."
            if prefix:
                root_path = source_root.relative_to(root).as_posix()
                parent = "group:" + root_path
                nodes[parent] = Node(parent, "group", prefix, None if root_path == "." else "group:.", root_path)
                packages[prefix, root_path] = parent
            for i in range(len(relative.parts) - 1):
                directory = source_root.joinpath(*relative.parts[:i + 1])
                rel_dir = directory.relative_to(root).as_posix()
                name = ".".join(([prefix] if prefix else []) + list(relative.parts[:i + 1]))
                group_id = "group:" + rel_dir
                nodes[group_id] = Node(group_id, "group", name, parent, rel_dir)
                packages[name, rel_dir] = group_id
                parent = group_id
            package = ".".join(components)
            name = package if path.name == "__init__.py" else ".".join(components + [path.stem])
            rel_path = path.relative_to(root).as_posix()
            node = Node("module:" + rel_path, "module", name, parent, rel_path)
            nodes[node.id] = node
            modules.append(Module(node, name, package))
            index[name].add(node.id)
        for (name, directory), group_id in packages.items():
            init_id = "module:" + (directory + "/" if directory != "." else "") + "__init__.py"
            if init_id not in nodes:
                index[name].add(group_id)
        graph.nodes = sorted(nodes.values(), key=lambda n: n.id)
        sites = defaultdict(set)
        local_tops = {name.split(".")[0] for name in index}

        def record(module: Module, reference: str, evidence: Evidence, status: str, reason: str,
                   candidates: tuple[str, ...] = ()) -> None:
            graph.unresolved.append(UnresolvedImport(
                stable_id("reference", module.node.id, reference, evidence.path, evidence.line,
                          evidence.column, status), module.node.id, reference, status, reason, evidence, candidates))

        def resolve(module: Module, reference: str, evidence: Evidence) -> bool:
            candidates = tuple(sorted(index.get(reference, ())))
            parts = reference.split(".")
            for length in range(1, len(parts)):
                prefix_candidates = tuple(sorted(index.get(".".join(parts[:length]), ())))
                if len(prefix_candidates) > 1:
                    record(module, reference, evidence, "uncertain", "Ambiguous local parent package", prefix_candidates)
                    return False
            if len(candidates) == 1:
                sites[module.node.id, candidates[0]].add(evidence)
                return True
            if candidates:
                record(module, reference, evidence, "uncertain", "Multiple local candidates", candidates)
            else:
                status = "unresolved" if reference.split(".")[0] in local_tops else "external"
                record(module, reference, evidence, status,
                       "Not found under a local package" if status == "unresolved" else
                       "Outside configured source roots; installed availability is not checked")
            return False

        for module in modules:
            try:
                with tokenize.open(root / module.node.path) as stream:
                    source = stream.read()
                tree = ast.parse(source, filename=module.node.path)
            except (SyntaxError, UnicodeError, LookupError, ValueError) as exc:
                graph.issues.append(Issue("parse-error", module.node.path,
                                          "Cannot parse Python source (syntax or encoding error)",
                                          getattr(exc, "lineno", None)))
                continue
            except OSError:
                graph.issues.append(Issue("read-error", module.node.path, "Cannot read file; check permissions"))
                continue
            except RecursionError:
                graph.issues.append(Issue("parse-error", module.node.path, "Source exceeds parser nesting limits"))
                continue
            for statement in ast.walk(tree):
                if not isinstance(statement, (ast.Import, ast.ImportFrom)):
                    continue
                evidence = Evidence(module.node.path, statement.lineno, statement.col_offset,
                                    ast.get_source_segment(source, statement) or "")
                if isinstance(statement, ast.Import):
                    for alias in statement.names:
                        resolve(module, alias.name, evidence)
                    continue
                base = statement.module or ""
                if statement.level:
                    parts = module.package.split(".") if module.package else []
                    if statement.level > len(parts):
                        record(module, "." * statement.level + base, evidence, "unresolved",
                               "Relative import escapes the containing package")
                        continue
                    base = ".".join(parts[:len(parts) - statement.level + 1] + ([base] if base else []))
                # The base is always imported, even when the imported name is a symbol.
                # For a known child module, retain both explicit base and child facts.
                if not resolve(module, base, evidence):
                    continue
                for alias in statement.names:
                    child = base + "." + alias.name
                    if child in index:
                        resolve(module, child, evidence)
                    else:
                        record(module, child, evidence, "uncertain",
                               "Wildcard exports are not evaluated" if alias.name == "*" else
                               "May be a symbol or re-export; no local child module found")
        graph.edges = [Edge(stable_id("edge", "imports", *pair), "imports", *pair,
                            tuple(sorted(sites[pair]))) for pair in sorted(sites)]
        # Repeated aliases in a single statement must not duplicate reference IDs.
        graph.unresolved = sorted({r.id: r for r in graph.unresolved}.values(), key=lambda r: r.id)
        return graph

    @staticmethod
    def _discover(root: Path, config: Config, issues: list[Issue]) -> list[Path]:
        found = []

        def excluded(path: Path) -> bool:
            relative = path.relative_to(root).as_posix()
            return (path.name in EXCLUDED or path.name.endswith(".egg-info") or path.is_symlink()
                    or any(fnmatchcase(relative, pattern) for pattern in config.exclude))

        def failed(exc: OSError) -> None:
            path = Path(exc.filename) if exc.filename else root
            relative = path.relative_to(root).as_posix() if path.is_relative_to(root) else "."
            issues.append(Issue("discovery-error", relative, "Cannot list directory; check permissions"))

        for directory, dirs, files in os.walk(root, topdown=True, onerror=failed, followlinks=False):
            parent = Path(directory)
            dirs[:] = sorted(name for name in dirs if not excluded(parent / name)
                             and not (parent / name / "pyvenv.cfg").is_file())
            for name in sorted(files):
                path = parent / name
                if path.suffix == ".py" and not excluded(path) and path.is_file():
                    found.append(path)
        return sorted(found)
