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
| One-way supports (CAESAR "+Y" etc.) solved as two-way, so a support could pull the pipe (`GENERIC_APPROX_UNILATERAL_LINEARIZED`) | On by default: active-set iteration per load case (`src/lfea/unilateral-active-set.js`, `sourceId: LFEA_UNILATERAL_ACTIVE_SET_ITERATION`, reviewer `NOT ENGINEER-REVIEWED (LFEA unilateral active set)`). Solve; release every rigid one-way support whose reaction opposes its only direction; re-solve; re-engage any whose pipe moves back into it; stop when the set is stable, at most 20 solves per case. The record (per case: status, solve count, lifted-off supports, history) is sealed into the raw execution batch hash. A lifted-off support reports a reaction of exactly zero, so derived supports show it as zero. It never blocks: if a case cycles, hits the cap, or a release cannot be solved (for example a mechanism), the last solved state is published and the status says so. One-way springs stay linear and are counted. | Results, "One-way and gapped support basis": "One-way supports solved by active-set iteration (LFEA_UNILATERAL_ACTIVE_SET_ITERATION): … lifted off (nodes) … NOT ENGINEER-REVIEWED". The support basis lists the lifted-off supports. |
| Gapped supports (CAESAR `GAP` > 0 on a guide or limit stop) treated as closed (`GENERIC_APPROX_GAP_CLOSED`) | On by default, in the same active-set iteration and record. A gap is a contact with a distance g: one side for a one-way gapped support, both sides for a two-way guide or limit. The first solve sees every gap open. An open gap closes when the pipe moves past g, and the solver then holds the pipe at exactly g (a constraint offset, `SOLVER_CONSTRAINT_OFFSET_INVALID` if malformed). A closed gap opens again when its stop pulls. Open gaps report zero. A gap whose length unit cannot be resolved stays closed and is counted. | Same "One-way and gapped support basis" line: "… gaps N closed (node DOF ±g mm) / M open …". |
| B31 check refused anything but exact straight pipe, so reducers and tees went unchecked | Reducer and tee elements are B31 targets too; bend arcs still are not (`src/lfea/practical-b31-fittings.js`, `sourceId: LFEA_PRACTICAL_B31_FITTINGS`, B31.3 2022 + B31J 2017 factors). **Reducer** (a CAESAR reducer record): both ends get the B31J Table 1-1 reducer SIF. The `DIAMETER2` end is checked with that size (the matching-pipe rule), and that is the only case where an end section may differ from the element's OD. CAESAR's `ALPHA`, `R2` and `L2` are used where given. Where they are 0, labelled defaults stand in: cone half-angle from the element geometry, r2 = 0.1·D2, L2 = 0.1·L, body wall = T1. **Welding tee** (CAESAR SIF type 3, three legs): B31J run or branch SIF, where the run is the two most nearly opposite legs. In-plane and out-of-plane follow the element's local axes; if neither axis is normal to the tee plane, the larger factor is used both ways. Tee quality is `UNVERIFIED`, so no 1.26 reduction. **Weldolet** (CAESAR SIF type 5) run ends: B31.3 Table D300 welded-on fitting SIF, i = 0.9 / h^(2/3), h = 3.3 T / r2, in and out of plane and as the sustained index; torsion and axial 1 (`LFEA_WELDOLET_DEFAULT`, NOT ENGINEER-REVIEWED: LFEA has no B31J weldolet equations). Branch ends stay at 1. Other fittings stay at i = 1 and are counted. Never blocks. | Code check status line: "B31J SIFs at N reducer end(s) and M welding-tee end(s) (LFEA_PRACTICAL_B31_FITTINGS); B31.3 Table D300 SIFs at W weldolet run end(s), LFEA default, no B31J weldolet equations; K fitting end(s) not covered, unity factors". |
| B31 check had no expansion (displacement stress range) category | When the run has an operating case (`IXP-WPT`, else `IXP-WT`) and a sustained case (`IXP-WP`, else `IXP-W`), every sustained end also gets a `DISPLACEMENT_STRESS_RANGE` check on the operating minus sustained actions (CAESAR's EXP = OPE − SUS). Stress is B31.3 (2016+) Eq. (17), SE = √((\|Sa\| + Sb)² + (2St)²) with Sa = ia\|Fa\|/A, on the nominal section (a reducer end at that end's size), with the fitting's displacement SIFs. Allowable is Eq. (1a), f (1.25 Sc + 0.25 Sh), with f = 1 (`NOT ENGINEER-REVIEWED (LFEA default: f = 1, 7000 cycles or fewer)`). The engine rule is `DISPLACEMENT_RANGE_COLD_HOT_CYCLE_REDUCTION_EQ17_AXIAL_TORSION_V1`; profiles on the original rule keep the B31.3-2006 form. | Code check status line: "B31.3 expansion check: N check(s), IXP-WPT minus IXP-WP, allowable f (1.25 Sc + 0.25 Sh), f = 1 (LFEA default)", plus a weldolet warning when weldolets are present. |
| Support friction (CAESAR `FRIC_COEF`) | **Not applied yet** (`GENERIC_APPROX_FRICTION_IGNORED`): supports slide freely. The record counts the friction coefficients not applied. | Same line: "N support friction coefficient(s) not applied: those supports slide freely." |

