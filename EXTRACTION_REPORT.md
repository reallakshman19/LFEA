# LFEA extraction report

Source: `reallakshman19/AA3` @ `a8650bb` (2026-10-11).
Extracted: 2026-11-25.

## Verified in this repo

| Check | Result |
|---|---|
| `scripts/lfea-standalone-boundary-check.mjs` (446 modules, no LAFEA / combined shell) | PASS |
| `scripts/lfea-standalone-boundary-self-test.mjs` (LAFEA absent; LAFEA + legacy imports rejected) | PASS |
| Standalone qualification steps from `scripts/run-lfea-standalone-check.mjs` | all PASS except `lfea-standalone-native-execution-check`, which also fails in AA3 |
| `npm run build` + `lfea-standalone-build-artifact-check` | PASS |
| `e2e/lfea-standalone.spec.js`: Source → Run → Results → Verification/Dossier → stale → rerun → Compare → reload, plus the malformed-source test | 2/2 PASS (Edge channel) |
| Every `scripts/*-check.mjs` / `*-guard.mjs` (330) | 250 PASS. The 67 still failing also fail in an unmodified AA3 checkout on the same machine (listed below). |

## Changed relative to AA3

- `package.json`: only LFEA / linear-piping / ACCDB / StagedJSON scripts.
  New `gate` script: the LFEA parts of AA3's `gate`, then `build`.
- `vite.config.js`: single `lfea.html` input, vendor-only manual chunks.
  AA3's core partitions produced circular chunks in this smaller graph.
- `vite.lfea.config.js`: delegates to `vite.config.js`.
- `playwright.config.js`: the webServer readiness URL is now `/Advanced_Analysis/lfea.html`.
- `scripts/lfea-standalone-boundary-check.mjs`: an import of a LAFEA or
  legacy-shell path is reported as a boundary violation even though the
  file no longer exists here.
- `scripts/lfea-standalone-boundary-self-test.mjs`: AA3's "physical-absence"
  mode is now the permanent state of this repo.
- `scripts/run-lfea-standalone-check.mjs`: dropped the removed source-workflow check.

## Removed: checks that assert wiring inside AA3's combined app

These read `src/main.js`, `src/workspace/bootstrap.js` or
`src/workspace/workspace-layout.js`, which don't exist in a standalone LFEA app.
Their npm-script references were removed as well.

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

The 14 `e2e/lfea-pipeline-*` / `lfea-workbench` specs that drive AA3's
combined `index.html` were not copied either.

## Not copied

LAFEA (`src/**/lafea*`), the combined shell (`src/main.js`, `index.html`,
`analyze.html`, `src/workspace/bootstrap.js`), WRC/EMP.1, first-cut load
estimation, the CII standalone port beyond the 2 files LFEA imports, and
`.github/workflows/lfea-*.yml`. The workflows use AA3's CI setup; add them
deliberately if you want CI.

## Checks failing here and in unmodified AA3

These failures are not caused by the extraction.

### Assertion / source drift upstream (37)

