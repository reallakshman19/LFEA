#!/usr/bin/env node
/**
 * The labelled defaults that let real CAESAR models run (2026-11-27 real-model
 * benchmark), each on a variant of BM4's InputXML, because the real models
 * they were found on are not committed:
 *
 * - specified displacement (CAESAR DISPLACEMENTS) in place of BM4's anchor:
 *   all-zero D1 gives the anchored model exactly; D1 moves the node in WPT only;
 * - a duplicate guide on the same node is merged (LFEA_RESTRAINT_DUPLICATE_MERGED)
 *   and changes nothing;
 * - an unsized hanger in place of a +Y support is designed in two passes and
 *   carries that support's own restrained-weight reaction;
 * - a bend whose far tangent lands on the next node consumes that element;
 * - a 45 degree bend runs under the smooth-90 default (the correction applies
 *   only to 90 degree bends).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';
import { prepareLfeaPreFlightWithHangerDesign } from '../src/workspace/lfea-hanger-design.js';

const SOURCE = readFileSync('benchmarks/LFEA/BM4/InputXML_BM4.xml', 'utf8');
const UNSET = '-1.010100';

const intakeOf = (content, cases) => createLinearPipingInputXmlIntake({ fileName: 'BM4-variant.xml', content }, { requestedCaseIds: cases });
function preFlightOf(content, cases) {
  const preFlight = prepareLinearPipingInputXmlPreFlight(intakeOf(content, cases));
  assert.notEqual(preFlight.status, 'BLOCK', blockText(preFlight));
  return preFlight;
}
function blockText(preFlight) {
  return (preFlight.preparation?.findings ?? []).filter((row) => row.disposition === 'BLOCK')
    .map((row) => `${row.code}: ${row.message}`).slice(0, 3).join(' | ');
}
function run(preFlight, cases) {
  const authorized = preFlight.solveAuthorized ? preFlight : authorizeLinearPipingInputXmlPreFlight(preFlight, {
    approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Real-model defaults check.',
  });
  const state = createLfeaNativeExecutionAuthority().run(authorized, { requestedCaseIds: cases });
  return new Map(state.execution.caseExecutions.map((row) => {
    assert.equal(row.executionStatus, 'QUALIFIED', `${row.caseId} qualified`);
    return [row.caseId, row.execution];
  }));
}
const valueAt = (execution, field, node, dof) => execution[field]
  .filter((row) => row.nodeId === `IXP.N${node}` && row.dof === dof).reduce((sum, row) => sum + row.value, 0);
function maxDisplacementDifference(left, right) {
  const other = new Map(right.displacement.map((row) => [`${row.nodeId}:${row.dof}`, row.value]));
  return Math.max(...left.displacement.map((row) => Math.abs(row.value - (other.get(`${row.nodeId}:${row.dof}`) ?? Number.NaN))));
}
function limitationCount(preFlight, code) {
  return preFlight.diagnostics.representabilityDiagnostics.inventory
    .filter((row) => Object.values(row.dispositionByProfile).some((entry) => entry.limitationCode === code)).length;
}
/** The text of the PIPINGELEMENT that contains `marker`, and its bounds. */
function elementAround(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `marker ${marker}`);
  const start = text.lastIndexOf('<PIPINGELEMENT', at);
  const end = text.indexOf('</PIPINGELEMENT>', at);
  return { start, end, body: text.slice(start, end) };
}
function replaceInElement(text, marker, edit) {
  const { start, end, body } = elementAround(text, marker);
  return `${text.slice(0, start)}${edit(body)}${text.slice(end)}`;
}
const emptied = (tag) => tag.replace(/ NODE="[^"]+"/u, ` NODE="${UNSET}"`).replace(/ TYPE="[^"]+"/u, ` TYPE="${UNSET}"`);

const base = run(preFlightOf(SOURCE, ['IXP-W', 'IXP-WPT']), ['IXP-W', 'IXP-WPT']);
const summary = {};

// 1. BM4's anchor at 22490 as a CAESAR specified displacement.
const ANCHOR = /<RESTRAINT NUM="\d" NODE="22490\.000000" TYPE="0\.000000"[^>]*\/>/u;
const withDisplacement = (dz) => replaceInElement(SOURCE, 'NODE="22490.000000" TYPE="0.000000"', (body) => body
  .replace(ANCHOR, (tag) => emptied(tag))
  .concat(`<DISPLACEMENTS DISP_NUM="1" NODE_NUM="22490.000000"><VECTOR NUMBER="1" DX="0.000000" DY="0.000000" DZ="${dz}" RX="0.000000" RY="0.000000" RZ="0.000000"/></DISPLACEMENTS>`));
const zeroDisplacement = preFlightOf(withDisplacement('0.000000'), ['IXP-W', 'IXP-WPT']);
assert.equal(limitationCount(zeroDisplacement, 'LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1'), 1);
const zeroRun = run(zeroDisplacement, ['IXP-W', 'IXP-WPT']);
summary.zeroDisplacementVsAnchorMaxMetres = Math.max(
  maxDisplacementDifference(zeroRun.get('IXP-W'), base.get('IXP-W')),
  maxDisplacementDifference(zeroRun.get('IXP-WPT'), base.get('IXP-WPT')),
);
assert.ok(summary.zeroDisplacementVsAnchorMaxMetres < 1e-9, 'all-zero D1 is the anchor');
const movedRun = run(preFlightOf(withDisplacement('5.000000'), ['IXP-W', 'IXP-WPT']), ['IXP-W', 'IXP-WPT']);
summary.d1MovesWptUzMetres = valueAt(movedRun.get('IXP-WPT'), 'displacement', 22490, 'UZ');
assert.ok(Math.abs(summary.d1MovesWptUzMetres - 0.005) < 1e-9, 'D1 moves the node in the operating case');
assert.ok(Math.abs(valueAt(movedRun.get('IXP-W'), 'displacement', 22490, 'UZ')) < 1e-12, 'and holds it in weight');

