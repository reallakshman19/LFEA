#!/usr/bin/env node
/**
 * The weldolet run-end default (src/lfea/lfea-weldolet-default.js) against
 * the SIFs CAESAR II printed at BM4_L's weldolets (B31.3-2022 with B31J):
 *
 * - every stored point equals CAESAR's CASE 14 (EXP) in-plane, out-of-plane,
 *   axial and torsional SIF at that run size;
 * - CAESAR's CASE 6 (SUS) indices are sqrt of those, which the default uses;
 * - the factor sets LFEA builds for BM4_L reproduce CAESAR at every
 *   weldolet run end, expansion and sustained.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  LFEA_CAESAR_WELDOLET_RUN_POINTS,
  LFEA_WELDOLET_RUN_FIT,
  lfeaWeldoletRunFactors,
  powerFitThroughCaesarPoints,
} from '../src/lfea/lfea-weldolet-default.js';
import { lfeaB31EndFittings } from '../src/lfea/practical-b31-fittings.js';
import { createLinearPipingAccdbSession, prepareLinearPipingAccdbPreFlight } from '../src/workspace/linear-piping-accdb-intake.js';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.abs(expected),
  `${label}: ${actual} vs ${expected}`);

// Model-independent. The free power law through CAESAR's two points lands on
// the stored round numbers, i = (R/T)^0.43 and it = 1.2 (R/T)^0.46.
for (const field of ['bending', 'torsion']) {
  const free = powerFitThroughCaesarPoints(field);
  near(free.coefficient, LFEA_WELDOLET_RUN_FIT[field].coefficient, 1e-5, `${field} coefficient through CAESAR's points`);
  near(free.exponent, LFEA_WELDOLET_RUN_FIT[field].exponent, 1e-5, `${field} exponent through CAESAR's points`);
}
for (const point of LFEA_CAESAR_WELDOLET_RUN_POINTS) {
  const factors = lfeaWeldoletRunFactors(point.outerDiameter, point.wallThickness);
  assert.equal(factors.extrapolated, false, `${point.source} is a measured size`);
  // CAESAR stores float32: 1e-6 relative.
  near(factors.displacementSifs.inPlaneBending, point.bending, 1e-6, `${point.source} i`);
  near(factors.displacementSifs.torsional, point.torsion, 1e-6, `${point.source} it`);
  assert.equal(factors.displacementSifs.axial, factors.displacementSifs.inPlaneBending);
  assert.equal(factors.displacementSifs.outOfPlaneBending, factors.displacementSifs.inPlaneBending);
  near(factors.sustainedIndices.inPlaneBending, Math.sqrt(point.bending), 1e-6, `${point.source} I`);
  assert.equal(factors.sustainedIndices.axial, 1);
}
const thinWall = lfeaWeldoletRunFactors(610, 9.53);
assert.equal(thinWall.extrapolated, true, 'R/T 31.5 is outside the CAESAR points');
assert.ok(thinWall.displacementSifs.inPlaneBending > 2.33, 'thinner wall, higher SIF');
assert.equal(lfeaWeldoletRunFactors(100, 49).displacementSifs.inPlaneBending, 1, 'floored at 1');

const ACCDB = 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB';
if (!existsSync(ACCDB)) {
  console.log(JSON.stringify({ check: 'lfea-weldolet-caesar-backcalc-check', status: 'SKIPPED_MODEL_NOT_PRESENT', requiredModel: ACCDB }));
  process.exit(0);
}
const MDBReaderModule = await import('mdb-reader');
const MDBReader = MDBReaderModule.default ?? MDBReaderModule;
const reader = new MDBReader(readFileSync(ACCDB));
const weldoletNodes = new Set(reader.getTable('INPUT_SIFTEES').getData()
  .filter((row) => Math.round(row.TYPE) === 5).map((row) => String(Math.round(row.NODE))));
const sizes = new Map(reader.getTable('INPUT_BASIC_ELEMENT_DATA').getData()
  .map((row) => [`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, row]));
const output = reader.getTable('OUTPUT_COMPONENT_STRESSES').getData();
/** CAESAR's SIFs at weldolet ends: `${from}-${to}:${I|J}` -> { exp, sus }. */
const caesar = new Map();
for (const row of output) {
  const caseNumber = Number(row.LCASE_NUM);
  if (caseNumber !== 14 && caseNumber !== 6) continue;
  const key = `${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`;
  for (const [end, node, side] of [['I', row.FROM_NODE, 'F'], ['J', row.TO_NODE, 'T']]) {
    if (!weldoletNodes.has(String(Math.round(node)))) continue;
    const entry = caesar.get(`${key}:${end}`) ?? {};
    entry[caseNumber === 14 ? 'exp' : 'sus'] = {
      inPlane: row[`SIFIN${side}`], outOfPlane: row[`SIFOUT${side}`], torsion: row[`SIFTORS${side}`], axial: row[`SIFAXL${side}`],
    };
    caesar.set(`${key}:${end}`, entry);
  }
}
assert.equal(weldoletNodes.size, 4);
assert.equal(caesar.size, 8, 'BM4_L: 4 weldolets on unbranched runs, 8 run ends');

