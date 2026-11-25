# LFEA end-to-end audit

Date: 2026-11-25 · Commit audited: `aa0e7e4` · Tester: the running app on a
Vite dev server (Edge/Chromium), plus code, CI and dependency inspection.

## 1. Journey tested with real models

| Step | BM1 (16 nodes / 15 elements, real CAESAR II InputXML) | BM4 (97 nodes / 96 elements, real model, repaired) |
|---|---|---|
| Import InputXML | ✅ Parsed; SHA-256, unit (mm) and 4 load cases shown | ✅ Parsed |
| Pre-flight | `WARN`: 34 conditional findings (disclosed approximations) | ❌ **`BLOCK`, "Available cases: None"** |
| Review / accept limitations | ✅ Reviewer + reason seals authorization | ❌ Not possible: blocked |
| Model | ✅ Identities, 2 materials, 6 sections, 22 constraints, 4 cases | — |
| Run | ✅ Case W solved and recovered in **1.2 s** | — |
| Results | ✅ Raw displacements and recovered element actions (209 table rows), CSV export | — |
| Support loads (Fa/Fl/Fv) | ❌ `BLOCKED` (needs a governed interface set, up-axis and parallel tolerance) | — |
| B31 code check | ❌ `BLOCKED`. The Code checks tab asks the user to paste an already-sealed code profile and edition dataset as JSON | — |
| Verification / dossier | ✅ Evidence dossier can be created | — |
| History / Compare | ✅ Within a session. ❌ **Runs are lost on page reload**: History is empty after reload | — |

**What blocks BM4.** The pre-flight finding
`BRANCH_FACTOR_EDITION_AUTHORITY_UNRESOLVED`: welding tees need an
explicitly sealed B31.3/B31J branch-factor authority. The standalone UI has
no control to supply it. Also, that single blocking finding is item 134 of
1,347 list entries on the Source page, below 162 conditional findings.

**Conclusion.** The standalone app can import, govern, solve and recover
small models. It cannot yet run a real-size CAESAR model with welding
tees, and it does not produce the two outputs a piping engineer needs:
support loads and code stress.

## 2. UX findings

1. **Finding lists are not prioritised.** Blocking items are buried, and the
   Source view shows "Review findings — 34" while Review shows "Findings 150
   (34 conditional)" for the same model.
2. **Numbers are raw SI floats** with full precision, e.g.
   `0.001093713766532283 m`. No engineering units (mm, kN, N·m), rounding or
   per-quantity unit selection.
3. **No model or result visualisation in the main flow.** Results is
   tables only. The SVG model viewer (`src/workspace/lfea-svg/*`) is one of
   the 46 unwired modules.
4. **Jargon-first copy:** identity hashes, `fnv1a64:` IDs and authority codes
   dominate every view. Useful for audit, heavy for daily use.
5. **A `[SIMULATED] Load Mock Data` button ships in the production
   Verification tab** (`lfea-workbench-controller.js` → `lfea-mock-data`).
6. **ACCDB import is hidden** inside a "CAESAR ACCDB benchmark" panel on the
   Verification tab, not offered as a source on the Source tab.
7. **Layout:** the Source form wraps awkwardly at normal widths; the status
   line and the authorization form compete for space.

## 3. Accessibility

- The tab bar is a set of buttons without `role="tablist"` / `role="tab"`
  / `aria-selected`.
- 6 form controls have no label or `aria-label`.
- `lang="en"` and a single `h1` are present (good).

## 4. Engineering-correctness status

See `docs/DRIFT_REVIEW.md` for detail. Highlights:

- **Likely regression:** result recovery no longer refuses a code station at
  a non-existent node (B34-T14), since AA3 `382fac12`.
- **Accuracy gap:** tee 20295 FLEXb 1.32142 vs CAESAR 1.323 (0.12% > 0.1%).
  The check has never passed.
- **Approximation profile:** BM1 runs only under
  `DISCLOSED_GENERIC_ANALYZER_APPROXIMATION_V1`, which, among other
  things, treats **bends as straight chords** and **ignores friction**. The
  strict profile refuses these models.
- 53 inherited check failures, classified in `EXTRACTION_REPORT.md`.

## 5. Code, build and dependencies

| Area | Finding |
|---|---|
| Size | 758 JS files / 56.6 k lines in `src/`; the app itself (`src/lfea`) is 6.0 k lines. 451 modules reachable from the app, 46 unreachable and untested. |
| Largest files | `fea-benchmarks/caesar-accdb-linear-solve.js` (2,646 lines), `caesar-accdb-friction-solve.js` (1,440), `lfea-pipeline-accdb-input-panel.js` (1,051). Several modules exceed the 300-line rule the repo's own guards enforce elsewhere. |
| Bundle | Main chunk **1.35 MB** (≈375 kB gzip) loaded up front for every tab, plus a 175 kB worker. No per-tab code splitting. |
| Static assets | `public/vendor` is 14 MB (Pyodide for StagedJSON→InputXML), deployed even though the main flow doesn't use it. |
| Dependencies | `npm audit`: **xlsx** (high; prototype pollution and ReDoS, no npm fix) is not in the standalone bundle today but is used by unwired modules. **fast-xml-parser** via mdb-reader: fix available (`npm audit fix`). |
| Tests | 462 check scripts. 256 run in CI and pass on Linux; 53 inherited failures; 1 standalone e2e spec (2 tests) using small synthetic fixtures only. There is **no e2e test on a real model**. |
| CI | Lint, checks, build, artifact check and browser journey on ubuntu-24.04. Green. |
| Repo | Private. Pages workflow ready but off. |
