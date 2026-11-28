#!/usr/bin/env node
/**
 * The app's thermal default is CAESAR's own strain, back-calculated from the
 * benchmark outputs (lfea-caesar-thermal-strain-backcalc.mjs). This re-runs the
 * back-calculation and holds the default to it: each stored point must be what
 * CAESAR's output still gives, the method must reproduce the independent BM4_L
 * record, and the default must return each point exactly.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { backCalculateCaesarThermalStrain, CAESAR_THERMAL_BENCHMARKS } from './lfea-caesar-thermal-strain-backcalc.mjs';
import {
  LFEA_CAESAR_THERMAL_STRAIN_POINTS,
  LFEA_THERMAL_DEFAULT_BASIS,
  lfeaThermalDefaultCoefficient,
} from '../src/workspace/lfea-thermal-default.js';

const missing = CAESAR_THERMAL_BENCHMARKS.filter((benchmark) => !existsSync(benchmark.model));
if (missing.length > 0) {
  console.log(JSON.stringify({ check: 'lfea-caesar-thermal-strain-backcalc', status: 'SKIPPED_MODEL_NOT_PRESENT', missing: missing.map((row) => row.model) }));
  process.exit(0);
}
const groups = new Map();
for (const benchmark of CAESAR_THERMAL_BENCHMARKS) {
  const result = await backCalculateCaesarThermalStrain(benchmark);
  for (const group of result.groups) groups.set(`${benchmark.id}@${group.operatingTemperatureC}`, group);
}
const relative = (a, b) => Math.abs(a / b - 1);
const at = (key) => {
  const group = groups.get(key);
  assert.ok(group, `${key} back-calculated`);
  assert.equal(group.materialNumber, 106, `${key} material`);
  return group;
};

// The method reproduces the independent 54-span BM4_L record (to 6e-8), and
// BM1's own 120 C spans agree within 0.11% (BM1's ambient is 21.1 C, BM4_L's 21).
const record = JSON.parse(readFileSync('benchmarks/LFEA/CAESAR_ACCDB/m047-bm4l-t1-interval-authority.json', 'utf8'));
assert.ok(relative(at('BM4_L@120').medianStrain, record.interval.epsilonT1) < 1e-6, 'BM4_L 120 C reproduces the interval record');
assert.ok(relative(at('BM1@120').medianStrain, record.interval.epsilonT1) < 1.2e-3, 'BM1 120 C agrees with BM4_L');

// Every stored point is still what CAESAR's output gives.
const sources = { 82: 'BM1@82', 120: 'BM4_L@120', 325: 'BM4@325' };
for (const [celsius, strain] of LFEA_CAESAR_THERMAL_STRAIN_POINTS) {
  const group = at(sources[celsius]);
  assert.ok(relative(group.medianStrain, strain) < 1e-6, `${celsius} C point matches the back-calculation (${group.medianStrain} vs ${strain})`);
  const kelvin = celsius + 273.15;
  const applied = lfeaThermalDefaultCoefficient(kelvin) * (kelvin - LFEA_THERMAL_DEFAULT_BASIS.installationTemperature);
  assert.ok(relative(applied, strain) < 1e-12, `the default applies exactly CAESAR's strain at ${celsius} C`);
}
assert.ok(at('BM4@325').spans >= 54, 'BM4 325 C spans');

// The mean coefficient rises with temperature, as carbon steel's does.
const curve = LFEA_THERMAL_DEFAULT_BASIS.meanCoefficientCurveByMaterial[106];
for (let index = 1; index < curve.length; index += 1) assert.ok(curve[index][1] > curve[index - 1][1], 'mean coefficient rises');

console.log(JSON.stringify({
  check: 'lfea-caesar-thermal-strain-backcalc',
  status: 'PASS',
  points: Object.fromEntries([...groups].map(([key, group]) => [key, { strain: group.medianStrain, spans: group.spans }])),
}));
