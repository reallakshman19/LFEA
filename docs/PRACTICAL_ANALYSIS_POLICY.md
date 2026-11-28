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
| `BRANCH_FACTOR_EDITION_AUTHORITY_UNRESOLVED`: welding tees refused without an explicitly chosen B31/B31J edition. Bends also fell back to straight chords. | Default basis: ASME B31.3 2022 + B31J 2017, with the smooth-90° correction (CAESAR applies it on BM4_L). The sealed authority uses `sourceId: LFEA_DEFAULT_ASSUMED_BASIS`, and the control on the Source tab changes it. | "ASSUMED (default): … Choose below to change." |
| Pre-flight `WARN` required a reviewer name and reason before Run | Sealed automatically through the same governed path. The approver is recorded as `NOT ENGINEER-REVIEWED (LFEA auto-accept)`; the reason lists the warning count. | Status line and basis line: "results are NOT ENGINEER-REVIEWED" |
| Support loads: `GOVERNED_INTERFACE_SET_REQUIRED`, `EXPLICIT_UP_GLOBAL_REQUIRED`, `EXPLICIT_PARALLEL_TOLERANCE_REQUIRED` | Every Run derives one support per restrained node from the constraints the solve actually used (`src/lfea/derived-support-authority.js`). Up is the opposite of solve gravity (+Y), the axes are global X/Y/Z, and the parallel tolerance is 1e-6. It is staged, accepted as `NOT ENGINEER-REVIEWED (LFEA derived supports)` and published through the same governed chain, with `sourceId: LFEA_DERIVED_FROM_MODEL_RESTRAINTS`. If derivation fails, Results are unaffected. | Results, support panel, "Support basis": "DERIVED from the model restraints used by the solve … NOT ENGINEER-REVIEWED." |
| B31 code check: `GOVERNED_CODE_PROFILE_REQUIRED`, `GOVERNED_EDITION_DATASET_REQUIRED` (pasted sealed JSON) | The Code tab takes two numbers, Sc and Sh in MPa, and **Run B31.3 code check** builds everything else (`src/lfea/practical-b31-check.js`). That means one SUSTAINED check per straight-pipe element end in each run weight case, unity stress factors on straight pipe, W = 1, Sc at 70 °F and Sh at the material's design temperature. It is staged, accepted as `NOT ENGINEER-REVIEWED (LFEA user allowables)` and published through the governed chain. Later Runs repeat it with the same values. | Results, B31 panel, "Code check basis": "Allowables entered by user (Sc=…;Sh=…) … NOT ENGINEER-REVIEWED." |
| One-way supports (CAESAR "+Y" etc.) solved as two-way, so a support could pull the pipe (`GENERIC_APPROX_UNILATERAL_LINEARIZED`) | On by default: active-set iteration per load case (`src/lfea/unilateral-active-set.js`, `sourceId: LFEA_UNILATERAL_ACTIVE_SET_ITERATION`, reviewer `NOT ENGINEER-REVIEWED (LFEA unilateral active set)`). Solve; release every rigid one-way support whose reaction opposes its only direction; re-solve; re-engage any whose pipe moves back into it; stop when the set is stable, at most 20 solves per case. The record (per case: status, solve count, lifted-off supports, history) is sealed into the raw execution batch hash. A lifted-off support reports a reaction of exactly zero, so derived supports show it as zero. It never blocks: if a case cycles, hits the cap, or a release cannot be solved (for example a mechanism), the last solved state is published and the status says so. One-way springs stay linear and are counted. | Results, "One-way and gapped support basis": "One-way supports solved by active-set iteration (LFEA_UNILATERAL_ACTIVE_SET_ITERATION): … lifted off (nodes) … NOT ENGINEER-REVIEWED". The support basis lists the lifted-off supports. |
| Gapped supports (CAESAR `GAP` > 0 on a guide or limit stop) treated as closed (`GENERIC_APPROX_GAP_CLOSED`) | On by default, in the same active-set iteration and record. A gap is a contact with a distance g: one side for a one-way gapped support, both sides for a two-way guide or limit. The first solve sees every gap open. An open gap closes when the pipe moves past g, and the solver then holds the pipe at exactly g (a constraint offset, `SOLVER_CONSTRAINT_OFFSET_INVALID` if malformed). A closed gap opens again when its stop pulls. Open gaps report zero. A gap whose length unit cannot be resolved stays closed and is counted. | Same "One-way and gapped support basis" line: "… gaps N closed (node DOF ±g mm) / M open …". |
| B31 check refused anything but exact straight pipe, so reducers and tees went unchecked | Reducer and tee elements, and since 2026-11-28 bend leads and arc chords, are B31 targets too (`src/lfea/practical-b31-fittings.js`, `sourceId: LFEA_PRACTICAL_B31_FITTINGS`, B31.3 2022 + B31J 2017 factors). **Reducer** (a CAESAR reducer record): both ends get the B31J Table 1-1 reducer SIF. The `DIAMETER2` end is checked with that size (the matching-pipe rule), and that is the only case where an end section may differ from the element's OD. CAESAR's `ALPHA`, `R2` and `L2` are used where given. Where they are 0, labelled defaults stand in: cone half-angle from the element geometry, r2 = 0.1·D2, L2 = 0.1·L, body wall = T1. **Welding tee** (CAESAR SIF type 3, three legs): B31J run or branch SIF, where the run is the two most nearly opposite legs. In-plane is local my on every leg: production solves each tee leg with the B31J branch modifier, whose reference vector is the tee-plane normal (since 2026-11-28; see "Tee plane mapping" below). Tee quality is `UNVERIFIED`, so no 1.26 reduction. **Weldolet** (CAESAR SIF type 5) run ends: SIFs back-calculated from CAESAR's BM4_L output (`src/lfea/lfea-weldolet-default.js`, `LFEA_DEFAULT_WELDOLET_CAESAR_BACKCALC`, NOT ENGINEER-REVIEWED: LFEA has no B31J weldolet equations). Expansion uses i = (R/T)^0.43 in and out of plane and axial, and i_t = 1.2 (R/T)^0.46. The sustained index is min(0.75 i, √i), with axial 1. These reproduce CAESAR to 1e-6 (until 2026-11-28 the Table D300 welded-on fitting SIF was used; see "Weldolet run ends" below). Branch ends stay at 1. Other fittings stay at i = 1 and are counted. Never blocks. | Code check status line: "B31J SIFs at N reducer end(s) and M welding-tee end(s) (LFEA_PRACTICAL_B31_FITTINGS); CAESAR-fitted SIFs at W weldolet run end(s), LFEA default (LFEA_DEFAULT_WELDOLET_CAESAR_BACKCALC), no B31J weldolet equations; K fitting end(s) not covered, unity factors". |
| B31 check had no expansion (displacement stress range) category | When the run has an operating case (`IXP-WPT`, else `IXP-WT`) and a sustained case (`IXP-WP`, else `IXP-W`), every sustained end also gets a `DISPLACEMENT_STRESS_RANGE` check on the operating minus sustained actions (CAESAR's EXP = OPE − SUS). Stress is B31.3 (2016+) Eq. (17), SE = √((\|Sa\| + Sb)² + (2St)²) with Sa = ia\|Fa\|/A, on the nominal section (a reducer end at that end's size), with the fitting's displacement SIFs. Allowable is Eq. (1a), f (1.25 Sc + 0.25 Sh), with f = 1 (`NOT ENGINEER-REVIEWED (LFEA default: f = 1, 7000 cycles or fewer)`). The engine rule is `DISPLACEMENT_RANGE_COLD_HOT_CYCLE_REDUCTION_EQ17_AXIAL_TORSION_V1`; profiles on the original rule keep the B31.3-2006 form. | Code check status line: "B31.3 expansion check: N check(s), IXP-WPT minus IXP-WP, allowable f (1.25 Sc + 0.25 Sh), f = 1 (LFEA default)" (the weldolet under-prediction warning was dropped on 2026-11-28, once weldolet SIFs came from CAESAR). |
| InputXML bends with CAESAR station nodes (`NODE1`/`NODE2`) refused an arc (`BEND_INTERNAL_STATION_GEOMETRY_NOT_SUPPORTED`) and ran as straight chords (`GENERIC_APPROX_BEND_STRAIGHT_CHORD`). Every bend in BM4 (11) and BM1 (2) has station nodes. | Resolved from the corner, CAESAR's own convention: FROM→TO runs along the incoming leg to the corner, and the next element leaves along the outgoing leg; the tangent points sit R·tan(θ/2) back on each leg (`src/core/geometry/adapters/inputxml-bend-corner.js`, tangent basis `INPUTXML_CORNER_INTERSECTION_V1`). It is the same arithmetic as ACCDB's `ACCDB_CORNER_INTERSECTION_V1`, and the bend then follows the same retopology. A bend whose corner is not a simple two-span corner, or whose radius does not fit, stays a chord with the diagnostic. | Pre-flight diagnostic `BEND_CORNER_ARC_GEOMETRY_RESOLVED` per bend; the chord limitation disappears from the retained list. |
| Requested cases defaulted to weight only, so no expansion check ran until the user applied a selection on the Model tab | When no selection has been applied, the Source workflow requests weight, the sustained case (`WEIGHT_PRESSURE`) and one operating case (`WEIGHT_PRESSURE_TEMPERATURE`, else `WEIGHT_TEMPERATURE`) that the model has (`src/workspace/lfea-default-case-selection.js`). If that set would block a model the weight-only pass did not, weight only is kept. Applying a selection replaces it. | Source facts: "Requested cases: IXP-W, IXP-WP, IXP-WPT (LFEA default: weight, sustained and operating cases; change on the Model tab)". |
| The Source tab took InputXML only; a CAESAR ACCDB could be analysed only by the scripts | The Source tab imports `.accdb`/`.mdb` too (`src/workspace/lfea-accdb-source.js`). The eleven INPUT_* tables are read in the page (nothing is uploaded), with a SHA-256 over the exact bytes, and pre-flight runs through the same governed chain as InputXML (`linear-piping-accdb-intake.js`), so every default above applies. A file without the CAESAR model tables is refused and the previous source stays. BM4_L through the Source workflow on app defaults (`scripts/lfea-accdb-source-import-check.mjs`): SUS 122/128 ends within 1% of CAESAR CASE 6, all 128 within 5%; EXP straight pipe a median 0.34% from CASE 14, 67/77 within 5% (3.38% low and 63/77 before the thermal default below). | Source facts: "Format: CAESAR II ACCDB (model tables read in the browser)". |
| InputXML was diagnosed in its own length unit (mm or in) but given the 25 mm geometry allowance in metres, i.e. 0.025 mm. So BM4 as CAESAR exported it blocked on its three 1 mm backtracking elements (seven `TOPOLOGY_COLLINEAR_SEGMENT_OVERLAP`), which the ACCDB path accepts in BM4_L | The allowance is passed in the source unit (`lfeaProximityOptionsForSourceUnit`, `src/workspace/lfea-geometry-allowance.js`): 25 mm whatever the file's unit, and no allowance for a unit LFEA does not know. The overlaps are still detected and named, as ADVISORY "accepted within the declared 25 allowance"; anything past 25 mm still blocks (a 30 mm backtrack in BM4 does). The model runs as written, as CAESAR ran it; the bounded sign-flip repair (`InputXML_BM4.repaired.xml`) stays a benchmark variant. BM4 as exported vs Output_BM4: SUS straight pipe 100/111 within 1% of CASE 19; EXP straight pipe at a CAESAR-like strain a median 3.71% (3.55% repaired). | Pre-flight findings: "IX-S89 and IX-S93 classify as collinear overlap, accepted within the declared 25 allowance." |
| An element whose declared delta does not close its loop blocked at any miss over 1e-6 (`TOPOLOGY_ELEMENT_DELTA_CLOSURE_MISMATCH`). Real models miss by 0.0009 to 8.4 mm from rounded deltas | A miss within the same 25 mm allowance, in the source unit, is ADVISORY: "misses by …, accepted within the declared 25 allowance", and the solved node coordinates are used (`topology-graph-diagnostics.js`, `topologyOptions`). A larger miss still blocks. | Pre-flight finding on the element. |
| Two restraints on one node and DOF blocked (`MODEL_RESTRAINT_TARGET_DUPLICATE`): the same guide typed on two adjacent elements, a Y support repeated. Five of seven real models had them | A restraint whose every DOF is held rigidly both ways (no gap, spring or connecting node) by another restraint at the same node is merged into it, listed and not compiled (`inputxml-restraint-duplicate-merge.js`, `LFEA_RESTRAINT_DUPLICATE_MERGED`). That is exact in a linear analysis: a rigid hold in parallel with anything is the rigid hold. Duplicates no rigid hold covers (connecting nodes, two springs) still block. CI: a copied guide on BM4 merges and changes no displacement. | Pre-flight finding per merged restraint, CONDITIONAL. |
| A CAESAR hanger with no spring rate (a request for CAESAR's hanger design) blocked (`MODEL_HANGER_PREDEFINED_DATA_INCOMPLETE`) | Two passes (`src/workspace/lfea-hanger-design.js`): a weight-only solve with each such hanger held rigid (`LFEA_HANGER_RESTRAINED_WEIGHT_PASS`), then each hanger is a constant-effort support of its restrained-weight reaction in every weight-bearing case (`LFEA_HANGER_CONSTANT_EFFORT_DEFAULT`, reviewer `NOT ENGINEER-REVIEWED (LFEA hanger restrained-weight pass)`), the batch it came from sealed with the load. That is CAESAR's design load without its spring selection, so the up-to-25% load variation of a real spring is not modelled. A hanger on a node a rigid restraint already holds carries nothing; a negative reaction gives no load. If the weight pass cannot run, the model stays as it was and the Source tab says why. CI: a hanger in place of BM4's +Y support at 20300 carries that support's reaction (357.008 N) exactly. | Pre-flight finding per hanger; load ledger "constant-effort". |
| A bend whose tangent point lands on a node (the next node at the far tangent, or the bend leaving straight off its FROM node) blocked (`BEND_RETOPOLOGY_TANGENT_OVERRUN`, or a zero-length segment) | A tangent within 1e-4 of the span's length of its end node is on that node (`BEND_TANGENT_AT_NODE_FRACTION`, `bend-retopology-geometry.js`). The node moves onto the exact tangent; at the far end the next element lies wholly in the arc and is consumed, and the corner working point is retired into that node, so anything bound to it moves with it. A consumed element that carries an applied load blocks. CI: BM4's element after the 381 mm bend shortened to 381 mm is consumed and the model runs. | None beyond the bend; the consumed element has no segment. |
| The smooth-90° default (above) was passed to every bend, and the factor calculator refuses it on anything but 90°, so any model with a 45° bend blocked (`BEND_FACTOR_SET_NOT_QUALIFIED`) | The correction applies only to 90° bends, within the calculator's own 1e-6° ("where applicable"); other angles keep their uncorrected factor. CI: BM4 with one bend turned to 45° runs. | Bend factor record. |
| A tee whose run legs were not collinear within 1 + cos θ ≤ 1e-9 (0.003°) blocked (`PIPING_COMPONENT_BRANCH_RUN_NOT_IDENTIFIED`); a real tee was 0.008° off | 1e-6, i.e. 0.08° (`LFEA_PRACTICAL_RUN_COLLINEARITY_V1`, `inputxml-production-branch-modifiers.js`). | Branch factor record. |
| CAESAR specified displacements (InputXML `DISPLACEMENTS`, how a nozzle anchors a line) were not read at all, so a nozzle-anchored model solved as if free | Read (`inputxml-specified-displacement.js`): a DOF with a value in any vector is held in every case (a prescribed slot); vector 1 (D1) moves it in the temperature cases, CAESAR's W+D1+T1+P1 (`LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1`); vectors 2–9 are counted, not applied; a DOF unset in every vector is free. Length in the model unit, rotation in degrees. A record on a node the model does not have is listed and ignored (`LFEA_DISPLACEMENT_NODE_ABSENT_IGNORED`). A DOF both displaced and restrained blocks. ACCDB displacement tables are not read yet. CI: BM4's anchor as an all-zero displacement reproduces the anchored solution exactly; D1 DZ = 5 mm moves the node 5 mm in WPT and not in W. | Pre-flight finding per record; load ledger "specified displacement". |
| Thermal strain for carbon steel was a generic α = 1.17e-5 /K from 20 °C, which put BM4_L operating and expansion results 3.4% below CAESAR and BM4 (325 °C) 13.5% below | CAESAR's own strain, **back-calculated from CAESAR's output** (`scripts/lfea-caesar-thermal-strain-backcalc.mjs`; default in `src/workspace/lfea-thermal-default.js`, `LFEA_DEFAULT_THERMAL_CAESAR_BACKCALC`). In CAESAR's friction-free EXP case, weight and pressure cancel, so every straight element obeys stretch = εL + NL/(EA) whatever the supports did. ε per element comes from CAESAR's displacements and local axial force; the median per operating temperature is CAESAR's strain there. From 21 °C, A106 Grade B: **82 °C 0.00072931** (BM1, 1 span), **120 °C 0.00121097** (BM4_L: 44 spans, reproduces the independent 54-span record to 6e-8; BM1's 9 spans agree within 0.11%, its ambient being 21.1 °C), **325 °C 0.00406767** (BM4: 34 of 54 spans within 1e-6; the same 10 short elements stray in BM4 and BM4_L). Stored as the mean α from 21 °C (1.1956e-5, 1.2232e-5, 1.3381e-5 /K), read off linearly in temperature between the points and along the end slopes beyond them (`inputxml-thermal-default.js`); it extrapolates to 1.15e-5 at 20 °C. Used for A106 B (106) and A334 Gr 6 (360); other materials keep the generic project authority, and a model-interval authority, where given, still wins. Outside 82–325 °C it is an extrapolation. The CAESAR material database will replace it. CI (`lfea-caesar-thermal-strain-backcalc-check`) re-runs the back-calculation and holds every point to it. On app defaults: **BM4_L** expansion straight pipe 45/77 within 1%, 67/77 within 5% of CASE 14, median 0.34% (was 3.38% low); operating vs CASE 5 displacement ratio 0.999 (was 0.967), worst node 0.15 mm (was 0.42), 46/47 support loads within 5% (was 43). **BM4** expansion straight pipe 39/98 within 1%, 77/98 within 5% of CASE 21, median 2.0%, CAESAR/LFEA 0.998 (was 4/98 within 5%, 13.5% low); OPE vs CASE 20 displacement ratio 0.9994 (was 0.893), 25/30 supports within 5% (was 18), 29/30 counting lift-offs (was 22), all five gap closures where CAESAR has them (20030 DZ, 20390 DX, 21480 DX and DZ, 21640 DX). **BM1** (probe, not in CI) expansion displacement ratio 0.968 (was 0.937); the rest is CAESAR's friction at nodes 70 and 80. | Source facts, "Thermal basis": "N heated element(s) on the LFEA default (…): carbon-steel strain back-calculated from CAESAR output at 82, 120, 325 C, from 21 C, at T1 … C (… extrapolated); NOT ENGINEER-REVIEWED". |
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
with CAESAR CASE 20, its friction-free operating case. SUS was compared with
CASE 17, which carries friction. Since 2026-11-27 SUS is compared with
CASE 19: the user-verified case settings
(`benchmarks/LFEA/CAESAR_ACCDB/bm4nl-l19-l20-linear-solve.profile.json`) give
CASE 19 and CASE 20 `FRICTION_MULTIPLIER 0`, so they are the friction-free
pair, and CASE 21 (EXP) = L20 − L19.

