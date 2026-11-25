# Practical analysis policy

Adopted 2026-11-25 at the owner's direction. LFEA inherited AA3's
fail-closed design, where every missing authority, basis or review stopped
the analysis. That made real models unusable. LFEA follows this rule
instead:

> **Stop only when the analysis is physically or numerically impossible.
> Everything else runs on a declared basis and is labelled.**

## What still stops

- Unreadable or invalid input (unparseable XML, missing geometry, unknown
  units that cannot be resolved).
- A model that cannot be solved: mechanism or singular stiffness, or a
  solve that fails its residual, equilibrium or energy gates.
- Pre-flight `BLOCK` findings for physically invalid input. These cannot
  be authorized.

## What runs on a labelled basis instead

| Gate (before) | Now | Label shown |
|---|---|---|
| `BRANCH_FACTOR_EDITION_AUTHORITY_UNRESOLVED`: welding tees refused without an explicitly chosen B31/B31J edition. Bends also fell back to straight chords. | Default basis: ASME B31.3 2022 + B31J 2017, no smooth-90° correction. The sealed authority uses `sourceId: LFEA_DEFAULT_ASSUMED_BASIS`, and the control on the Source tab changes it. | "ASSUMED (default): … Choose below to change." |
| Pre-flight `WARN` required a reviewer name and reason before Run | Sealed automatically through the same governed path. The approver is recorded as `NOT ENGINEER-REVIEWED (LFEA auto-accept)`; the reason lists the warning count. | Status line and basis line: "results are NOT ENGINEER-REVIEWED" |

Every assumed value stays in the sealed records (authority IDs, source IDs,
approver identity), so dossiers, history and exports show exactly what was
assumed. Nothing is hidden.

## Next gates to convert

| Gate | Planned default basis |
|---|---|
| Support loads: `GOVERNED_INTERFACE_SET_REQUIRED`, `EXPLICIT_UP_GLOBAL_REQUIRED`, `EXPLICIT_PARALLEL_TOLERANCE_REQUIRED` | Derive support definitions from the model's own CAESAR restraints. Take up-axis from the model's vertical-axis setting, and use a documented default parallel tolerance. All are labelled as derived. |
| B31 code check: `GOVERNED_CODE_PROFILE_REQUIRED`, `GOVERNED_EDITION_DATASET_REQUIRED` | Use the allowables carried in the model (CAESAR `ALLOWBL` block) with the chosen or assumed edition; label "allowables from source model". |
| Strict profile refusals (bends as chords, friction, unilateral supports) | Keep running under the approximation profile, listing each approximation on the results. |

## Evidence

BM4 (97 nodes), real CAESAR II model:

- **Before:** pre-flight `BLOCK`, "Available cases: None".
- **After the default basis:** runs. Against CAESAR, sustained total vertical
  reaction is within 1.19% and total displacement ratio is 1.001; 21 of 30
  supports are within 5%. Residual 4.3e-13, `QUALIFIED`.

`scripts/lfea-bm4-cii-output-comparison-check.mjs` records these measurements.
