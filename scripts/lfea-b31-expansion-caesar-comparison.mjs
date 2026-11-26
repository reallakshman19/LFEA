#!/usr/bin/env node
/**
 * B31.3 expansion (displacement stress range) check vs CAESAR II, BM4_L
 * CASE 14 (EXP) L14 = L5 - L6, friction-free.
 *
 * LFEA's practical check takes IXP-WPT minus IXP-WP at every straight-pipe,
 * reducer and tee end and evaluates B31.3 (2016+) Eq. (17),
 * SE = sqrt((|Sa| + Sb)^2 + (2 St)^2), on the nominal section against the
 * Eq. (1a) allowable f (1.25 Sc + 0.25 Sh). This script prepares BM4_L the
 * way scripts/lfea-production-caesar-parity-check.mjs does (CAESAR's
 * reconstructed 21 -> 120 C thermal strain, B31J 2017 bends with the
 * smooth-90 correction), so the comparison measures the code check, not the
 * app's thermal and bend defaults (see docs/PRACTICAL_ANALYSIS_POLICY.md).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createLfeaNativeB31PublicationAuthority } from '../src/lfea/native-b31-publication-authority.js';
import { createLfeaNativeExecutionAuthority } from '../src/lfea/native-execution-authority.js';
import { createLfeaNativeResultsAuthority } from '../src/lfea/native-results-authority.js';
import { runLfeaPracticalB31Check } from '../src/lfea/practical-b31-check.js';
import { lfeaB31EndFittings } from '../src/lfea/practical-b31-fittings.js';
import { authorizeLinearPipingInputXmlPreFlight } from '../src/workspace/linear-piping-inputxml-prefea.js';
import { createLinearPipingAccdbSession, prepareLinearPipingAccdbPreFlight } from '../src/workspace/linear-piping-accdb-intake.js';
import { sealInputXmlProductionBendFactorAuthority } from '../src/core/linear-piping-analysis-consumer/inputxml-production-bend-factor-authority.js';
import { sealInputXmlProductionBranchFactorAuthority } from '../src/core/linear-piping-analysis-consumer/inputxml-production-branch-factor-authority.js';
import {
  INPUTXML_THERMAL_INTERVAL_AUTHORITY_SCHEMA,
  sealInputXmlThermalIntervalAuthority,
} from '../src/core/linear-piping-analysis-consumer/inputxml-thermal-authority.js';
import { computeInputXmlModelHealthSourceSemanticHash } from '../src/core/geometry/model-health/index.js';
import { semanticHash } from '../src/core/shared-piping-model/canonical-json.js';

const ACCDB = 'benchmarks/LFEA/BM4/BM4_L/BM4_L.ACCDB';
const THERMAL = 'benchmarks/LFEA/CAESAR_ACCDB/m047-bm4l-t1-interval-authority.json';
const TABLES = ['INPUT_BASIC_ELEMENT_DATA', 'INPUT_BENDS', 'INPUT_CONTROL', 'INPUT_FORCMNT', 'INPUT_NODAL_COORDINATES',
  'INPUT_OFFSETS', 'INPUT_REDUCERS', 'INPUT_RESTRAINTS', 'INPUT_RIGIDS', 'INPUT_SIFTEES', 'INPUT_UNITS'];
const CASES = ['IXP-W', 'IXP-WP', 'IXP-WPT'];
const EDITION = 'B31_3_2022_B31J_2017';

if (!existsSync(ACCDB)) {
  console.log(JSON.stringify({ check: 'lfea-b31-expansion-caesar-comparison', status: 'SKIPPED_MODEL_NOT_PRESENT', requiredModel: ACCDB }));
  process.exit(0);
}
const MDBReaderModule = await import('mdb-reader');
const MDBReader = MDBReaderModule.default ?? MDBReaderModule;
const reader = new MDBReader(readFileSync(ACCDB));
const tables = Object.fromEntries(TABLES.map((name) => [name, { rows: reader.getTable(name).getData() }]));
const session = createLinearPipingAccdbSession(tables, { fileName: 'BM4_L.ACCDB', requestedCaseIds: CASES });
const record = JSON.parse(readFileSync(THERMAL, 'utf8'));
const prepared = prepareLinearPipingAccdbPreFlight(session.intake, session.sourceBundle, {
  bendFactorAuthority: sealInputXmlProductionBendFactorAuthority({
    authorityId: 'LFEA-EXP-COMPARISON-BEND', editionProfileId: EDITION, smooth90FlexibilityCorrection: true,
    sourceId: 'LFEA_EXPANSION_COMPARISON', sourceRevision: '1',
  }),
  branchFactorAuthority: sealInputXmlProductionBranchFactorAuthority({
    authorityId: 'LFEA-EXP-COMPARISON-BRANCH', editionProfileId: EDITION, sourceId: 'LFEA_EXPANSION_COMPARISON', sourceRevision: '1',
  }),
  preparationOptions: { authorityOptions: { thermalIntervalAuthority: sealInputXmlThermalIntervalAuthority({
    schema: INPUTXML_THERMAL_INTERVAL_AUTHORITY_SCHEMA,
    authorityId: `${record.schema}:${record.benchmarkId}`,
    modelId: 'IXP',
    sourceBundleSemanticHash: computeInputXmlModelHealthSourceSemanticHash(session.sourceBundle),
    materialNumber: session.sourceBundle.geometry.segments.find((row) => row.meta?.materialNumber != null).meta.materialNumber,
    installationTemperature: record.interval.installationTemperatureC + 273.15,
    operatingTemperature: record.interval.operatingTemperatureC + 273.15,
    coefficientPerKelvin: record.interval.meanAlphaPerK,
    sourceEvidence: { sourceId: THERMAL, sourceRevision: record.reconstruction.evidenceSourceCommit, sourceSemanticHash: semanticHash(record) },
    semanticHash: '',
  }) } },
});
const preFlight = authorizeLinearPipingInputXmlPreFlight(prepared, {
  approverIdentity: 'NOT ENGINEER-REVIEWED (LFEA auto-accept)', reason: 'B31 expansion comparison.',
});
const executionAuthority = createLfeaNativeExecutionAuthority();
const executionState = executionAuthority.run(preFlight, { requestedCaseIds: CASES });
const resultsState = createLfeaNativeResultsAuthority().recover(preFlight, executionState);
const b31 = createLfeaNativeB31PublicationAuthority();
const status = runLfeaPracticalB31Check({
  sourceController: { getPreFlight: () => preFlight },
  executionAuthority,
  stageNativeB31Authority: (input) => b31.stage(preFlight, input),
  authorizeNativeB31Authority: (approval) => b31.authorize(preFlight, approval),
  publishNativeB31Application: () => b31.publish(preFlight, executionState, resultsState),
}, { scMpa: 137.9, shMpa: 137.9 });
assert.match(status, /B31\.3 expansion check: 132 check\(s\), IXP-WPT minus IXP-WP, allowable f \(1\.25 Sc \+ 0\.25 Sh\)/u);

const caesar = new Map(reader.getTable('OUTPUT_COMPONENT_STRESSES').getData()
  .filter((row) => Number(row.LCASE_NUM) === 14) // CASE 14 (EXP) L14 = L5 - L6
  .map((row) => [`${Math.round(row.FROM_NODE)}-${Math.round(row.TO_NODE)}`, row]));
const structural = preFlight.preparation.structuralPreparation;
const kinds = new Map([...lfeaB31EndFittings(preFlight).fittings].map(([key, row]) => [key, row.kind]));
const rows = [];
for (const row of b31.getState().application.results.filter((entry) => entry.codeResult.category === 'DISPLACEMENT_STRESS_RANGE')) {
  const [, elementId, end] = row.checkId.match(/^B31-EXP-(.+)-([IJ])-IXP-WPT-IXP-WP$/u);
  const binding = structural.segmentBindings.find((entry) => entry.elementId === elementId);
  const reference = caesar.get(`${binding.startNodeId}-${binding.endNodeId}`);
  if (!reference) continue;
  const side = end === 'I' ? 'F' : 'T';
  rows.push({
    key: `${binding.startNodeId}-${binding.endNodeId} ${end}`,
    kind: kinds.get(`${elementId}:${end}`) ?? binding.componentKind,
    lfea: row.codeResult.calculatedStress / 1e6,
    caesar: reference[`CODE_STRESS${side}`] / 1e3,
    allowable: row.codeResult.allowableStress / 1e6,
    caesarAllowable: reference[`ALLOW_STRESS${side}`] / 1e3,
  });
}
const rel = (a, b) => Math.abs(a - b) / b;
function measure(list) {
  const errors = list.map((row) => rel(row.lfea, row.caesar)).sort((a, b) => a - b);
  return {
    ends: list.length,
    within1Pct: errors.filter((e) => e <= 0.01).length,
    within5Pct: errors.filter((e) => e <= 0.05).length,
    medianPct: +(errors[errors.length >> 1] * 100).toFixed(2),
    maxPct: +(errors.at(-1) * 100).toFixed(1),
  };
}
// CAESAR values under 1 MPa are compared loosely: a literal % of almost nothing says little.
const compared = rows.filter((row) => row.caesar >= 1);
const byKind = Object.fromEntries([...new Set(compared.map((row) => row.kind))].sort()
  .map((kind) => [kind, measure(compared.filter((row) => row.kind === kind))]));
const summary = { name: 'BM4_L EXP (L14)', rows: rows.length, ...measure(compared), byKind };
console.log(JSON.stringify(summary));

// Measured 2026-11-26.
assert.equal(rows.length, 128, 'every W+P end CAESAR reports has an expansion row');
assert.ok(rows.every((row) => Math.abs(row.allowable - row.caesarAllowable) < 0.05),
  'the allowable equals CAESAR\'s f (1.25 Sc + 0.25 Sh) = 206.8 MPa at every end');
assert.ok(rows.filter((row) => row.caesar < 1).every((row) => Math.abs(row.lfea - row.caesar) < 0.1),
  'ends CAESAR puts under 1 MPa are within 0.1 MPa');
assert.equal(compared.length, 109);
assert.ok(summary.within1Pct >= 53 && summary.within5Pct >= 86 && summary.medianPct <= 1.1, 'BM4_L expansion stress tolerance');
assert.ok(byKind.STRAIGHT_PIPE.within5Pct >= 67 && byKind.STRAIGHT_PIPE.medianPct <= 0.34, 'straight pipe');
assert.equal(byKind.WELDING_TEE.within5Pct, byKind.WELDING_TEE.ends, 'welding-tee ends within 5%');
assert.ok(byKind.TEE.within5Pct >= 11, 'tee-element ends (the two-leg tee at 20700 stays at unity)');
assert.ok(byKind.REDUCER.within5Pct >= 4 && byKind.REDUCER.maxPct <= 7.1, 'reducers (labelled r2/L2 defaults)');
// Known and stated: weldolet run ends use the Table D300 SIF (about 1.5), and
// CAESAR's B31J value is about 2.3 (torsion 2.9), so LFEA's expansion stress
// there is 35-40% LOW. This pins the gap so a change to it is deliberate.
for (const row of compared.filter((entry) => entry.kind === 'WELDOLET')) {
  const ratio = row.lfea / row.caesar;
  assert.ok(ratio > 0.6 && ratio < 0.66, `${row.key} weldolet expansion ratio ${ratio.toFixed(3)}`);
}
assert.equal(byKind.WELDOLET.ends, 8);
console.log('LFEA B31 expansion vs CAESAR comparison PASS');
