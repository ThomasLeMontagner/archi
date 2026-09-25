# Two real repository validation

Verified on 2026-09-25 with the installed Archi 0.2.0 wheel, CPython 3.12.3
on Linux, and the Codex in-app browser at 1280×720. The wheel was rebuilt
after fixing the crossing-arrow bug described below.

Both targets are existing local repositories with no `[tool.archi]` settings.
They were scanned as working trees without changing files, installing their
dependencies, importing their code, or running their application/tests.
CLI commands ran from `/tmp`, outside both target directories.

| Result | SatelliteMLPipeline | satellite-orbit-risk |
| --- | --- | --- |
| Git revision | `f63904b` | `022d7a4` |
| Discovered modules | 24 | 35 |
| Packages, excluding graph root | 6 | 13 |
| Direct import edges | 34 | 42 |
| Package dependency edges | 10 | 21 |
| External references | 53 | 61 |
| Uncertain symbol/re-export references | 52 | 47 |
| Unresolved local references | 0 | 0 |
| Analysis complete | Yes | Yes |
| Rule violations / package cycles | 0 / 0 | 0 / 0 |
| `check` / `export` exit codes | 0 / 0 | 0 / 0 |
| Repeated export bytes identical | Yes | Yes |
| Browser API identical to CLI export | Yes | Yes |
| Distinct graph evidence sites checked against source | 34, all match | 42, all match |

Each discovered module set exactly matches the repository's tracked `.py`
files: no missing or extra modules. Existing untracked caches, local data,
editor files and environment settings were not changed.

## Browser walkthroughs

### SatelliteMLPipeline

- Landing map correctly shows repository root, 24 modules, six packages and
  zero cycles, matching `check`. Largest groups are `core_pipeline` and
  `model`, each containing seven modules.
- Selected `model → utils`: five distinct sites and five underlying edges.
  Confirmed `model/health.py:14,15`, `model/inferences.py:17`,
  `model/train.py:16`, and `model/train_from_tiles.py:17` against source.
- Ctrl+K searched `orchestration.dags.batch_inference_dag`. Tab and Enter
  revealed its nested package and focused the selected module. Its external
  Airflow imports and uncertain imported symbol were separately inspectable.
- Back restored the overview, camera and previously selected `model → utils`
  dependency with all five evidence sites.

### satellite-orbit-risk

- Landing map correctly shows repository root, 35 modules, 13 packages and
  zero cycles, matching `check`. The largest grouping is `app` (31 modules).
- Expanded `app`, selected `app.api → app.schemas`, and verified all three
  source sites: `app/api/routes_conjunctions.py:9`, `routes_health.py:3`, and
  `routes_satellites.py:7`.
- Expanded a second level into `app.services`. Its child packages and the
  conjunctions-to-propagation dependency remain visible.
- Ctrl+K searched `app.services.propagation.propagator`. Keyboard selection
  revealed and focused that module, preserving its four-level breadcrumb.
  The inspector showed its dependency on `app.db.models`, two importing
  modules, and separate external/uncertain references.

Neither repository contains a detected cycle, so this is a zero-violation
CLI/browser comparison. Non-empty diagnostic IDs, affected members, closed
cycle witnesses and evidence remain covered by the passing cyclic fixture
tests. These scans do not validate actual runtime import behavior: installed
dependencies and runtime search paths are intentionally not inspected.

## Bug found and fixed (UI-01, UI-04, UI-08)

In the first map, two diagonal dependencies placed their evidence badges at
the same crossing point. Clicking the `model → utils` edge control selected
`orchestration → core_pipeline`, obscuring the intended evidence.

The fix positions inter-row badges a quarter of the way along their curve,
near the importer, and makes the badge itself the accessible button. The line
remains clickable; keyboard focus visibly outlines its badge and highlights
the corresponding line. This resolves the observed collision, without
claiming a general crossing-free graph layout.

The new `crossing` fixture reproduces the four-package topology without using
either project's source code. The browser regression first failed on
overlapping badge bounds, then passed after the fix. It checks non-overlap,
correct pointer selection/evidence for both crossings, and keyboard selection
of the first dependency.
The corrected interaction was also verified again in SatelliteMLPipeline.

Validation after the fix:

- TypeScript/production asset build: passed.
- Four frontend graph tests: passed.
- Eleven browser tests: passed, including the new regression, existing
  evidence/navigation/cycle checks, accessibility audits and 5,000-node case.
- New regression against the rebuilt installed wheel: passed.
- Both real-repository servers served JS identical to the rebuilt asset.
- `git diff --check`: passed.

The last full CI run on commit `e62fddc` passed Python 3.11, 3.12 and 3.13,
including browser tests, artifact builds and offline wheel smoke tests:
[GitHub Actions run](https://github.com/ThomasLeMontagner/archi/actions/runs/36147505001).
The crossing-arrow fix and this report are local changes and have not yet
been run in remote CI.

## Requirement evidence and limits

- **AN-01/02/04, IR-02/03, CLI-01/02, UI-02/04/05:** additional real-project
  discovery, evidence, deterministic export, navigation and search checks pass.
- **RL-02:** both real maps agree with the CLI's empty diagnostic set; the
  existing cyclic fixtures validate populated diagnostics.
- **UX-02:** both unconfigured real repositories produce explorable maps with
  correct roots. Normal browser-launch commands were attempted, but the
  default OS browser handoff was not directly observable through the available
  browser controls; the printed URLs were opened explicitly for verification.
  Keep that final automatic-launch acceptance item pending.
- **OP-03:** the remote build/packaging matrix has now passed for `e62fddc`.
  Re-run CI after committing the newly discovered UI fix.
- **UX-04:** this was an agent walkthrough, not a timed first-time human study.
  Manual accessibility/reduced-motion and network-isolation release checks
  from the browser milestone remain separate acceptance work.

Raw graph JSON and CLI output are retained locally under ignored
`.artifacts/real-repositories/`; repository source was not copied into fixtures.

## Repeat the walkthrough

From the Archi checkout, install the rebuilt wheel and run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --no-index --no-deps --force-reinstall dist/archi_explorer-0.2.0-py3-none-any.whl
.venv/bin/archi check ../SatelliteMLPipeline
.venv/bin/archi ../SatelliteMLPipeline --port 0
# Stop with Ctrl+C before the next project.
.venv/bin/archi check ../satellite-orbit-risk
.venv/bin/archi ../satellite-orbit-risk --port 0
```

Use the graph's search shortcut and dependency badges to repeat the journeys
above. Rebuild the wheel first if running from a fresh checkout; instructions
are in the README. Run the focused regression with:

```sh
npm --prefix ui run test:browser -- --grep 'crossing arrows'
```
