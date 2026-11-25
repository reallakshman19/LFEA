# Review of the 21 "engineering drift" failures

Date: 2026-11-25. Scope: the checks in group C of `EXTRACTION_REPORT.md`.
They fail identically in unmodified AA3 @ `a8650bb`, so they were inherited
by this repo, not caused by the extraction.

Method:

- **Pickaxe:** `git log -S` over AA3's full history (8,851 commits) for the
  token each check asserts on.
- **Before/after runs:** each check run on the commit before and after a
  suspect commit (worktrees at `382fac12^` and `382fac12`).
- **Creation runs:** each check run at the commit that created it, to see
  whether it ever passed.

An automated bisect was tried, but it came back inconclusive: many
intermediate AA3 commits fail for unrelated reasons.

**No engineering code or check was changed in this repo for any item below.**
Each row ends with a recommendation that needs an owner decision.

## 1. One commit explains three failures: `382fac12` "Agent/lfea timoshenko alignment (#1516)", 2026-08-28

Verified by running each check on `382fac12^` (all three pass) and on
`382fac12` (all three fail).

The commit added a Poisson pressure-elongation term,
`(1−2ν)·P·Di²/…`, inside `linear-fea-frame-element/frame-element.js`.
That term reads `outerDiameter` / `innerDiameter`. The commit also made
`pressure` a required frame-element input, and it changed result recovery.

| Check | What fails | Recommendation |
|---|---|---|
| `lfea-b3.1-source-guard` | The guard forbids reading section geometry in the frame element ("compiled A, Iy, Iz, J are the section authority") | **Decide the authority rule.** Either (a) move the pressure-elongation term out of the element into a section/pressure authority that supplies a compiled quantity, which keeps the B-3.1 rule, or (b) amend the guard to allow exactly this term. (a) is the cleaner design. |
| `lfea-b3.14-appendix-s-example3` | `FRAME_ELEMENT_INPUT_INVALID: frameElementInput is missing pressure` | Supply `pressure` in the Example 3 fixture. Use 0 if Example 3 is an unpressurised case; take the value from the Appendix S source otherwise. Then confirm the expected results still match. |
| `lfea-b3.4-recovery` (test B34-T14) | A code station naming a node that is not an element end is **no longer refused**; `RECOVERY_CODE_STATION_NOT_LOCATABLE` is not thrown | **Likely real regression.** Recovery should refuse rather than interpolate at an unknown node. Restore the refusal in `linear-fea-result-recovery`. |

## 2. Real accuracy gap (never passed)

| Check | Finding | Recommendation |
|---|---|---|
| `lfea-m047-tee-rigid-thermal` | Fails at its own introducing commit `b4f193b7` (2026-08-11). Tee 20295 FLEXb in-plane: ours 1.32142, pinned CAESAR 1.323, a 0.12% difference against a 0.1% tolerance. The other tee in the check passes. | Engineering review of tee 20295: run/branch mean diameters 0.157302 / 0.157327 m, and the mean-diameter basis from `07cb824f`. If the CAESAR value is a 3-decimal rounding, a ±0.0005 absolute tolerance (≈0.04%) still fails, so the gap is real. Do not widen the tolerance without a source basis. |

## 3. New governance gates the fixtures don't satisfy yet

| Check | Finding | Recommendation |
|---|---|---|
| `lfea-bm4-inputxml-preflight`; blocks `lfea-bm4-cii-output-comparison`, `lfea-pipeline-analysis` | Pre-flight returns `BLOCK`: `BRANCH_FACTOR_EDITION_AUTHORITY_UNRESOLVED` for welding tees in physical case `IXP-W`. The gate came from `8a809cf3` "add explicit S6 branch factor authority" (2026-08-24). The checks call pre-flight with no options. | **Owner chooses the branch-factor edition** for BM4 (B31.3 Appendix D, or B31J) and seals it in the fixture options. This is a deliberate fail-closed gate, so don't bypass it. |
| `lfea-m047-bm4l-t1-interval-authority` | Expects ROTATION `zeroReferenceAbsolute === 1e-7`. The profile now has `1.745e-6` (= 1e-4° in rad), changed 2026-08-12/13 (`da50efcc`…`12c695a9`) after the check (`3c7cb956`, 08-11). | Confirm the radian-based gate is intended, then update the check's expectation and record the source. |

