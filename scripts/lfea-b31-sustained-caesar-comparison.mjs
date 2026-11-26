#!/usr/bin/env node
/**
 * B31.3 SUSTAINED (W+P) stresses vs CAESAR II output for BM1, BM4 and BM4_L.
 * The pressure term must match CAESAR SLP on the nominal-less-corrosion wall;
 * the total code stress is held to the tolerances measured when each
 * comparison was recorded (moment differences come from the solver, e.g.
 * BM4 support friction, and from fittings).
 *
 * BM4_L (benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB) is the friction-free
 * reference: its CASE 6 (SUS) W+P1 is linear, and its ACCDB carries CAESAR's
 * reducer records, which the BM4 InputXML export drops.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createLfeaNativeB31PublicationAuthority } from '../src/lfea/native-b31-publication-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import { runLfeaPracticalB31Check } from '../src/lfea/practical-b31-check.js';
import { lfeaB31EndFittings } from '../src/lfea/practical-b31-fittings.js';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';
import {
  createLinearPipingAccdbSession,
  prepareLinearPipingAccdbPreFlight,
} from '../src/workspace/linear-piping-accdb-intake.js';

const BM4L_ACCDB = 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB';
const ACCDB_MODEL_TABLES = [
  'INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT', 'INPUT_NODAL_COORDINATES',
  'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS', 'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS',
];

function authorized(preFlight) {
  return preFlight.solveAuthorized ? preFlight : authorizeLinearPipingInputXmlPreFlight(preFlight, {
    approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Practical B31 check.',
  });
}

function runtimeFor(preFlight) {
  const executionAuthority = createLfeaNativeExecutionAuthority();
  const executionState = executionAuthority.run(preFlight);
  const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
  const b31 = createLfeaNativeB31PublicationAuthority();
  return {
    preFlight, b31,
    sourceController: { getPreFlight: () => preFlight },
    executionAuthority,
    stageNativeB31Authority: (input) => b31.stage(preFlight, input),
    authorizeNativeB31Authority: (approval) => b31.authorize(preFlight, approval),
    publishNativeB31Application: () => b31.publish(preFlight, executionState, resultsState),
  };
}

function inputXmlPreFlight(path) {
  return authorized(prepareLinearPipingInputXmlPreFlight(createLinearPipingInputXmlIntake(
    { fileName: path, content: readFileSync(path, 'utf8') }, { requestedCaseIds: ['IXP-W', 'IXP-WP'] },
  )));
}

/** CAESAR code stress and SLP per element end, MPa, from an InputXML-run XML output. */
function caesarXmlSustained(outPath, susLabel, nextLabel) {
  const xml = readFileSync(outPath, 'utf8');
  const sus = xml.slice(xml.indexOf(`LOADCASE="${susLabel}`), xml.indexOf(`LOADCASE="${nextLabel}`));
  const rows = new Map();
  for (const m of sus.matchAll(/FROM_NODE="(\d+)" TO_NODE="(\d+)"[^>]*>\s*<AXIAL_STRESS[^>]*>\s*<BENDING_STRESS[^>]*>\s*<TORSION_STRESS[^>]*>\s*<HOOP_STRESS[^>]*>\s*<MAX_STRESS_INTENSITY[^>]*>\s*<CODE_STRESS FROM="([-\d.]+)" TO="([-\d.]+)"/g)) {
    rows.set(`${m[1]}-${m[2]}`, { codeI: +m[3] / 1e3, codeJ: +m[4] / 1e3 });
  }
  for (const m of sus.matchAll(/FROM_NODE="(\d+)" TO_NODE="(\d+)"[^>]*>\s*<AXIAL_STRESS[^>]*>\s*<SLP FROM="([-\d.]+)" TO="([-\d.]+)"/g)) {
    const key = `${m[1]}-${m[2]}`;
    rows.set(key, { ...rows.get(key), slpI: +m[3] / 1e3, slpJ: +m[4] / 1e3 });
  }
  return rows;
}

