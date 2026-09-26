# Informational package metrics (unreleased)

This feature extends the Product Specification v0.1 after the v0.2.0 release.
`MET-*` IDs below are new extension requirements, not pre-existing MVP IDs.
They complement UI-04 (evidence), UI-08 (accessible controls), IR-02 (aggregation)
and RL-03 (opt-in policy). No new architecture judgment is enabled.

## Definition and decisions

The inspector computes **package-import instability** from confirmed local
`imports` edges in graph schema 1.0:

`I = outgoing packages / (incoming packages + outgoing packages)`

The result is a ratio in [0, 1], displayed to two decimal places with its exact
integer inputs. A zero denominator is **N/A**, not 0. High or low values are
descriptions of coupling direction, not grades or rule violations. This is an
import-based adaptation of [Martin's package stability metric](https://objectmentor.com/resources/articles/stability.pdf),
whose original inputs involve class dependencies across package boundaries.

Ambiguities settled for this implementation:

- **Selected boundary:** the selected package and every descendant node. An
  import entirely inside or entirely outside this boundary contributes nothing.
- **Outside owners:** a module belongs to its nearest enclosing group. An
  import directly targeting a namespace group belongs to that group. Each
  owner's stable ID contributes at most once per direction. Repeated imports,
  multiple modules, and multiple source sites never inflate package counts.
- **Nested peers:** outside nested packages count separately. For example,
  imports from `alpha.main` and `alpha.nested.worker` into `beta` count as two
  incoming packages to `beta`: `alpha` and `alpha.nested`. When selecting
  `alpha`, its nested package is inside the boundary and contributes no
  internal coupling. An ancestor of a selected nested package counts only for
  crossing imports from/to nodes outside that selected subtree.
- **Navigation:** metrics use the full graph, independent of the current map
  scope, page, zoom, rendered arrows or cycle highlighting. Paging retains a
  selected node's inspector even when the node is off the current page.
- **Ungrouped modules:** the repository root is not a package for these
  metrics. Imports involving root-level modules are excluded and exposed as
  deduplicated import sites with evidence. This does not change cycle-rule
  grouping or the underlying graph.
- **Coverage:** only confirmed local import edges contribute. Show counts of
  external, uncertain and unresolved reference records originating in the
  selected subtree; these are not counts of external packages or sites.
  Incoming unresolved references cannot reliably be assigned to the package.
  A partially resolved from-import can have both a confirmed base dependency
  and a separate excluded uncertain symbol record; those are not exclusive
  categories of source statements.
- **Partial results:** incomplete analysis keeps available metrics visible,
  prominently marked provisional. N/A on a partial graph means no observed
  package coupling, not proof of isolation in the complete repository.
- **Evidence:** contributor lists retain every supporting direct edge and
  distinct import site. They support package navigation and evidence inspection,
  including a return to the originating package's metrics.
- **Compatibility:** this is a pure TypeScript graph calculation, memoized for
  the selected node. No Python syntax or package-name splitting is used.
  Schema 1.0, `archi export`, `archi check`, diagnostics, configuration and exit
  codes are unchanged. Metrics are not serialized into exports in this version.

## Acceptance requirements

| ID | Requirement | Passing focused evidence |
| --- | --- | --- |
| MET-01 | Correct distinct incoming/outgoing counts and ratio; 0/1 endpoints and N/A isolation | Graph tests cover 2/3, 1/2, 0, 1, N/A, repeated imports, self/internal edges and mutual dependencies |
| MET-02 | Stable documented package boundaries across scope and pagination | Nested owner assertions, projection independence, and browser expand/back/page checks retain 1 incoming / 2 outgoing / 0.67 for alpha |
| MET-03 | Inspect contributors and the exact imports behind counts | Browser shows all five alpha-to-beta sites, drills into repeated module imports, returns to metrics, opens incoming delta evidence, and reveals beta |
| MET-04 | Visible reference exclusions, ungrouped sites and partial-analysis limitations | Unit assertions for all statuses and source sites; browser coverage, root-module evidence and provisional notice checks |
| MET-05 | Informational, accessible package-only feature without changing lint policy | Browser keyboard activation, axe audits at 1440×900 and 1024×768, no horizontal overflow, package-only rendering, explicit adaptation explanation, and headless fixture check |

The new `tests/fixtures/metrics` fixture has repeated imports, a namespace
target, nested packages, self/internal imports, an isolated package, external
and unresolved names, a possible symbol import, and root-level modules. It
explicitly disables the cycle rule because its two root-module directions
create a package-level cycle under the existing rule grouping. The separate
`cycles` fixture checks mutual metric contributions with the rule both enabled
and disabled. The `malformed` fixture verifies provisional metrics.

Validation on Linux / Python 3.12.3 / Chrome (2026-09-26):

- Production TypeScript build: passed.
- Full Python suite: 27 tests passed.
- Eight graph tests: passed.
- Full browser suite: 14 tests passed, including all three new metric acceptance
  tests, against a freshly built wheel installed into a clean virtual environment.
  The packaged browser harness runs without Node on the server's PATH.
- Real-repository walkthrough: SatelliteMLPipeline's `model` package shows two
  incoming packages (`api`, `core_pipeline`), one outgoing package (`utils`), and
  instability 0.33. Checked the exported crossing edges and opened the five
  supporting `model` → `utils` import sites in the inspector. The root-level
  `constants` dependency is excluded with visible evidence; 17 external and 14
  uncertain outgoing reference records are reported separately.

Run the focused checks with `npm --prefix ui test` and
`npm --prefix ui run test:browser -- --grep 'MET-'`. To verify a wheel installation,
set `ARCHI_TEST_CLI` to its virtual environment's `archi` executable when running
the browser suite. The local validation wheel retains the development version;
this feature has not been published in the v0.2.0 release.

Abstractness, class analysis, metric-driven lint rules, thresholds, metric
history and public JSON metric fields remain deferred. These metrics do not
complete RL-06 (configurable maximum outgoing coupling), which remains an
independent opt-in rule proposal.
