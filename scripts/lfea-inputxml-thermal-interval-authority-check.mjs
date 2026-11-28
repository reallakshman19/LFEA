import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INPUTXML_THERMAL_DEFAULT_BASIS,
  meanCoefficientAt,
  resolveInputXmlDefaultThermalInput,
} from '../src/core/linear-piping-analysis-consumer/inputxml-thermal-default.js';
import { LFEA_THERMAL_DEFAULT_BASIS } from '../src/workspace/lfea-thermal-default.js';
import {
  INPUTXML_THERMAL_INTERVAL_AUTHORITY_SCHEMA,
  requireInputXmlThermalIntervalAuthority,
  resolveInputXmlThermalExpansionAuthority,
  resolveInputXmlThermalInputAuthority,
  sealInputXmlThermalIntervalAuthority,
} from '../src/core/linear-piping-analysis-consumer/inputxml-thermal-authority.js';

const MODEL_ID = 'MODEL-A';
const SOURCE_HASH = 'fnv1a64:0123456789abcdef';
const INSTALLATION_TEMPERATURE = 294.15;
const OPERATING_TEMPERATURE = 393.15;
const COEFFICIENT = 1.2231989994646464e-5;

const intervalAuthority = sealInputXmlThermalIntervalAuthority({
  schema: INPUTXML_THERMAL_INTERVAL_AUTHORITY_SCHEMA,
  authorityId: 'MODEL-A-T1',
  modelId: MODEL_ID,
  sourceBundleSemanticHash: SOURCE_HASH,
  materialNumber: 106,
  installationTemperature: INSTALLATION_TEMPERATURE,
  operatingTemperature: OPERATING_TEMPERATURE,
  coefficientPerKelvin: COEFFICIENT,
  sourceEvidence: {
    sourceId: 'QUALIFIED_MODEL_INTERVAL_RECORD',
    sourceRevision: '1',
    sourceSemanticHash: 'fnv1a64:fedcba9876543210',
  },
  semanticHash: '',
});

assert.equal(intervalAuthority.status, 'RESOLVED');
assert.equal(intervalAuthority.basis, 'MODEL_INTERVAL_MEAN');
assert.equal(intervalAuthority.materialNumber, '106');
assert.equal(intervalAuthority.deltaTemperature, 99);
assert.equal(intervalAuthority.thermalStrain, 0.00121096700947);
assert.ok(Object.isFrozen(intervalAuthority));
assert.ok(Object.isFrozen(intervalAuthority.sourceEvidence));
assert.deepEqual(requireInputXmlThermalIntervalAuthority(intervalAuthority), intervalAuthority);

const explicit = resolveInputXmlThermalInputAuthority({
  intervalAuthority,
  modelId: MODEL_ID,
  sourceBundleSemanticHash: SOURCE_HASH,
  materialNumber: 106,
  operatingTemperature: OPERATING_TEMPERATURE,
});
assert.equal(explicit.basis, 'MODEL_INTERVAL_MEAN');
assert.equal(explicit.installationTemperature, INSTALLATION_TEMPERATURE);
assert.equal(explicit.thermalAuthority.semanticHash, intervalAuthority.semanticHash);

const genericAuthority = resolveInputXmlThermalExpansionAuthority(106);
const generic = resolveInputXmlThermalInputAuthority({
  modelId: MODEL_ID,
  sourceBundleSemanticHash: SOURCE_HASH,
  materialNumber: 106,
  operatingTemperature: OPERATING_TEMPERATURE,
});
assert.equal(generic.basis, 'GENERIC_MATERIAL');
assert.equal(generic.installationTemperature, 293.15);
assert.deepEqual(generic.thermalAuthority, genericAuthority);
assert.equal(genericAuthority.coefficientPerKelvin, 1.17e-5);
assert.equal(genericAuthority.semanticHash, 'fnv1a64:e5c67f01036ef16b');

expectCode(
  () => resolveExplicit({ modelId: 'MODEL-B' }),
  'INPUTXML_THERMAL_INTERVAL_AUTHORITY_MODEL_MISMATCH',
);
expectCode(
  () => resolveExplicit({ sourceBundleSemanticHash: 'fnv1a64:1111111111111111' }),
  'INPUTXML_THERMAL_INTERVAL_AUTHORITY_SOURCE_MISMATCH',
);
expectCode(
  () => resolveExplicit({ materialNumber: 360 }),
  'INPUTXML_THERMAL_INTERVAL_AUTHORITY_MATERIAL_MISMATCH',
);
expectCode(
  () => resolveExplicit({ operatingTemperature: 394.15 }),
  'INPUTXML_THERMAL_INTERVAL_AUTHORITY_OPERATING_TEMPERATURE_MISMATCH',
);

