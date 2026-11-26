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
| Support loads: `GOVERNED_INTERFACE_SET_REQUIRED`, `EXPLICIT_UP_GLOBAL_REQUIRED`, `EXPLICIT_PARALLEL_TOLERANCE_REQUIRED` | Every Run derives one support per restrained node from the constraints the solve actually used (`src/lfea/derived-support-authority.js`). Up is the opposite of solve gravity (+Y), the axes are global X/Y/Z, and the parallel tolerance is 1e-6. It is staged, accepted as `NOT ENGINEER-REVIEWED (LFEA derived supports)` and published through the same governed chain, with `sourceId: LFEA_DERIVED_FROM_MODEL_RESTRAINTS`. If derivation fails, Results are unaffected. | Results, support panel, "Support basis": "DERIVED from the model restraints used by the solve … NOT ENGINEER-REVIEWED." |
| B31 code check: `GOVERNED_CODE_PROFILE_REQUIRED`, `GOVERNED_EDITION_DATASET_REQUIRED` (pasted sealed JSON) | The Code tab takes two numbers, Sc and Sh in MPa, and **Run B31.3 code check** builds everything else (`src/lfea/practical-b31-check.js`). That means one SUSTAINED check per straight-pipe element end in each run weight case, unity stress factors on straight pipe, W = 1, Sc at 70 °F and Sh at the material's design temperature. It is staged, accepted as `NOT ENGINEER-REVIEWED (LFEA user allowables)` and published through the governed chain. Later Runs repeat it with the same values. | Results, B31 panel, "Code check basis": "Allowables entered by user (Sc=…;Sh=…) … NOT ENGINEER-REVIEWED." |

Every assumed value stays in the sealed records (authority IDs, source IDs,
approver identity), so dossiers, history and exports show exactly what was
assumed. Nothing is hidden.

## Next gates to convert

| Gate | Planned default basis |
|---|---|
| Strict profile refusals (bends as chords, friction, unilateral supports) | Keep running under the approximation profile, listing each approximation on the results. |

## Evidence

BM4 (97 nodes), real CAESAR II model:

- **Before:** pre-flight `BLOCK`, "Available cases: None".
- **After the default basis:** runs. Against CAESAR, sustained total vertical
  reaction is within 1.19% and total displacement ratio is 1.001; 21 of 30
  supports are within 5%. Residual 4.3e-13, `QUALIFIED`.

`scripts/lfea-bm4-cii-output-comparison-check.mjs` records these measurements.

Support loads: BM4 derives and resolves all 30 supports, and BM1 all 10.
`scripts/lfea-derived-support-publication-check.mjs` checks this.

B31 code check: BM4 publishes 116 sustained checks (weight case) and BM1
publishes 36 (W and W+P). `scripts/lfea-practical-b31-check.mjs` checks this.
Why the allowables are typed in: BM1 and BM4 leave every `ALLOWABLESTRESS`
value at CAESAR's "not set" sentinel (-1.0101), and ASME tables are licensed,
so LFEA ships none.

Sustained pressure term (B31.3 form, matching CAESAR II):

- The longitudinal pressure stress is P·di²/(Do²−di²), the end-cap force over
  the metal area. P·Do/4t, the B31.1 form, is no longer used.
- Sustained stresses use the nominal wall less the model's `CORR_ALLOW`,
  explicit or inherited. The section source is
  `LFEA_NOMINAL_LESS_CORROSION_ALLOWANCE`, and the check's section basis
  states the value. Mill tolerance is not deducted, which matches CAESAR.
- Pressure elongation (axial thrust), Bourdon and pressure stiffening are
  applied by the solver. They are disclosed in the pressure term's source
  (`SOLVER_APPLIED_…`) and no longer stop the check.

Comparison with CAESAR SUS (W+P), checked by
`scripts/lfea-b31-sustained-caesar-comparison.mjs`:

| Model | W+P checks | Pressure term = CAESAR SLP | Within 1% | Within 5% | Worst |
|---|---|---|---|---|---|
| BM1 | 18 | 18 | 10 | 16 | 13.2% (40-45, next to a bend) |
| BM4 | 116 | 112 | 55 | 103 | 29.7% |

The remaining differences are in the moments, not the code check:

- **BM4:** CAESAR lifts off the "+Y" supports and LFEA does not (see the
  support limit below).
- **BM1:** the moments next to the bend at 48–50 differ.
- **BM4, 4 ends at tees:** CAESAR applies the tee SIF and branch section;
  LFEA checks these ends as plain pipe.

Known B31 limits, all stated in the status line:

- Each check set covers one material, the one with the most elements.
- Bends and tees are not checked yet. The native boundary covers straight
  pipe only, and an end at a tee is checked with i = 1.
- BM4 runs only its weight case unless W+P is requested.

Known limit: derived supports mirror the solver's linear constraints. A
CAESAR "+Y" (one-way) support is therefore reported as two-way, and can show
uplift (positive Fv, as at BM4 node 20090). This is the same unilateral
finding the BM4 comparison records.