InputXML bends as real arcs (2026-11-27), same check:

| BM4 (30 supports) | Bends as chords | Real bend arcs | Real arcs, back-calculated CAESAR strain (2026-11-28) |
|---|---|---|---|
| SUS vs CASE 19 within 5% / or lifted off | 24 / 26 | **28 / 30** | 28 / 30 |
| OPE vs CASE 20 within 5% / or lifted off | 21 / 25 | 18 / 22 | **25 / 29** |
| Total displacement ratio SUS (CASE 19) | 0.6823 | **1.0171** | 1.0171 |
| Total displacement ratio OPE | 0.8960 | 0.8930 | **0.9994** |
| Total vertical reaction vs CAESAR | 1.19% | **0.19%** | 0.19% |
| OPE gaps closed | 3 | 4: 20030 DZ now closes at −25 mm, as in CAESAR | 5: 21480 DZ too, as in CAESAR |

OPE support loads dropped with real arcs because the app's default thermal
strain was about 12% below CAESAR's at BM4's 325 °C (1.17e-5 /K from 20 °C).
Since 2026-11-28 the default is the strain back-calculated from this output
(see the thermal row at the top), and OPE is in the last column.

B31 on the app's own path (`scripts/lfea-b31-inputxml-caesar-comparison.mjs`:
BM4 InputXML, app defaults, default cases):

