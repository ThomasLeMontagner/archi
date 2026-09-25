"""Dedicated browser-test host; this module is never installed in the wheel."""

from pathlib import Path
import sys
import tempfile
import signal
from time import perf_counter

from archi.core import analyze
from archi.model import Edge, Evidence, Graph, Node, SCHEMA_VERSION
from archi.server import create_server


def synthetic(size):
    nodes = [Node('root', 'group', '.', None, '.'), Node('bulk', 'group', 'bulk', 'root', 'bulk')]
    nodes += [Node(f'm{i}', 'module', f'bulk.mod{i:04}', 'bulk', f'bulk/mod{i:04}.py') for i in range(size)]
    edges = [Edge(f'e{i}', 'imports', f'm{i}', f'm{i+1}',
                  (Evidence(f'bulk/mod{i:04}.py', 1, 0, f'import bulk.mod{i+1:04}'),)) for i in range(size - 1)]
    return Graph(SCHEMA_VERSION, {'name': 'synthetic', 'version': '1', 'language': 'python'}, nodes, edges, [], [], [])


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    target = sys.argv[1]
    start = perf_counter()
    if target.startswith('benchmark:'):
        size = int(target.split(':')[1])
        temporary = tempfile.TemporaryDirectory(prefix='archi-benchmark-')
        root = Path(temporary.name)
        (root / 'bulk').mkdir()
        for i in range(size):
            (root / 'bulk' / f'mod{i:04}.py').write_text(f'import bulk.mod{i+1:04}\n' if i + 1 < size else '')
        start = perf_counter()
        graph = analyze(root)
    elif target.startswith('synthetic:'):
        graph = synthetic(int(target.split(':')[1]))
        root = Path(f'/synthetic-{target.split(":")[1]}')
    else:
        root = Path(target).resolve()
        graph = analyze(root)
    with create_server(root, graph, port=0, analysis_seconds=perf_counter() - start) as server:
        print(f'http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()
