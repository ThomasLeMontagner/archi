"""Repeatable headless half of OP-01; no timing assertions on shared CI hosts."""
import json
from pathlib import Path
import platform
from statistics import median
import tempfile
from time import perf_counter

from archi.core import analyze

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='archi-benchmark-') as folder:
        root = Path(folder)
        (root / 'bulk').mkdir()
        for i in range(500):
            (root / 'bulk' / f'mod{i:04}.py').write_text(f'import bulk.mod{i+1:04}\n' if i < 499 else '')
        timings = []
        for _ in range(3):
            started = perf_counter()
            graph = analyze(root)
            timings.append(perf_counter() - started)
            assert graph.complete and not graph.diagnostics
            assert sum(n.kind == 'module' for n in graph.nodes) == 500
        cpu = next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines()
                    if line.startswith('model name')), 'unknown') if Path('/proc/cpuinfo').exists() else platform.processor()
        result = {'python': platform.python_version(), 'platform': platform.platform(), 'cpu': cpu,
                  'shape': '500 modules, one namespace package, 499 chain imports',
                  'analysisSeconds': timings, 'medianSeconds': median(timings)}
        Path('.artifacts').mkdir(exist_ok=True)
        Path('.artifacts/analysis-benchmark.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