| BM4 InputXML vs Output_BM4 | Ends | Within 1% | Within 5% | Median |
|---|---|---|---|---|
| SUS straight pipe vs CASE 19 | 111 | 100 | 106 | 0.08% |
| SUS, all compared ends | 126 | 114 | 121 | 0.10% |
| EXP straight pipe vs CASE 21, back-calculated CAESAR strain (since 2026-11-28) | 98 | 39 | 77 | 2.0% (CAESAR/LFEA 0.998) |
| EXP, all compared ends | 113 | 39 | 84 | 2.4% (CAESAR/LFEA 1.000) |
| EXP straight pipe, generic 1.17e-5 /K from 20 °C (before) | 98 | 2 | 4 | 13.5% low (CAESAR/LFEA 1.147) |
| EXP straight pipe, chords (earlier), scaled to a CAESAR-like strain | 98 | 8 | 31 | 11.3% |

Before 2026-11-27 the BM4 InputXML expansion check was compared with BM4_L's
CASE 14 by mistake. BM4_L runs at 120 °C and BM4 at 325 °C, so that gave
about 3× CAESAR; Output_BM4 is the right reference.

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
| BM4, + weldolet run ends (Table D300) | 126 of 128 | 122 | 62 | 109 | 29.7% |
| BM4, re-measured 2026-11-28 before the weldolet change (after the real-model fixes) | 126 of 128 | 122 | 70 | 113 | 29.7% |
| BM4, weldolets on the CAESAR-fitted default (now; 21800-21850 I goes 1.10% → 1.22%, BM4 friction) | 126 of 128 | 122 | **69** | **113** | 29.7% |
| BM4_L (ACCDB) vs CASE 6, friction-free, reducers and tees | 128 | 128 | 106 | 128 | 4.7% |
| BM4_L, + weldolet run ends | 128 | 128 | 112 | 128 | 3.6% |
| **BM4_L, + restraint code 3 read as two-way Y (now; weldolet indices exact since 2026-11-28)** | **128** | **128** | **122** | **128** | **2.0%** |

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

