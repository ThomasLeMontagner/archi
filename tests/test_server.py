"""Browser-host acceptance: UX-01/02/03/05 and CLI-01."""

from contextlib import redirect_stdout
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import socket
import threading
import unittest
from unittest.mock import patch

from archi.cli import main
from archi.core import analyze
from archi.server import create_server, serve

FIXTURES = Path(__file__).parent / 'fixtures'


class BrowserHostAcceptance(unittest.TestCase):
    def setUp(self):
        self.root = FIXTURES / 'cycles'
        self.graph = analyze(self.root)
        self.server = create_server(self.root, self.graph, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, path, headers=None, method='GET'):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_UX_01_CLI_01_serves_bundled_UI_and_identical_graph(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn(b'/app.js', body)
        self.assertIn("script-src 'self'", headers['Content-Security-Policy'])
        for path, content_type in (('/app.js', 'text/javascript'), ('/app.css', 'text/css'), ('/favicon.svg', 'image/svg+xml')):
            status, headers, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertTrue(headers['Content-Type'].startswith(content_type))
            self.assertGreater(len(body), 100)
        self.assertEqual(self.request('/api/graph')[2].decode(), self.graph.to_json())
        metadata = json.loads(self.request('/api/project')[2])
        self.assertEqual(metadata['root'], str(self.root.resolve()))
        self.assertEqual(metadata['name'], 'cycles')
        self.assertEqual(self.request('/app.js', method='HEAD')[2], b'')

    def test_UX_05_only_loopback_fixed_routes_no_source_or_cross_origin(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        for path in ('/../pyproject.toml', '/%2e%2e/pyproject.toml', '/a/one.py', '/api/source', '//etc/passwd'):
            self.assertEqual(self.request(path)[0], 404, path)
        self.assertEqual(self.request('/api/graph', {'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/graph', {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/graph', method='POST')[0], 501)
        status, headers, _ = self.request('/api/graph')
        self.assertEqual(status, 200)
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_UX_03_occupied_port_selects_another_loopback_port(self):
        with create_server(self.root, self.graph, port=self.server.server_port) as other:
            self.assertNotEqual(other.server_port, self.server.server_port)
            self.assertEqual(other.server_address[0], '127.0.0.1')
        for port in (-1, 65536):
            with self.assertRaisesRegex(ValueError, 'Port'):
                create_server(self.root, self.graph, port=port)

    def test_AN_05_partial_results_over_HTTP(self):
        graph = analyze(FIXTURES / 'malformed')
        with create_server(FIXTURES / 'malformed', graph, port=0) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                connection.request('GET', '/api/graph')
                data = json.loads(connection.getresponse().read())
                connection.close()
                self.assertFalse(data['complete'])
                self.assertEqual(data['issues'][0]['path'], 'pkg/broken.py')
                self.assertTrue(data['edges'])
            finally:
                server.shutdown()
                worker.join(timeout=5)

    def test_UX_02_opens_browser_and_UX_03_fallback_message(self):
        for fixture in ('regular', 'src_layout'):
            root = FIXTURES / fixture
            graph = analyze(root)
            server = create_server(root, graph, port=0)
            output = io.StringIO()
            with patch('archi.server.create_server', return_value=server), \
                 patch.object(server, 'serve_forever', side_effect=KeyboardInterrupt), \
                 patch('archi.server.webbrowser.open', return_value=False) as opened, redirect_stdout(output):
                self.assertEqual(serve(root, graph, port=0), 0)
            opened.assert_called_once_with(f'http://127.0.0.1:{server.server_port}/')
            self.assertIn('open the URL above', output.getvalue())
            self.assertIn(str(root.resolve()), output.getvalue())

    def test_CLI_01_default_path_browse_alias_and_no_browser(self):
        for arguments in ([str(self.root), '--no-browser', '--port', '0'],
                          ['browse', str(self.root), '--no-browser']):
            with patch('archi.cli.serve', return_value=0) as host:
                self.assertEqual(main(arguments), 0)
                self.assertEqual(host.call_args.args[0], self.root.resolve())
                self.assertFalse(host.call_args.kwargs['open_browser'])
        with patch('archi.cli.serve') as host, redirect_stdout(io.StringIO()):
            self.assertEqual(main([str(self.root), '--port', '-1']), 2)
            host.assert_not_called()


if __name__ == '__main__':
    unittest.main()
