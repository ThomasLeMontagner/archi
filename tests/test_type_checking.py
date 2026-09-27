"""TC-01 through TC-04: type-only evidence, policy, and interchange."""
import ast
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest

from archi.config import Config, ConfigError, ForbiddenRule, load_config
from archi.core import analyze
from archi.model import Graph
from archi.python_analyzer import import_sites
from tests.test_acceptance import FIXTURES, imports, run_cli


class TypeCheckingAcceptance(unittest.TestCase):
    def test_TC_01_aliases_nested_else_relative_and_mixed_evidence(self):
        graph = analyze(FIXTURES / 'type_checking')
        edges = imports(graph)
        self.assertEqual([(s.line, s.type_only) for s in edges['a/main.py', 'b/peer.py'].evidence],
                         [(6, True), (14, True), (16, True)])
        self.assertEqual([(s.line, s.type_only) for s in edges['a/main.py', 'c/peer.py'].evidence],
                         [(10, True), (12, False), (17, False)])
        self.assertTrue(edges['a/main.py', 'a/helper.py'].evidence[0].type_only)
        external = next(r for r in graph.unresolved if r.reference == 'missing_vendor')
        self.assertTrue(external.evidence.type_only)
        self.assertTrue(graph.complete)

    def test_TC_01_ambiguous_guards_are_not_hidden(self):
        examples = [
            'TYPE_CHECKING = True\nif TYPE_CHECKING:\n import b\n',
            'from typing import TYPE_CHECKING\nTYPE_CHECKING = True\nif TYPE_CHECKING:\n import b\n',
            'from typing import TYPE_CHECKING\ndef f(TYPE_CHECKING):\n if TYPE_CHECKING:\n  import b\n',
            'from typing import TYPE_CHECKING\nif not TYPE_CHECKING:\n import b\n',
            'from typing import TYPE_CHECKING\nif TYPE_CHECKING and enabled:\n import b\n',
            'import typing as t\nt.TYPE_CHECKING = True\nif t.TYPE_CHECKING:\n import b\n',
            'from vendor import TYPE_CHECKING\nif TYPE_CHECKING:\n import b\n',
            'from typing import TYPE_CHECKING\nfrom vendor import *\nif TYPE_CHECKING:\n import b\n',
        ]
        for source in examples:
            with self.subTest(source=source):
                sites = list(import_sites(ast.parse(source)))
                self.assertFalse(any(flag for _, flag in sites))
        source = 'import typing\nif typing.TYPE_CHECKING:\n import b\n'
        self.assertTrue(any(flag for _, flag in import_sites(ast.parse(source))))
        self.assertFalse(any(flag for _, flag in import_sites(ast.parse(source), typing_is_local=True)))

    def test_TC_02_policy_filters_cycles_and_forbidden_but_retains_export(self):
        config = Config(forbidden=(ForbiddenRule('a', 'b', True), ForbiddenRule('a', 'c', True)))
        full = analyze(FIXTURES / 'type_checking', config=config)
        filtered = analyze(FIXTURES / 'type_checking', config=replace(config, include_type_only=False))
        self.assertEqual(len(full.diagnostics), 3)
        self.assertEqual(len(filtered.diagnostics), 1)
        self.assertEqual(filtered.diagnostics[0].rule_code, 'forbidden-dependency')
        self.assertEqual([s.line for s in filtered.diagnostics[0].evidence], [12, 17])
        self.assertEqual(full.edges, filtered.edges)
        self.assertEqual(full.unresolved, filtered.unresolved)
        self.assertEqual(filtered.analyzer['include_type_only'], 'false')

    def test_TC_02_config_and_cli_exit_codes(self):
        import shutil
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(FIXTURES / 'type_checking', root, dirs_exist_ok=True)
            self.assertEqual(run_cli('check', root).returncode, 1)
            (root / 'pyproject.toml').write_text('[tool.archi]\ninclude-type-only = false\n')
            self.assertFalse(load_config(root).include_type_only)
            self.assertEqual(run_cli('check', root).returncode, 0)
            exported = run_cli('export', root)
            self.assertEqual(exported.returncode, 0)
            self.assertTrue(any(s['type_only'] for e in json.loads(exported.stdout)['edges'] for s in e['evidence']))
            (root / 'pyproject.toml').write_text('[tool.archi]\ninclude-type-only = "false"\n')
            with self.assertRaises(ConfigError):
                load_config(root)
            self.assertEqual(run_cli('check', root).returncode, 2)

    def test_TC_04_schema_round_trip_and_strict_type_only_field(self):
        graph = analyze(FIXTURES / 'type_checking')
        self.assertEqual(graph.schema_version, '2.0')
        self.assertEqual(Graph.from_json(graph.to_json()).to_json(), graph.to_json())
        data = json.loads(graph.to_json())
        data['edges'][0]['evidence'][0]['type_only'] = 'true'
        with self.assertRaises(ValueError):
            Graph.from_json(json.dumps(data))
        data = json.loads(graph.to_json())
        data['schema_version'] = '1.0'
        with self.assertRaises(ValueError):
            Graph.from_json(json.dumps(data))
