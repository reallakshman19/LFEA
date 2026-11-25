# LFEA roadmap

Based on `docs/AUDIT.md` and `docs/DRIFT_REVIEW.md` (2026-11-25).
Ordered by what blocks real engineering use first. Sizes are rough:
S ≈ ≤1 day, M ≈ 2–5 days, L ≈ 1–3 weeks. Items marked **🔒 owner** need an
engineering or product decision before work starts.

**Goal:** a piping engineer imports a real CAESAR II model, runs the standard
load cases, and gets trustworthy **support loads** and **B31.3 code
stresses**, with evidence, in one app.

## Phase 0 — Hygiene and correctness (≈1 week)

| # | Item | Size | Done when |
|---|---|---|---|
| 0.1 | Restore B34-T14 refusal in result recovery: a code station at an unknown node must be refused (regression from AA3 `382fac12`) | S | `lfea-b3.4-recovery-check` passes |
| 0.2 | **🔒 owner** Decide where the pressure-elongation term lives (frame element vs section/pressure authority); then fix `b3.1`, `b3.14` and the component-promotion guard | M | 3 checks pass |
| 0.3 | Update the stale guards: `b3.6` import path; model-health source set; step-guidance state. Re-pin the friction execution hash after diff review. | S | 4 checks pass |
| 0.4 | Remove `[SIMULATED] Load Mock Data` from the production UI (keep it for tests/dev only) | S | Not in the built bundle |
| 0.5 | `npm audit fix` (fast-xml-parser); plan the xlsx replacement (SheetJS CDN build or exceljs) before any unwired XLSX code is wired in | S | `npm audit --omit=dev` shows no high severity in shipped code |
| 0.6 | Accessibility: tab bar as a real `tablist` with `aria-selected`; label the 6 unlabelled inputs | S | axe check clean on all tabs |
| 0.7 | Publish: make the repo public and enable Pages (commands in README) | S | App live at `/LFEA/` |

## Phase 1 — Real models run (≈2–3 weeks)

| # | Item | Size | Done when |
|---|---|---|---|
| 1.1 | **🔒 owner** Choose the default branch-factor edition policy (B31.3 Appendix D vs B31J) | — | Decision recorded |
| 1.2 | Add a branch-factor authority control to Source/Review. Reuse the unwired `lfea-bend-factor-authority-control` / S6 authority, so a user can seal the edition. | M | BM4 pre-flight is not BLOCK; `lfea-bm4-inputxml-preflight`, `bm4-cii-output-comparison` and `pipeline-analysis` checks pass |
| 1.3 | Findings triage UI: blocking first, grouped by code with counts, one consistent total across Source and Review | M | Blocking item visible without scrolling |
| 1.4 | Multi-case runs (W, WP, WPT, WT, and operating/sustained/expansion sets) from the Model tab in one action | M | BM1 runs all 4 cases |
| 1.5 | Persist runs and evidence across reloads (IndexedDB), with an explicit "clear" | M | History survives reload; e2e covers it |
| 1.6 | Promote ACCDB as a first-class source on the Source tab (move it out of the benchmark panel) | M | BM4_L.ACCDB imports from Source |
| 1.7 | Real-model e2e: BM1 and BM4 through Source → Results in CI | S | New spec green in CI |

## Phase 2 — Engineering deliverables (≈4–6 weeks)

| # | Item | Size | Done when |
|---|---|---|---|
| 2.1 | Support loads (Fa/Fl/Fv): build the governed interface set in-app. The user confirms up-axis and parallel tolerance with explicit, recorded defaults. | L | Support-actions publication unblocked for BM1/BM4; values match CAESAR within stated tolerance |
| 2.2 | **🔒 owner** Bundle a sealed ASME B31.3 edition dataset and code profile (allowables, SIF/flexibility basis) with source custody | M | No JSON pasting needed |
| 2.3 | B31.3 code check end to end: sustained, expansion range and occasional, with a code-point recovery UI | L | Code stress table for BM1 matches the CAESAR output report within tolerance |
| 2.4 | Load-case combinations and envelopes per B31.3 (reusing `linear-piping-multicase-application`) | M | Expansion-range and envelope results shown |
| 2.5 | **🔒 owner** Resolve the tee 20295 accuracy gap (1.3214 vs 1.323) | M | `m047-tee-rigid-thermal` passes without widening tolerance |
| 2.6 | Strict profile coverage: real bends (not straight chords) and friction or unilateral handling, so fewer models need the approximation profile | L | BM1 runs under the strict profile |
| 2.7 | Get the BM2/BM3 benchmark files and re-enable their 12 checks | S | 12 checks pass |

## Phase 3 — Usable product (≈3–4 weeks)

| # | Item | Size | Done when |
|---|---|---|---|
| 3.1 | Engineering units and formatting: mm, kN, N·m, MPa; significant-figure rounding; unit switcher; raw values on demand | M | No raw float strings in default views |
| 3.2 | Model and result viewer: wire `src/workspace/lfea-svg/*` for isometric model, node labels, deflected shape, support markers | L | Results show the deflected shape |
| 3.3 | Results UX: filter/sort by node, element and case; highlight governing values | M | — |
| 3.4 | Report export: calculation package (PDF/XLSX) with inputs, limitations, results and code check | M | One-click report |
| 3.5 | Plain-language layer over identities and hashes (details collapsible) | M | Hashes hidden by default |
| 3.6 | Decide on each of the 46 unwired modules (`docs/UNWIRED_MODULES.md`): wire or delete | M | List empty |

## Phase 4 — Performance and platform (ongoing)

| # | Item | Size |
|---|---|---|
| 4.1 | Code-split per tab (main chunk 1.35 MB → < 400 kB first load) | M |
| 4.2 | Run solve and recovery in the existing worker for large models; add a progress indicator | M |
| 4.3 | Lazy-load Pyodide (14 MB) only when StagedJSON conversion is used | S |
| 4.4 | Break up >1,000-line modules (`caesar-accdb-linear-solve.js` etc.) under the repo's 300-line rule | M |
| 4.5 | **🔒 owner** Retire or port the WP3–WP9 release-governance checks that never pass outside AA3 CI | S |
| 4.6 | Add a Windows CI job (the code base has Windows-path and line-ending sensitivity) | S |
| 4.7 | Versioning and releases: semantic version in the UI (currently `v0.0.0`), changelog, tagged releases | S |

## Decisions needed from the owner

1. Pressure-elongation term placement (0.2).
2. Default branch-factor edition policy (1.1).
3. Which B31.3 edition dataset to bundle, and its source custody (2.2).
4. Accept or investigate the tee 20295 difference (2.5).
5. Keep or retire the WP3–WP9 governance programme (4.5).
6. Repo visibility / Pages (0.7).

## Suggested first sprint

0.1, 0.3, 0.4, 0.5, 0.6. Then 1.1 → 1.2, which makes BM4 run.
