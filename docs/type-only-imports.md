# Type-only imports (v0.3.0)

`TC-*` are new extension IDs, supplementing AN-02, IR-01/02/03, RL-01/04,
UI-04/08 and MET-01/04. Package and Git-commit comparison remains deferred.

## Decisions

- Keep all source imports by default. Classification is evidence-level: an edge
  can contain both ordinary and type-only sites without duplicating dependencies.
- Recognize direct positive `if TYPE_CHECKING:` and `if typing.TYPE_CHECKING:`
  guards, including explicit aliases in module-level `typing` imports that appear
  before the guard. Relative imports and unresolved/external records preserve
  the same classification. Nested statements inherit an enclosing type-only
  guard. The guard's `else` does not inherit that guard (but retains any outer
  type-only context).
- Never execute imports or evaluate conditions. Unknown, compound, negated,
  dynamically constructed or function-local aliases are not classified. A name
  rebound anywhere in the file, including parameters, assignment, other imports,
  exception/match bindings, or attribute assignment, invalidates recognition
  conservatively across that file. Wildcard imports also invalidate aliases.
  A local module/package named `typing` disables this recognition. This may miss
  valid type-only sites; it avoids deliberately hiding ambiguous dependencies.
  Dynamic monkey-patching is outside this static model.
- `include-type-only = true` is the default rule policy. False excludes recognized
  sites from both cycle and forbidden-dependency checks. Mixed edges retain their
  ordinary sites. Aggregates are rebuilt before checking. Exit codes are unchanged.
- Export retains every import regardless of rule policy. Required evidence field
  `type_only: boolean` changes the strict interchange contract to **2.0**.
  Reader and browser reject 1.0; regenerate snapshots rather than silently
  relabeling unknown old data. Logical edge IDs remain stable.
- Browser evidence shows **Type-only** labels. The checkbox changes map edges,
  node dependency lists, reference lists, and package metrics together. Nodes are
  retained even if isolated by filtering. Coverage counts refer to included sites.
- Rules and their count retain the configured policy, stated beside the filter.
  Opening a rule restores all imports. Cycle highlights are suppressed while
  excluding type-only imports if the lint policy included them, avoiding a claim
  that the filtered graph still has the same cycle. Switching filters clears view
  history and stale dependency selections; selected nodes remain selected.
- No new runtime dependency, repository execution, Git comparison, or API/class
  extraction is introduced. This feature ships in v0.3.0; published v0.2.0 assets remain unchanged.

## Acceptance evidence

| ID | Acceptance | Tests |
| --- | --- | --- |
| TC-01 | Classify supported guards conservatively, retain exact mixed/relative/reference evidence | `tests/test_type_checking.py`: aliases/nesting/else and ambiguous guard tests |
| TC-02 | Opt-in exclusion affects cycle/forbidden rules, not export; preserve exit codes and reject invalid config | Policy and CLI tests in `tests/test_type_checking.py` |
| TC-03 | Browser labels sites and filters map/metrics without hiding ordinary mixed sites; independent rule scope and accessibility | Graph test and browser test named `TC-03` |
| TC-04 | Versioned strict, deterministic interchange with type-only metadata | Schema test plus IR-03 cross-root/process/hash-seed test including `type_checking` |

Validation completed on Linux / Python 3.12.3 / Chrome, 2026-09-27:

- 32 Python acceptance tests passed; the extended IR-03 test also passed after
  adding the type-only fixture to cross-root/process/hash-seed verification.
- 9 graph tests passed.
- 15 browser tests passed against a fresh wheel installed into a clean virtual
  environment, including keyboard filter activation, type-only evidence labels,
  changed package metrics, unchanged export, restoring rule evidence, and axe
  audits at 1440 and 1024 pixels.
- Production TypeScript build and `git diff --check` passed.
- Offline wheel smoke test passed: no Node on PATH, check exit codes 0/1/2,
  packaged assets, browser response and schema 2.0 graph API.

TC-01 through TC-04 are satisfied by these passing acceptance tests. Recognition
limitations above remain explicit; general Python control-flow evaluation is not
claimed.