// 2. A second, identical guide on node 20030.
const duplicated = replaceInElement(SOURCE, 'NODE="20030.000000" TYPE="10.000000"', (body) => {
  const guide = body.match(/<RESTRAINT NUM="\d" NODE="20030\.000000" TYPE="10\.000000"[^>]*\/>/u)[0];
  return body.replace(/<RESTRAINT NUM="(\d)" NODE="-1\.010100" TYPE="-1\.010100"[^>]*\/>/u,
    (slot, num) => guide.replace(/NUM="\d"/u, `NUM="${num}"`));
});
const duplicatePreFlight = preFlightOf(duplicated, ['IXP-W']);
assert.equal(limitationCount(duplicatePreFlight, 'LFEA_RESTRAINT_DUPLICATE_MERGED'), 1, 'the copy is merged and listed');
summary.duplicateVsBaseMaxMetres = maxDisplacementDifference(run(duplicatePreFlight, ['IXP-W']).get('IXP-W'), base.get('IXP-W'));
assert.ok(summary.duplicateVsBaseMaxMetres < 1e-12, 'a merged duplicate changes nothing');

// 3. An unsized hanger in place of the +Y support at 20300 (no friction there).
const hung = replaceInElement(SOURCE, 'NODE="20300.000000" TYPE="17.000000"', (body) => body
  .replace(/<RESTRAINT NUM="\d" NODE="20300\.000000" TYPE="17\.000000"[^>]*\/>/u, (tag) => emptied(tag))
  .concat(`<HANGER NODE="20300.000000" CNODE="${UNSET}" CONST_EFF_LOAD="${UNSET}" LOAD_VAR="25.000000" COLD_LOAD="${UNSET}" HOT_LOAD="${UNSET}" NUM_HGR="${UNSET}" HGR_TABLE="1" SHORT_RANGE="1"/>`));
const notes = [];
const designed = prepareLfeaPreFlightWithHangerDesign({
  intake: intakeOf(hung, ['IXP-W']),
  prepare: (intake, options) => prepareLinearPipingInputXmlPreFlight(intake, options),
  weightIntake: () => intakeOf(hung, ['IXP-W']),
  onNote: (text) => notes.push(text),
});
assert.notEqual(designed.status, 'BLOCK', `${blockText(designed)} ${notes.join(' ')}`);
const hanger = designed.preparation.structuralPreparation.constraintBindings.find((row) => row.sourceKind === 'HANGER');
assert.equal(hanger.hangerDesignMode, 'CONSTANT_EFFORT');
const supportReaction = valueAt(base.get('IXP-W'), 'reactions', 20300, 'UY');
summary.hangerLoadNewtons = +hanger.coldLoadTotal.toFixed(3);
summary.replacedSupportReactionNewtons = +supportReaction.toFixed(3);
assert.ok(supportReaction > 0 && Math.abs(hanger.coldLoadTotal / supportReaction - 1) < 1e-6,
  'the hanger carries the restrained-weight reaction of the support it replaced');
summary.hangerWeightDeflectionMetres = valueAt(run(designed, ['IXP-W']).get('IXP-W'), 'displacement', 20300, 'UY');
assert.ok(Math.abs(summary.hangerWeightDeflectionMetres) < 1e-6, 'so in weight the pipe sits where the support held it');

// 4. The element after the 381 mm bend at 20120 shortened to the tangent length.
const snapped = replaceInElement(SOURCE, 'FROM_NODE="20120.000000" TO_NODE="20130.000000"',
  (body) => body.replace('DELTA_Y="-1434.000000"', 'DELTA_Y="-381.000000"'));
const snappedPreFlight = preFlightOf(snapped, ['IXP-W']);
const consumedId = snappedPreFlight.diagnostics.sourceBundle.elementRecords
  .find((row) => row.fromNodeId === '20120' && row.toNodeId === '20130').canonicalSegmentId;
const snappedBindings = snappedPreFlight.preparation.structuralPreparation.segmentBindings;
assert.ok(snappedBindings.length > 0 && !snappedBindings.some((row) => String(row.sourceSegmentId) === String(consumedId)),
  `element 20120-20130 (${consumedId}) is consumed by the bend's arc`);
summary.consumedByBend = consumedId;
run(snappedPreFlight, ['IXP-W']);

// 5. The same bend turned to 45 degrees.
const angled = replaceInElement(SOURCE, 'FROM_NODE="20120.000000" TO_NODE="20130.000000"',
  (body) => body.replace(`DELTA_X="${UNSET}" DELTA_Y="-1434.000000"`, 'DELTA_X="-1434.000000" DELTA_Y="-1434.000000"'));
run(preFlightOf(angled, ['IXP-W']), ['IXP-W']);

console.log(JSON.stringify({ check: 'lfea-real-model-defaults', status: 'PASS', ...summary }));
console.log('LFEA real-model defaults PASS');
