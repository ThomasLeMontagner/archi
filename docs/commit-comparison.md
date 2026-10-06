# Commit comparison (unreleased)

This milestone adds `CMP-01` through `CMP-05` as extension requirements, building
on AN-01/05, IR-01/02/03, RL-02 and UI-04/08. Interfaces, class/API signatures,
rename inference, and merge-base/three-way comparison remain out of scope.

## Usage

```sh
archi compare /path/to/repository --base v0.2.0 --head HEAD
archi compare /path/to/repository --base HEAD~1 --head HEAD --json
archi compare /path/to/repository --base HEAD~1 -o comparison.json
```

Git must be installed and both commits available locally. `--head` defaults to
HEAD; `--base` is required. Without `--json` or `-o`, the command opens the local
browser; `--no-browser` prints its URL, and `--port 0` chooses an available port.
A directory inside a working tree compares the entire repository. Uncommitted,
staged, untracked, and ignored working-tree changes are not snapshot inputs.

Exit 0 means both analyses completed, even if there are differences or rule
violations. Exit 2 means incomplete analysis, invalid references/configuration,
missing Git, unsupported input, or an I/O error. An incomplete comparison still
exports available results; the browser command returns 2 after its server stops.
Comparison does not introduce an exit-1 policy or change `archi check` semantics.

## Definition and boundaries

- Resolve both refs to exact commit IDs before analysis. Read tracked blobs from
  Git's object database into temporary directories. Do not check out, reset,
  register worktrees, run hooks or checkout filters, or execute repository code.
  Git replacement objects are disabled. Temporary snapshots are cleaned up.
- Each snapshot uses its own root `pyproject.toml`. Any change to that file shows
  a configuration notice; this deliberately includes unrelated project metadata
  edits. A missing file uses normal defaults. Invalid configuration is an error.
- Materialize Python files, the root configuration, virtualenv markers, and
  tracked parent directories so normal discovery and explicit source roots work.
  Submodules and symlinks are not followed and create snapshot issues. They make
  the comparison provisional, even when outside the analyzed source roots.
- Reject unsupported/unsafe filenames and impose 32 MiB per analyzed blob and
  256 MiB total per snapshot. Normal graph discovery exclusions still apply.
- Match nodes by stable ID and dependencies by `(kind, source, target)`.
  The initial Python adapter's path-based identity means a rename is a removal
  plus an addition. New/removed packages and modules are structural changes.
- A retained dependency is **modified** when its set of ordinary/type-only site
  classifications changes. Differences only in location, statement text, or
  number of sites are **evidence changed**, not structural additions/removals.
  These are hidden by default in the browser, with an explicit checkbox/filter.
  Both direct imports and aggregated package dependencies are compared.
- A missing-before record is **uncertain** if the base analysis is incomplete;
  a missing-after record is uncertain if the head is incomplete. This conservative
  treatment prevents omitted/malformed files from becoming definite changes.
- Diagnostics are compared by stable diagnostic ID, preserving before/after
  evidence. Added/removed means reported/no longer reported under each commit's
  policy. A changed cycle witness or evidence can modify a retained diagnostic.
- External/unresolved/uncertain references remain available in both snapshots;
  they are not turned into confirmed dependency changes. Coverage and issues
  remain inspectable. All imports are included in the change list; existing
  type-only filters and package metrics are available separately in each map.
  This version does not produce a numerical metric-delta report.

## Interchange and browser

Comparison JSON has `comparison_version: "1.0"`, exact `base_commit` and
`head_commit`, `complete`, `configuration_changed`, full schema-2.0 `base` and
`head` graphs, and `changes` arrays for `nodes`, `dependencies`, and `diagnostics`.
Each entry has `status`, `before` and `after` (null on an absent side). Embedded
graph edges have `count`; delta edge records expose evidence directly without a
redundant count. Output is sorted, newline-terminated, and free of temporary or
absolute host paths. The normal graph schema remains 2.0.

The comparison server adds fixed JSON routes `/api/comparison`, `/api/base-graph`
and `/api/head-graph`. The normal `/api/graph` is the head snapshot. A normal
(non-comparison) explorer returns null from `/api/comparison`. Same-origin,
loopback-only hosting and no repository filesystem serving remain in force.
Each snapshot map exports its own graph. Change lists have text status badges,
search, status/dependency-level filters, and bounded pages of 20 records.

## Acceptance tracking

| ID | Requirement | Evidence |
| --- | --- | --- |
| CMP-01 | Analyze committed trees without checkout changes or execution; explicit omissions; stable root identity | Git-history tests preserve dirty index/worktree/HEAD, ignore untracked files, omit links/submodules, preserve virtualenv markers and root-package names |
| CMP-02 | Distinguish structural, classification and evidence changes deterministically | Graph comparison test covers package/module add/remove, import replacement, line shifts, type-only changes, new cycles, same-commit emptiness and repeatability |
| CMP-03 | Explain incomplete analysis and avoid definite changes inferred from missing data | Forward/reverse malformed-history tests and provisional browser acceptance |
| CMP-04 | Browser/headless CLI, export, configuration notices, error/exit behavior | CLI tests cover JSON/file export, ref errors, configuration changes, partial exit 2 and browser payload |
| CMP-05 | Inspect changes and exact before/after evidence, access both maps and exports | Browser tests cover filters, evidence-only rows, base/head exports, provisional issues and accessibility |

Validation completed on Linux / Python 3.12.3 / Chrome, 2026-09-27:

- Full Python suite: **38 passed**, including six comparison acceptance tests.
- Graph suite: **9 passed**.
- Full browser suite against a clean wheel installation: **17 passed**, including
  both comparison tests, snapshot exports, before/after evidence, provisional
  results, and axe audits at 1440 and 768 pixels.
- Production TypeScript build, `git diff --check`, and offline installed-wheel
  smoke (assets, API, no Node server dependency, CLI exits 0/1/2) passed.
- Real-repository comparison of Archi `v0.2.0` (`92ce1a3e716a`) to `main`
  (`1d034e4dbca7`) completed: one added module, five added direct dependencies,
  five evidence-only dependency records, and no changed diagnostics. Opened
  an added dependency and verified its head-side file/line evidence in the browser.

CMP-01 through CMP-05 are satisfied within the documented boundaries by these
passing acceptance tests. The local wheel retains the development application
version; this feature has not been released.