- `scripts/lfea-001-check.mjs` — Error: ENOENT: no such file or directory, scandir 'D:\D:\CodeE\LFEA\src\core\element-fea'
- `scripts/lfea-001-source-guard.mjs` — Error: ENOENT: no such file or directory, scandir 'D:\D:\CodeE\LFEA\src\core\element-fea'
- `scripts/lfea-002-check.mjs` — const err = new Error(message);
- `scripts/lfea-002-source-guard.mjs` — const err = new Error(message);
- `scripts/lfea-003-source-guard.mjs` — const err = new Error(message);
- `scripts/lfea-b3.1-source-guard.mjs` — AssertionError [ERR_ASSERTION]: section geometry must not be read here; the compiled A, Iy, Iz, J states are the section authority
- `scripts/lfea-b3.14-appendix-s-example3-check.mjs` — throw new FrameElementError(message, code);
- `scripts/lfea-b3.23-reducer-condensation-check.mjs` — AssertionError [ERR_ASSERTION]: Candidate reducer condensation authority must not be reachable from the production linear-piping consumer.
- `scripts/lfea-b3.4-recovery-check.mjs` — AssertionError [ERR_ASSERTION]: Missing expected exception.
- `scripts/lfea-b3.4-source-guard.mjs` — AssertionError [ERR_ASSERTION]: check:lfea-b3.4 must run inside check:lfea-linear-core, directly after check:lfea-b3.3
- `scripts/lfea-b3.6-sparse-assembly-check.mjs` — Node.js v22.23.2
- `scripts/lfea-bm4-cii-output-comparison-check.mjs` — throw new Error('BM4 unexpectedly BLOCKED at pre-flight; see lfea-bm4-inputxml-preflight-check.mjs.');
- `scripts/lfea-bm4-inputxml-preflight-check.mjs` — AssertionError [ERR_ASSERTION]: BM4 pre-flight returned BLOCK
- `scripts/lfea-bm4l-e75-weight-bending-evidence-check.mjs` — AssertionError [ERR_ASSERTION]: Expected authentic E75 gravity/bending receipt path
- `scripts/lfea-bm4l-rx-source-topology-check.mjs` — TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type string. Received undefined
- `scripts/lfea-inputxml-model-health-source-check.mjs` — AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
- `scripts/lfea-m047-bm4l-residual-invariant-check.mjs` — throw new Error('usage: node lfea-m047-bm4l-residual-invariant-check.mjs <authority.json> <bm4l-report.json>');
- `scripts/lfea-m047-bm4l-t1-interval-authority-check.mjs` — if (!condition) throw new Error('M047_T1_INTERVAL_AUTHORITY_CHECK_FAILED: ${message}');
- `scripts/lfea-m047-stage2-friction-check.mjs` — AssertionError [ERR_ASSERTION]: L5 execution hash changed
- `scripts/lfea-m047-tee-rigid-thermal-check.mjs` — AssertionError [ERR_ASSERTION]: tee 20295 FLEXb in-plane: 1.3214165064292276 vs 1.323
- `scripts/lfea-pipeline-analysis-check.mjs` — AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to:
- `scripts/lfea-pipeline-step-guidance-check.mjs` — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
- `scripts/lfea-piping-a0-baseline-check.mjs` — const err = new Error(message);
- `scripts/lfea-piping-component-promotion-anti-drift-check.mjs` — Node.js v22.23.2
- `scripts/lfea-piping-phase-findings-check.mjs` — const error = new Error(code);
- `scripts/lfea-piping-phase6g-anti-drift-check.mjs` — AssertionError [ERR_ASSERTION]: The validation function is expected to return "true". Received false
- `scripts/lfea-piping-phase6h-anti-drift-check.mjs` — Node.js v22.23.2
- `scripts/lfea-piping-release-readiness-check.mjs` — Node.js v22.23.2
- `scripts/lfea-piping-wp3-runtime-bundle-assembler-check.mjs` — AssertionError [ERR_ASSERTION]: The validation function is expected to return "true". Received false
- `scripts/lfea-standalone-e2e-source-check.mjs` — AssertionError [ERR_ASSERTION]: The input did not match the regular expression /base: '\/Advanced_Analysis\/'/u. Input:
- `scripts/lfea-standalone-native-execution-check.mjs` — AssertionError [ERR_ASSERTION]: The input did not match the regular expression /requireAxisCustody/u. Input:
- `scripts/lfea-ui-continuity-check.mjs` — - active completed steps do not remain visibly current
- `scripts/lfea-ui-numerical-custody-check.mjs` — AssertionError [ERR_ASSERTION]: governed pre-flight wrapper drifted during the UI-only program: src/workspace/linear-piping-inputxml-prefea.
- `scripts/linear-piping-project-qualification-anti-drift-check.mjs` — Node.js v22.23.2
- `scripts/qa-check.mjs` — ❌ Workspace E2E Tests failed.
- `scripts/stagedjson-to-inputxml-vendor-check.mjs` — name: 'AssertionError'
- `scripts/w10.11-pipe-solver-source-guard.mjs` — const err = new Error(message);

### BM2/BM3 benchmark files absent upstream (12)

