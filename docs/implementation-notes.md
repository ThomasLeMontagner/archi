# Milestone 1 implementation and acceptance notes

Source: **Architecture Explorer and Linter Product Specification v0.1**.
Scope: Python analysis core and headless CLI. Requirement IDs below retain
their meaning from the specification; implementing the backend of a browser
requirement does not complete that requirement.

## Decisions made before implementation

- **Runtime:** Python 3.11+ (stdlib `ast`, `tokenize`, `tomllib`, `argparse`,
  `unittest`). No runtime dependencies. Linux/CPython 3.12 is the verified
  environment; other Python/OS combinations need release-matrix testing.
- **Configuration:** only `<target>/pyproject.toml`, `[tool.archi]`. The schema
  is intentionally small and rejects unknown keys, wrong types, escaping
  paths, nonexistent source roots, and unknown forbidden-rule group names.
- **Source roots:** default to `.` and top-level `src/` if present. The deepest
  matching root owns each discovered file, so `src/foo.py` is `foo`, not
  `src.foo`. Explicit `source-roots` replaces the defaults and limits included
  modules. An import root containing `__init__.py` is itself a package named
  after that directory. This permits scanning a package directory directly.
- **Namespace packages:** source directories containing Python descendants
  become package groups even without `__init__.py`. Multiple physical
  packages with the same name remain separate candidates; they are not
  merged or resolved by an assumed runtime `sys.path` order. Ambiguity in an
  ancestor package also prevents a confident child-module edge.
- **Resolution:** no repository code is imported, and installed packages and
  interpreter search paths are not consulted. Missing names under a known
  local top-level name are `unresolved`; other missing names are `external`
  (availability unverified). Duplicate local names and potential symbols or
  re-exports are `uncertain`. These statuses are not analysis failures.
- **From-imports:** retain a confirmed edge to the base and, if found, the
  child module. A missing child becomes an uncertain symbol/re-export record,
  not a guessed edge. Wildcard exports are likewise uncertain. Relative
  imports that escape the containing package are unresolved. Dynamic imports
  and runtime package-path changes are outside scope.
- **Grouping and cycles:** default aggregation uses immediate owning packages.
  Internal/self edges disappear before SCC detection. Nested packages remain
  distinct owners, so a genuine parent/child dependency cycle can be flagged.
  Each SCC has one deterministic cycle witness and supporting source sites.
  Arbitrary named architectural group configuration is deferred.
- **Forbidden rules:** exact package names with required `include-descendants`
  boolean, applying to both endpoints. Each confirmed module edge that matches
  gets one diagnostic per rule. Policy does not guess through uncertain edges.
- **Discovery:** exclude common virtual environments (including arbitrary
  directories containing `pyvenv.cfg`), VCS/cache/build directories,
  `node_modules`, `site-packages`, and `*.egg-info`. Additional excludes use
  root-relative POSIX `fnmatch` patterns; matching a directory prunes its tree.
  No `.gitignore` support yet. File/directory symlinks are skipped to prevent
  escapes and traversal loops; the selected root itself is resolved first.
- **Partial analysis:** preserve discoverable nodes even when a file cannot
  be parsed/read, plus all valid files' imports. Issues include paths and
  normalized reasons; parser-specific error prose is omitted for stable
  output across runtimes. `check` and `export` return 2 for incomplete analysis.
  `export` otherwise returns 0, including when policy violations exist.
- **Canonical output:** relative POSIX paths, preserved filename case, sorted
  arrays/keys, stable logical IDs, no timestamps or absolute directory names.
  Newlines normalize to LF. Determinism assumes identical file names, source,
  analyzer version, settings, and syntax accepted by each runtime. Case-only
  filenames may not be representable on every filesystem; package-root
  renaming intentionally changes its import name.

## Acceptance status

Verified on 2026-09-24, Linux x86_64, CPython 3.12.3:

- `PYTHONPATH=src python3 -m unittest discover -v`: **21 tests passed**
  (3.5 seconds on the final source test run).
- Built `dist/archi_explorer-0.1.0-py3-none-any.whl` using
  `pip wheel --no-deps --no-build-isolation --no-index . -w dist`.
- Built `dist/archi-explorer-0.1.0.tar.gz` using setuptools' `build_sdist`.
  The source archive includes the tests, fixtures, spec, and implementation notes.
- Installed the wheel with `--no-index --no-deps` into a fresh virtualenv.
  From an unrelated temporary directory, with no Node in `PATH` and no
  `PYTHONPATH`, verified help, checks returning 0/1/2, JSON to stdout/file,
  and partial JSON with exit 2. The installed wheel has no runtime dependencies.
- The installed CLI analyzed this real Archi checkout: **12 modules, zero
  violations, complete analysis**. Its 79 external/unresolved/uncertain
  references remain visible in JSON; none are silently turned into edges.