Every assumed value stays in the sealed records (authority IDs, source IDs,
approver identity), so dossiers, history and exports show exactly what was
assumed. Nothing is hidden.

## Next gates to convert

| Gate | Planned default basis |
|---|---|
| Support friction ignored (`GENERIC_APPROX_FRICTION_IGNORED`) | Friction in the same iteration: a support in contact holds the pipe sideways up to mu x its normal load, then slides. With gaps open and no friction, BM4 SUS slides where CAESAR CASE 17 holds it (see the gapped-support evidence below), so this is now BM4's largest sustained error. A first attempt (stick spring of CAESAR's default 1,000,000 lb/in stiffness, slip by return mapping) did not converge on BM4, so it was left out. |
| Strict profile refusals (bends as chords, friction) | Keep running under the approximation profile, listing each approximation on the results. |

## Evidence

BM4 (97 nodes), real CAESAR II model:

- **Before:** pre-flight `BLOCK`, "Available cases: None".
- **After the default basis:** runs. Against CAESAR, sustained total vertical
  reaction is within 1.19% and total displacement ratio is 1.001; 21 of 30
  supports are within 5%. Residual 4.3e-13, `QUALIFIED`.

`scripts/lfea-bm4-cii-output-comparison-check.mjs` records these measurements.

One-way supports (active-set iteration, 2026-11-26). Each case converges in
2 solves. LFEA lifts off exactly the supports CAESAR reports at zero: SUS
20090 and 21470; OPE 20090, 20350, 21470 and 21610. Before the iteration,
these supports pulled the pipe down, by up to 151.7 kN in OPE.

| BM4 support loads (UY, 30 supports) | Before | After |
|---|---|---|
| SUS within 5% (where CAESAR is nonzero) | 21 | 21 |
| SUS within 5% or lifted off with CAESAR (both zero) | 21 | **23** |
| OPE within 5% (where CAESAR is nonzero) | 15 | **17** |
| OPE within 5% or lifted off with CAESAR (both zero) | 15 | **21** |
| One-way supports pulling the pipe (SUS / OPE) | 2 / 4 | **0 / 0** |
| Total displacement ratio SUS / OPE | 1.0013 / 0.7978 | 1.0014 / 0.7615 |

The check's thresholds are raised to the "after" column. OPE vertical
movement now matches CAESAR (sum |DY| ratio 0.997). The remaining OPE
shortfall is horizontal, at gapped guides CAESAR leaves open: node 20030
moves −25 mm in Z in CAESAR and 0 here (`GENERIC_APPROX_GAP_CLOSED`).
`scripts/lfea-unilateral-active-set-check.mjs` checks the following:
- end-span lift-off on a small model;
- the sealed record, and that recovery refuses it if tampered;
- the solver's release validation;
- the non-converging and unsolvable paths, which publish the last state
  rather than block;
- that BM4 derived supports report zero Fv at every lifted-off support;
- that the solver holds a closed gap at its offset and refuses invalid
  offsets, and the BM4 gap states below.

