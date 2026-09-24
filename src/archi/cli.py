"""Headless CLI and exit contract (CLI-01, CLI-02)."""

import argparse
from pathlib import Path
import sys

from archi import __version__
from archi.core import analyze


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="archi", description="Static Python architecture analysis (headless milestone).",
                                     epilog="Browser explorer (archi PATH) is planned for the next milestone.")
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    check = subparsers.add_parser("check", help="Check dependencies; exit 0 pass, 1 violations, 2 analysis/config error")
    check.add_argument("path", type=Path, help="Repository directory")
    export = subparsers.add_parser("export", help="Write versioned JSON; exit 2 if analysis is incomplete")
    export.add_argument("path", type=Path, help="Repository directory")
    export.add_argument("-o", "--output", type=Path, help="Output file (default: stdout)")
    args = parser.parse_args(argv)
    try:
        graph = analyze(args.path)
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
            for diagnostic in graph.diagnostics:
                print(f"{diagnostic.rule_code} [{diagnostic.id}]: {diagnostic.message}")
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
