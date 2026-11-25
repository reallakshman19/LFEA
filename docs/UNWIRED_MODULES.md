# Modules not wired into the standalone app

Generated from the import graph on 2026-11-25. Regenerate this file after wiring or pruning anything.

| Group | Files |
|---|---|
| Reached from `src/lfea/main.js` | 451 |
| Not reached, but imported by an LFEA check | 275 |
| Not reached and not imported by any check | 46 |

## Not reached and untested (46)

These are mostly the LFEA pipeline screens from AA3's combined workbench (pipeline shell, run panel, SVG viewport, results authority, preflight UI). They are the candidates to either wire into `src/lfea` or delete.

- `src/core/linear-piping-analysis-consumer/generic-inputxml-solve.js`
- `src/master-data/bundled-master-data.js`
- `src/workspace/lfea-diagnostics/lfea-error-check-panel.js`
- `src/workspace/lfea-diagnostics/lfea-error-check.css`
- `src/workspace/lfea-global-settings-popover.js`
- `src/workspace/lfea-model-review/lfea-model-review-panel.js`
- `src/workspace/lfea-model-review/lfea-model-review.css`
- `src/workspace/lfea-pipeline-analysis-surface.js`
- `src/workspace/lfea-pipeline-continuity-presentation.js`
- `src/workspace/lfea-pipeline-export-panel.js`
- `src/workspace/lfea-pipeline-icon-manifest.js`
- `src/workspace/lfea-pipeline-icon-sprite.js`
- `src/workspace/lfea-pipeline-layout-panel.js`
- `src/workspace/lfea-pipeline-load-case-authoring-panel.js`
- `src/workspace/lfea-pipeline-model-repair-panel.js`
- `src/workspace/lfea-pipeline-results-panel.js`
- `src/workspace/lfea-pipeline-results-sort-presentation.js`
- `src/workspace/lfea-pipeline-results-task-visibility.js`
- `src/workspace/lfea-pipeline-shell-controller.js`
- `src/workspace/lfea-pipeline-shell-view.js`
- `src/workspace/lfea-pipeline-shell.css`
- `src/workspace/lfea-pipeline-stagedjson-input-panel.js`
- `src/workspace/lfea-pipeline-verification-drawer.js`
- `src/workspace/lfea-pipeline-worker.js`
- `src/workspace/lfea-preflight-phase1-review-surface.js`
- `src/workspace/lfea-preflight-phase1.css`
- `src/workspace/lfea-preflight-ui.js`
- `src/workspace/lfea-results-authority/lfea-results-authority-panel.js`
- `src/workspace/lfea-results-authority/lfea-results-authority-presentation.js`
- `src/workspace/lfea-results-authority/lfea-results-authority.css`
- `src/workspace/lfea-source-acquisition.css`
- `src/workspace/lfea-svg/core/engineering-svg-adapter.js`
- `src/workspace/lfea-svg/lfea-engineering-svg-adapter.js`
- `src/workspace/lfea-svg/lfea-svg-command-gateway.js`
- `src/workspace/lfea-svg/lfea-svg-overlay.js`
- `src/workspace/lfea-svg/lfea-svg-properties.js`
- `src/workspace/lfea-svg/lfea-svg-selection.js`
- `src/workspace/lfea-svg/lfea-svg-snap-providers.js`
- `src/workspace/lfea-svg/lfea-svg-viewport.js`
- `src/workspace/lfea-svg/lfea-svg-workbench.js`
- `src/workspace/linear-piping-analyzer-integration.js`
- `src/workspace/master-data-controller.js`
- `src/workspace/properties-panel-lfea-actions.js`
- `src/workspace/properties-panel.js`
- `src/workspace/stagedjson-conversion-diagnostics-view.js`
- `src/workspace/topology-edit-3d-sjson-fidelity-controller.js`

## Not reached but tested (275)

Engineering and model code exercised by the LFEA checks. Keep these while their checks remain.

