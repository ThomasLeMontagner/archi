# Architecture Explorer and Linter — Product Specification

**Status:** Baseline proposal · **Version:** 0.1 · **Date:** 2026-09-24  
**Intended readers:** Maintainers, contributors, designers, and reviewers  
**Requirement notation:** `MVP` is required for the first usable release; `Later` is planned but does not block it. IDs remain stable when wording changes.

## 1. Purpose and success criteria

Build a local application that helps a developer understand a Python repository and enforce chosen dependency rules. The developer runs `archi .`, explores a responsive architectural map in a local browser, and can run `archi check .` in CI. The Python parser is the first adapter; the graph model, rules, and UI remain usable by future language adapters.

The primary success test is a developer unfamiliar with a real Python project finding a package, tracing a dependency to its source import, and identifying a cycle without reading generated documentation. A second success test is installing the packaged tool and opening the map offline without Node, an account, configuration, or a separate server setup.

### Requirement conventions

- **Description** states observable behavior. **Verification** describes a reproducible acceptance test; a passing unit test alone is insufficient for a visual or installation requirement.
- **Package** means a Python import package or a configured architectural grouping. **Module** means one importable Python source unit. **Dependency** means a statically observed import, with source location and resolution status.
- A dependency arrow points **from importer to imported module**. Cycles are evaluated on the selected graph granularity; self-imports and within-package imports must not become misleading package cycles.
- No universal architecture score is implied. A diagnostic states the violated configured rule and the underlying evidence.

## 2. Requirements

### Installation and first use

| ID | Phase | Idea | Description | Verification |
| --- | --- | --- | --- | --- |
| UX-01 | MVP | Single installation | Install one Python distribution; bundle the compiled UI. Running the installed CLI requires Python and a browser, with no Node, database, account, or service installation. | Install from a built wheel in a clean environment without Node; run `archi --help`, `archi .`, and `archi check .`. |
| UX-02 | MVP | Zero-config start | `archi .` analyzes the given directory and opens the browser at a loopback URL. It selects sensible defaults and shows results without requiring a config file. | Run against two unconfigured Python repositories; both open an explorable map and show the analyzed root. |
| UX-03 | MVP | Predictable failures | A nonexistent path, inaccessible directory, invalid config, or occupied port produces a concise actionable message. Port selection is automatic when the default is occupied. | Trigger each condition; verify message, exit behavior, and alternate loopback port. |
| UX-04 | MVP | Fast orientation | The landing view displays repository name, module/package counts, cycle count, and the largest top-level groupings with legible dependency arrows. | A first-time tester identifies the largest grouping and opens a dependency explanation within two minutes, without instructions. |
| UX-05 | MVP | Offline and private | Scanning and browsing work without network access. The server binds only to a loopback interface; no source, metadata, or telemetry is sent externally. | Run with external networking disabled; inspect process connections and verify a LAN client cannot reach the server. |
| UX-06 | Later | Helpful onboarding | Offer a short, dismissible first-run hint explaining click, expand, search, and edge inspection; it must not block exploration. | Fresh profile can dismiss hints and use every control; a returning profile is not forced through onboarding. |

### Python analysis and graph model

| ID | Phase | Idea | Description | Verification |
| --- | --- | --- | --- | --- |
| AN-01 | MVP | Safe discovery | Find `.py` files under the selected root while excluding common virtual environments, caches, build outputs, and version-control directories. Never execute or import repository code. | Fixture includes valid files, excluded trees, and a file with top-level side effects; only valid paths appear and the side effect never runs. |
| AN-02 | MVP | AST extraction | Use the Python standard-library AST to extract `import` and `from ... import ...` statements with file and line number. Include imports inside functions and conditional blocks as static dependencies. | Fixture covers both import syntaxes at top level, inside a function, and inside a conditional; all locations match. |
| AN-03 | MVP | Import resolution | Resolve absolute and relative imports to local modules/packages where possible, including `__init__.py` and typical `src/` layouts. Preserve unresolved/external imports separately; never invent a local edge. | Fixture includes `src/`, namespace and regular packages, `from . import x`, `from ..pkg import y`, external modules, and ambiguous names; expected local edges and unresolved records match. |
| AN-04 | MVP | Evidence preservation | Every edge retains the exact import sites that produced it; deduplicate repeated edges without losing locations. | Two files importing the same target produce one aggregated edge with both sites; clicking it shows both paths and lines. |
| AN-05 | MVP | Partial results | A syntax error or unreadable file is reported with its path and reason; other files remain explorable. The UI marks analysis incomplete, and `check` exits as an analysis error. | Insert one broken file among valid files; valid nodes remain, the warning appears, and `check` returns 2. |
| IR-01 | MVP | Language-neutral graph | Define a versioned JSON graph with stable node IDs, node kind, parent ID, and typed edges with evidence. No required field assumes Python syntax. | Serialize and deserialize a Python fixture and a hand-built non-Python fixture through the same schema. |
| IR-02 | MVP | Hierarchical aggregation | Aggregate module edges into package/group edges. The aggregated count reflects distinct underlying import sites; opening it reveals the supporting edges. | Three import sites across two modules yield the correct package arrow count and evidence after expansion. |
| IR-03 | MVP | Deterministic output | Given the same files and settings, IDs, edge ordering, diagnostics, and exported JSON are stable across runs and machines with supported Python versions. | Analyze the same fixture twice and compare normalized exported bytes; document any platform-dependent path normalization. |
| IR-04 | Later | Cross-language validation | A second analyzer, initially Go, emits the same graph schema and uses the existing rule engine and UI without language-specific branches there. | Run equivalent Python and Go fixtures through identical graph checks and UI navigation tests. |

