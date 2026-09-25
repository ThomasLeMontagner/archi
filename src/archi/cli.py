"""Browser and headless CLI (CLI-01, CLI-02)."""

import argparse
from pathlib import Path
import sys
from time import perf_counter

from archi import __version__
from archi.core import analyze
from archi.server import DEFAULT_PORT, serve


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="archi", description="Explore and check a Python repository's architecture.",
                                     epilog="archi PATH opens the local browser explorer. Use ./check for a directory named check.")
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    check = subparsers.add_parser("check", help="Check dependencies; exit 0 pass, 1 violations, 2 analysis/config error")
    check.add_argument("path", type=Path, help="Repository directory")
    export = subparsers.add_parser("export", help="Write versioned JSON; exit 2 if analysis is incomplete")
    export.add_argument("path", type=Path, help="Repository directory")
    export.add_argument("-o", "--output", type=Path, help="Output file (default: stdout)")
    browse = subparsers.add_parser("browse", help="Open the local explorer (also: archi PATH)")
    browse.add_argument("path", type=Path, nargs="?", default=Path("."), help="Repository directory (default: .)")
    browse.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred loopback port; falls back if occupied")
    browse.add_argument("--no-browser", action="store_true", help="Print the local URL without opening a browser")
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments or arguments[0] not in {"check", "export", "browse", "--help", "-h", "--version"}:
        arguments.insert(0, "browse")
    args = parser.parse_args(arguments)
    try:
        if args.command == "browse" and not 0 <= args.port <= 65535:
            raise ValueError("Port must be between 0 and 65535")
        started = perf_counter()
        graph = analyze(args.path)
        if args.command == "browse":
            return serve(args.path.resolve(), graph, port=args.port, open_browser=not args.no_browser,
                         analysis_seconds=perf_counter() - started)
        if args.command == "export":
            content = graph.to_json()
            if args.output:
                args.output.write_text(content, encoding="utf-8", newline="\n")
            else:
                sys.stdout.write(content)
        else:
            modules = sum(n.kind == "module" for n in graph.nodes)
            print(f"Analyzed {modules} modules; {len(graph.diagnostics)} violation(s); "
                  f"{len(graph.unresolved)} external/unresolved/uncertain reference(s).")
            names = {node.id: node.name for node in graph.nodes}
            for diagnostic in graph.diagnostics:
                print(f"{diagnostic.rule_code} [{diagnostic.id}]: {diagnostic.message}")
                print("  Affected nodes: " + ", ".join(names[node] for node in diagnostic.nodes))
                for evidence in diagnostic.evidence:
                    print(f"  {evidence.path}:{evidence.line}: {evidence.text}")
            print("Analysis incomplete." if not graph.complete else
                  "Checks failed." if graph.diagnostics else "Checks passed.")
        for issue in graph.issues:
            location = f"{issue.path}:{issue.line}" if issue.line else issue.path
            print(f"archi: {issue.code}: {location}: {issue.message}", file=sys.stderr)
        if not graph.complete:
            return 2
        return 1 if args.command == "check" and graph.diagnostics else 0
    except (OSError, ValueError) as exc:
        print(f"archi: {exc}", file=sys.stderr)
        return 2