for (const [key, { exp, sus }] of caesar) {
  const element = sizes.get(key.split(':')[0]);
  const point = LFEA_CAESAR_WELDOLET_RUN_POINTS.find((row) => row.outerDiameter === element.DIAMETER && row.wallThickness === element.WALL_THICK);
  assert.ok(point, `${key}: a stored point for ${element.DIAMETER} x ${element.WALL_THICK}`);
  for (const value of [exp.inPlane, exp.outOfPlane, exp.axial]) near(value, point.bending, 1e-7, `${key} CAESAR EXP i`);
  near(exp.torsion, point.torsion, 1e-7, `${key} CAESAR EXP it`);
  // CAESAR's sustained index is sqrt of its expansion SIF (min(0.75 i, sqrt i)).
  near(sus.inPlane, Math.sqrt(exp.inPlane), 1e-6, `${key} CAESAR SUS I`);
  near(sus.outOfPlane, Math.sqrt(exp.outOfPlane), 1e-6, `${key} CAESAR SUS Io`);
  near(sus.torsion, Math.sqrt(exp.torsion), 1e-6, `${key} CAESAR SUS It`);
  assert.equal(sus.axial, 1);
}

// The factor sets LFEA builds on BM4_L, end by end.
const TABLES = ['INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT', 'INPUT_NODAL_COORDINATES',
  'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS', 'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS'];
const tables = Object.fromEntries(TABLES.map((name) => [name, { rows: reader.getTable(name).getData() }]));
const session = createLinearPipingAccdbSession(tables, { fileName: 'BM4_L.ACCDB', requestedCaseIds: ['IXP-W', 'IXP-WP'] });
const preFlight = prepareLinearPipingAccdbPreFlight(session.intake, session.sourceBundle);
const bindings = new Map(preFlight.preparation.structuralPreparation.segmentBindings.map((row) => [row.elementId, row]));
let compared = 0;
for (const [fittingKey, fitting] of lfeaB31EndFittings(preFlight).fittings) {
  if (fitting.kind !== 'WELDOLET') continue;
  const [elementId, end] = fittingKey.split(':');
  const binding = bindings.get(elementId);
  const reference = caesar.get(`${binding.startNodeId}-${binding.endNodeId}:${end}`);
  assert.ok(reference, `${fittingKey}: CAESAR reports this weldolet end`);
  const { displacementSifs, sustainedIndices } = fitting.stressFactorSet;
  near(displacementSifs.inPlaneBending.value, reference.exp.inPlane, 1e-6, `${fittingKey} i`);
  near(displacementSifs.outOfPlaneBending.value, reference.exp.outOfPlane, 1e-6, `${fittingKey} io`);
  near(displacementSifs.axial.value, reference.exp.axial, 1e-6, `${fittingKey} ia`);
  near(displacementSifs.torsional.value, reference.exp.torsion, 1e-6, `${fittingKey} it`);
  near(sustainedIndices.inPlaneBending.value, reference.sus.inPlane, 1e-6, `${fittingKey} I`);
  near(sustainedIndices.torsional.value, reference.sus.torsion, 1e-6, `${fittingKey} It`);
  assert.equal(sustainedIndices.axial.value, 1);
  assert.match(fitting.note, /NOT ENGINEER-REVIEWED \(LFEA default: weldolet run SIFs fitted to CAESAR/u);
  compared += 1;
}
assert.equal(compared, 8, 'every BM4_L weldolet run end');
console.log(JSON.stringify({
  check: 'lfea-weldolet-caesar-backcalc-check',
  fit: LFEA_WELDOLET_RUN_FIT,
  caesarEnds: caesar.size,
  lfeaEndsMatchingCaesar: compared,
}));
console.log('LFEA weldolet CAESAR back-calculation check PASS');