Weldolet run ends, back-calculated from CAESAR (2026-11-28). This replaces
the Table D300 default above. `src/lfea/lfea-weldolet-default.js`,
`sourceId: LFEA_DEFAULT_WELDOLET_CAESAR_BACKCALC`, labelled
"NOT ENGINEER-REVIEWED (LFEA default: weldolet run SIFs fitted to CAESAR B31J
output on BM4_L; LFEA has no B31J weldolet equations)".

What CAESAR printed at BM4_L's 4 weldolets (8 run ends, branch not modelled),
B31.3-2022 with B31J:

| Run pipe | R/T | EXP i (in = out = axial) | EXP i_t | SUS I (in = out) | SUS I_t | SUS axial |
|---|---|---|---|---|---|---|
| 273 × 18.26 mm | 6.974 | 2.3052 | 2.9322 | 1.5183 | 1.7124 | 1 |
| 168.3 × 10.97 mm | 7.169 | 2.3326 | 2.9696 | 1.5273 | 1.7232 | 1 |

- The sustained indices are √ of the expansion SIFs to float precision, that
  is min(0.75 i, √i). That is the same rule as B31J branch indices.
- A power law c (R/T)^n through the two sizes lands on round numbers: c = 1.0000,
  n = 0.4300 for bending and c = 1.2000, n = 0.4600 for torsion, within 4e-6.
  LFEA stores i = (R/T)^0.43 and i_t = 1.2 (R/T)^0.46 (R mean radius,
  T nominal wall), both at least 1. These reproduce CAESAR's values to 1e-6.
