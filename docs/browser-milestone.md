# Browser milestone implementation and acceptance

Version 0.2.0; verified 2026-09-25 against the Product Specification v0.1.
The [first milestone notes](implementation-notes.md) remain the record of
analysis semantics. This milestone adds the packaged local explorer without
changing graph schema 1.0 or the headless exit contract.

Follow-up: [two real repository validation](real-repository-validation.md)
records a successful remote CI matrix, real-project walkthroughs, and the
crossing-arrow interaction fix discovered during those walkthroughs. The
tables below preserve the original milestone verification record.

## Decisions and scope

- `archi PATH` analyzes once, starts a standard-library HTTP server and opens
  the default browser. `archi browse PATH` is an explicit alias. No arguments
  means the current directory. `--no-browser` supports manual opening.
- Bind exclusively to `127.0.0.1`; default port 8765 falls back to an assigned
  free port when occupied. Port 0 explicitly requests a free port. Serve only
  fixed bundled assets and the immutable graph/project snapshot. Validate Host
  and Origin, use a restrictive content security policy, and expose no source
  file route. Repository roots appear in local project metadata, not exports.
- React/TypeScript assets are compiled with esbuild and checked in. Node 24 is
  a frontend development dependency; the installed distribution has no Python
  runtime dependencies and needs no Node server, CDN, account or database.
- Use a small deterministic layout implementation, without a graph library:
  group strongly connected nodes and arrange bounded pages. Preserve selection
  and camera in navigation history. Arrows always point importer to dependency.
- Render at most nine nodes per desktop page, four below a 720-pixel canvas
  width, and 120 arrows. Search reveals any hidden node; node details include
  dependencies outside the visible page. Evidence and cycle lists are paged.
  These limits deliberately prioritize readable labels over graph density.
- Aggregation retains underlying direct edges and deduplicates import sites.
  UI diagnostics use the graph's IDs, members and evidence. `check` now prints
  affected node names as well, allowing direct CLI/browser comparison.
- Scope is an immutable snapshot. Live refresh, editor links, arbitrary custom
  groups and a Go analyzer remain deferred. Source-root, namespace, symlink,
  configuration and `.gitignore` decisions from milestone 1 remain in force.
- Verified platform: Linux x86_64, CPython 3.12.3, Chrome 153.0.8010.52.
  Python 3.11+ is required; 3.11/3.12/3.13 CI is configured but has not run
  remotely for these changes. Other OS/browser combinations are unverified.

## Passing verification

- Python acceptance: **27 passed** (`tests/test_acceptance.py`,
  `tests/test_server.py`), including the original headless scenarios.
- Frontend graph tests: **4 passed** (`ui/tests/graph.test.ts`).
- Browser acceptance: **10 passed**, 30.9 seconds, using the installed 0.2.0
  wheel for fixture servers with Node removed from the server's PATH.
  Synthetic and benchmark cases use the dedicated test host.
- Fresh virtualenv installation used `--no-index --no-deps`; the wheel smoke
  test passed help, check exits 0/1/2, browser HTML, compiled JS/CSS and graph API
  from another directory with no Node in PATH. The host has Node installed;
  this is runtime isolation, not a separate machine without Node installed.
- Manual preview of this real checkout: 17 modules, two packages, no rule
  violations, complete analysis. Keyboard search revealed `archi.server` on a
  hidden page and focused its node. Its dependency on `archi.model` showed
  `src/archi/server.py:16`, verified against `from archi.model import Graph`.
- Reviewed small, medium and dense screenshots. Automated checks cover
  1440×900 and 1024×768, no horizontal control overflow, visible focused nodes,
  reduced-motion styles and zero axe violations on the audited views.

### Requirement status

“Satisfied” below is limited to the verified runtime/browser. A partial row
is not a claim that the full specification acceptance has passed.

