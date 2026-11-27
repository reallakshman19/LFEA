#!/usr/bin/env node
/**
 * The app's own path against CAESAR II: BM4 InputXML (the file a user loads),
 * app defaults, the default case set, the practical B31 check. Compared with
 * Output_BM4.xml's friction-free pair: CASE 19 (SUS) W+P1 and CASE 21 (EXP)
 * L21 = L20 - L19 (FRICTION_MULTIPLIER 0, see
 * benchmarks/LFEA/CAESAR_ACCDB/bm4nl-l19-l20-linear-solve.profile.json).
 *
 * BM4 runs at T1 = 325 C. The app's default thermal strain (1.17e-5 /K from
 * 20 C) is about 12% below CAESAR's carbon-steel value there, so expansion
 * stress is pinned LOW by that much until the default comes from the CAESAR
 * material database. Because the expansion range is linear in the thermal
 * strain, the check also scales it by a CAESAR-like strain (1.3289e-5 /K from
 * 21 C) to show the rest of the chain agrees.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import { lfeaDefaultRequestedCaseIds } from '../src/workspace/lfea-default-case-selection.js';

const SOURCE = 'benchmarks/LFEA/BM4/InputXML_BM4.repaired.xml';
const OUTPUT = 'benchmarks/LFEA/BM4/Output_BM4.xml';
const content = readFileSync(SOURCE, 'utf8');
const intake = (requestedCaseIds) => createLinearPipingInputXmlIntake({ fileName: 'InputXML_BM4.repaired.xml', content }, { requestedCaseIds });

// The app's first pass is weight-only; the default case set replaces it.
const cases = lfeaDefaultRequestedCaseIds(prepareLinearPipingInputXmlPreFlight(intake(['IXP-W'])));
assert.deepEqual(cases, ['IXP-W', 'IXP-WP', 'IXP-WPT'], 'default cases: weight, sustained, operating');

let preFlight = prepareLinearPipingInputXmlPreFlight(intake(cases));
assert.notEqual(preFlight.status, 'BLOCK');
if (!preFlight.solveAuthorized) {
  preFlight = authorizeLinearPipingInputXmlPreFlight(preFlight, {
    approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'B31 InputXML comparison.',
  });
}
const structural = preFlight.preparation.structuralPreparation;
assert.equal(preFlight.preparation.stiffnessPreflight.bendExactMechanicsApplied, true, 'BM4 bends are real arcs');
assert.equal(structural.segmentBindings.filter((row) => row.limitationCode === 'GENERIC_APPROX_BEND_STRAIGHT_CHORD').length, 1,
  'one bend-arc element stays a chord (the tee-classified one); the 11 BEND elements are arcs');

const executionAuthority = createLfeaNativeExecutionAuthority();
const executionState = executionAuthority.run(preFlight);
const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
const b31 = createLfeaNativeB31PublicationAuthority();
const status = runLfeaPracticalB31Check({
  sourceController: { getPreFlight: () => preFlight },
  executionAuthority,
  stageNativeB31Authority: (input) => b31.stage(preFlight, input),
  authorizeNativeB31Authority: (approval) => b31.authorize(preFlight, approval),
  publishNativeB31Application: () => b31.publish(preFlight, executionState, resultsState),
}, { scMpa: 137.9, shMpa: 137.9 });
assert.match(status, /B31\.3 expansion check: 128 check\(s\), IXP-WPT minus IXP-WP/u);

const xml = readFileSync(OUTPUT, 'utf8');
const blocks = xml.split(/(?=<[^<>]*LOADCASE=")/u);
function caesarCodeStress(label) {
  const map = new Map();
  for (const block of blocks.filter((part) => part.includes(`LOADCASE="${label}`))) {
    for (const m of block.matchAll(/FROM_NODE="(\d+)" TO_NODE="(\d+)"[^>]*>\s*<AXIAL_STRESS[^>]*>\s*<BENDING_STRESS[^>]*>\s*<TORSION_STRESS[^>]*>\s*<HOOP_STRESS[^>]*>\s*<MAX_STRESS_INTENSITY[^>]*>\s*<CODE_STRESS FROM="([-\d.]+)" TO="([-\d.]+)"/gu)) {
      map.set(`${m[1]}-${m[2]}`, { I: Number(m[3]) / 1e3, J: Number(m[4]) / 1e3 });
    }
  }
  assert.ok(map.size > 100, `${label} has code stresses`);
  return map;
}
const kinds = new Map([...lfeaB31EndFittings(preFlight).fittings].map(([key, row]) => [key, row.kind]));
function rows(category, pattern, reference) {
  const out = [];
  for (const row of b31.getState().application.results.filter((entry) => entry.codeResult.category === category)) {
    const m = row.checkId.match(pattern);
    if (!m) continue;
    const binding = structural.segmentBindings.find((entry) => entry.elementId === m[1]);
    const cii = reference.get(`${binding.startNodeId}-${binding.endNodeId}`)?.[m[2]];
    if (cii === undefined || cii < 1) continue; // under 1 MPa a % says little
    out.push({ kind: kinds.get(`${m[1]}:${m[2]}`) ?? binding.componentKind, lfea: row.codeResult.calculatedStress / 1e6, cii });
  }
  return out;
}
function measure(list, scale = 1) {
  const errors = list.map((row) => Math.abs((row.lfea * scale) / row.cii - 1)).sort((a, b) => a - b);
  const ratios = list.map((row) => row.cii / row.lfea).sort((a, b) => a - b);
  return {
    ends: list.length,
    within1Pct: errors.filter((e) => e <= 0.01).length,
    within5Pct: errors.filter((e) => e <= 0.05).length,
    medianPct: +(100 * errors[errors.length >> 1]).toFixed(2),
    medianCaesarOverLfea: +ratios[ratios.length >> 1].toFixed(4),
  };
}
const straight = (list) => list.filter((row) => row.kind === 'STRAIGHT_PIPE');
const sus = rows('SUSTAINED', /^B31-SUS-(.+)-([IJ])-IXP-WP$/u, caesarCodeStress('CASE 19 (SUS)'));
const exp = rows('DISPLACEMENT_STRESS_RANGE', /^B31-EXP-(.+)-([IJ])-IXP-WPT-IXP-WP$/u, caesarCodeStress('CASE 21 (EXP)'));
const thermalScale = (1.3289e-5 * 304) / (1.17e-5 * 305);
const summary = {
  name: 'BM4 InputXML, app defaults',
  sustainedStraightPipe: measure(straight(sus)),
  sustainedAll: measure(sus),
  expansionStraightPipe: measure(straight(exp)),
  expansionStraightPipeAtCaesarLikeStrain: { scale: +thermalScale.toFixed(4), ...measure(straight(exp), thermalScale) },
};
console.log(JSON.stringify(summary));

// Measured 2026-11-27.
assert.ok(summary.sustainedStraightPipe.within1Pct >= 100 && summary.sustainedStraightPipe.within5Pct >= 106
  && summary.sustainedStraightPipe.medianPct <= 0.1, 'sustained straight pipe vs CASE 19');
assert.ok(summary.sustainedAll.within1Pct >= 114 && summary.sustainedAll.within5Pct >= 121, 'sustained, all compared ends vs CASE 19');
// Pinned low by the default thermal strain (see header); moves when that default changes.
assert.ok(summary.expansionStraightPipe.medianCaesarOverLfea > 1.12 && summary.expansionStraightPipe.medianCaesarOverLfea < 1.17,
  `expansion straight pipe: CAESAR/LFEA median ${summary.expansionStraightPipe.medianCaesarOverLfea}`);
assert.ok(summary.expansionStraightPipeAtCaesarLikeStrain.within5Pct >= 55
  && summary.expansionStraightPipeAtCaesarLikeStrain.medianPct <= 3.6, 'expansion straight pipe at a CAESAR-like strain');
console.log('LFEA B31 InputXML vs CAESAR comparison PASS');
