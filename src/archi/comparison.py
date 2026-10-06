"""CMP-01/02: immutable Git snapshots and language-neutral graph comparison."""

from dataclasses import asdict
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile

from archi.core import analyze
from archi.model import Graph, Issue

COMPARISON_VERSION = "1.0"


def _git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(["git", "--no-replace-objects", "-c", "core.fsmonitor=false",
                                 "-C", str(root), *args], capture_output=True, timeout=60)
    except FileNotFoundError as exc:
        raise ValueError("Git is required for commit comparison") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Git operation timed out") from exc
    if result.returncode:
        raise ValueError("Git: " + result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def _snapshot(root: Path, commit: str) -> tuple[Graph, str]:
    """Read tracked blobs directly: no checkout, hooks, filters, or repo execution."""
    entries = _git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0")
    issues = []
    config_text = ""
    total = 0
    with tempfile.TemporaryDirectory(prefix="archi-compare-") as folder:
        target = Path(folder) / root.name
        target.mkdir()
        for entry in entries:
            if not entry:
                continue
            header, raw_path = entry.split(b"\t", 1)
            mode, kind, oid = header.decode("ascii").split()
            try:
                path = raw_path.decode("utf-8")
            except UnicodeError as exc:
                raise ValueError("Commit has a filename that is not UTF-8") from exc
            relative = PurePosixPath(path)
            if relative.is_absolute() or any(p in {"..", ".git"} for p in relative.parts) or "\\" in path or ":" in path:
                raise ValueError("Commit contains an unsupported path")
            if mode == "160000" or mode == "120000":
                issues.append(Issue("snapshot-omission", path, "Submodule or symbolic link omitted from commit snapshot"))
                continue
            # Preserve tracked directories for explicit source-roots, even if they
            # contain only non-Python files. Excluded source trees stay excluded.
            (target / relative.parent).mkdir(parents=True, exist_ok=True)
            if not (path.endswith(".py") or path == "pyproject.toml" or relative.name == "pyvenv.cfg"):
                continue
            size = int(_git(root, "cat-file", "-s", oid))
            total += size
            if size > 32 * 1024 * 1024 or total > 256 * 1024 * 1024:
                raise ValueError("Commit snapshot exceeds analysis size limit (32 MiB/file, 256 MiB total)")
            content = _git(root, "cat-file", "blob", oid)
            (target / relative).write_bytes(content)
            if path == "pyproject.toml":
                config_text = content.decode("utf-8")
        graph = analyze(target)
        graph.issues.extend(issues)
        graph.validate()
        return graph, config_text


def compare_graphs(base: Graph, head: Graph) -> dict:
    """Logical identity ignores source evidence locations, counts, and text."""
    def changes(before, after, identity, category):
        left = {identity(item): item for item in before}
        right = {identity(item): item for item in after}
        output = []
        for key in sorted(left.keys() | right.keys()):
            old, new = left.get(key), right.get(key)
            if old is None:
                status = "added" if base.complete else "uncertain"
            elif new is None:
                status = "removed" if head.complete else "uncertain"
            elif category == "dependency":
                if {s.type_only for s in old.evidence} != {s.type_only for s in new.evidence}:
                    status = "modified"
                elif old.evidence != new.evidence:
                    status = "evidence"
                else:
                    continue
            elif old == new:
                continue
            else:
                status = "modified"
            output.append({"status": status, "before": asdict(old) if old else None,
                           "after": asdict(new) if new else None})
        return output

    return {
        "nodes": changes(base.nodes, head.nodes, lambda n: n.id, "node"),
        "dependencies": changes(base.edges, head.edges, lambda e: (e.kind, e.source, e.target), "dependency"),
        "diagnostics": changes(base.diagnostics, head.diagnostics, lambda d: d.id, "diagnostic"),
    }


def compare_commits(path: str | Path, base_ref: str, head_ref: str) -> dict:
    root = Path(path).resolve()
    if not root.is_dir():
        raise ValueError("Comparison path must be a Git working-tree directory")
    root = Path(os.fsdecode(_git(root, "rev-parse", "--show-toplevel").rstrip(b"\n")))
    # Resolve both before reading either snapshot; option-looking refs are never options.
    base = _git(root, "rev-parse", "--verify", "--end-of-options", base_ref + "^{commit}").decode().strip()
    head = _git(root, "rev-parse", "--verify", "--end-of-options", head_ref + "^{commit}").decode().strip()
    before, old_config = _snapshot(root, base)
    after, new_config = _snapshot(root, head)
    return {
        "comparison_version": COMPARISON_VERSION,
        "base_commit": base, "head_commit": head,
        "complete": before.complete and after.complete,
        "configuration_changed": old_config != new_config,
        "base": before.to_dict(), "head": after.to_dict(),
        "changes": compare_graphs(before, after),
    }


def comparison_json(comparison: dict) -> str:
    return json.dumps(comparison, sort_keys=True, indent=2, ensure_ascii=True) + "\n"
