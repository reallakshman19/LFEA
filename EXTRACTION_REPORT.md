# LFEA extraction report

Source: `reallakshman19/AA3` @ `a8650bb` (2026-10-11).
Extracted: 2026-11-25.
Comparison baseline: an unmodified AA3 checkout at the same commit, both
trees checked out with LF line endings and run with Node 22 on Windows 11.

## Result

| | LFEA | Unmodified AA3 |
|---|---|---|
| LFEA check scripts run | 310 | 310 (same list) |
| Pass | 257 | — |
| Fail | 53 | all 53 also fail in AA3 |
| Fail only in LFEA | **0** | |

The green set is listed in `scripts/ci-checks.json`: 256 checks.
`npm run check:ci` runs the 255 that need no browser; `npm run check:ci-browser`
runs the one that needs Chromium. The 257th, `lfea-standalone-build-artifact-check`,
needs `dist-lfea/` and runs after `npm run build`. All 257 pass on Windows
(Node 22) and in GitHub Actions on ubuntu-24.04.

Also verified:

- `npm run build`, `lfea-standalone-build-artifact-check`
- `e2e/lfea-standalone.spec.js` (2/2): Source → Run → Results →
  Verification/Dossier → stale → rerun → Compare → reload, plus the
  malformed-source test
- `npm run lint`

> **Line endings matter.** Several checks hash or regex-match source text.
> On Windows with `core.autocrlf=true`, a CRLF checkout makes extra checks
> fail in both repos. This repo pins LF in `.gitattributes`.

## Changes relative to AA3

| File | Change | Why |
|---|---|---|
| `package.json` | Only LFEA / linear-piping / ACCDB / StagedJSON scripts. New `gate`, `check:ci`, `check:ci-browser`. `check:lfea-b3.4` moved directly after `b3.3` in `check:lfea-linear-core`. | New repo; the B-3.4 source guard requires that order |
| `vite.config.js`, `vite.lfea.config.js` | Single `lfea.html` input, vendor-only chunks, base `/LFEA/` | Own app; AA3's core partitions made circular chunks here |
| `public/index.html` | `/LFEA/` redirects to `lfea.html` | Root URL |
| `playwright.config.js` | Readiness probe hits `/LFEA/lfea.html` | `/` is 404 under a base path |
| `e2e/lfea-standalone.spec.js`, `scripts/lfea-standalone-e2e-source-check.mjs`, `scripts/lfea-phase6h-demo-browser-check.mjs` | `/Advanced_Analysis/` → `/LFEA/` | Base path |
| `scripts/lfea-standalone-boundary-check.mjs` | An import of a LAFEA / legacy-shell path is a violation even though the file is absent | LAFEA is physically absent here |
| `scripts/lfea-standalone-boundary-self-test.mjs` | Physical absence is the permanent state | Same |
| `scripts/run-lfea-standalone-check.mjs` | Dropped the removed source-workflow check | Combined-shell check |
| `scripts/lfea-001-check.mjs`, `scripts/lfea-002-check.mjs` | Dropped the retired per-PR source guard from the runner list | See below |
| `eslint.config.js` | Ignore `dist-lfea`, `public/vendor`, `scripts/retired` | Built or vendored files |
| `src/workspace/lfea-case-selection-preferences.js` | `eslint-disable-next-line no-control-regex` on a regex that rejects control characters | The control-character regex is intentional |
| `.gitattributes` | `* text=auto eol=lf` | See the note above |

Evidence and governance records still name their origin repository
`reallaksh19/Advanced_Analysis`. That is provenance and was left unchanged.

## Removed or retired

**Removed: they assert wiring inside AA3's combined app.** These read
`src/main.js`, `bootstrap.js` or `workspace-layout.js`.

