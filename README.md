# Archi

Archi statically maps Python imports and checks package dependencies. This first
milestone provides the analysis library and headless CLI. It never imports or
executes scanned code and has no runtime dependencies. Requires Python 3.11+.
The browser explorer is planned for the next milestone.

## Install and try it

From this checkout:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/archi --help

# Analyze Archi itself as a real repository, or substitute your project's path.
.venv/bin/archi check .
.venv/bin/archi export . --output architecture.json
```

The target directory can be outside the current directory. Paths containing
spaces should be quoted. On Windows, use `.venv\Scripts\python.exe` and
`.venv\Scripts\archi.exe`. Linux is the tested platform for this milestone.

```sh
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

# Offline build when setuptools and wheel are already available:
python3 -m pip wheel --no-deps --no-build-isolation --no-index . -w dist
python3 -m venv /tmp/archi-smoke
/tmp/archi-smoke/bin/python -m pip install --no-index --no-deps dist/archi_explorer-0.1.0-py3-none-any.whl
/tmp/archi-smoke/bin/archi check .
```

The installable distribution is `archi-explorer`; the command and Python
package are `archi`. Building needs setuptools and wheel, but the installed
tool only needs Python. A full browser release will also bundle UI assets.

## Adapter API

`archi.core.analyze(path, adapter=...)` accepts the `Analyzer` protocol in
`archi.adapter`. An adapter implements `analyze(root: Path, config: Config)`
and returns a `Graph` with source nodes, typed import edges, unresolved
references, and analysis issues. Shared code aggregates dependencies, runs
rules, validates the result, and serializes it. The Python adapter is in
`archi.python_analyzer`; a future Go adapter can use the same pipeline.

See the [graph contract](docs/graph-format.md) and
[requirement acceptance record](docs/implementation-notes.md).