const tampered = {
  ...intervalAuthority,
  coefficientPerKelvin: intervalAuthority.coefficientPerKelvin * 1.01,
};
expectCode(
  () => requireInputXmlThermalIntervalAuthority(tampered),
  'INPUTXML_THERMAL_INTERVAL_AUTHORITY_HASH_INVALID',
);

// The app's declared default (CAESAR's back-calculated strain curve) stands
// where no interval authority is given; it gives exactly the BM4_L interval
// record's strain at 120 C, reads the curve linearly between and beyond its
// points, keeps unnamed materials on the generic authority, and refuses a bad basis.
const record = JSON.parse(readFileSync('benchmarks/LFEA/CAESAR_ACCDB/m047-bm4l-t1-interval-authority.json', 'utf8'));
assert.equal(LFEA_THERMAL_DEFAULT_BASIS.installationTemperature, record.interval.installationTemperatureC + 273.15);
const defaulted = resolveInputXmlDefaultThermalInput(LFEA_THERMAL_DEFAULT_BASIS, 106, OPERATING_TEMPERATURE);
assert.equal(defaulted.basis, INPUTXML_THERMAL_DEFAULT_BASIS);
assert.equal(defaulted.thermalAuthority.status, 'RESOLVED');
assert.equal(defaulted.thermalAuthority.materialLabel, 'A106 Grade B');
assert.ok(Math.abs(defaulted.thermalAuthority.coefficientPerKelvin * (OPERATING_TEMPERATURE - defaulted.installationTemperature)
  - intervalAuthority.thermalStrain) < 1e-15, 'default strain equals the CAESAR interval strain at 120 C');
const curve = [[300, 1e-5], [400, 2e-5]];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-18, `${message}: ${actual}`);
near(meanCoefficientAt(curve, 350), 1.5e-5, 'linear between points');
near(meanCoefficientAt(curve, 450), 2.5e-5, 'end slope beyond the last point');
near(meanCoefficientAt(curve, 250), 0.5e-5, 'start slope below the first point');
assert.equal(meanCoefficientAt([[300, 1e-5]], 999), 1e-5, 'one point is a constant');
assert.equal(resolveInputXmlDefaultThermalInput(LFEA_THERMAL_DEFAULT_BASIS, 360, OPERATING_TEMPERATURE).thermalAuthority.materialLabel, 'A334 Grade 6');
assert.equal(resolveInputXmlDefaultThermalInput(LFEA_THERMAL_DEFAULT_BASIS, 999, OPERATING_TEMPERATURE), null, 'unnamed material keeps the generic authority');
assert.equal(resolveInputXmlDefaultThermalInput(null, 106, OPERATING_TEMPERATURE), null, 'no basis, no default');
expectCode(
  () => resolveInputXmlDefaultThermalInput({ ...LFEA_THERMAL_DEFAULT_BASIS, installationTemperature: Number.NaN }, 106, OPERATING_TEMPERATURE),
  'INPUTXML_THERMAL_DEFAULT_BASIS_INVALID',
);
expectCode(
  () => resolveInputXmlDefaultThermalInput({ ...LFEA_THERMAL_DEFAULT_BASIS, meanCoefficientCurveByMaterial: { 106: [[400, 1e-5], [300, 1e-5]] } }, 106, OPERATING_TEMPERATURE),
  'INPUTXML_THERMAL_DEFAULT_BASIS_INVALID',
);

console.log(JSON.stringify({
  status: 'PASS',
  check: 'lfea-inputxml-thermal-interval-authority',
  defaultAuthoritySemanticHash: genericAuthority.semanticHash,
  intervalAuthoritySemanticHash: intervalAuthority.semanticHash,
  intervalThermalStrain: intervalAuthority.thermalStrain,
}));

function resolveExplicit(overrides) {
  return resolveInputXmlThermalInputAuthority({
    intervalAuthority,
    modelId: MODEL_ID,
    sourceBundleSemanticHash: SOURCE_HASH,
    materialNumber: 106,
    operatingTemperature: OPERATING_TEMPERATURE,
    ...overrides,
  });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error?.code === code, code);
}
