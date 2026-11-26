#!/usr/bin/env node
/**
 * B31.3 SUSTAINED (W+P) stresses vs CAESAR II output for BM1 and BM4.
 * The pressure term must match CAESAR SLP on the nominal-less-corrosion wall;
 * the total code stress is held to the tolerances measured when the
 * comparison was introduced (moment differences come from the solver, e.g.
 * BM4 gapped guides, and tee ends that are checked as plain pipe).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLfeaNativeB31PublicationAuthority } from '../src/lfea/native-b31-publication-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import {
  LFEA_B31_PRACTICAL_REVIEWER,
  LFEA_USER_ALLOWABLE_SOURCE,
  deriveLfeaB31AuthorityInput,
  runLfeaPracticalB31Check,
} from '../src/lfea/practical-b31-check.js';
import { createLinearPipingInputXmlIntake } from '../src/workspace/linear-piping-inputxml-intake.js';
import {
  authorizeLinearPipingInputXmlPreFlight,
  prepareLinearPipingInputXmlPreFlight,
} from '../src/workspace/linear-piping-inputxml-prefea.js';

function runtimeFor(path, requestedCaseIds) {
  let preFlight = prepareLinearPipingInputXmlPreFlight(createLinearPipingInputXmlIntake(
    { fileName: path, content: readFileSync(path, 'utf8') }, requestedCaseIds ? { requestedCaseIds } : {},
  ));
  if (!preFlight.solveAuthorized) {
    preFlight = authorizeLinearPipingInputXmlPreFlight(preFlight, {
      approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'Practical B31 check.',
    });
  }
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

function caesarSustained(outPath, susLabel, nextLabel) {
  const xml = readFileSync(outPath, 'utf8');
  const sus = xml.slice(xml.indexOf(`LOADCASE="${susLabel}`), xml.indexOf(`LOADCASE="${nextLabel}`));
  const code = new Map();
  for (const m of sus.matchAll(/FROM_NODE="(\d+)" TO_NODE="(\d+)"[^>]*>\s*<AXIAL_STRESS[^>]*>\s*<BENDING_STRESS[^>]*>\s*<TORSION_STRESS[^>]*>\s*<HOOP_STRESS[^>]*>\s*<MAX_STRESS_INTENSITY[^>]*>\s*<CODE_STRESS FROM="([-\d.]+)" TO="([-\d.]+)"/g)) {
    code.set(`${m[1]}-${m[2]}`, { I: +m[3] / 1e3, J: +m[4] / 1e3 });
  }
  const slp = new Map();
  for (const m of sus.matchAll(/FROM_NODE="(\d+)" TO_NODE="(\d+)"[^>]*>\s*<AXIAL_STRESS[^>]*>\s*<SLP FROM="([-\d.]+)" TO="([-\d.]+)"/g)) {
    slp.set(`${m[1]}-${m[2]}`, { I: +m[3] / 1e3, J: +m[4] / 1e3 });
  }
  return { code, slp };
}

function compare(name, inPath, outPath, susLabel, nextLabel) {
  const runtime = runtimeFor(inPath, ['IXP-W', 'IXP-WP']);
  runLfeaPracticalB31Check(runtime, { scMpa: 137.9, shMpa: 137.9 });
  const { code, slp } = caesarSustained(outPath, susLabel, nextLabel);
  const structural = runtime.preFlight.preparation.structuralPreparation;
  const rows = runtime.b31.getState().application.results
    .filter((row) => row.codeResult.stressTerms.pressure > 0)
    .map((row) => {
      const [, elementId, end] = row.checkId.match(/^B31-SUS-(.+)-([IJ])-IXP-WP$/u);
      const binding = structural.segmentBindings.find((x) => x.elementId === elementId);
      const key = `${binding.startNodeId}-${binding.endNodeId}`;
      const lfea = row.codeResult.calculatedStress / 1e6;
      const sp = row.codeResult.stressTerms.pressure / 1e6;
      return { key, end, lfea, caesar: code.get(key)?.[end], sp, slp: slp.get(key)?.[end] };
    });
  assert.ok(rows.length > 0 && rows.every((row) => row.caesar > 0 && row.slp > 0), `${name}: every W+P check maps to CAESAR`);
  const rel = (a, b) => Math.abs(a - b) / b;
  const slpOk = rows.filter((row) => rel(row.sp, row.slp) <= 1e-3).length;
  const within = (tol) => rows.filter((row) => rel(row.lfea, row.caesar) <= tol).length;
  const summary = { name, checks: rows.length, slpWithin0p1Pct: slpOk, within1Pct: within(0.01), within5Pct: within(0.05),
    maxPct: +(Math.max(...rows.map((row) => rel(row.lfea, row.caesar))) * 100).toFixed(1) };
  console.log(JSON.stringify(summary));
  return summary;
}

const bm1 = compare('BM1', 'benchmarks/LFEA/BM1/BM1_InputXML.xml', 'benchmarks/LFEA/BM1/BM1_CIIOutput.xml', 'CASE 4 (SUS)', 'CASE 5');
assert.equal(bm1.checks, 18);
assert.equal(bm1.slpWithin0p1Pct, 18, 'BM1 pressure term equals CAESAR SLP everywhere');
assert.ok(bm1.within1Pct >= 10 && bm1.within5Pct >= 16 && bm1.maxPct <= 15, 'BM1 sustained stress tolerance');

const bm4 = compare('BM4', 'benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml', 'benchmarks/LFEA/BM4/Output_BM4.xml', 'CASE 17 (SUS)', 'CASE 19');
assert.equal(bm4.checks, 116);
assert.ok(bm4.slpWithin0p1Pct >= 112, 'BM4 pressure term equals CAESAR SLP except at 4 tee ends');
// Re-measured 2026-11-26 with one-way supports solved by active-set iteration
// (SUS lifts 20090 and 21470, as CAESAR does): within 1% 55 -> 56, within 5%
// 103 -> 102, worst 29.7% unchanged (tee end 22000-22010 J). The one row that
// crossed 5% is 20030-20090 J (1.3% -> 5.5%), next to the lifted-off 20090,
// where CAESAR also holds the gapped guide at 20030 open (still closed here,
// GENERIC_APPROX_GAP_CLOSED).
assert.ok(bm4.within1Pct >= 56 && bm4.within5Pct >= 102 && bm4.maxPct <= 29.7, 'BM4 sustained stress tolerance');
console.log('LFEA B31 sustained vs CAESAR comparison PASS');