### Architecture rules and CLI

| ID | Phase | Idea | Description | Verification |
| --- | --- | --- | --- | --- |
| RL-01 | MVP | Package cycles | Detect strongly connected components in the package dependency graph and show at least one concrete cycle and supporting imports per component. Acyclic imports within one package do not count. | Fixtures contain a two-package cycle, a three-package cycle, a DAG, and internal imports; only the real package cycles are flagged. |
| RL-02 | MVP | Useful diagnostics | Each violation has a stable rule code, affected nodes, a short explanation, and source locations where applicable. CLI and UI show the same underlying violation. | Run `check` and open the UI on the same fixture; compare violation IDs, members, and evidence. |
| RL-03 | MVP | Opt-in policy | `no-cycles` is enabled by default; other architectural judgments require an explicit configuration. A config may disable the default cycle rule. | An unconfigured project reports a cycle; a config disabling it passes without altering the graph. |
| RL-04 | MVP | Forbidden dependency | Support configuration forbidding dependencies from one named package/group to another; specify whether descendants are included. | A fixture with direct and nested imports reports exactly the forbidden edges and no unrelated ones. |
| RL-05 | Later | Ordered layers | Configure allowed directions among named layers, including a clear policy for dependencies that skip layers. | Matrix of allowed, reversed, skipped, and outside-layer imports matches the configured policy. |
| RL-06 | Later | Coupling rules | Optionally set a maximum number of distinct outgoing package dependencies; report actual count and targets. | Package with N dependencies passes a limit of N and fails a limit of N−1 with named targets. |
| CLI-01 | MVP | Three core commands | `archi PATH` opens the explorer; `archi check PATH` runs headless; `archi export PATH` writes versioned JSON to stdout or a specified file. `--help` explains the commands. | Run all commands from a directory other than the target and validate their outputs and help text. |
| CLI-02 | MVP | CI exit contract | `check` exits 0 for passing checks, 1 for rule violations, 2 for invalid configuration or incomplete analysis. Output contains a human-readable summary. | Three fixtures exercise each exit code; capture stdout/stderr and verify meaningful messages. |
| CLI-03 | Later | Machine diagnostics | Offer a structured diagnostics format suitable for CI annotations without changing the human-readable default. | Schema validation and CI fixture confirm exact file/line mapping and stable rule IDs. |

### Browser explorer

