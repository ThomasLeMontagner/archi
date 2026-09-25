"""Requirement-linked acceptance tests. Run: python -m unittest discover -v."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from archi.python_analyzer import EXCLUDED
from archi.config import Config, ConfigError, ForbiddenRule
from archi.core import analyze
from archi.graph import aggregate_dependencies
from archi.model import Edge, Evidence, Graph, Node, SCHEMA_VERSION
from archi.rules import check_rules

PROJECT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"


def run_cli(*args, cwd=None, seed="0"):
    env = dict(os.environ, PYTHONPATH=str(PROJECT / "src"), PYTHONHASHSEED=seed)
    return subprocess.run([sys.executable, "-m", "archi", *map(str, args)],
                          cwd=cwd, env=env, text=True, capture_output=True, timeout=30)


def imports(graph):
    nodes = {n.id: n for n in graph.nodes}
    return {(nodes[e.source].path, nodes[e.target].path): e
            for e in graph.edges if e.kind == "imports"}


class AnalysisAcceptance(unittest.TestCase):
    def test_AN_01_discovery_exclusions_and_no_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sentinel = root / "executed"
            (root / "valid.py").write_text(f"from pathlib import Path\nPath({str(sentinel)!r}).touch()\n")
            for name in EXCLUDED | {"thing.egg-info", "custom-env", "ignored"}:
                directory = root / name
                directory.mkdir()
                (directory / "hidden.py").write_text("raise RuntimeError('executed')")
            (root / "custom-env" / "pyvenv.cfg").touch()
            (root / "linked.py").symlink_to(root / "valid.py")
            (root / "loop").symlink_to(root, target_is_directory=True)
            graph = analyze(root, config=Config(exclude=("ignored",)))
            self.assertEqual([n.path for n in graph.nodes if n.kind == "module"], ["valid.py"])
            self.assertFalse(sentinel.exists())
            self.assertTrue(graph.complete)
        graph = analyze(FIXTURES / "regular")
        self.assertTrue(graph.complete)  # A fixture also raises immediately if executed.

    def test_AN_02_all_static_import_sites_and_exact_text(self):
        graph = analyze(FIXTURES / "regular")
        edges = imports(graph)
        edge = edges["pkg/main.py", "pkg/helper.py"]
        self.assertEqual([e.line for e in edge.evidence], [1, 2, 5, 8])
        self.assertEqual([e.column for e in edge.evidence], [0, 0, 4, 4])
        self.assertEqual(edge.evidence[2].text, "import pkg.helper as h")
        self.assertIn(("pkg/__init__.py", "pkg/helper.py"), edges)

    def test_AN_03_src_namespace_and_relative_resolution(self):
        graph = analyze(FIXTURES / "src_layout")
        self.assertTrue(graph.complete)
        self.assertFalse(graph.unresolved)
        expected = {
            ("src/acme/api.py", "src/acme/__init__.py"),
            ("src/acme/api.py", "src/acme/util.py"),
            ("src/acme/api.py", "src/acme/nested/__init__.py"),
            ("src/acme/api.py", "src/acme/nested/worker.py"),
            ("src/acme/api.py", "src/space"),
            ("src/acme/api.py", "src/space/leaf.py"),
            ("src/acme/nested/worker.py", "src/acme/__init__.py"),
            ("src/acme/nested/worker.py", "src/acme/util.py"),
            ("src/acme/nested/worker.py", "src/acme/nested/__init__.py"),
            ("src/acme/nested/worker.py", "src/acme/nested/peer.py"),
            ("src/space/leaf.py", "src/acme/util.py"),
        }
        self.assertEqual(set(imports(graph)), expected)
        self.assertTrue(any(n.name == "space" and n.kind == "group" for n in graph.nodes))

    def test_AN_03_external_unresolved_symbols_and_ambiguity(self):
        graph = analyze(FIXTURES / "unresolved")
        self.assertEqual({(r.reference, r.status) for r in graph.unresolved}, {
            ("os", "external"), ("definitely_missing_dependency", "external"),
            ("pkg.missing", "unresolved"), ("pkg.unknown_symbol", "uncertain"),
            ("...", "unresolved"), ("pkg.*", "uncertain"),
        })
        self.assertEqual(set(imports(graph)), {("pkg/main.py", "pkg/__init__.py")})
        ambiguous = analyze(FIXTURES / "ambiguous")
        self.assertFalse(imports(ambiguous))
        self.assertEqual({r.reference for r in ambiguous.unresolved}, {"pkg", "pkg.child"})
        self.assertTrue(all(r.status == "uncertain" and len(r.candidates) == 2 for r in ambiguous.unresolved))

    def test_AN_03_configured_roots_and_package_as_target(self):
        graph = analyze(FIXTURES / "regular" / "pkg")
        self.assertIn(("main.py", "helper.py"), imports(graph))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "lib" / "pkg").mkdir(parents=True)
            (root / "lib" / "pkg" / "one.py").write_text("from . import two")
            (root / "lib" / "pkg" / "two.py").touch()
            (root / "ignored.py").write_text("bad syntax !!!")
            (root / "pyproject.toml").write_text('[tool.archi]\nsource-roots = ["lib"]\n')
            graph = analyze(root)
            self.assertTrue(graph.complete)
            self.assertIn(("lib/pkg/one.py", "lib/pkg/two.py"), imports(graph))
            self.assertNotIn("ignored.py", {n.path for n in graph.nodes})

    def test_AN_04_IR_02_aggregation_deduplicates_sites_not_evidence(self):
        graph = analyze(FIXTURES / "aggregation")
        edges = [e for e in graph.edges if e.kind == "group_dependency"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0].count, 3)
        self.assertEqual({(s.path, s.line) for s in edges[0].evidence},
                         {("a/one.py", 1), ("a/one.py", 2), ("a/two.py", 1)})
        self.assertEqual(len(edges[0].supporting_edges), 3)
        original = {e.id: e for e in graph.edges}
        self.assertEqual(set(edges[0].evidence),
                         {s for eid in edges[0].supporting_edges for s in original[eid].evidence})
        self.assertEqual(aggregate_dependencies(graph.nodes, graph.edges, depth=0), [])
        self.assertEqual(aggregate_dependencies(graph.nodes, graph.edges, depth=1), edges)

    def test_AN_05_partial_syntax_error(self):
        graph = analyze(FIXTURES / "malformed")
        self.assertFalse(graph.complete)
        self.assertEqual([(i.path, i.line, i.code) for i in graph.issues],
                         [("pkg/broken.py", 1, "parse-error")])
        self.assertIn(("pkg/good.py", "pkg/other.py"), imports(graph))
        result = run_cli("check", FIXTURES / "malformed")
        self.assertEqual(result.returncode, 2)
        self.assertIn("pkg/broken.py:1", result.stderr)
        self.assertIn("incomplete", result.stdout)

    def test_AN_05_unreadable_file_and_directory(self):
        import tokenize
        original = tokenize.open

        def guarded(path):
            if str(path).endswith("helper.py"):
                raise PermissionError("denied")
            return original(path)

        with patch("archi.python_analyzer.tokenize.open", side_effect=guarded):
            graph = analyze(FIXTURES / "regular")
        self.assertFalse(graph.complete)
        self.assertEqual([(i.path, i.code) for i in graph.issues], [("pkg/helper.py", "read-error")])
        self.assertIn(("pkg/main.py", "pkg/helper.py"), imports(graph))

        def unreadable(root, **kwargs):
            kwargs["onerror"](PermissionError(13, "denied", str(root)))
            return iter(())

        with patch("archi.python_analyzer.os.walk", side_effect=unreadable):
            graph = analyze(FIXTURES / "regular")
        self.assertFalse(graph.complete)
        self.assertEqual(graph.issues[0].code, "discovery-error")

    def test_AN_02_encoding_multiline_semicolons_and_aliases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "a.py").write_bytes(b"# coding: latin-1\n# caf\xe9\nimport b; import b\nfrom b import (\n    VALUE as renamed,\n)\n")
            (root / "b.py").write_text("VALUE = 1")
            graph = analyze(root)
            sites = imports(graph)["a.py", "b.py"].evidence
            self.assertEqual([(s.line, s.column) for s in sites], [(3, 0), (3, 10), (4, 0)])
            self.assertEqual(sites[-1].text, "from b import (\n    VALUE as renamed,\n)")


class GraphAndRuleAcceptance(unittest.TestCase):
    def test_IR_01_roundtrip_python_and_non_python_same_schema(self):
        python = analyze(FIXTURES / "regular")
        self.assertEqual(Graph.from_json(python.to_json()).to_json(), python.to_json())
        # Hand-built Go-shaped graph. The same aggregation and rule engine apply.
        go = Graph(SCHEMA_VERSION, {"name": "fixture-go", "version": "0", "language": "go"}, [
            Node("root", "group", ".", None, "."),
            Node("a", "group", "example.org/a", "root", "a"),
            Node("b", "group", "example.org/b", "root", "b"),
            Node("ma", "module", "a", "a", "a/main.go"),
            Node("mb", "module", "b", "b", "b/main.go"),
        ], [Edge("ab", "imports", "ma", "mb", (Evidence("a/main.go", 3, 0, 'import "example.org/b"'),)),
            Edge("ba", "imports", "mb", "ma", (Evidence("b/main.go", 2, 0, 'import "example.org/a"'),))], [], [], [])

        class GoFixtureAdapter:
            def analyze(self, root, config):
                return go

        graph = analyze(FIXTURES, adapter=GoFixtureAdapter(), config=Config())
        self.assertEqual(len(graph.diagnostics), 1)
        self.assertEqual(graph.diagnostics[0].rule_code, "no-cycles")
        self.assertEqual(Graph.from_json(graph.to_json()).to_json(), graph.to_json())
        forbidden = check_rules(graph, Config(no_cycles=False, forbidden=
                                             (ForbiddenRule("example.org/a", "example.org/b", True),)))
        self.assertEqual(len(forbidden), 1)

    def test_IR_01_reject_invalid_schema_and_references(self):
        data = analyze(FIXTURES / "regular").to_dict()
        mutations = [
            lambda d: d.update(schema_version="999"),
            lambda d: d["nodes"][0].update(parent_id="missing"),
            lambda d: d["edges"][0].update(count=100),
            lambda d: d["edges"][0].update(target="missing"),
            lambda d: d["nodes"][0].update(path="/host/secret"),
            lambda d: d.update(complete=False),
            lambda d: d["edges"][0]["evidence"][0].update(line=True),
            lambda d: d["nodes"].append(d["nodes"][0]),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                copied = json.loads(json.dumps(data))
                mutation(copied)
                with self.assertRaises(ValueError):
                    Graph.from_json(json.dumps(copied))

    def test_IR_03_deterministic_across_processes_locations_and_hash_seeds(self):
        for name in ("src_layout", "cycles", "unresolved", "malformed", "forbidden"):
            with self.subTest(fixture=name), tempfile.TemporaryDirectory() as folder:
                copied = Path(folder) / name
                shutil.copytree(FIXTURES / name, copied)
                first = run_cli("export", FIXTURES / name, seed="1")
                second = run_cli("export", copied, cwd=folder, seed="123")
                self.assertEqual(first.stdout.encode(), second.stdout.encode())
                Graph.from_json(first.stdout)
                self.assertNotIn(str(FIXTURES), first.stdout)

    def test_RL_01_two_and_three_package_cycles_DAG_and_internal(self):
        graph = analyze(FIXTURES / "cycles")
        nodes = {n.id: n.name for n in graph.nodes}
        self.assertEqual({tuple(sorted(nodes[n] for n in d.nodes)) for d in graph.diagnostics},
                         {("a", "b"), ("c", "d", "e")})
        edges = {e.id: e for e in graph.edges}
        for diagnostic in graph.diagnostics:
            self.assertEqual(diagnostic.cycle[0], diagnostic.cycle[-1])
            pairs = {(edges[e].source, edges[e].target) for e in diagnostic.edge_ids}
            self.assertEqual(pairs, set(zip(diagnostic.cycle, diagnostic.cycle[1:])))
            self.assertEqual(len(diagnostic.evidence), len(diagnostic.cycle) - 1)

    def test_RL_02_shared_diagnostics_stable_ids_and_source_lines(self):
        graph = analyze(FIXTURES / "cycles")
        result = run_cli("check", FIXTURES / "cycles")
        for diagnostic in graph.diagnostics:
            self.assertIn(diagnostic.id, result.stdout)
            self.assertIn(diagnostic.rule_code, result.stdout)
            for evidence in diagnostic.evidence:
                self.assertIn(f"{evidence.path}:{evidence.line}", result.stdout)

    def test_RL_03_default_cycle_rule_can_be_disabled_without_graph_change(self):
        enabled = analyze(FIXTURES / "cycles")
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "cycles"
            shutil.copytree(FIXTURES / "cycles", copied)
            (copied / "pyproject.toml").write_text("[tool.archi]\nno-cycles = false\n")
            disabled = analyze(copied)
            self.assertEqual(run_cli("check", copied).returncode, 0)
        self.assertEqual(enabled.nodes, disabled.nodes)
        self.assertEqual(enabled.edges, disabled.edges)
        self.assertEqual(disabled.diagnostics, [])

    def test_RL_04_exact_and_descendant_forbidden_rules(self):
        nested = analyze(FIXTURES / "forbidden")
        direct = analyze(FIXTURES / "forbidden", config=Config(
            forbidden=(ForbiddenRule("front", "back", False),)))
        self.assertEqual(len(nested.diagnostics), 4)
        self.assertEqual(len(direct.diagnostics), 1)
        self.assertEqual({(s.path, s.line) for d in nested.diagnostics for s in d.evidence},
                         {("front/one.py", 1), ("front/one.py", 2),
                          ("front/nested/one.py", 1), ("front/nested/one.py", 2)})
        self.assertEqual(direct.diagnostics[0].evidence[0].line, 1)
        with self.assertRaisesRegex(ConfigError, "unknown package"):
            analyze(FIXTURES / "forbidden", config=Config(forbidden=(ForbiddenRule("typo", "back", True),)))

    def test_RL_01_large_cycle_does_not_hit_recursion_limit(self):
        from archi.rules import _components, _cycle
        adjacency = {str(i): [str((i + 1) % 1500)] for i in range(1500)}
        components = _components(adjacency)
        self.assertEqual(len(components), 1)
        self.assertEqual(len(_cycle(components[0], adjacency)), 1501)


class CliAcceptance(unittest.TestCase):
    def test_CLI_01_headless_commands_from_another_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            help_result = run_cli("--help", cwd=folder)
            self.assertEqual(help_result.returncode, 0)
            self.assertIn("check", help_result.stdout)
            self.assertIn("export", help_result.stdout)
            self.assertIn("local browser explorer", help_result.stdout)
            stdout = run_cli("export", FIXTURES / "cycles", cwd=folder)
            self.assertEqual(stdout.returncode, 0)  # Policy violations do not prevent export.
            self.assertEqual(stdout.stderr, "")
            Graph.from_json(stdout.stdout)
            output = Path(folder) / "graph.json"
            written = run_cli("export", FIXTURES / "cycles", "--output", output, cwd=folder)
            self.assertEqual(written.returncode, 0)
            self.assertEqual(written.stdout, "")
            self.assertEqual(output.read_text(), stdout.stdout)

    def test_CLI_02_exit_codes_and_summaries(self):
        for fixture, code, message in (("regular", 0, "Checks passed"), ("cycles", 1, "Checks failed"),
                                       ("forbidden", 1, "forbidden-dependency"),
                                       ("malformed", 2, "Analysis incomplete")):
            with self.subTest(fixture=fixture):
                result = run_cli("check", FIXTURES / fixture)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(message, result.stdout)
                self.assertIn("modules", result.stdout)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "pyproject.toml").write_text("[tool.archi]\nno-cycles = 'yes'\n")
            invalid = run_cli("check", root)
            self.assertEqual(invalid.returncode, 2)
            self.assertIn("no-cycles must be a boolean", invalid.stderr)

    def test_CLI_02_analysis_errors_take_priority_over_violations(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "target"
            shutil.copytree(FIXTURES / "cycles", target)
            (target / "broken.py").write_text("def broken(:")
            checked = run_cli("check", target)
            exported = run_cli("export", target)
            self.assertEqual(checked.returncode, 2)
            self.assertIn("no-cycles", checked.stdout)
            self.assertEqual(exported.returncode, 2)
            graph = Graph.from_json(exported.stdout)
            self.assertFalse(graph.complete)
            self.assertEqual(len(graph.diagnostics), 2)

    def test_UX_03_headless_bad_path_config_and_output_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            missing = run_cli("check", root / "missing")
            self.assertEqual(missing.returncode, 2)
            self.assertIn("existing directory", missing.stderr)
            output = run_cli("export", FIXTURES / "regular", "-o", root / "missing" / "out.json")
            self.assertEqual(output.returncode, 2)
            self.assertNotIn("Traceback", output.stderr)
            for content in ('[tool.archi', '[tool.archi]\nunknown = true',
                            '[tool.archi]\nsource-roots = ["../escape"]',
                            '[tool.archi]\nsource-roots = []',
                            '[tool.archi]\nsource-roots = ["missing"]',
                            '[tool.archi]\nexclude = "bad"',
                            '[tool.archi]\nforbidden = [{from="a", to="b"}]'):
                with self.subTest(content=content):
                    (root / "pyproject.toml").write_text(content)
                    result = run_cli("check", root)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("archi:", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