Tests live in `tests/test_acceptance.py`; method names retain requirement IDs.
The following requirements' stated headless acceptance scenarios pass:

| ID | Status | Passing acceptance evidence |
| --- | --- | --- |
| AN-01 | Satisfied | `test_AN_01_discovery_exclusions_and_no_execution`: excluded trees, virtualenv marker, symlink loop/file, side-effect sentinel and raising fixture |
| AN-02 | Satisfied | `test_AN_02_all_static_import_sites_and_exact_text`, `test_AN_02_encoding_multiline_semicolons_and_aliases`: both syntaxes, nested/conditional imports, exact paths/lines/columns/text |
| AN-03 | Satisfied | Three `test_AN_03_*` methods: regular/namespace packages, `src/`, initializer modules, relative parents, explicit roots, externals, symbols, ambiguous ancestors; exact edge sets |
| IR-01 | Satisfied | `test_IR_01_roundtrip_python_and_non_python_same_schema`, `test_IR_01_reject_invalid_schema_and_references`: strict round-trips of Python and hand-built Go-shaped graph, invalid records rejected |
| IR-03 | Satisfied for tested runtime | `test_IR_03_deterministic_across_processes_locations_and_hash_seeds`: identical export bytes for five fixtures copied to another root and run under different hash seeds; normalization documented above |
| RL-01 | Satisfied | `test_RL_01_two_and_three_package_cycles_DAG_and_internal`: exactly two true SCCs, closed cycle witnesses with real edges/evidence; separate 1,500-node recursion-limit regression |
| RL-03 | Satisfied | `test_RL_03_default_cycle_rule_can_be_disabled_without_graph_change`: default violations, TOML disable passes with identical nodes/edges |
| RL-04 | Satisfied | `test_RL_04_exact_and_descendant_forbidden_rules`: exact match yields one edge, descendants yield four, unrelated edge excluded |
| CLI-02 | Satisfied | Three `test_CLI_02_*` methods plus malformed-file test: 0/1/2, invalid config, meaningful messages, analysis errors override violations |

Requirements with implemented, tested headless portions remain **partial**:

| ID | Passing backend evidence | Remaining acceptance |
| --- | --- | --- |
| AN-04 | `test_AN_04_IR_02_aggregation_deduplicates_sites_not_evidence` preserves multiple paths/lines | Click an edge and see every site in the browser |
| AN-05 | Two `test_AN_05_*` methods retain valid results, report syntax/read/discovery issues, and CLI test returns 2 | Browser shows partial results and marks incomplete analysis |
| IR-02 | Three sites across two modules aggregate to one arrow with three supporting edges; depth projection tested | Expand aggregate in browser and verify evidence |
| RL-02 | `test_RL_02_shared_diagnostics_stable_ids_and_source_lines` compares CLI with graph diagnostics | Compare the same IDs/members/evidence in the UI |
| CLI-01 | `test_CLI_01_headless_commands_from_another_directory` exercises help, check/export, stdout/file output outside target | `archi PATH` browser command |
| UX-03 | `test_UX_03_headless_bad_path_config_and_output_errors`; unreadable discovery test | Browser startup errors and occupied-port fallback |
| UX-01, OP-03 | Wheel build/clean-environment headless smoke test | Bundled UI, browser startup, full release artifacts and offline browser acceptance |

Unreadable file/directory conditions are fault-injected to work under both
ordinary users and privileged CI runners. The integration CLI tests use real
subprocesses, real fixture files, and their stdout/stderr/exit codes. Hand-built
Go data validates the adapter contract; it is **not** a Go analyzer and does
not complete IR-04.

## Browser milestone and deferred acceptance

- Implement `archi PATH`, a loopback-only server with automatic port selection,
  browser launch, root context, private/offline operation: UX-01/02/03/05,
  remaining CLI-01.
- Build and bundle the React/TypeScript UI: UI-01 through UI-08, UX-04. Include
  hierarchy navigation, pan/zoom/fit, search, keyboard access, dependency and
  cycle inspection, incomplete-analysis indicators, responsive layouts, and
  reduced motion.
- Verify evidence and diagnostic parity in the browser: remaining AN-04/05,
  IR-02, RL-02. Perform the real-project orientation walkthrough.
- Measure complete analysis/load/interaction performance on recorded hardware
  and bounded rendering for 5,000 modules: OP-01/02. Headless timings alone
  cannot complete these requirements.
- Build the full wheel and sdist with UI assets/build instructions and test
  installation offline without Node: remaining UX-01 and OP-03. Add Python
  and OS release-matrix verification before claiming cross-platform coverage.

All `Later` requirements remain deferred, including IR-04 (real Go analyzer),
RL-05/06, CLI-03, UI-09/10, OP-04/05, and UX-06. Browser requirements and the
overall first-release acceptance walkthrough are not marked complete.