Gapped supports (same iteration, 2026-11-26). BM4 has six gapped guides and
limit stops. SUS converges in 2 solves with all six open. OPE converges in 4
solves and closes three, each exactly where CAESAR closes it: 20390 DX −5 mm,
21480 DX +10 mm and 21640 DX −10 mm, the same in both. The OPE comparison is
with CAESAR CASE 20, its friction-free operating case. SUS is compared with
CASE 17, which carries friction. CASE 19 is not a clean friction-free SUS
case, so there is none to compare with.

| BM4 (30 supports) | One-way only | One-way + gaps |
|---|---|---|
| SUS within 5% / or lifted off with CAESAR | 21 / 23 | 21 / 23 |
| OPE within 5% / or lifted off with CAESAR | 17 / 21 | **21 / 25** |
| Total displacement ratio OPE | 0.7615 | **0.8960** |
| Total displacement ratio SUS | 1.0014 | 1.2381 |

The check's thresholds are raised to the new OPE values. SUS gets worse,
and the check records that rather than hiding it. With its gaps open (as
in CAESAR) and no friction, the sustained pipe slides sideways where
CAESAR's friction holds it. For example, node 20030 moves −0.58 mm in Z here
and 0.00 in CAESAR, whose support there carries FX −2086 N of friction. The
SUS band moves to 1.20–1.28 until friction is applied.

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
| BM4, two-way supports (before 2026-11-26) | 116 | 112 | 55 | 103 | 29.7% |
| BM4, one-way active set | 116 | 112 | 56 | 102 | 29.7% |
| BM4, one-way + gaps, no friction | 116 | 112 | 57 | 99 | 29.7% |
| BM4, + reducer and tee elements checked | 126 of 128 | 122 | 58 | 107 | 29.7% |
| BM4, + weldolet run ends (now) | 126 of 128 | 122 | **62** | **109** | 29.7% |
| BM4_L (ACCDB) vs CASE 6, friction-free, reducers and tees | 128 | 128 | 106 | 128 | 4.7% |
| BM4_L, + weldolet run ends | 128 | 128 | 112 | 128 | 3.6% |
| **BM4_L, + restraint code 3 read as two-way Y (now)** | **128** | **128** | **122** | **128** | **2.0%** |

Reducer and tee elements (2026-11-26). The check now covers reducer and tee
elements, not just straight pipe (`LFEA_PRACTICAL_B31_FITTINGS`, see the
labelled-basis table). BM4_L is the reference: it is the same model as a
CAESAR database, and its CASE 6 (SUS) W+P1 has no friction. It also keeps
CAESAR's reducer records, which the BM4 InputXML export drops.

- BM4_L: 96 straight-pipe ends (worst 3.4%) plus 32 reducer and tee ends
  (worst 4.7%), all within 5%. The pressure term matches CAESAR SLP at every
  end, including the reducer small ends.
  - Welding-tee run ends reproduce CAESAR's indices exactly, for example 1.391
    and 1.000 at 20160.
  - Reducer SIFs are within −10% to +12% of CAESAR's, because CAESAR left r2
    and L2 at 0 and LFEA's labelled defaults stand in.
  - The 4.7% rows were weldolet run ends: CAESAR uses SIF 1.527 there, LFEA
    used 1. See the weldolet note below.
- BM4 InputXML: 10 tee-element ends are added (8 within 5%). Element
  20150-20160 has no CAESAR row, because CAESAR splits it at 20161. The worst
  29.7% is reducer 22000-22010 J: with no reducer record, LFEA checks it as
  plain 168.3 mm pipe. BM4_L shows that same end at 0.9%.

Weldolet run ends (2026-11-26). LFEA has no B31J weldolet equations, and no
public copy of them was found. So a labelled default stands in
(`LFEA_WELDOLET_DEFAULT`, "NOT ENGINEER-REVIEWED"): the B31.3 Appendix D
Table D300 branch welded-on fitting SIF, i = 0.9 / h^(2/3) with
h = 3.3 T / r2 of the run pipe, in and out of plane. It is also the sustained
index, as for B31J tee runs, and torsion and axial stay 1. Against CAESAR's
B31J values on BM4_L it is 1.2–2.4% low (1.510 vs 1.527 at 168.3 × 10.97 mm,
1.482 vs 1.518 at 273 × 18.26 mm), where unity was 34–35% low. CAESAR also
gives a torsional SIF of about 1.72 there; LFEA uses 1. All 8 BM4_L weldolet
ends are run ends of weldolets whose branch is not modelled. A weldolet
branch end keeps unity.