- Expansion uses i in and out of plane and axial, and i_t in torsion.
  Sustained and occasional use min(0.75 i, √i), axial 1.
- Measured only at R/T 6.97–7.17 and only on unbranched runs. Outside that
  range the end's note says "extrapolated". How CAESAR's run SIF depends on
  branch size is not known from these models.
- `scripts/lfea-weldolet-caesar-backcalc-check.mjs` re-reads CAESAR's SIFs
  from the ACCDB, re-fits them, and requires every LFEA weldolet factor set on
  BM4_L to equal CAESAR's.

Results:
- BM4_L expansion: weldolet ends go from 0 to 8 of 8 within 5% (median 1.9%,
  worst 2.7%; was 37% low). All ends: within 5% 86 → 94, median 1.1% → 0.87%.
- BM4_L sustained: weldolet indices are now exact (Table D300 was 1.2–2.4%
  low). Totals unchanged at 122/128 within 1%.
- BM4 InputXML expansion, all ends: within 5% 84 → 92, median 2.4% → 2.0%.
- BM4 InputXML sustained: within 1% 70 → 69, within 5% 113. 21800-21850 I
  goes from 1.10% to 1.22% high. The factor is CAESAR's; the moment differs
  because of BM4's support friction.

Bends checked (2026-11-28). Until now bend-arc elements stayed outside the
B31 check. Now:

