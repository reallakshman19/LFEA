#!/usr/bin/env node
/**
 * BM4 against real CAESAR II output.
 *
 * These assertions record what this consumer actually agrees and disagrees
 * with CAESAR about on a real 96-element model. They are deliberately written
 * to FAIL if the known disagreements silently get worse, and equally to fail
 * if they silently disappear (which would mean the comparison stopped
 * measuring anything). None of them is tuned to make the model look correct.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBm4CiiComparison } from './lfea-bm4-cii-output-comparison.mjs';

console.log('\n--- LFEA BM4 vs. real CAESAR II output ---');
const comparison = buildBm4CiiComparison();
assert.equal(comparison.schema, 'lfea-bm4-cii-output-comparison/v1');
assert.equal(comparison.limitations.length, 4);

for (const [caseId, section] of Object.entries(comparison.cases)) {
  // Every restraint CAESAR reports must be one we also restrain, and vice
  // versa. A mismatch here means the restraint model itself drifted.
  assert.equal(section.restraint.matched.length, 30, `${caseId} restraint node count`);
  assert.deepEqual(section.restraint.unmatchedCiiNodes, [], `${caseId} unmatched CAESAR restraint nodes`);
  assert.deepEqual(section.restraint.unmatchedOurNodes, [], `${caseId} unmatched our restraint nodes`);
  assert.equal(section.displacement.matched.length, 97, `${caseId} displacement node count`);

  // Total supported weight is the one global scalar the linearization cannot
  // fudge: whatever it does to the DISTRIBUTION of load, the total must still
  // equal the model's weight. This is the strongest evidence that geometry,
  // section properties and gravity are right.
  const totalUY = section.restraint.totalUY;
  assert.ok(
    Math.abs(totalUY.percentDifference) < 3,
    `${caseId} total vertical reaction deviates ${totalUY.percentDifference.toFixed(3)}% from CAESAR (limit 3%)`,
  );

  // Physical qualification checks must hold even where the algebraic residual
  // gate does not (see the residual finding below).
  assert.equal(section.diagnostics.forceEquilibrium.status, 'PASS', `${caseId} force equilibrium`);
  assert.equal(section.diagnostics.momentEquilibrium.status, 'PASS', `${caseId} moment equilibrium`);
  assert.equal(section.diagnostics.energyBalance.status, 'PASS', `${caseId} energy balance`);
  assert.ok(section.diagnostics.energyBalance.value < 1e-14, `${caseId} energy balance is at machine precision`);
}

// ---------------------------------------------------------------------------
// Finding 1: one-way supports lift off exactly where CAESAR lifts them off.
// ---------------------------------------------------------------------------
// A "Rigid +Y" support can only push the pipe up. Linearized as a two-way
// FIXED DOF it pulled the pipe DOWN at 2 SUS and 4 OPE supports (worst
// -151.7 kN in OPE, measured 2026-11-25), where CAESAR reports zero. Since
// 2026-11-26 the active-set iteration (LFEA_UNILATERAL_ACTIVE_SET_ITERATION)
// releases those supports. Asserted: no support pulls, the iteration
// converged, and the supports we lift off are exactly the "+Y" supports
// CAESAR reports at zero.
const sustained = comparison.cases['IXP-WP'];
const operating = comparison.cases['IXP-WPT'];

const expectedLiftOff = { 'IXP-WP': ['20090', '21470'], 'IXP-WPT': ['20090', '20350', '21470', '21610'] };
for (const [caseId, section] of [['IXP-WP', sustained], ['IXP-WPT', operating]]) {
  assert.equal(section.restraint.unilateralTensionNodes.length, 0, `${caseId}: no one-way support may pull the pipe`);
  assert.equal(section.unilateralActiveSet.status, 'CONVERGED', `${caseId} active set converged`);
  assert.ok(section.unilateralActiveSet.solveCount <= 20, `${caseId} active set within its iteration cap`);
  assert.deepEqual([...section.unilateralActiveSet.liftedOffNodes].sort(), expectedLiftOff[caseId], `${caseId} lifted-off supports`);
  assert.deepEqual([...section.restraint.zeroReactionMatches].sort(), expectedLiftOff[caseId],
    `${caseId}: every lifted-off support matches CAESAR's zero, and no other CAESAR zero is missed`);
}

// ---------------------------------------------------------------------------
// Finding 1b: gapped supports close exactly where CAESAR closes them.
// ---------------------------------------------------------------------------
// BM4 has six gapped guides/limit stops. Since 2026-11-26 the active set opens
// them and closes the ones the pipe reaches. In OPE three close, and the pipe
// sits at the gap distance CAESAR reports there (20390 DX -5, 21480 DX +10,
// 21640 DX -10 mm). In SUS none is reached.
const closedGaps = (section) => section.unilateralActiveSet.gaps
  .filter((row) => row.state !== 'OPEN').map((row) => `${row.nodeId}:${row.dof}:${row.state}`).sort();
assert.equal(sustained.unilateralActiveSet.gaps.length, 6, 'BM4 gapped supports found');
assert.deepEqual(closedGaps(sustained), [], 'BM4 SUS: no gap closes');
assert.deepEqual(closedGaps(operating), ['20390:UX:CLOSED-', '21480:UX:CLOSED+', '21640:UX:CLOSED-'], 'BM4 OPE closed gaps');
for (const node of ['20390', '21480', '21640']) {
  const row = operating.displacement.matched.find((entry) => entry.nodeId === node);
  assert.ok(Math.abs(row.UX.ours - row.UX.cii) < 0.01, `BM4 OPE ${node} DX ${row.UX.ours} mm sits at CAESAR's ${row.UX.cii} mm`);
}

// ---------------------------------------------------------------------------
// Finding 2: per-node agreement, and how far it degrades.
// ---------------------------------------------------------------------------
// Re-measured 2026-11-26 with the active set: SUS 21/30 (unchanged) and OPE
// 17/30 (was 15) within 5% where CAESAR is nonzero; counting the supports both
// solvers lift off to exactly zero, SUS 23/30 (was 21) and OPE 21/30 (was 15).
// Re-measured 2026-11-26 with gapped supports: SUS 21/30 and 23/30 unchanged;
// OPE 21/30 within 5% (was 17) and 25/30 counting lift-offs (was 21).
const withinFivePercent = (section) => section.restraint.matched
  .filter((row) => row.UY.percentDifference !== null && Math.abs(row.UY.percentDifference) < 5).length;
const sustainedWithin = withinFivePercent(sustained);
const operatingWithin = withinFivePercent(operating);
assert.ok(sustainedWithin >= 21, `BM4 SUS: only ${sustainedWithin}/30 restraints within 5% of CAESAR`);
assert.ok(operatingWithin >= 21, `BM4 OPE: only ${operatingWithin}/30 restraints within 5% of CAESAR`);
const sustainedAgree = sustainedWithin + sustained.restraint.zeroReactionMatches.length;
const operatingAgree = operatingWithin + operating.restraint.zeroReactionMatches.length;
assert.ok(sustainedAgree >= 23, `BM4 SUS: only ${sustainedAgree}/30 restraints within 5% or lifted off with CAESAR`);
assert.ok(operatingAgree >= 25, `BM4 OPE: only ${operatingAgree}/30 restraints within 5% or lifted off with CAESAR`);

// ---------------------------------------------------------------------------
// Finding 3: displacements are systematically UNDER-predicted.
// ---------------------------------------------------------------------------
// Welding every unilateral and gapped support makes the model too stiff, so it
// moves less than the real one. The sustained case -- where CAESAR has the most
// open gaps -- is worst.
const sustainedRatio = sustained.displacement.totalAbsoluteTranslation.ratio;
const operatingRatio = operating.displacement.totalAbsoluteTranslation.ratio;
// Re-measured 2026-11-25: with the default B31J tee basis and current
// unilateral handling the sustained total displacement is 1.0013 x CAESAR
// (previously 0.30-0.40, too stiff). Band records the new measurement.
// Re-measured 2026-11-26 with the active set: SUS 1.0014, OPE 0.7615. OPE
// vertical movement now matches CAESAR (sum |DY| ratio 0.997); the remaining
// OPE shortfall is horizontal, at gapped guides CAESAR leaves open
// (GENERIC_APPROX_GAP_CLOSED), e.g. node 20030 DZ -25 mm in CAESAR, 0 here.
// Re-measured 2026-11-26 with gapped supports: OPE 0.8960 (was 0.7615), the
// guides CAESAR leaves open now open here too. SUS 1.2381 (was 1.0014): with
// its gaps open and no friction yet, the pipe slides sideways where CAESAR's
// CASE 17 holds it by friction (e.g. 20030 DZ -0.58 mm here, 0.00 in CAESAR,
// whose support there carries FX -2086 N of friction). Recorded, not tuned: it
// moves back toward 1.0 once support friction is applied.
assert.ok(sustainedRatio > 1.20 && sustainedRatio < 1.28, `BM4 SUS displacement ratio ${sustainedRatio.toFixed(4)} moved outside its recorded band`);
assert.ok(operatingRatio > 0.86 && operatingRatio < 0.93, `BM4 OPE displacement ratio ${operatingRatio.toFixed(4)} moved outside its recorded band`);

// ---------------------------------------------------------------------------
// Finding 4: the algebraic residual gate blocks a solution CAESAR confirms.
// ---------------------------------------------------------------------------
// residualCheck() measures ||K*U - F|| / ||F|| on the UNSCALED matrix, while
// the factorization and solve happen on the diagonally scaled system (BM4's
// scale factors span 2.1e6, because a 1 mm element sits next to a 6.6 m one).
// Recovering the residual into unscaled coordinates re-amplifies it by that
// spread, so the 1e-9 limit is unreachable for this model no matter how
// accurate the solve is. Force equilibrium (1e-8), moment equilibrium
// (6.7e-12) and energy balance (4e-16) all pass, and the total reaction agrees
// with CAESAR to 1.45%. Asserted as an open finding, NOT worked around: the
// limit is left exactly where its engineering authority set it.
// Re-measured 2026-11-25: the residual-conditioning work upstream resolved
// this finding. Both cases now pass the unchanged 1e-9 residual gate
// (SUS 4.3e-13, OPE 4.6e-14) and execute QUALIFIED. Asserted so a regression
// back to BLOCK/WARN is caught.
assert.equal(sustained.diagnostics.residual.status, 'PASS', 'BM4 SUS residual gate');
assert.equal(sustained.executionStatus, 'QUALIFIED');
assert.ok(sustained.diagnostics.residual.value < 1e-9, 'BM4 SUS residual within its gate');
assert.equal(operating.diagnostics.residual.status, 'PASS', 'BM4 OPE residual gate');
assert.equal(operating.executionStatus, 'QUALIFIED');

mkdirSync(fileURLToPath(new URL('../reports', import.meta.url)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL('../reports/lfea-bm4-cii-output-comparison.json', import.meta.url)),
  `${JSON.stringify(comparison, null, 2)}\n`,
);

console.log(JSON.stringify({
  check: 'lfea-bm4-cii-output-comparison',
  status: 'PASS',
  sustained: {
    totalReactionDeviationPercent: Number(sustained.restraint.totalUY.percentDifference.toFixed(3)),
    restraintsWithinFivePercent: `${sustainedWithin}/30`,
    restraintsWithinFivePercentOrLiftedOff: `${sustainedAgree}/30`,
    displacementRatio: Number(sustainedRatio.toFixed(4)),
    unilateralTensionSupports: sustained.restraint.unilateralTensionNodes.length,
    liftedOff: sustained.unilateralActiveSet.liftedOffNodes,
    closedGaps: closedGaps(sustained),
    executionStatus: sustained.executionStatus,
  },
  operating: {
    totalReactionDeviationPercent: Number(operating.restraint.totalUY.percentDifference.toFixed(3)),
    restraintsWithinFivePercent: `${operatingWithin}/30`,
    restraintsWithinFivePercentOrLiftedOff: `${operatingAgree}/30`,
    displacementRatio: Number(operatingRatio.toFixed(4)),
    unilateralTensionSupports: operating.restraint.unilateralTensionNodes.length,
    liftedOff: operating.unilateralActiveSet.liftedOffNodes,
    closedGaps: closedGaps(operating),
    executionStatus: operating.executionStatus,
  },
}, null, 2));
console.log('LFEA BM4 vs. real CAESAR II output comparison PASS (known deviations asserted, not tuned away)');
