#!/usr/bin/env node
/**
 * Bend stress factors in the practical B31 check against the SIFs CAESAR II
 * printed for BM4_L (B31.3-2022 with B31J, OUTPUT_COMPONENT_STRESSES):
 *
 * - every bend end LFEA checks at a CAESAR node carries CAESAR's in-plane and
 *   out-of-plane SIF (EXP, CASE 14) and index (SUS, CASE 6), torsion and
 *   axial 1, to 1e-4. The B31J bend SIF with the declared-pressure
 *   correction (0.9 / h^(2/3) and 0.75 / h^(2/3) over 1 + 3.25 (P/E)
 *   (R/T)^(5/2) (r/R)^(2/3)) is what CAESAR uses;
 * - the lead's start end is plain pipe (CAESAR SIF 1), except a lead shorter
 *   than 1% of the bend radius, where CAESAR's near point is the FROM node;
 * - arc chords map in-plane to local my (the bend component's reference
 *   vector is the bend-plane normal);
 * - the one exception is the bend into the two-leg tee at 20700, where CAESAR
 *   prints 1.5737 in and out of plane (a tee SIF LFEA does not apply).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { lfeaB31EndFittings, LFEA_BEND_LEAD_ON_ARC } from '../src/lfea/practical-b31-fittings.js';
import { createLinearPipingAccdbSession, prepareLinearPipingAccdbPreFlight } from '../src/workspace/linear-piping-accdb-intake.js';
import { createCaesarEndKey } from './lfea-caesar-end-key.mjs';

const ACCDB = 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB';
assert.equal(LFEA_BEND_LEAD_ON_ARC, 0.01);
if (!existsSync(ACCDB)) {
  console.log(JSON.stringify({ check: 'lfea-bend-caesar-sif-check', status: 'SKIPPED_MODEL_NOT_PRESENT', requiredModel: ACCDB }));
  process.exit(0);
}
const MDBReaderModule = await import('mdb-reader');
const MDBReader = MDBReaderModule.default ?? MDBReaderModule;
const reader = new MDBReader(readFileSync(ACCDB));
const TABLES = ['INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT', 'INPUT_NODAL_COORDINATES',
  'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS', 'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS'];
const tables = Object.fromEntries(TABLES.map((name) => [name, { rows: reader.getTable(name).getData() }]));
const session = createLinearPipingAccdbSession(tables, { fileName: 'BM4_L.ACCDB', requestedCaseIds: ['IXP-W', 'IXP-WP'] });
const preFlight = prepareLinearPipingAccdbPreFlight(session.intake, session.sourceBundle);
const output = reader.getTable('OUTPUT_COMPONENT_STRESSES').getData();
const byCase = (caseNumber) => new Map(output.filter((row) => Number(row.LCASE_NUM) === caseNumber)
  .map((row) => [`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, row]));
const exp = byCase(14);
const sus = byCase(6);
const caesarEndKey = createCaesarEndKey(preFlight, new Set(exp.keys()));
const structural = preFlight.preparation.structuralPreparation;
const bindings = new Map(structural.segmentBindings.map((row) => [row.elementId, row]));
const { fittings } = lfeaB31EndFittings(preFlight);

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-4 * expected, `${label}: ${actual} vs CAESAR ${expected}`);
let compared = 0;
let leadStarts = 0;
const exceptions = [];
for (const [fittingKey, fitting] of fittings) {
  if (fitting.kind !== 'BEND') continue;
  const [elementId, lfeaEnd] = fittingKey.split(':');
  const binding = bindings.get(elementId);
  if ((binding.bendChordOf ?? null) !== null) {
    assert.equal(fitting.stressFactorSet.momentDirectionMapping.inPlaneField, 'my', `${fittingKey}: chord in-plane is local my`);
  }
  const mapped = caesarEndKey(binding, lfeaEnd);
  if (!mapped) continue;
  const side = mapped.end === 'I' ? 'F' : 'T';
  const e = exp.get(mapped.key);
  const s = sus.get(mapped.key);
  const label = `${mapped.key} ${mapped.end} (${fittingKey})`;
  const set = fitting.stressFactorSet;
  if (mapped.key.endsWith('-20700') && mapped.end === 'J' || mapped.key.startsWith('20699-20700') || mapped.key.startsWith('20698-20699')) {
    exceptions.push(label);
    continue;
  }
  near(set.displacementSifs.inPlaneBending.value, e[`SIFIN${side}`], `${label} EXP in-plane`);
  near(set.displacementSifs.outOfPlaneBending.value, e[`SIFOUT${side}`], `${label} EXP out-of-plane`);
  near(set.sustainedIndices.inPlaneBending.value, s[`SIFIN${side}`], `${label} SUS in-plane`);
  near(set.sustainedIndices.outOfPlaneBending.value, s[`SIFOUT${side}`], `${label} SUS out-of-plane`);
  assert.equal(e[`SIFTORS${side}`], 1, `${label} CAESAR torsion SIF`);
  assert.equal(set.displacementSifs.torsional.value, 1);
  assert.equal(set.displacementSifs.axial.value, 1);
  if (binding.retopologyRole === 'BEND_INCOMING_STRAIGHT' && lfeaEnd === 'I') leadStarts += 1;
  compared += 1;
}
// Lead starts LFEA leaves as plain pipe: CAESAR has SIF 1 there.
let plainLeadStarts = 0;
for (const binding of structural.segmentBindings) {
  if (binding.retopologyRole !== 'BEND_INCOMING_STRAIGHT' || fittings.has(`${binding.elementId}:I`)) continue;
  const mapped = caesarEndKey(binding, 'I');
  if (!mapped) continue;
  assert.equal(exp.get(mapped.key).SIFINF, 1, `${mapped.key} I: CAESAR has no bend SIF at a lead start`);
  plainLeadStarts += 1;
}
assert.equal(compared, 34, 'bend ends at CAESAR nodes with CAESAR\'s factors');
assert.equal(leadStarts, 2, 'the two vanishing leads (20230, 20760) take the bend SIF, as CAESAR does');
assert.ok(plainLeadStarts >= 8, 'plain lead starts match CAESAR SIF 1');
assert.equal(exceptions.length, 4, 'only the bend into the two-leg tee at 20700 differs');
console.log(JSON.stringify({ check: 'lfea-bend-caesar-sif-check', compared, leadStarts, plainLeadStarts, exceptions }));
console.log('LFEA bend CAESAR SIF check PASS');