- **Where.** A CAESAR bend element is a straight lead plus arc chords in LFEA.
  Every chord end, including the tangent points, gets the bend SIF. The lead
  is plain pipe, as CAESAR has it. The exception is a lead at most 1% of the
  bend radius long (`LFEA_BEND_LEAD_ON_ARC`): there CAESAR's near point is the
  FROM node, and CAESAR applies the bend SIF there (BM4_L 20230 and 20760,
  leads of 0.2 and 0.4 mm). A tee or weldolet SIF at a node wins. Where the
  tee has no factors (two legs), the bend SIF stands.
- **Factors.** B31J Table 1-1 bend SIFs, 0.9 / h^(2/3) and 0.75 / h^(2/3),
  with the declared-pressure correction 1 + 3.25 (P/E)(R/T)^(5/2)(r/R)^(2/3).
  Torsion and axial are 1, and the sustained index is the SIF (B31J direct).
  These equal CAESAR's printed SIFs at every BM4_L bend end at a CAESAR node
  (34 ends, expansion and sustained, to 1e-4), except the bend into the
  two-leg tee at 20700. BM1's and BM4's expansion SIFs equal CAESAR's too.
- **Plane.** In-plane is bending in the bend plane. Arc chords are solved
  inside the bend component, whose reference vector is the bend-plane normal
  (`bend-component.js`, `BEND_PLANE_NORMAL_V1`), so on a chord in-plane is
  local my. The structural model's own chord axes are not the solved ones:
  using them swapped in and out of plane on three BM4_L bends, putting them
  exactly 1.302 / 1.562 = 0.83 of CAESAR.
