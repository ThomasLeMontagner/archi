# Archi

Archi maps Python imports in a local browser and checks package dependencies
in CI. It never imports or executes scanned code and has no runtime dependencies.
Requires Python 3.11+ and, for the explorer, a browser. The wheel includes the
compiled React/TypeScript UI; Node is only needed to develop the UI.

## Install and try it

From this checkout:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/archi .
```

This opens the architecture map at a loopback URL. Keep the command running
while browsing; press Ctrl+C in that terminal to stop the server. Use
`--no-browser` to print the URL without opening it, or `--port 0` to choose
a free port. The default port is 8765; an occupied port falls back automatically.

The target directory can be outside the current directory. Paths containing
spaces should be quoted. On Windows, use `.venv\Scripts\python.exe` and
`.venv\Scripts\archi.exe`. Linux is the tested platform for this milestone.

```sh
archi /absolute/path/to/python-repository
archi check /absolute/path/to/python-repository
archi export /absolute/path/to/python-repository > architecture.json
```

`check` prints a summary, stable diagnostic IDs, rule codes, and evidence:

| Exit | Meaning |
| --- | --- |
| 0 | Analysis complete and checks pass |
| 1 | Analysis complete with rule violations |
| 2 | Invalid path/configuration, incomplete analysis, or an I/O error |

`export` writes only versioned JSON to stdout, or to `-o` / `--output`. It
returns 0 even when rules fail. Incomplete analysis still produces a partial
graph with `complete: false`, reports issues on stderr, and returns 2. Invalid
configuration prevents export. Errors take priority over violations.
External or uncertain imports are information, not analysis errors.

## Explore the map

- Start with the largest packages and module/package/cycle counts.
- Select a node to inspect its incoming and outgoing dependencies. Use its
  arrow button (or double-click) to expand a package. Breadcrumbs and Back
  restore earlier contexts and selections.
- Select a dependency arrow to see its direction, distinct import-site count,
  underlying module edges, and exact file/line evidence.
- Select a rule violation to focus its members and trace a concrete cycle.
- Press **Ctrl+K** / **Cmd+K** to find any module, including collapsed or
  paged modules. Search reveals and centers the result.
- Drag empty map space to pan; scroll to zoom. With the map focused, use arrow
  keys to pan, **+ / −** to zoom, and **F** to fit. Every graph node, arrow,
  search result, and toolbar action is keyboard reachable.

Views show up to nine nodes (four on narrower canvases) and 120 arrows. Paging,
search, and the inspector expose remaining nodes and dependencies without
mounting thousands of graph items. Edges in the map connect nodes within the
current view; a selected node's inspector also shows dependencies outside it.
External/uncertain references are separately inspectable. Syntax/read failures
produce a visible incomplete-analysis banner, while valid files remain usable.

The server serves an immutable snapshot. Rerun Archi after source changes.
It binds only to `127.0.0.1`, uses no external assets, sends no telemetry, and
serves only the bundled UI and graph metadata—not repository file URLs.

## Package metrics

Selecting a package shows **incoming packages**, **outgoing packages**, and
**package-import instability**: `outgoing / (incoming + outgoing)`. An isolated
package shows **N/A**. Open either contributor list to reveal a package or
inspect the exact imports behind its count. These are informational metrics;
high instability is not a lint failure or a quality score.

The selected package includes all descendants. Internal imports are excluded;
each outside package counts once per direction, using the module's immediate
owning package. Nested outside packages count separately. The definition stays
fixed when the map expands or pages, and selected-package details remain open
while paging. Existing incoming/outgoing **edge** counts remain separate from
these distinct **package** counts.

Only confirmed local imports contribute. The inspector reports excluded
external, uncertain and unresolved reference records originating in the
selected subtree, plus import sites involving root-level modules without a
package. Incomplete graphs show a provisional-values notice. This is an
import-based adaptation, not Martin's original class-based metric; Abstractness
and a Stable Dependencies rule are not implemented. See the
[metric decisions and acceptance notes](docs/package-metrics.md).

## Configuration

Configuration is read only from the **target directory's** `pyproject.toml`.
No config is needed. By default, cycles are checked, common generated trees
are skipped, and both the repository root and top-level `src/` are import roots.

```toml
[tool.archi]
no-cycles = true
# Optional: replace default import roots. Paths are relative to the target.
source-roots = ["src"]
# Optional: add case-sensitive patterns matched against root-relative paths.
exclude = ["tests/fixtures", "generated", "vendor/*"]

[[tool.archi.forbidden]]
from = "myapp.domain"
to = "myapp.web"
include-descendants = true
```

Set `no-cycles = false` to disable cycle diagnostics without changing graph
nodes or edges. Each forbidden rule must specify `include-descendants`:
`false` matches exactly the named owning packages; `true` also matches their
nested packages on both ends. Unknown group names and unknown config keys
are errors. Forbidden diagnostics are emitted per confirmed module edge.
Only Python package groups are configurable in this milestone; arbitrary
architectural grouping is deferred.

Imports are static facts, including conditional and function-local statements.
For `from package import child`, the base package and a known child module
both receive edges. If `child` may instead be a symbol/re-export, only the
base edge is confirmed and a separate uncertain record preserves the name.
The tool does not evaluate dynamic imports, exports, `sys.path` changes, or
installed dependencies. See [implementation decisions](docs/implementation-notes.md).

## Test and package

```sh
PYTHONPATH=src python3 -m unittest discover -v

# Rebuild the bundled UI and run frontend acceptance tests (Node 24):
cd ui
npm ci
npm run build
npm test
npx playwright install chromium  # only needed if system Chrome is unavailable
npm run test:browser
cd ..

# Offline build when setuptools and wheel are already available:
python3 -m pip wheel --no-deps --no-build-isolation --no-index . -w dist
python3 -m venv /tmp/archi-smoke
/tmp/archi-smoke/bin/python -m pip install --no-index --no-deps dist/archi_explorer-0.2.0-py3-none-any.whl
/tmp/archi-smoke/bin/archi check .
```

The installable distribution is `archi-explorer`; the command and Python
package are `archi`. Building needs setuptools and wheel, but the installed
tool only needs Python and a browser. UI assets are checked in under
`src/archi/static/`; `ui/build.mjs` rebuilds them from the locked frontend dependencies.
The source distribution contains the UI sources, lockfile, tests, and build instructions.

For a wheel and source distribution, install the development build tool
(`python3 -m pip install build`) and run `python3 -m build`. Run the offline
installed-wheel smoke test with:

```sh
python3 tests/package_smoke.py dist/archi_explorer-0.2.0-py3-none-any.whl
```

CI rebuilds the UI, checks that bundled assets match, runs Python and browser
acceptance tests, builds both distributions, and tests the wheel with no Node
in its runtime PATH. See [browser milestone notes](docs/browser-milestone.md)
for verification results and remaining release acceptance.

## Adapter API

`archi.core.analyze(path, adapter=...)` accepts the `Analyzer` protocol in
`archi.adapter`. An adapter implements `analyze(root: Path, config: Config)`
and returns a `Graph` with source nodes, typed import edges, unresolved
references, and analysis issues. Shared code aggregates dependencies, runs
rules, validates the result, and serializes it. The Python adapter is in
`archi.python_analyzer`; a future Go adapter can use the same pipeline.

See the [graph contract](docs/graph-format.md) and
[requirement acceptance record](docs/implementation-notes.md).
