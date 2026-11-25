# LFEA — Linear Finite Element Analysis

A standalone LFEA application extracted from `reallakshman19/AA3`
(source commit `a8650bb`, 2026-10-11). It keeps only LFEA modules and the
common modules they depend on. LAFEA, the combined "Advanced Analysis"
workbench shell, and unrelated tools (WRC/EMP.1, first-cut load estimation,
etc.) are left out.

## Run

```bash
npm install
npm run dev        # opens /LFEA/lfea.html
npm run build      # boundary check + production build -> dist-lfea/
npm run preview
```

## What was kept and how

The selection is mechanical, not hand-picked:

1. **App:** the full static and dynamic import closure of `src/lfea/main.js`
   (446 JS modules plus CSS). This is the same closure that
   `scripts/lfea-standalone-boundary-check.mjs` verifies.
2. **LFEA modules:** every `src/**` file whose name contains `lfea` or
   `linear-piping` (non-LAFEA), plus everything they import.
3. **Checks:** every `scripts/*lfea*` / `*linear-piping*` check whose import
   closure has no LAFEA or combined-shell module, plus everything they import.
   Benchmarks, reports and governance files they read by path are also kept.
4. **Runtime assets:** `public/logo.png`, `public/master-data`,
   `public/vendor` (Pyodide + StagedJSON→InputXML scripts) and
   `public/demo-only/lfea-phase6h`.

No file under `src/` was edited. The few config and boundary-script changes
needed for a standalone repo are listed in
[EXTRACTION_REPORT.md](EXTRACTION_REPORT.md), along with the
check-by-check comparison against unmodified AA3.

| Area | Files | Contents |
|---|---|---|
| `src/lfea` | 44 | Standalone app: runtime, layout, native execution/results/history/comparison/verification |
| `src/core` | ~500 | Linear FEA (`linear-fea-*`), piping consumer/code application (`linear-piping-*`), common geometry, topology, shared solve, support-restraints, shared piping model |
| `src/workspace` | ~230 | LFEA pipeline UI (`lfea-*`, `linear-piping-*`), topology-edit, engineering enrichment, event bus |
| `scripts` | ~470 | LFEA checks, source guards and benchmark comparisons |
| `benchmarks/LFEA` | — | BM1, BM4, CAESAR ACCDB, SPRING_DRAFT fixtures |

## Notes

- The app is served under `/LFEA/` (`vite.config.js` `base`); `/LFEA/` redirects to
  `/LFEA/lfea.html`. Evidence/governance records still name their origin
  repository `reallaksh19/Advanced_Analysis` on purpose — that is provenance, not config.
- Some checks assert wiring inside AA3's combined app (`src/main.js`,
  `workspace-layout.js`) and cannot pass here. See `EXTRACTION_REPORT.md`.

## Checks and CI

```bash
npm run check:ci          # the 257 checks that pass on a clean checkout
npm run check:ci-browser  # the one check that launches Chromium
npm run lint
npx playwright test e2e/lfea-standalone.spec.js
```

`.github/workflows/ci.yml` runs all of the above on push and PR.
`.github/workflows/pages.yml` deploys `dist-lfea` to GitHub Pages; it is
off until the repository variable `ENABLE_PAGES=true` is set (see the comment
in the workflow).

The 53 checks that still fail (all also fail in unmodified AA3) are
classified in `EXTRACTION_REPORT.md`. Modules that the standalone app does
not use yet are listed in `docs/UNWIRED_MODULES.md`.