function compare(name, runtime, caesar) {
  runLfeaPracticalB31Check(runtime, { scMpa: 137.9, shMpa: 137.9 });
  const structural = runtime.preFlight.preparation.structuralPreparation;
  const rows = runtime.b31.getState().application.results
    .filter((row) => row.codeResult.stressTerms.pressure > 0)
    .map((row) => {
      const [, elementId, end] = row.checkId.match(/^B31-SUS-(.+)-([IJ])-IXP-WP$/u);
      const binding = structural.segmentBindings.find((x) => x.elementId === elementId);
      const key = `${binding.startNodeId}-${binding.endNodeId}`;
      const reference = caesar.get(key);
      return {
        key, end, kind: binding.componentKind,
        lfea: row.codeResult.calculatedStress / 1e6, sp: row.codeResult.stressTerms.pressure / 1e6,
        caesar: reference?.[`code${end}`], slp: reference?.[`slp${end}`],
      };
    });
  const mapped = rows.filter((row) => row.caesar > 0 && row.slp > 0);
  const rel = (a, b) => Math.abs(a - b) / b;
  const measure = (list) => ({
    checks: list.length,
    slpWithin0p1Pct: list.filter((row) => rel(row.sp, row.slp) <= 1e-3).length,
    within1Pct: list.filter((row) => rel(row.lfea, row.caesar) <= 0.01).length,
    within5Pct: list.filter((row) => rel(row.lfea, row.caesar) <= 0.05).length,
    maxPct: +(Math.max(...list.map((row) => rel(row.lfea, row.caesar))) * 100).toFixed(1),
  });
  const summary = {
    name, ...measure(mapped),
    unmapped: rows.filter((row) => !mapped.includes(row)).map((row) => `${row.key} ${row.end}`),
    fittings: measure(mapped.filter((row) => row.kind !== 'STRAIGHT_PIPE')),
  };
  console.log(JSON.stringify(summary));
  return summary;
}

const bm1 = compare('BM1', runtimeFor(inputXmlPreFlight('benchmarks/LFEA/BM1/BM1_InputXML.xml')),
  caesarXmlSustained('benchmarks/LFEA/BM1/BM1_CIIOutput.xml', 'CASE 4 (SUS)', 'CASE 5'));
assert.equal(bm1.checks, 18);
assert.deepEqual(bm1.unmapped, []);
assert.equal(bm1.slpWithin0p1Pct, 18, 'BM1 pressure term equals CAESAR SLP everywhere');
assert.ok(bm1.within1Pct >= 10 && bm1.within5Pct >= 16 && bm1.maxPct <= 15, 'BM1 sustained stress tolerance');

const bm4 = compare('BM4', runtimeFor(inputXmlPreFlight('benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml')),
  caesarXmlSustained('benchmarks/LFEA/BM4/Output_BM4.xml', 'CASE 17 (SUS)', 'CASE 19'));
// Re-measured 2026-11-26 with one-way supports solved by active-set iteration
// (SUS lifts 20090 and 21470, as CAESAR does): within 1% 55 -> 56, within 5%
// 103 -> 102, worst 29.7% unchanged. The one row that crossed 5% is
// 20030-20090 J (1.3% -> 5.5%), next to the lifted-off 20090.
// Re-measured 2026-11-26 with gapped supports, friction not yet applied:
// within 1% 56 -> 57, within 5% 102 -> 99, worst 29.7% unchanged. With its
// gaps open (as in CAESAR) and no friction, the sustained pipe slides where
// CAESAR CASE 17 holds it by friction, so three more rows near sliding
// supports cross 5%.
// Re-measured 2026-11-26 with reducer and tee elements checked (B31J
// factors, LFEA_PRACTICAL_B31_FITTINGS): 116 -> 128 W+P checks; the 10 new
// tee-element ends CAESAR reports add 1 within 1% and 8 within 5%. Element
// 20150-20160 has no CAESAR row (CAESAR splits it at 20161). The worst 29.7%
// is the reducer 22000-22010 J: the BM4 InputXML export carries no reducer
// record, so LFEA checks that element as plain 168.3 mm pipe; BM4_L below
// shows the same end at 0.9% once CAESAR's reducer record is present.
assert.equal(bm4.checks, 126);
assert.deepEqual(bm4.unmapped, ['20150-20160 I', '20150-20160 J']);
assert.ok(bm4.slpWithin0p1Pct >= 122, 'BM4 pressure term equals CAESAR SLP except at the 4 unrecorded reducer ends');
assert.ok(bm4.within1Pct >= 58 && bm4.within5Pct >= 107 && bm4.maxPct <= 29.7, 'BM4 sustained stress tolerance');

