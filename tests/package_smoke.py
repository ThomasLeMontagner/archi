"""Offline installed-wheel acceptance (UX-01, CLI-01, OP-03).

Usage: python tests/package_smoke.py dist/archi_explorer-0.2.0-py3-none-any.whl
The only package installed is the supplied wheel; no Node or network is used.
"""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
from urllib.request import urlopen
import zipfile


def main():
    wheel = Path(sys.argv[1]).resolve()
    project = Path(__file__).resolve().parents[1]
    with zipfile.ZipFile(wheel) as archive:
        for filename in ('index.html', 'app.js', 'app.css', 'favicon.svg', 'app.js.LEGAL.txt'):
            assert archive.read(f'archi/static/{filename}'), filename
    with tempfile.TemporaryDirectory(prefix='archi-wheel-smoke-') as folder:
        root = Path(folder)
        venv = root / 'venv'
        subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
        binary = venv / ('Scripts' if os.name == 'nt' else 'bin')
        python = binary / ('python.exe' if os.name == 'nt' else 'python')
        cli = binary / ('archi.exe' if os.name == 'nt' else 'archi')
        env = {k: v for k, v in os.environ.items() if k != 'PYTHONPATH'}
        env['PATH'] = str(binary)
        subprocess.run([str(python), '-m', 'pip', 'install', '--no-index', '--no-deps', str(wheel)],
                       check=True, cwd=root, env=env, stdout=subprocess.PIPE)
        for arguments, code in [(['--help'], 0), (['check', str(project / 'tests/fixtures/regular')], 0),
                                (['check', str(project / 'tests/fixtures/cycles')], 1),
                                (['check', str(project / 'tests/fixtures/malformed')], 2)]:
            result = subprocess.run([str(cli), *arguments], capture_output=True, text=True, env=env, cwd=root)
            assert result.returncode == code, (arguments, result.stdout, result.stderr)
        server = subprocess.Popen([str(cli), str(project), '--no-browser', '--port', '0'],
                                  cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        output = queue.Queue()
        def read():
            for line in server.stdout:
                output.put(line)
        thread = threading.Thread(target=read, daemon=True)
        thread.start()
        try:
            line = output.get(timeout=15)
            assert line.startswith('Archi explorer: http://127.0.0.1:'), line
            url = line.split('Archi explorer: ', 1)[1].strip()
            with urlopen(url, timeout=5) as response:
                assert response.status == 200 and b'/app.js' in response.read()
            for path, mime in [('app.js', 'text/javascript'), ('app.css', 'text/css'), ('api/graph', 'application/json')]:
                with urlopen(url + path, timeout=5) as response:
                    assert response.headers['Content-Type'].startswith(mime)
                    content = response.read()
                    assert content
                    if path == 'api/graph':
                        graph = json.loads(content)
                        assert graph['schema_version'] == '1.0' and graph['complete']
            print('PASS: installed wheel, no Node in PATH, check exits 0/1/2, browser page, compiled assets, graph API.')
        finally:
            server.terminate()
            server.wait(timeout=10)
            server.stdout.close()
            server.stderr.close()
            thread.join(timeout=2)


if __name__ == '__main__':
    main()