| Area | Files |
|---|---|
| `src/workspace/topology-edit` | 46 |
| `src/workspace/engineering-enrichment` | 25 |
| `src/core/common-enriched-properties` | 21 |
| `src/core/vertical-beam-solver` | 16 |
| `src/core/model-loads` | 13 |
| `src/core/support-load-screening` | 13 |
| `src/core/linear-piping-project-qualification` | 12 |
| `src/core/model-calculation-package` | 11 |
| `src/core/geometry` | 10 |
| `src/core/linear-piping-analysis-consumer` | 10 |
| `src/core/settings-authority` | 10 |
| `src/core/workspace-consumers` | 8 |
| `src/core/linear-fea-variable-spring-hanger` | 5 |
| `src/workspace/lfea-svg` | 5 |
| `src/core/linear-piping-presentation` | 4 |
| `src/workspace/lfea-model-review` | 4 |
| `src/core/linear-piping-multicase-application` | 3 |
| `src/calc-workspace/cii-standalone-port` | 2 |
| `src/core/fea-benchmarks` | 1 |
| `src/core/piping-topology` | 1 |
| `src/workspace/dataset-adapter.js` | 1 |
| `src/workspace/dataset-hierarchy.js` | 1 |
| `src/workspace/dataset-types.js` | 1 |
| `src/workspace/dataset-utils.js` | 1 |
| `src/workspace/event-bus.js` | 1 |
| `src/workspace/event-payload-assertions.js` | 1 |
| `src/workspace/event-payload-validators.js` | 1 |
| `src/workspace/event-topic-ids.js` | 1 |
| `src/workspace/event-topics.js` | 1 |
| `src/workspace/geometry-evidence.js` | 1 |
| `src/workspace/lfea-bm4l-pinned-accdb.js` | 1 |
| `src/workspace/lfea-case-selection-preferences.js` | 1 |
| `src/workspace/lfea-diagnostics` | 1 |
| `src/workspace/lfea-finding-suggested-action.js` | 1 |
| `src/workspace/lfea-geometry-allowance.js` | 1 |
| `src/workspace/lfea-pipeline-accdb-input-panel.js` | 1 |
| `src/workspace/lfea-pipeline-accdb-view-model.js` | 1 |
| `src/workspace/lfea-pipeline-analysis-controller.js` | 1 |
| `src/workspace/lfea-pipeline-case-selection-panel.js` | 1 |
| `src/workspace/lfea-pipeline-layout-grid.js` | 1 |
| `src/workspace/lfea-pipeline-results-view-model.js` | 1 |
| `src/workspace/lfea-pipeline-run-panel.js` | 1 |
| `src/workspace/lfea-pipeline-session.js` | 1 |
| `src/workspace/lfea-pipeline-step-registry.js` | 1 |
| `src/workspace/lfea-preflight-phase1-adapter.js` | 1 |
| `src/workspace/lfea-preflight-phase1-authority-bridge.js` | 1 |
| `src/workspace/lfea-preflight-phase1-bitset.js` | 1 |
| `src/workspace/lfea-preflight-phase1-component-index.js` | 1 |
| `src/workspace/lfea-preflight-phase1-index.js` | 1 |
| `src/workspace/lfea-preflight-phase1-master-authority.js` | 1 |
| `src/workspace/lfea-preflight-phase1-review-ledger.js` | 1 |
| `src/workspace/lfea-preflight-phase1-review-session.js` | 1 |
| `src/workspace/lfea-preflight-phase1-review-source.js` | 1 |
| `src/workspace/lfea-preflight-phase1-schema.js` | 1 |
| `src/workspace/lfea-preflight-phase1-viewport.js` | 1 |
| `src/workspace/lfea-preflight-resolution.js` | 1 |
| `src/workspace/lfea-session` | 1 |
| `src/workspace/lfea-source-acquisition.js` | 1 |
| `src/workspace/lfea-source-intake.js` | 1 |
| `src/workspace/lfea-support-actions-panel.js` | 1 |
| `src/workspace/lfea-topology-edit-source-capture.js` | 1 |
| `src/workspace/lfea-workbench.js` | 1 |
| `src/workspace/linear-piping-accdb-intake.js` | 1 |
| `src/workspace/linear-piping-prerun-check.js` | 1 |
| `src/workspace/linear-piping-prerun-view.js` | 1 |
| `src/workspace/linear-piping-results-view.js` | 1 |
| `src/workspace/linear-piping-results-workbench.js` | 1 |
| `src/workspace/linear-piping-run-analysis.js` | 1 |
| `src/workspace/linear-piping-run-gate.js` | 1 |
| `src/workspace/linear-piping-run-request.js` | 1 |
| `src/workspace/linear-piping-support-action-xlsx.js` | 1 |
| `src/workspace/shared-model-index-validation.js` | 1 |
| `src/workspace/source-line-identity.js` | 1 |
| `src/workspace/staged-model-index.js` | 1 |
| `src/workspace/workspace-state.js` | 1 |