- **Checks.** `scripts/lfea-bend-caesar-sif-check.mjs` holds the factors to
  CAESAR's. `scripts/lfea-caesar-end-key.mjs` maps LFEA bend ends to CAESAR's
  rows at CAESAR's own nodes (the bend's FROM, mid stations and TO). Ends
  between synthetic arc nodes have no CAESAR row.

| Bend ends vs CAESAR | Ends | Within 1% | Within 5% | Median | Worst |
|---|---|---|---|---|---|
| BM4_L sustained, CASE 6, friction-free | 40 | 39 | 40 | — | 1.1% |
| BM4_L expansion, CASE 14 | 43 | 19 | 39 | 1.2% | 17.2% (into the two-leg tee at 20700) |
| BM4 InputXML sustained, CASE 19 | 42 | 40 | 42 | 0.16% | — |
| BM4 InputXML expansion, CASE 21 | 42 | 21 | 38 | 1.1% | — |
| BM4 InputXML sustained, CASE 17 (CAESAR with friction) | 42 | 12 | 26 | — | 13.1% |
| BM1 sustained, CASE 4 | 12 | 2 | 5 | — | 79.3% (48-49 I) |

- **BM1.** BM1's CAESAR output is B31.3-2018: its sustained bend index is
  0.75 i (1.99 / 1.66), where LFEA's practical profile, B31.3-2022 with B31J,
  uses i (2.66 / 2.21). CAESAR's BM1 expansion SIFs are exactly LFEA's. At
  48, LFEA's moment is also about 2.8 times CAESAR's, next to 40-45, which
  was already BM1's worst straight end.
- **Totals.** BM4_L expansion, all ends: 109 → 152 compared, 133 within 5%,
  median 1.1%. Sustained: 128 → 174, all within 5%.

Tee plane mapping (2026-11-28). The same axis issue as the bend chords, at
welding tees.

- **What was wrong.** Production solves every leg of a three-leg welding tee
  with the B31J branch modifier (`teeExactMechanics`). The modifier's reference
  vector is the tee-plane normal (`directional-branch-flexibility.js`), so on
  every leg local y is the normal and in-plane is local my. The B31 check
  chose the plane from the structural model's leg axes instead. On run legs
  those happen to agree. On BM4's two branch legs, though, the structural z
  lies on the normal, so in-plane was read from mz: the out-of-plane moment.
  Checked on the solved BM4_L run legs: local my equals the global end moment
  projected on the tee-plane normal exactly.
- **Fix.** Tee legs always map in-plane to local my
  (`practical-b31-fittings.js`).
- **Pairing.** CAESAR splits both branches at nodes of its own: 20150-20161-20160
  and 20295-20296-21429. Those ends had no CAESAR row, so the comparisons
  never measured them. `scripts/lfea-caesar-end-key.mjs` now pairs an end at a
  CAESAR node with the one CAESAR row that has that node at that end, where the
  row's other node is a node LFEA does not have. When the element's other node
  is a CAESAR node, the row must also continue to it.

| BM4_L tee branch ends vs CAESAR | In-plane from mz (before) | In-plane from my |
|---|---|---|
| 20295-20296 I, expansion CASE 14 | 20.9% low | 4.2% low |
| 20295-20296 I, sustained CASE 6 | 1.6% high | 2.1% high |
| 20161-20160 J, expansion CASE 14 | 0.8% high | 2.5% high |
| 20161-20160 J, sustained CASE 6 | 0.1% high | 0.3% high |

