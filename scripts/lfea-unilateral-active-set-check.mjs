#!/usr/bin/env node
/**
 * One-way (unilateral) supports solved by active-set iteration
 * (LFEA_UNILATERAL_ACTIVE_SET_ITERATION, docs/PRACTICAL_ANALYSIS_POLICY.md).
 *
 * UNI-01  a "+Y" support next to a short end span lifts off: linear solve
 *         pulls it down, the active set releases it and reports zero.
 * UNI-02  the active-set record is sealed in the raw batch hash and recovery
 *         accepts the batch; tampering with the record is refused.
 * UNI-03  the solver refuses a released constraint that is not a FIXED
 *         constraint of the compilation.
 * UNI-04  never blocks: a release that cannot be solved, and an active set
 *         that cycles, both publish the last solved state with a status.
 * UNI-05  BM4: derived supports report every lifted-off support as zero.
 * UNI-06  the Results basis label carries the source ID and reviewer identity.
 * UNI-07  the solver holds a closed gap at its offset and refuses an offset that
 *         is not one distinct, unreleased FIXED constraint with a finite value.
 * UNI-08  BM4: gapped supports open, three close in OPE, and the label names the
 *         closed gaps and the friction coefficients not applied.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { executeInputXmlAuthorizedRawCases } from '../src/core/linear-piping-analysis-consumer/inputxml-linear-production-executor.js';
import { recoverInputXmlAuthorizedRawCases } from '../src/core/linear-piping-analysis-consumer/inputxml-linear-production-recovery.js';
import { compileSolverExecution } from '../src/core/linear-fea-solver/index.js';
import { inputXmlStiffnessFrameElementProfile, inputXmlStiffnessSolverProfile } from '../src/core/linear-piping-analysis-consumer/inputxml-linear-stiffness-profile.js';
import { compileInputXmlExecutionElementAuthorities } from '../src/core/linear-piping-analysis-consumer/inputxml-linear-execution-elements.js';
import { PRODUCTION_CAPABILITY_PROFILE } from '../src/core/linear-piping-analysis-consumer/production-capability-profile.js';
import {
  LFEA_UNILATERAL_ACTIVE_SET_REVIEWER,
  LFEA_UNILATERAL_ACTIVE_SET_SOURCE,
  lfeaUnilateralActiveSetLabel,
  lfeaUnilateralCandidates,
  solveWithLfeaUnilateralActiveSet,
} from '../src/lfea/unilateral-active-set.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import { createLfeaNativeSupportPublicationAuthority } from '../src/lfea/native-support-publication-authority.js';
import { LFEA_DERIVED_SUPPORT_REVIEWER, deriveLfeaSupportAuthorityInput } from '../src/lfea/derived-support-authority.js';

const CASE = 'IXP-W';

// UNI-01 ---------------------------------------------------------------------
// +Y at 10, 0.5 m span, +Y at 20, 6 m span, anchor at 30. Hogging over 20
// from the long span lifts the end support at 10 (a classic end-span uplift).
const preFlight = authorized(fixtureXml());
const linear = createLfeaNativeExecutionAuthority({ unilateralActiveSet: false }).run(preFlight, { requestedCaseIds: [CASE] });
const linearUy = reactionUy(linear.execution, '10');
assert.ok(linearUy < -1, `linear solve must pull the end support down (got ${linearUy} N)`);
assert.equal(linear.execution.unilateralActiveSet, undefined, 'disabled iteration leaves the batch identity unchanged');

const iterated = createLfeaNativeExecutionAuthority().run(preFlight, { requestedCaseIds: [CASE] });
const record = iterated.execution.unilateralActiveSet;
assert.equal(record.sourceId, LFEA_UNILATERAL_ACTIVE_SET_SOURCE);
assert.equal(record.reviewerIdentity, LFEA_UNILATERAL_ACTIVE_SET_REVIEWER);
assert.equal(record.candidateCount, 2);
assert.equal(record.status, 'CONVERGED');
const caseRecord = record.cases.find((row) => row.caseId === CASE);
assert.deepEqual(caseRecord.liftedOff.map((row) => row.sourceNodeId), ['10']);
assert.equal(reactionUy(iterated.execution, '10'), 0, 'a lifted-off support reports exactly zero');
assert.ok(reactionUy(iterated.execution, '20') > 0, 'the remaining one-way support pushes up');
assert.ok(displacementUy(iterated.execution, '10') >= 0, 'the pipe moves away from the lifted-off support');
const weight = totalUy(linear.execution);
assert.ok(Math.abs(totalUy(iterated.execution) - weight) <= 1e-6 * Math.abs(weight), 'total vertical reaction is unchanged');
assert.equal(iterated.execution.status, 'QUALIFIED');
console.log('LFEA-UNI-01 PASS one-way end support lifts off and reports zero');

// UNI-02 ---------------------------------------------------------------------
const recovery = recoverInputXmlAuthorizedRawCases({ preparation: preFlight.preparation, rawExecutionBatch: iterated.execution });
assert.equal(recovery.status, 'QUALIFIED');
assert.notEqual(iterated.execution.semanticHash, linear.execution.semanticHash);
const tampered = structuredClone(iterated.execution);
tampered.unilateralActiveSet.cases[0].releasedConstraintIds = [];
assert.throws(() => recoverInputXmlAuthorizedRawCases({ preparation: preFlight.preparation, rawExecutionBatch: tampered }),
  (error) => error?.code === 'INPUTXML_RECOVERY_RAW_BATCH_HASH_MISMATCH');
console.log('LFEA-UNI-02 PASS active set is sealed in the raw batch and recovery accepts it');

// UNI-03 ---------------------------------------------------------------------
const physical = preFlight.preparation.physicalPreparation.physicalCases.find((row) => row.caseId === CASE);
const elements = compileInputXmlExecutionElementAuthorities(
  preFlight.preparation.structuralPreparation, inputXmlStiffnessFrameElementProfile(), physical.loadCase, {
    sourcePreparation: preFlight.preparation.sourcePreparation,
    bendFactorAuthority: preFlight.preparation.stiffnessPreflight.bendFactorAuthority,
    branchFactorAuthority: preFlight.preparation.stiffnessPreflight.branchFactorAuthority,
    capabilityProfile: PRODUCTION_CAPABILITY_PROFILE,
  });
for (const releasedConstraintIds of [['NOT-A-CONSTRAINT'], 'IXP-C', [caseRecord.releasedConstraintIds[0], caseRecord.releasedConstraintIds[0]]]) {
  assert.throws(() => compileSolverExecution({
    compilation: preFlight.preparation.structuralPreparation.compilation,
    elementContributions: elements.elementContributions,
    loadCase: physical.loadCase,
    solverProfile: inputXmlStiffnessSolverProfile(),
    releasedConstraintIds,
  }), (error) => error?.code === 'SOLVER_RELEASED_CONSTRAINT_INVALID');
}
console.log('LFEA-UNI-03 PASS solver releases only distinct FIXED constraints of the compilation');

// UNI-04 ---------------------------------------------------------------------
const realSolve = (caseIds, activeSet) => createLfeaNativeExecutionAuthority({
  executeAuthorizedCases: (input) => executeInputXmlAuthorizedRawCases({ ...input, unilateralActiveSet: activeSet }),
  unilateralActiveSet: false,
}).run(preFlight, { requestedCaseIds: caseIds }).execution;
let solves = 0;
const unsolvable = solveWithLfeaUnilateralActiveSet(preFlight.preparation, [CASE], (caseIds, activeSet) => {
  solves += 1;
  if (activeSet.provisional && activeSet.cases[0].releasedConstraintIds.length > 0) throw new Error('SOLVER_MECHANISM_FLOATING_COMPONENT');
  return realSolve(caseIds, activeSet);
});
assert.equal(unsolvable.unilateralActiveSet.status, 'STOPPED_RELEASE_UNSOLVABLE');
assert.deepEqual(unsolvable.unilateralActiveSet.cases[0].releasedConstraintIds, [], 'the last solved state is published');
assert.ok(lfeaUnilateralActiveSetLabel(unsolvable.unilateralActiveSet).includes('Did not converge'));
const cycling = solveWithLfeaUnilateralActiveSet(preFlight.preparation, [CASE], (caseIds, activeSet) => {
  const batch = realSolve(caseIds, activeSet);
  if (!activeSet.provisional) return batch;
  // A pretend solve that always pulls on every engaged one-way support and
  // pushes every released one back: release and re-engage forever.
  return fakeFlip(batch, preFlight, activeSet.cases[0].releasedConstraintIds);
});
assert.match(cycling.unilateralActiveSet.status, /^NOT_CONVERGED_/u);
assert.ok(cycling.unilateralActiveSet.cases[0].solveCount <= 21);
assert.ok(solves >= 2);
console.log('LFEA-UNI-04 PASS non-convergence publishes the last state with a label, never a block');

// UNI-05 ---------------------------------------------------------------------
const bm4 = authorized(readFileSync('benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml', 'utf8'), 'InputXML_BM4.repaired.xml', ['IXP-WP', 'IXP-WPT']);
const bm4Execution = createLfeaNativeExecutionAuthority().run(bm4, { requestedCaseIds: ['IXP-WP', 'IXP-WPT'] });
const bm4Results = createLfeaNativeResultsAuthority().recover(bm4, bm4Execution);
const supports = createLfeaNativeSupportPublicationAuthority();
const input = deriveLfeaSupportAuthorityInput(bm4);
const staged = supports.stage(bm4, input);
supports.authorize(bm4, {
  reviewerIdentity: LFEA_DERIVED_SUPPORT_REVIEWER, reason: 'Active-set check.', acceptedAuthoritySemanticHash: staged.authority.semanticHash,
});
const published = supports.publish(bm4, bm4Execution, bm4Results);
assert.equal(published.publicationCurrentness, 'CURRENT');
let zeroCount = 0;
for (const caseRow of bm4Execution.execution.unilateralActiveSet.cases) {
  const publication = published.publications.find((row) => row.caseId === caseRow.caseId).publication;
  assert.ok(caseRow.liftedOff.length > 0, `${caseRow.caseId} lifts off at least one BM4 support`);
  for (const lift of caseRow.liftedOff) {
    const action = publication.actions.find((row) => row.nodeId === lift.nodeId);
    assert.ok(action, `${caseRow.caseId}: derived support at ${lift.sourceNodeId} is published`);
    assert.equal(Math.abs(action.fVertical), 0, `${caseRow.caseId}: lifted-off ${lift.sourceNodeId} reports zero Fv`);
    zeroCount += 1;
  }
}
assert.equal(zeroCount, 6, 'BM4 lifts off 2 SUS and 4 OPE supports');
console.log('LFEA-UNI-05 PASS BM4 derived supports report lifted-off supports as zero');

// UNI-06 ---------------------------------------------------------------------
const label = lfeaUnilateralActiveSetLabel(bm4Execution.execution.unilateralActiveSet);
assert.ok(label.includes(LFEA_UNILATERAL_ACTIVE_SET_SOURCE) && label.includes(LFEA_UNILATERAL_ACTIVE_SET_REVIEWER));
assert.ok(label.includes('IXP-WP: 2 lifted off (20090, 21470)'), label);
console.log('LFEA-UNI-06 PASS Results basis label names source, lifted-off supports and reviewer identity');

// UNI-07 ---------------------------------------------------------------------
const [end, middle] = lfeaUnilateralCandidates(preFlight.preparation).candidates;
const solverBase = {
  compilation: preFlight.preparation.structuralPreparation.compilation,
  elementContributions: elements.elementContributions,
  loadCase: physical.loadCase,
  solverProfile: inputXmlStiffnessSolverProfile(),
};
const held = compileSolverExecution({ ...solverBase, constraintOffsets: [{ constraintId: middle.constraintId, value: 0.002 }] });
const heldUy = held.displacement.find((row) => row.nodeId === middle.nodeId && row.dof === 'UY').value;
assert.ok(Math.abs(heldUy - 0.002) < 1e-12, `a closed gap holds the pipe at its offset (got ${heldUy} m)`);
for (const [constraintOffsets, releasedConstraintIds] of [
  [[{ constraintId: 'NOT-A-CONSTRAINT', value: 0.001 }], undefined],
  [[{ constraintId: end.constraintId, value: 0.001 }], [end.constraintId]],
  [[{ constraintId: end.constraintId, value: Number.NaN }], undefined],
  [[{ constraintId: end.constraintId, value: 0.001 }, { constraintId: end.constraintId, value: 0.002 }], undefined],
  [{ constraintId: end.constraintId, value: 0.001 }, undefined],
]) {
  assert.throws(() => compileSolverExecution({ ...solverBase, constraintOffsets, releasedConstraintIds }),
    (error) => error?.code === 'SOLVER_CONSTRAINT_OFFSET_INVALID');
}
console.log('LFEA-UNI-07 PASS solver holds a closed gap at its offset and refuses invalid offsets');

// UNI-08 ---------------------------------------------------------------------
const bm4Record = bm4Execution.execution.unilateralActiveSet;
assert.equal(bm4Record.gapCandidateCount, 6, 'BM4 has six gapped supports');
assert.ok(bm4Record.frictionNotAppliedCount > 0, 'BM4 friction coefficients are counted as not applied');
const operatingGaps = bm4Record.cases.find((row) => row.caseId === 'IXP-WPT');
// Four close since bends have real arcs (2026-11-27); 20030 closes at -25 mm, as in CAESAR.
// Five since the thermal strain is back-calculated from CAESAR (2026-11-28):
// 21480 closes in DZ as well as DX, as in CAESAR.
assert.deepEqual(operatingGaps.gaps.filter((row) => row.state !== 'OPEN').map((row) => `${row.sourceNodeId}:${row.dof}`).sort(),
  ['20030:UZ', '20390:UX', '21480:UX', '21480:UZ', '21640:UX']);
assert.equal(operatingGaps.constraintOffsets.length, 5, 'each closed gap is sealed as a solver offset');
assert.ok(label.includes('IXP-WPT: 4 lifted off') && label.includes('gaps 5 closed'), label);
assert.ok(label.includes('friction coefficient(s) not applied'), label);
console.log('LFEA-UNI-08 PASS BM4 gaps open and close, label names closed gaps and friction not applied');

console.log(JSON.stringify({
  check: 'lfea-unilateral-active-set',
  status: 'PASS',
  fixtureLinearTensionNewtons: Number(linearUy.toFixed(3)),
  bm4LiftedOff: Object.fromEntries(bm4Execution.execution.unilateralActiveSet.cases
    .map((row) => [row.caseId, row.liftedOff.map((lift) => lift.sourceNodeId)])),
}));

function fakeFlip(batch, flight, released) {
  const releasedSet = new Set(released);
  const bindings = flight.preparation.structuralPreparation.constraintBindings.filter((row) => row.unilateralAction);
  const keys = new Map(bindings.map((row) => [`IXP.N${row.sourceNodeId}:${row.unilateralAction.dof}`, row]));
  const caseRow = batch.caseExecutions[0];
  const reactions = caseRow.execution.reactions.map((row) => {
    const binding = keys.get(`${row.nodeId}:${row.dof}`);
    return binding && !releasedSet.has(binding.declarationIds[0]) ? { ...row, value: -binding.unilateralAction.resistedSign * 1000 } : row;
  });
  const displacement = caseRow.execution.displacement.map((row) => {
    const binding = keys.get(`${row.nodeId}:${row.dof}`);
    return binding && releasedSet.has(binding.declarationIds[0]) ? { ...row, value: -binding.unilateralAction.resistedSign * 0.01 } : row;
  });
  return { caseExecutions: [{ ...caseRow, execution: { ...caseRow.execution, reactions, displacement } }] };
}

function authorized(content, fileName = 'unilateral-active-set.xml', requestedCaseIds = [CASE]) {
  let flight = prepareLinearPipingInputXmlPreFlight(createLinearPipingInputXmlIntake({ fileName, content }, { requestedCaseIds }));
  if (flight.status === 'BLOCK') throw new Error(`${fileName} unexpectedly BLOCKED at pre-flight.`);
  if (!flight.solveAuthorized) {
    flight = authorizeLinearPipingInputXmlPreFlight(flight, {
      approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Unilateral active-set check.',
    });
  }
  return flight;
}
function rows(execution, field, node, dof) {
  return execution.caseExecutions[0].execution[field].filter((row) => row.nodeId === `IXP.N${node}` && row.dof === dof);
}
function reactionUy(execution, node) { return rows(execution, 'reactions', node, 'UY').reduce((sum, row) => sum + row.value, 0); }
function displacementUy(execution, node) { return rows(execution, 'displacement', node, 'UY')[0].value; }
function totalUy(execution) {
  return execution.caseExecutions[0].execution.reactions.filter((row) => row.dof === 'UY').reduce((sum, row) => sum + row.value, 0);
}

function fixtureXml() {
  const element = (from, to, dx, restraint) => `
      <PIPINGELEMENT FROM_NODE="${from}" TO_NODE="${to}" DELTA_X="${dx}" DELTA_Y="0" DELTA_Z="0"
        DIAMETER="114.3" WALL_THICK="6.02" MATERIAL_NAME="A106 Grade B" MATERIAL_NUM="106"
        MODULUS="200000" POISSONS="0.3" PIPE_DENSITY="7850" TEMP_EXP_C1="20">${restraint}
      </PIPINGELEMENT>`;
  const plusY = (node) => `
        <RESTRAINT NODE="${node}" TYPE="17" XCOSINE="0" YCOSINE="1" ZCOSINE="0"/>`;
  return `<CAESARII xmlns="COADE" VERSION="14.00" XML_TYPE="Input">
    <UNITS>
      <LENGTH LABEL="MM" FACTOR="25.4"/><FORCE LABEL="N" FACTOR="4.4482216152605"/>
      <MOMENT-INPUT LABEL="N-M" FACTOR="0.1129848290276167"/><STRESS LABEL="MPA" FACTOR="0.006894757293168"/>
      <PRESSURE LABEL="MPA" FACTOR="0.006894757293168"/><EMOD LABEL="MPA" FACTOR="0.006894757293168"/>
      <TEMP LABEL="C" FACTOR="0.5555555555555556"/><PDENS LABEL="KG/M3" FACTOR="27679.9047102"/>
      <IDENS LABEL="KG/M3" FACTOR="27679.9047102"/><FDENS LABEL="KG/M3" FACTOR="27679.9047102"/>
    </UNITS>
    <PIPINGMODEL xmlns="" JOBNAME="LFEA-UNILATERAL-ACTIVE-SET">${element(10, 20, 500, `${plusY(10)}${plusY(20)}`)}${element(20, 30, 6000, `
        <RESTRAINT NODE="30" TYPE="0" XCOSINE="1" YCOSINE="0" ZCOSINE="0"/>`)}
    </PIPINGMODEL>
  </CAESARII>`;
}