- BM4_L: within 1% goes from 106 to 112; worst from 4.7% to 3.6%.
- BM4 InputXML: within 1% from 58 to 62, within 5% from 107 to 109.

BM4_L Y supports are two-way (2026-11-26). LFEA read ACCDB restraint code 3
as a one-way "+Y". That label came from the BM4 InputXML run, where those
supports really are +Y. BM4_L is different:

- its own `RESTRAINT_TYPES` table names 3 = "Y" and 14 = "+Y";
- its `OUTPUT_RESTRAINTS` prints "Rigid Y" at every one of those supports;
- CAESAR holds 20090 down in CASE 6 (1.66 kN) and in CASE 5 (51.8 kN), which
  a +Y cannot do; and
- L14 (L5 − L6) equals L3 (T1 alone) exactly, so CAESAR solved it as linear.

Read as +Y, LFEA lifted 20090, 21470, 21610 and 20350 off in the operating
case. `accdb-restraint-type-correspondence.js` now maps 3 to two-way Y and
14 to +Y. BM4 InputXML is unaffected (its +Y supports keep the active set).

BM4_L against CAESAR, measured by `scripts/lfea-production-caesar-parity-check.mjs`
(node displacements and rotations, support forces and moments, element end
forces and moments; a value passes within 10% of CAESAR's, measured literally,
so very small CAESAR values fail easily):

| Case | Values within 10%, before | Now | Median error, before | Now |
|---|---|---|---|---|
| L2, W | 93.1% | **96.8%** | 0.63% | **0.37%** |
| L6, W+P1 (SUS) | 84.7% | **95.8%** | 0.82% | **0.35%** |
| L5, W+T1+P1 (OPE) | 70.6% | **93.0%** | 1.62% | **0.57%** |

The thermal increment (L5 − L6) displacement now matches CAESAR: median ratio
1.000, 10th percentile 0.997, over 117 components larger than 2 mm. Most of
the L5 values still failing have small CAESAR values (rotations under
1e-4 rad, moments under 50 N·m). The largest real ones are an axial force of
550 N vs CAESAR's 446 N along 20160–20295 and moments of about 244 vs 304 N·m
near 22130–22190.

Pass marks (2026-11-26). The script now fails CI if BM4_L agrees less with
CAESAR than this (`PASS_MARKS` in the script). They are set at the values
measured above and are only ever raised:

| Case | Values within 10% | Displacements within 10% | Support forces within 10% | Median error at most |
|---|---|---|---|---|
| L2, W | 96.7% | 96.5% | 98.8% | 0.37% |
| L6, W+P1 | 95.8% | 96.5% | 100% | 0.36% |
| L5, W+T1+P1 | 93.0% | 93.8% | 100% | 0.57% |

With gaps, the check holds BM4 at 57 within 1%, 99 within 5% and a worst case
of 29.7%. Three more rows cross 5%. They are near supports that slide here but
that CAESAR CASE 17 holds by friction, the same cause as the SUS displacement
change above. They are expected to recover once friction is applied.

With one-way supports only, the check held BM4 at 56 within 1%, 102 within 5% and a worst case of 29.7%.
The SUS case lifts off only 2 small supports (20090 and 21470; 20090 was
pulling by about 290 N), so the stresses barely move. One row improves to
within 1%. One row crosses 5%: 20030-20090 J goes from 1.3% to 5.5%, next
to the lifted-off 20090, where CAESAR also holds the gapped guide at 20030
open. The 5% count is therefore one lower than before. This is recorded
here, not hidden.

The remaining differences are in the moments, not the code check:

- **BM4:** support friction, which CAESAR models and LFEA does not yet
  (`GENERIC_APPROX_FRICTION_IGNORED`).