- `scripts/lfea-b3.25-bm2-inputxml-ingestion-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-b3.26-bm2-case-authority-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Output_BM2.xml'
- `scripts/lfea-b3.26-bm2-solve-comparison-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-b3.28-bm2-junction-surface-node-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-b3.29-bm2-bend-geometry-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-bm2-consolidated-latest-output-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Output_BM2.xml'
- `scripts/lfea-bm3-consolidated-latest-output-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM3\BM3_Output.xml'
- `scripts/lfea-common-caesar-output-benchmark-policy-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Output_BM2.xml'
- `scripts/lfea-common-inputxml-restraint-correction-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-inputxml-load-diagnostics-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM2\Input_BM2.xml'
- `scripts/lfea-m028-bm3-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM3\BM3_InputXML.xml'
- `scripts/lfea-m029-bm3-hanger-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\benchmarks\LFEA\BM3\BM3_InputXML.xml'

### Evidence tool needing CLI arguments (not a standalone check) (10)

- `scripts/lfea-bm4l-bend-retopology-source-check.mjs` — if (!tablesPath) throw new TypeError('Usage: node scripts/lfea-bm4l-bend-retopology-source-check.mjs --tables <accdb-tables.json>');
- `scripts/lfea-bm4l-bend-tangent-source-check.mjs` — if (!tablesPath) throw new TypeError('Usage: node scripts/lfea-bm4l-bend-tangent-source-check.mjs --tables <accdb-tables.json>');
- `scripts/lfea-bm4l-e75-matrix-evidence-check.mjs` — AssertionError [ERR_ASSERTION]: Usage: node scripts/lfea-bm4l-e75-matrix-evidence-check.mjs <receipt.json>
- `scripts/lfea-bm4l-e75-pressure-boundary-check.mjs` — AssertionError [ERR_ASSERTION]: Missing --accdb
- `scripts/lfea-bm4l-e75-pressure-research-evidence-check.mjs` — AssertionError [ERR_ASSERTION]: Usage: --source-section <pinned-receipt.json> --out <hypothesis.json>
- `scripts/lfea-bm4l-e75-section-load-evidence-check.mjs` — AssertionError [ERR_ASSERTION]: Usage: node scripts/lfea-bm4l-e75-section-load-evidence-check.mjs <receipt.json>
- `scripts/lfea-bm4l-e75-w-neighborhood-qualification-check.mjs` — AssertionError [ERR_ASSERTION]: Use --experiment --full-report --weight-bending --out
- `scripts/lfea-bm4l-e75-w-system-reference-check.mjs` — AssertionError [ERR_ASSERTION]: Use --experiment <json> --rotation-budget <json> --out <json>
- `scripts/lfea-production-caesar-parity-evidence-check.mjs` — throw new TypeError('Usage: --log <capture.log> --accdb <BM4_L.ACCDB> --out <measurement.json>');
- `scripts/lfea-s4-reducer-parity-evidence-file-check.mjs` — S4 reducer parity evidence path is required.

### Needs git history / remote (7)

- `scripts/lfea-004-source-guard.mjs` — <ref *1> Error: spawnSync git ENOENT
- `scripts/lfea-005-source-guard.mjs` — <ref *1> Error: spawnSync git ENOENT
- `scripts/lfea-006-source-guard.mjs` — <ref *1> Error: spawnSync git ENOENT
- `scripts/lfea-piping-phase6e-anti-drift-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\.github\workflows\lfea-piping-runtime-release-certification.yml'
- `scripts/lfea-piping-phase6i-anti-drift-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\.github\workflows\lfea-piping-independent-closure-review.yml'
- `scripts/lfea-piping-phase6i-governance-recording-anti-drift-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\.github\workflows\lfea-piping-governance-recording-preparation.yml'
- `scripts/lfea-piping-phase6i-independent-closure-anti-drift-check.mjs` — Error: ENOENT: no such file or directory, open 'D:\CodeE\LFEA\.github\workflows\lfea-piping-independent-closure-review.yml'

### Needs AA3 combined build output (1)

- `scripts/lfea-bm4l-built-asset-check.mjs` — Error: ENOENT: no such file or directory, scandir 'D:\CodeE\LFEA\dist\assets'