- In- and out-of-plane indices equal CAESAR's at all 6 BM4_L welding-tee ends,
  branches included (`scripts/lfea-b31-sustained-caesar-comparison.mjs`).
- Totals with the newly paired ends:
  - BM4_L expansion: 152 → 156 compared, 137 within 5%, median 1.1%. Welding-tee
    ends are 6 of 6 within 5%, worst 4.2%.
  - BM4_L sustained: 174 → 178 ends, all within 5%, worst 2.1%.
  - BM4 InputXML, sustained CASE 17 (CAESAR with friction): 126 → 128 non-bend
    ends, 115 within 5%.
  - BM4 InputXML, expansion CASE 21: non-bend ends 113 → 116, 94 within 5%. The
    median goes from 2.0% to 2.18% because the added rows sit above it.
  - The 20295 bend's 21429 station (row 20296-21429) also pairs now: 35 bend ends
    are held to CAESAR's factors.

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
| All | 109 | 55 | 94 | 0.87% | 36.3% (two-leg tee at 20700, unity) |
| Straight pipe | 77 | 45 | 67 | 0.34% | 16.7% (1.4 vs 1.7 MPa) |
| Welding tees | 4 | 2 | 4 | 2.2% | 4.0% |
| Tee elements | 12 | 6 | 11 | 1.5% | 36.3% (two-leg tee at 20700, unity) |
| Reducers | 8 | 0 | 4 | 6.7% | 7.1% (labelled r2, L2 defaults) |
| **Weldolets (CAESAR-fitted default, 2026-11-28)** | 8 | 2 | **8** | **1.9%** | **2.7%** |
| Weldolets, Table D300 (before) | 8 | 0 | 0 | 36.7% low | 39.5% low |

- **Weldolets now use CAESAR's own SIFs** (see "Weldolet run ends" above).
  With the Table D300 value, about 1.5, expansion was 37% low there, because
  CAESAR's run SIF for expansion is 2.31–2.33 (torsion 2.93–2.97). The
  sustained check had matched only because CAESAR's sustained index is
  min(0.75 i, √i) = √2.33 = 1.53, close to Table D300's 1.51.
- This comparison prepares BM4_L as the parity harness does: CAESAR's
  reconstructed thermal strain (0.00121097 for 21 → 120 °C) and B31J bends
  with the smooth-90° correction. **The app's own defaults now give the same
  figures**: since 2026-11-28 the thermal default gives that same CAESAR
  strain at 120 °C (see the table at the top). Before that, with α 1.17e-5 from 20 °C,
  straight-pipe expansion stress was a median 3.4% below CAESAR and 63 of 77
  ends were within 5%; before smooth-90° was the default, 7.5% and 24 of 77.
  The L2/L6/L5 parity figures above also use the CAESAR-matched preparation.

Known B31 limits, all stated in the status line:

- Each check set covers one material, the one with the most elements.
- The app's default thermal strain is back-calculated from CAESAR output at
  82, 120 and 325 °C and exact there; between those points it is interpolated
  and outside them extrapolated, and materials other than A106 B and
  A334 Gr 6 keep the generic 1.17e-5 /K (see above).
- Bends are checked (since 2026-11-28) at every arc-chord end, with the
  B31.3-2022 / B31J sustained index I = i. A CAESAR run on an older edition
  (BM1's output is B31.3-2018, I = 0.75 i) reports lower bend sustained
  stress. A bend ending at a tee with no LFEA tee factors (the two-leg tee at
  BM4_L 20700) keeps the bend SIF; CAESAR uses 1.5737 both ways there.
  Mitred bends are not distinguished from smooth ones.
- Weldolet run ends use the CAESAR-fitted default, i = (R/T)^0.43 and
  i_t = 1.2 (R/T)^0.46. It is measured only at R/T 6.97–7.17 on unbranched
  runs; how CAESAR's run SIF depends on branch size is unknown. Weldolet
  branch ends keep i = 1.
- Sweepolets, fabricated tees and other fittings the B31J factor calculator
  does not implement keep i = 1. The status line counts them.
- BM4 runs only its weight case unless W+P is requested.

Derived supports mirror the constraints the final active-set solve used. A
CAESAR "+Y" (one-way) support that lifts off reports zero, for example BM4
node 20090. Before 2026-11-26 it was reported as two-way with about 290 N of
uplift. To turn the iteration off, for example for comparison scripts, use
`createLfeaNativeExecutionAuthority({ unilateralActiveSet: false })`.