- **BM1:** the moments next to the bend at 48–50 differ.
- **BM4 InputXML, 4 reducer ends:** this note used to say "4 ends at tees",
  which was wrong. They are reducers (273→219, 273→168, 168→88.9 and
  88.9→168). CAESAR's InputXML export carries no reducer record for them, so
  LFEA checks them as plain pipe at the large end's size. Inferring a reducer
  from a size change is a possible follow-up. Imported from the ACCDB
  (BM4_L), they are checked as reducers.

Expansion check vs CAESAR (2026-11-26), checked by
`scripts/lfea-b31-expansion-caesar-comparison.mjs`: BM4_L CASE 14 (EXP),
L14 = L5 − L6, at 128 W+P ends, 109 of them with CAESAR at 1 MPa or more.

- What CAESAR's numbers show. The code stress is √((\|Sa\| + Sb)² + (2St)²).
  CAESAR includes Sa even though its axial-stress column reads 0. At
  20290–20295 J: √((0.09 + 58.67)² + (2 × 12.91)²) = 64.18 MPa, CAESAR 64.18.
  The allowable is 206.8 MPa everywhere, Eq. (1a), not the liberal Eq. (1b).
  The engine's original range formula leaves out Sa and the 2 on St, so the
  practical profile opts into the Eq. (17) rule.
- The allowable equals CAESAR's at all 128 ends.

| Ends (CAESAR ≥ 1 MPa) | Ends | Within 1% | Within 5% | Median | Worst |
|---|---|---|---|---|---|
| All | 109 | 53 | 86 | 1.1% | 39.5% |
| Straight pipe | 77 | 45 | 67 | 0.34% | 16.7% (1.4 vs 1.7 MPa) |
| Welding tees | 4 | 2 | 4 | 2.2% | 4.0% |
| Tee elements | 12 | 6 | 11 | 1.5% | 36.3% (two-leg tee at 20700, unity) |
| Reducers | 8 | 0 | 4 | 6.7% | 7.1% (labelled r2, L2 defaults) |
| **Weldolets** | 8 | 0 | 0 | **36.7% low** | **39.5% low** |

- **Weldolets are under-predicted.** CAESAR's B31J weldolet run SIF for
  expansion is 2.31–2.33 (torsion 2.93–2.97). LFEA uses the Table D300 value,
  about 1.5. The sustained check matched only because CAESAR's B31J sustained
  index there is min(0.75 i, √i) = √2.33 = 1.53, close to Table D300's 1.51.
  The status line warns about this whenever weldolets are present.
- This comparison prepares BM4_L as the parity harness does: CAESAR's
  reconstructed thermal strain (0.00121097 for 21 → 120 °C) and B31J bends
  with the smooth-90° correction. **With the app's own defaults** (α 1.17e-5
  from 20 °C, so 0.00117, and no smooth-90° correction), straight-pipe
  expansion stress is a median 7.5% below CAESAR and 24 of 77 ends are within
  5%. The thermal strain explains 3.4% of that; the smooth-90° correction
  explains the rest. The L2/L6/L5 parity figures above also use the
  CAESAR-matched preparation.

Known B31 limits, all stated in the status line:

- Each check set covers one material, the one with the most elements.
- Expansion at weldolet run ends uses the Table D300 SIF and is about 37% low
  against CAESAR (see above).
- The app's default thermal strain and bend basis put BM4_L operating and
  expansion results 5–8% below CAESAR (see above).
- Bends are not checked yet; bend-arc elements stay outside the native
  boundary. Straight pipe, reducer and tee elements are checked.
- Weldolet run ends use the Table D300 default above, not B31J, and weldolet
  branch ends keep i = 1.
- Sweepolets, fabricated tees and other fittings the B31J factor calculator
  does not implement keep i = 1. The status line counts them.
- BM4 runs only its weight case unless W+P is requested.

Derived supports mirror the constraints the final active-set solve used. A
CAESAR "+Y" (one-way) support that lifts off reports zero, for example BM4
node 20090. Before 2026-11-26 it was reported as two-way with about 290 N of
uplift. To turn the iteration off, for example for comparison scripts, use
`createLfeaNativeExecutionAuthority({ unilateralActiveSet: false })`.