| IDs | Status | Acceptance evidence |
| --- | --- | --- |
| AN-01/02/03, IR-01/03, RL-01/03/04, CLI-02 | Retained, passing | Original Python acceptance suite; cross-runtime determinism still awaits the release matrix |
| AN-04, IR-02, UI-04 | Satisfied | Aggregate-arrow browser test opens all exact source sites and underlying module edges; graph projection unit tests |
| AN-05 | Satisfied | Malformed fixture retains usable nodes and incomplete banner; Python tests verify errors and exit 2 |
| RL-02, UI-06 | Satisfied | Browser test compares CLI IDs, affected members and every evidence site, then traces a closed cycle witness |
| CLI-01 | Satisfied | Headless subprocess tests from another directory; default browse/alias tests; installed wheel browser tests |
| UX-03 | Satisfied | Invalid path/config/read-error tests, real occupied-port fallback, browser-launch failure message |
| UI-01 | Satisfied for Chrome/Linux | React/TypeScript packaged assets; reviewed small/medium/5,000-module views and desktop/narrow screenshots; bounded layout and reduced motion |
| UI-02 | Satisfied | Two nested expansions, Back restores camera/selection, projection tests preserve counts |
| UI-03 | Satisfied in tested journeys | Pointer/keyboard pan, wheel zoom, fit and focus tests; selection retained without page scrolling |
| UI-05 | Satisfied | Shortcut search reveals collapsed and off-page modules, including the final node of the 5,000-module graph; manual real-project keyboard journey |
| UI-07 | Satisfied | Automated 1440×900 and 1024×768 viewport checks and visual review |
| UI-08 | Partial acceptance | Keyboard/focus restoration tests, manual search/focus journey, axe audits and reduced-motion assertions pass; full manual focus-order/reduced-motion walkthrough remains |
| OP-01 | Satisfied on recorded machine | Three analysis runs and three browser runs, reported below |
| OP-02 | Satisfied | 5,000-module graph opens, pages and searches while mounting at most nine graph nodes |
| UX-01 | Partial strict acceptance | Fresh offline virtualenv and installed browser tests pass without Node in runtime PATH; separate machine/environment with Node absent remains untested |
| UX-02 | Partial acceptance | Two fixture launch callbacks, installed browser fixtures and real checkout exploration pass; two unconfigured real repositories with actual automatic browser launch remain |
| UX-04 | Pending human acceptance | Landing counts/largest groups implemented; no first-time tester timed orientation study performed |
| UX-05 | Partial acceptance | External browser requests blocked, only loopback bound, fixed routes/Host/Origin tests pass; process-connection audit and separate LAN-client attempt remain |
| OP-03 | Partial acceptance | Local wheel/sdist build and offline installed smoke verified; CI workflow implemented but remote artifact build not yet run |

## Performance record (OP-01)

Reference machine: Intel Core i5-7300HQ CPU @ 2.50 GHz; Linux
7.0.0-31-generic x86_64/glibc 2.39; CPython 3.12.3; Chrome 153.0.8010.52.
Fixture: 500 actual Python modules under one namespace package, 499 imports
forming a chain. Browser viewport: 1440×900.

| Measurement | Three runs | Median | Target |
| --- | --- | --- | --- |
| Analysis | 284.3, 291.0, 276.9 ms | 284.3 ms | <10 s |
| Data ready to interactive map | 439.4, 31.3, 29.3 ms | 31.3 ms | <2 s |
| Expand package to rendered update | 94.7, 28.7, 31.1 ms | 31.1 ms | <200 ms usual case |

Map readiness is measured from parsed API data to the settled initial layout
after two animation frames. Interaction includes the click and two animation
frames, not the full optional entrance animation. These figures are scoped
measurements, not guarantees for arbitrary graph shapes or machines. The first
map run is included; later runs benefit from warm browser execution.

Reproduce with `PYTHONPATH=src python3 tests/benchmark.py` and
`npm --prefix ui run test:browser -- --grep 'OP-01'`. Raw timing JSON and
screenshots are written to ignored `.artifacts/` files.

## Packaging and remaining work

The wheel includes all compiled assets and their license notices. The source
distribution includes frontend sources, lockfile, build script, fixtures and
these notes, excluding node_modules and browser reports. See the README for
build/install commands and `.github/workflows/ci.yml` for the release checks.

Before declaring the full MVP accepted, finish the partial/pending rows above
and run the remote Python matrix. The results in this document record local
verification; remote CI results must be checked separately after pushing.

All specification `Later` requirements remain deferred: UX-06, IR-04,
RL-05/06, CLI-03, UI-09/10 and OP-04/05. In particular, a Go-shaped schema
fixture is not a Go analyzer, and rerunning the CLI is not incremental refresh.