| ID | Phase | Idea | Description | Verification |
| --- | --- | --- | --- | --- |
| UI-01 | MVP | Polished interface | Use React and TypeScript, packaged as static assets. Visual hierarchy, typography, contrast, spacing, and motion make dense maps readable. Motion should convey expansion and preserve orientation. | Review defined small, medium, and dense fixtures in supported browsers; verify no clipped labels, overlapping controls, or disorienting transitions. |
| UI-02 | MVP | Progressive navigation | Start with high-level groupings; expand/collapse packages to modules, with breadcrumb or back navigation. Avoid rendering the entire module graph at once. | Expand two nested levels and return; selected context is preserved and node/edge aggregation remains accurate. |
| UI-03 | MVP | Direct manipulation | Support pan, wheel/trackpad zoom, fit-to-view, selecting nodes, and focusing a selection. Controls remain usable with mouse and keyboard. | Execute the interactions on a large fixture; verify no lost selection or unintended page scrolling. |
| UI-04 | MVP | Inspect dependency | Clicking an arrow reveals direction, import count, importing/imported modules, file paths, and line numbers. The user can jump from aggregated to underlying evidence. | Select a package arrow with multiple sites and confirm every site against source fixture lines. |
| UI-05 | MVP | Fast search | Search package/module names with `Ctrl+K`/`Cmd+K`; selecting a result reveals and centers its node, expanding parents as needed. | Search for a collapsed nested module; confirm node becomes visible and focused without manual expansion. |
| UI-06 | MVP | Visible cycles | Cyclic dependencies are distinguishable on the map and linked to an explanation and source evidence; highlighting does not obscure ordinary graph reading. | Open a cyclic fixture, select the indicator, and trace the complete cycle to import sites. |
| UI-07 | MVP | Responsive layout | The explorer remains functional at desktop and narrow laptop viewport sizes; side panels adapt without hiding primary navigation. | Browser viewport checks at 1440×900 and 1024×768; no horizontal overflow of application controls. |
| UI-08 | MVP | Accessible controls | Keyboard users can reach search, graph items, zoom/fit controls, and details; provide visible focus, readable contrast, and reduced-motion behavior. | Navigate key journeys by keyboard; run an automated accessibility audit and manually check focus order and reduced-motion setting. |
| UI-09 | Later | Explore and Inspect views | Explore emphasizes structure; Inspect emphasizes violations. Switching modes retains selected component and zoom state. | Switch views during a selected-edge inspection; selection and camera position remain intact. |
| UI-10 | Later | Editor handoff | Source references can open the selected file and line in a configured local editor, with an explicit user action. | Configure two supported editors and verify the intended file/line opens; malformed paths cannot open outside the analyzed root. |

### Performance, packaging, and evolution

| ID | Phase | Idea | Description | Verification |
| --- | --- | --- | --- | --- |
| OP-01 | MVP | Measured responsiveness | Target initial analysis of 500 Python modules within 10 seconds and first interactive map within 2 seconds after data loads on a documented reference laptop. UI actions on a 500-module fixture should respond within 200 ms in the usual case. These are targets, not promises for every machine. | Repeat benchmark three times on a recorded machine; report median analysis, load, interaction time, and fixture shape. |
| OP-02 | MVP | Bounded rendering | Show aggregated graph levels and cap visible detail when a grouping is too large; provide search or further grouping instead of freezing. | Test synthetic 5,000-module graph; opening it stays responsive and never mounts thousands of visible nodes at once. |
| OP-03 | MVP | Reproducible release | Build a wheel including the precompiled UI and a source distribution with documented UI build steps; install wheel into a clean environment. | CI builds both artifacts; offline wheel smoke test verifies assets, `check`, and browser page. |
| OP-04 | Later | Incremental refresh | Reanalyze changed files and update affected edges without resetting the browser’s current selection or zoom. | Edit, add, and remove fixture imports while explorer runs; graph and diagnostics update and selection persists where valid. |
| OP-05 | Later | Architecture diff | Compare two Git revisions without modifying the working tree; display added/removed nodes, edges, and rule violations with evidence. | Fixture repository with known revision changes yields exact expected additions/removals. |

## 3. First release boundaries

The MVP includes Python import dependencies, package/module hierarchy, cycle detection, configurable forbidden dependencies, JSON export, CLI checks, and the local browser experience above. It does not promise a call graph, dynamic imports, runtime dependency injection, service boundaries inferred from deployment, or semantic understanding of interfaces. Those relationships require separate evidence models and should not be presented as facts inferred from ordinary imports.

Configuration should use one documented TOML location (for example, `[tool.archi]` in `pyproject.toml`) with a small, validated schema. A future decision record should settle package grouping and namespace-package conventions before the parser is implemented; ambiguous module resolution must surface as uncertainty, not a confident arrow.

## 4. Release acceptance walkthrough

1. Build and install the wheel into a clean, offline Python environment without Node.
2. Run `archi .` against one real local Python project and one test fixture. Confirm the browser opens and the top-level map explains the repository.
3. Search for a nested module, expand its parent, inspect a dependency, and verify every displayed file and line against source.
4. Run `archi check .` on passing, cyclic, forbidden-edge, and malformed-source fixtures. Verify the stated exit codes and the same diagnostics in the browser.
5. Complete a keyboard navigation check, viewport check, and measured performance run. Record findings and any accepted deviations in release notes.

## 5. Decisions to record during implementation

These are explicit design choices, not hidden assumptions: supported Python versions and operating systems; the treatment of namespace packages and multiple import roots; `.gitignore` support; configuration paths; graph-layout library; supported browsers; and benchmark hardware. Record each decision with its rationale and update affected requirement tests. Changes to requirement meaning receive a spec revision while retaining the ID.