## 4. Intentional upstream changes; the guard was not updated

| Check | Finding | Recommendation |
|---|---|---|
| `lfea-b3.23-reducer-condensation` | The guard (`18f5d5cb`, 08-23) forbids the candidate reducer authority in the production consumer. `21a05efc` (10-10) "transmit ten-cylinder reducer local stiffness and loads to global assembly" wired it in, and `c74e77e2` added a pressure-basis rejection. | If that promotion was authorised, update the guard to the promoted state and add a production-readiness assertion. If not, revert the wiring. |
| `lfea-b3.6-sparse-assembly` | Expects `sparseMultiply` from `../lafea-linear-solve/sparse-matrix.js`. The LAFEA separation moved the neutral primitives to `shared-linear-solve`, and `lfea-linear-solver-neutral-dependency-check` passes. | Update the import pattern only. No numerical impact; **safe to apply.** |
| `lfea-standalone-native-execution` | Expects `requireAxisCustody` in the execution element authorities. It was removed by `2d76b1bb` / `865f8b7d` (2026-08-24, S6 tee modifiers into shared element authority). | Find where axis custody is enforced now and point the check there. If nothing enforces it any more, that is a regression. |
| `lfea-inputxml-model-health-source` | The source set now includes `accdb-source-binding.js` (`585a897a`, 2026-08-18) | Add the file to the expected set after confirming it belongs to model health. Low risk. |
| `lfea-piping-component-promotion-anti-drift` | `pressureCorrectionApplied !== false` was removed or moved by `382fac12` (see §1) | Resolve together with §1. |
| `lfea-ui-numerical-custody` | The blob hash of `linear-piping-inputxml-prefea.js` changed. It was frozen at "UI00" (`0bb07da0`, 08-22) and edited by `638927cf` (10-10, "remove import-time component-basis polling") and earlier commits. | Review the diff for numerical effect. If there is none, re-pin the hash with a custody note. |
| `lfea-pipeline-step-guidance` | Step state is `CURRENT`, expected `COMPLETE`; changed by UI continuity `42662495` (08-30) | UI semantics only. Update the expectation if "active completed step stays current" is the intended behaviour; `lfea-ui-continuity-check` asserts that it is. |

## 5. Results unchanged; metadata only

| Check | Finding | Recommendation |
|---|---|---|
| `lfea-m047-stage2-friction` | For case L5, row count, row semantic hash and every row value equal the frozen baseline; only `executionSemanticHash` differs | Re-pin the execution hash after confirming which execution-metadata field changed. **Numerics are unaffected.** |

## 6. Governance / release-evidence checks: never passed locally (unverified)

`linear-piping-project-qualification-anti-drift`, `lfea-piping-release-readiness`
(`RELEASE_LEDGER_MUTATION` in `governance-recording.js`),
`lfea-piping-phase6g-anti-drift`, `lfea-piping-wp3-runtime-bundle-assembler`
(`LFEA_WP3_RUNTIME_BUNDLE_PACKAGE_ID_MISMATCH`), and
`lfea-piping-phase6h-anti-drift`.

The two that were tested fail even at the commit that created them. They
probably depend on CI-supplied state: exact-head SHA, workflow
environment, or release evidence. **Unverified.** Recommendation: decide
whether the WP3–WP9 release-governance programme continues in LFEA. If it
doesn't, retire these with the other AA3 delivery guards.

## Suggested order

1. **B34-T14 recovery refusal (§1).** It is the only item that looks like a
   silent behavioural regression.
2. **BM4 branch-factor edition choice (§3).** It unblocks three checks and
   the real-model pre-flight.
3. **§1 authority decision for the pressure term**, then the b3.14 fixture
   and component-promotion guard.
4. **Tee 20295 accuracy (§2).**
5. **The mechanical guard updates:** b3.6, then model-health, step-guidance
   and friction re-pin once reviewed.
