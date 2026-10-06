"""CMP-01 through CMP-04: committed snapshots and deterministic structural diff."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from archi.comparison import compare_commits, comparison_json
from archi.cli import main
from tests.comparison_fixture import git, history
from tests.test_acceptance import run_cli


class ComparisonAcceptance(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='archi-compare-test-')
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.base, self.head = history(self.root)

    def test_CMP_01_commits_ignore_dirty_index_worktree_and_do_not_execute(self):
        (self.root / 'a/main.py').write_text('raise RuntimeError("must not run")\n')
        git(self.root, 'add', 'a/main.py')
        (self.root / 'untracked.py').write_text('import untracked\n')
        before = git(self.root, 'status', '--porcelain')
        result = compare_commits(self.root / 'a', self.base, self.head)
        self.assertEqual(result['base_commit'], self.base)
        self.assertEqual(result['head_commit'], self.head)
        self.assertEqual(before, git(self.root, 'status', '--porcelain'))
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), self.head)
        self.assertNotIn('untracked.py', comparison_json(result))
        self.assertNotIn('must not run', comparison_json(result))

    def test_CMP_02_structure_evidence_type_changes_and_cycles(self):
        result = compare_commits(self.root, self.base, self.head)
        nodes = {(c['after'] or c['before'])['path']: c['status'] for c in result['changes']['nodes']}
        self.assertEqual(nodes, {'newpkg': 'added', 'newpkg/new.py': 'added',
                                 'removed': 'removed', 'removed/gone.py': 'removed'})
        edges = {(c['after'] or c['before'])['source']: c for c in result['changes']['dependencies']
                 if (c['after'] or c['before'])['kind'] == 'imports'}
        self.assertEqual(edges['module:shift/client.py']['status'], 'evidence')
        self.assertEqual(edges['module:shift/client.py']['before']['evidence'][0]['line'], 1)
        self.assertEqual(edges['module:shift/client.py']['after']['evidence'][0]['line'], 3)
        self.assertEqual(edges['module:typed/client.py']['status'], 'modified')
        a = [c for c in result['changes']['dependencies'] if (c['after'] or c['before'])['source'] == 'module:a/main.py']
        self.assertEqual({c['status'] for c in a}, {'added', 'removed'})
        self.assertEqual([(c['status'], c['after']['rule_code']) for c in result['changes']['diagnostics']], [('added', 'no-cycles')])
        same = compare_commits(self.root, self.head, self.head)
        self.assertTrue(all(not value for value in same['changes'].values()))
        self.assertEqual(comparison_json(result), comparison_json(compare_commits(self.root, self.base, self.head)))
        self.assertNotIn(str(self.root), comparison_json(result))

    def test_CMP_03_incomplete_analysis_never_claims_definite_missing_dependencies(self):
        (self.root / 'a/main.py').write_text('def broken(\n')
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-qm', 'Malformed')
        broken = git(self.root, 'rev-parse', 'HEAD')
        result = compare_commits(self.root, self.base, broken)
        self.assertFalse(result['complete'])
        self.assertTrue(result['head']['issues'])
        self.assertNotIn('removed', [c['status'] for c in result['changes']['dependencies']])
        reverse = compare_commits(self.root, broken, self.base)
        self.assertNotIn('added', [c['status'] for c in reverse['changes']['dependencies']])
        cli = run_cli('compare', self.root, '--base', self.base, '--head', broken, '--json')
        self.assertEqual(cli.returncode, 2)
        self.assertFalse(json.loads(cli.stdout)['complete'])

    def test_CMP_01_symlinks_and_submodules_are_not_followed(self):
        (self.root / 'link.py').symlink_to('/etc/passwd')
        git(self.root, 'add', 'link.py')
        git(self.root, 'update-index', '--add', '--cacheinfo', f'160000,{self.base},vendor')
        git(self.root, 'commit', '-qm', 'Omissions')
        result = compare_commits(self.root, self.base, 'HEAD')
        self.assertFalse(result['complete'])
        self.assertEqual({i['path'] for i in result['head']['issues']}, {'link.py', 'vendor'})
        self.assertNotIn('module:link.py', {n['id'] for n in result['head']['nodes']})

    def test_CMP_04_cli_config_ref_errors_and_browser_payload(self):
        (self.root / 'pyproject.toml').write_text('[tool.archi]\nno-cycles = false\n')
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-qm', 'Policy')
        result = run_cli('compare', self.root, '--base', self.base, '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['configuration_changed'])
        target = self.root / 'comparison.json'
        exported = run_cli('compare', self.root, '--base', self.base, '-o', target)
        self.assertEqual(exported.returncode, 0)
        self.assertEqual(json.loads(target.read_text()), json.loads(result.stdout))
        for ref in ('not-a-ref', '--help'):
            self.assertEqual(run_cli('compare', self.root, '--base', ref, '--json').returncode, 2)
        with patch('archi.cli.serve', return_value=0) as serve:
            self.assertEqual(main(['compare', str(self.root), '--base', self.base, '--no-browser']), 0)
            self.assertIn('comparison', serve.call_args.kwargs)
            self.assertFalse(serve.call_args.kwargs['open_browser'])

    def test_CMP_01_root_package_name_is_stable_and_virtualenv_markers_preserved(self):
        (self.root / '__init__.py').write_text('from .a import main\n')
        (self.root / 'customenv').mkdir()
        (self.root / 'customenv/pyvenv.cfg').write_text('home = /unused\n')
        (self.root / 'customenv/hidden.py').write_text('import should_not_appear\n')
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-qm', 'Root package')
        first = compare_commits(self.root, 'HEAD', 'HEAD')
        self.assertTrue(all(not value for value in first['changes'].values()))
        self.assertEqual(comparison_json(first), comparison_json(compare_commits(self.root, 'HEAD', 'HEAD')))
        self.assertNotIn('customenv/hidden.py', comparison_json(first))
        self.assertIn(self.root.name, {n['name'] for n in first['head']['nodes']})