- `lfea-p0-ui-containment-check`
- `lfea-pipeline-analysis-anti-drift-check`
- `lfea-pipeline-verification-drawer-anti-drift-check`
- `lfea-preflight-phase1-review-source-check`
- `lfea-s3-bend-factor-authority-control-check`
- `lfea-ui-engineering-session-integration-check`
- `lfea-ui-error-check-check`
- `lfea-ui-results-authority-check`
- `linear-piping-inputxml-source-workflow-check`
- `linear-piping-presentation-anti-drift-check`
- `linear-piping-workspace-integration-check`
- `linear-piping-inputxml-analyzer-integration-check`
- `qa-check` (AA3's combined-app QA runner)

**Retired to `scripts/retired/`:** `lfea-001…006-source-guard`,
`w10.11-pipe-solver-source-guard`. These are per-PR delivery guards that
diff pinned AA3 base commits against `HEAD`, so they cannot pass outside
AA3's history.

**Not copied:** LAFEA, the combined shell (`src/main.js`, `index.html`,
`analyze.html`, `bootstrap.js`), WRC/EMP.1, first-cut load estimation, the
14 combined-app `e2e/lfea-pipeline-*` specs, and AA3's
`.github/workflows/lfea-*.yml`.

**Evidence file restored:** `reports/lfea-bm1-cii-output-comparison.json` is
byte-identical to AA3 (blob `0ee951b`). Note that
`lfea-bm1-cii-output-comparison-check` rewrites this file on every run. With
current code it differs from the stored evidence only at about 1e-22 (float
noise), in both repos.

## The 53 known failures (all also fail in unmodified AA3)

### A. Missing upstream inputs (19), which need files from the owner

- **BM2 / BM3 benchmark XML** (`benchmarks/LFEA/BM2`, `BM3`) is not in AA3.
  Affected: `lfea-b3.25`, `b3.26` ×2, `b3.28`, `b3.29`,
  `lfea-bm2-consolidated-latest-output`, `lfea-bm3-consolidated-latest-output`,
  `lfea-common-caesar-output-benchmark-policy`,
  `lfea-common-inputxml-restraint-correction`, `lfea-inputxml-load-diagnostics`,
  `lfea-m028-bm3`, `lfea-m029-bm3-hanger`.
- **GitHub workflow files that AA3 does not contain:** `lfea-piping-phase6e`,
  `phase6i-governance-recording`, `phase6i-independent-closure` anti-drift.
- **Phase-6I anti-drift** expects `linear-piping-presentation-anti-drift-check`
  (combined-shell, removed above).
- `lfea-piping-a0-baseline-check` needs a git `origin` remote and pinned
  baseline. `lfea-piping-phase-findings-check`: `LFEA_PHASE_EVIDENCE_MISSING`.
- `lfea-bm4l-built-asset-check` expects the combined app to emit BM4_L.ACCDB
  under `dist/`. The standalone app does not import the pinned-ACCDB module
  (see `docs/UNWIRED_MODULES.md`).

### B. Evidence tools, not standalone checks (13)

These need command-line inputs (receipts, ACCDB tables, logs) that CI
workflows supplied in AA3:

- `lfea-bm4l-bend-retopology-source`, `lfea-bm4l-bend-tangent-source`
- `lfea-bm4l-e75-*` (7)
- `lfea-bm4l-rx-source-topology`
- `lfea-m047-bm4l-residual-invariant`
- `lfea-production-caesar-parity-evidence`
- `lfea-s4-reducer-parity-evidence-file`

### C. Engineering / authority drift upstream (21), for engineering review

These are in protected domains (solver, recovery, B31 code engine, benchmark
authority, result custody). **Nothing here was changed to make a check pass.**
Each failure means AA3's source moved after the check or its pinned
evidence was written. Someone has to decide which side is right.

| Check | Failure | Likely meaning |
|---|---|---|
| `lfea-bm4-inputxml-preflight` | BM4 pre-flight returns `BLOCK` | Pre-flight became stricter, or a BM4 regression. Also blocks `lfea-bm4-cii-output-comparison` and `lfea-pipeline-analysis`. |
| `lfea-b3.14-appendix-s-example3` | `frameElementInput is missing pressure` | Frame-element contract now requires `pressure`; the fixture predates it |
| `lfea-b3.4-recovery` | Expected exception not thrown | Recovery is more permissive than the check expects |
| `lfea-b3.23-reducer-condensation` | Candidate reducer authority is reachable from the production consumer | Reducer augmentation was promoted to production without updating the guard |
| `lfea-b3.1-source-guard` | Section geometry read in the frame element | Source changed against the B-3.1 authority rule |
| `lfea-b3.6-sparse-assembly` | Qualification no longer uses `sparseMultiply` | Solver refactor |
| `lfea-m047-tee-rigid-thermal` | Tee 20295 FLEXb in-plane 1.3214 vs 1.323 | 0.1% numeric drift against the reference |
| `lfea-m047-stage2-friction` | L5 execution hash changed | Pinned run hash out of date, or behaviour changed |
| `lfea-m047-bm4l-t1-interval-authority` | Rotation zero gate unchanged | Interval authority evidence out of date |
| `lfea-inputxml-model-health-source` | Extra `accdb-source-binding.js` in the source set | ACCDB binding added after the pin |
| `lfea-standalone-native-execution` | `requireAxisCustody` no longer present | Execution-authority refactor |
| `lfea-ui-numerical-custody` | `linear-piping-inputxml-prefea.js` blob hash drifted | Pre-flight wrapper edited after the UI-only freeze |
| `linear-piping-project-qualification-anti-drift`, `lfea-piping-release-readiness` | `RELEASE_LEDGER_MUTATION` in `governance-recording.js` | Release ledger code edited after the freeze |
| `lfea-piping-phase6g/6h-anti-drift`, `lfea-piping-wp3-runtime-bundle-assembler` | Bundle package-id mismatch / missing marker | Runtime bundle schema moved |
| `lfea-piping-component-promotion-anti-drift` | `pressureCorrectionApplied !== false` not found | Component-promotion code moved |
| `lfea-pipeline-step-guidance` | Step state `CURRENT` vs expected `COMPLETE` | UI state semantics changed |

## Modules not wired into the standalone app

See `docs/UNWIRED_MODULES.md`:

- 451 modules are reached from `src/lfea/main.js`.
- 275 more are exercised by checks.
- 46 are neither. These are mostly AA3's LFEA pipeline screens, the
  candidates to either wire into `src/lfea` or delete.