if (existsSync(BM4L_ACCDB)) {
  const MDBReaderModule = await import('mdb-reader');
  const MDBReader = MDBReaderModule.default ?? MDBReaderModule;
  const reader = new MDBReader(readFileSync(BM4L_ACCDB));
  const tables = Object.fromEntries(ACCDB_MODEL_TABLES.map((name) => [name, { rows: reader.getTable(name).getData() }]));
  const session = createLinearPipingAccdbSession(tables, { fileName: 'BM4_L.ACCDB', requestedCaseIds: ['IXP-W', 'IXP-WP'] });
  const preFlight = authorized(prepareLinearPipingAccdbPreFlight(session.intake, session.sourceBundle));
  const caesar = new Map(reader.getTable('OUTPUT_COMPONENT_STRESSES').getData()
    .filter((row) => Number(row.LCASE_NUM) === 6) // CASE 6 (SUS) W+P1, friction-free
    .map((row) => [`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, {
      codeI: row.CODE_STRESSF / 1e3, codeJ: row.CODE_STRESST / 1e3, slpI: row.SLPF / 1e3, slpJ: row.SLPT / 1e3,
      sifI: row.SIFINF, sifJ: row.SIFINT,
    }]));
  const bm4l = compare('BM4_L', runtimeFor(preFlight), caesar);
  // Measured 2026-11-26. Straight pipe: 96 ends, 88 within 1%, all within 5%,
  // worst 3.4%. Reducers and tees: 32 ends, 18 within 1%, all within 5%, worst
  // 4.7% (a weldolet run end, CAESAR SIF 1.527, unity here). Pressure term
  // equals CAESAR SLP at every end, the reducer small ends included.
  assert.equal(bm4l.checks, 128);
  assert.equal(bm4l.unmapped.length, 4, 'BM4_L: only the two split bend-lead tee elements lack a CAESAR row');
  assert.equal(bm4l.slpWithin0p1Pct, 128, 'BM4_L pressure term equals CAESAR SLP everywhere');
  assert.ok(bm4l.within1Pct >= 106 && bm4l.within5Pct === 128 && bm4l.maxPct <= 4.7, 'BM4_L sustained stress tolerance');
  assert.equal(bm4l.fittings.checks, 32);
  assert.equal(bm4l.fittings.within5Pct, 32, 'BM4_L: every reducer and tee end within 5% of CAESAR');

  // Factors against CAESAR's own SIFs. Welding-tee run ends reproduce CAESAR's
  // sustained indices; reducers use CAESAR's ALPHA where given and the
  // labelled LFEA defaults for r2 and L2 (CAESAR left them 0): -10%..+12%.
  const found = lfeaB31EndFittings(preFlight);
  const structural = preFlight.preparation.structuralPreparation;
  const sifAt = (elementId, end) => {
    const binding = structural.segmentBindings.find((row) => row.elementId === elementId);
    return caesar.get(`${binding.startNodeId}-${binding.endNodeId}`)[`sif${end}`];
  };
  let teeRunEnds = 0;
  let reducerEnds = 0;
  for (const [key, fitting] of found.fittings) {
    const [elementId, end] = key.split(':');
    const binding = structural.segmentBindings.find((row) => row.elementId === elementId);
    if (!caesar.has(`${binding.startNodeId}-${binding.endNodeId}`)) continue;
    const sustained = fitting.stressFactorSet.sustainedIndices;
    const larger = Math.max(sustained.inPlaneBending.value, sustained.outOfPlaneBending.value);
    const ratio = larger / sifAt(elementId, end);
    if (fitting.kind === 'WELDING_TEE') {
      teeRunEnds += 1;
      assert.ok(Math.abs(ratio - 1) < 0.005, `${key} tee index ${larger} vs CAESAR ${sifAt(elementId, end)}`);
    } else {
      reducerEnds += 1;
      assert.ok(ratio > 0.88 && ratio < 1.13, `${key} reducer SIF ${larger} vs CAESAR ${sifAt(elementId, end)}`);
    }
  }
  assert.equal(teeRunEnds, 4, 'BM4_L welding-tee run ends compared with CAESAR (the two branch ends have no CAESAR row)');
  assert.equal(reducerEnds, 8, 'BM4_L reducer ends compared with CAESAR');
  assert.equal(found.unsupported.size, 9, 'BM4_L: 8 weldolet ends and the two-leg tee at 20700 stay at unity');
} else {
  console.log(JSON.stringify({ name: 'BM4_L', status: 'SKIPPED_MODEL_NOT_PRESENT', requiredModel: BM4L_ACCDB }));
}
console.log('LFEA B31 sustained vs CAESAR comparison PASS');
