#!/usr/bin/env node
/**
 * ACCDB import on the Source tab: BM4_L.ACCDB through the same Source workflow
 * controller the app mounts, on app defaults (assumed B31J basis with
 * smooth-90, default thermal strain, default cases), then Run and the
 * practical B31 check, compared with CAESAR's own output in the same file.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createLfeaNativeB31PublicationAuthority } from '../src/lfea/native-b31-publication-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import { runLfeaPracticalB31Check } from '../src/lfea/practical-b31-check.js';
import { lfeaB31EndFittings } from '../src/lfea/practical-b31-fittings.js';
import { isLfeaAccdbFileName } from '../src/workspace/lfea-accdb-source.js';
import { authorizeLinearPipingInputXmlPreFlight } from '../src/workspace/linear-piping-inputxml-prefea.js';
import { LinearPipingInputXmlSourceWorkflowController } from '../src/workspace/linear-piping-inputxml-source-workflow.js';

const ACCDB = 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB';
if (!existsSync(ACCDB)) {
  console.log(JSON.stringify({ check: 'lfea-accdb-source-import', status: 'SKIPPED_MODEL_NOT_PRESENT', requiredModel: ACCDB }));
  process.exit(0);
}
assert.equal(isLfeaAccdbFileName('BM4_L.ACCDB'), true);
assert.equal(isLfeaAccdbFileName('model.mdb'), true);
assert.equal(isLfeaAccdbFileName('InputXML_BM4.xml'), false);

const bytes = readFileSync(ACCDB);
const file = { name: 'BM4_L.ACCDB', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
const controller = new LinearPipingInputXmlSourceWorkflowController({ append() {} }, { createElement() {} }, {});

// A file that is not a CAESAR model is refused without disturbing anything.
await controller.loadAccdbFile({ name: 'empty.accdb', arrayBuffer: async () => new ArrayBuffer(16) });
assert.equal(controller.getPreFlight(), null);
assert.ok(controller.error, 'an unreadable ACCDB is reported');

await controller.loadAccdbFile(file);
let preFlight = controller.getPreFlight();
assert.ok(preFlight, controller.error);
assert.notEqual(preFlight.status, 'BLOCK');
assert.equal(controller.getSourceText(), null, 'an ACCDB has no source text');
assert.match(controller.inspection.contentSha256, /^[0-9a-f]{64}$/u, 'custody hash over the exact bytes');
assert.deepEqual([...preFlight.preparation.requestedCaseIds], ['IXP-W', 'IXP-WP', 'IXP-WPT'], 'default cases');
assert.equal(controller.defaultCasesApplied, true);
assert.equal(preFlight.preparation.stiffnessPreflight.bendExactMechanicsApplied, true, 'BM4_L bends are real arcs');
if (!preFlight.solveAuthorized) {
  preFlight = authorizeLinearPipingInputXmlPreFlight(preFlight, {
    approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'ACCDB import check.',
  });
}

const executionAuthority = createLfeaNativeExecutionAuthority();
const executionState = executionAuthority.run(preFlight);
assert.equal(executionState.currentness, 'CURRENT');
const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
const b31 = createLfeaNativeB31PublicationAuthority();
const status = runLfeaPracticalB31Check({
  sourceController: { getPreFlight: () => preFlight },
  executionAuthority,
  stageNativeB31Authority: (input) => b31.stage(preFlight, input),
  authorizeNativeB31Authority: (approval) => b31.authorize(preFlight, approval),
  publishNativeB31Application: () => b31.publish(preFlight, executionState, resultsState),
}, { scMpa: 137.9, shMpa: 137.9 });
assert.match(status, /B31\.3 expansion check: 132 check\(s\), IXP-WPT minus IXP-WP/u);

// CAESAR's own output in the same database: CASE 6 (SUS) L6 = W+P1 and
// CASE 14 (EXP) L14 = L5 - L6, both friction-free.
const MDBReaderModule = await import('mdb-reader');
const MDBReader = MDBReaderModule.default ?? MDBReaderModule;
const output = new MDBReader(bytes).getTable('OUTPUT_COMPONENT_STRESSES').getData();
const caesar = (lcase) => new Map(output.filter((row) => Number(row.LCASE_NUM) === lcase)
  .map((row) => [`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, row]));
const structural = preFlight.preparation.structuralPreparation;
const kinds = new Map([...lfeaB31EndFittings(preFlight).fittings].map(([key, row]) => [key, row.kind]));
function compare(category, pattern, reference) {
  const errors = [];
  const straight = [];
  for (const row of b31.getState().application.results.filter((entry) => entry.codeResult.category === category)) {
    const m = row.checkId.match(pattern);
    if (!m) continue;
    const binding = structural.segmentBindings.find((entry) => entry.elementId === m[1]);
    const cii = reference.get(`${binding.startNodeId}-${binding.endNodeId}`)?.[`CODE_STRESS${m[2] === 'I' ? 'F' : 'T'}`];
    if (cii === undefined || cii / 1e3 < 1) continue;
    const error = Math.abs(row.codeResult.calculatedStress / 1e6 / (cii / 1e3) - 1);
    errors.push(error);
    if ((kinds.get(`${m[1]}:${m[2]}`) ?? binding.componentKind) === 'STRAIGHT_PIPE') straight.push(error);
  }
  const summarize = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    return { ends: sorted.length, within1Pct: sorted.filter((e) => e <= 0.01).length, within5Pct: sorted.filter((e) => e <= 0.05).length,
      medianPct: +(100 * sorted[sorted.length >> 1]).toFixed(2) };
  };
  return { all: summarize(errors), straightPipe: summarize(straight) };
}
const summary = {
  name: 'BM4_L.ACCDB via the Source tab, app defaults',
  sustained: compare('SUSTAINED', /^B31-SUS-(.+)-([IJ])-IXP-WP$/u, caesar(6)),
  expansion: compare('DISPLACEMENT_STRESS_RANGE', /^B31-EXP-(.+)-([IJ])-IXP-WPT-IXP-WP$/u, caesar(14)),
};
console.log(JSON.stringify(summary));

// Measured 2026-11-27. Expansion is low by the default thermal strain
// (1.17e-5 /K from 20 C vs CAESAR's 21 -> 120 C value): about 3.4% on BM4_L.
assert.ok(summary.sustained.all.within1Pct >= 122 && summary.sustained.all.within5Pct === 128, 'sustained vs CAESAR CASE 6');
assert.ok(summary.expansion.straightPipe.within5Pct >= 63 && summary.expansion.straightPipe.medianPct <= 3.4, 'expansion straight pipe vs CASE 14');
console.log('LFEA ACCDB Source import PASS');
