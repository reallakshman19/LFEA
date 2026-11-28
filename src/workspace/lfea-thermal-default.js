import { meanCoefficientAt } from '../core/linear-piping-analysis-consumer/inputxml-thermal-default.js';

/**
 * Practical-analysis thermal default for carbon steel, back-calculated from
 * CAESAR II's own output for the benchmarks that have it
 * (scripts/lfea-caesar-thermal-strain-backcalc.mjs): the strain CAESAR applied
 * from 21 C, at each operating temperature a benchmark runs at. Stored as the
 * mean coefficient from 21 C and read off linearly in temperature between
 * those points, and along the end slopes beyond them. Used for A106 Grade B
 * (106, the benchmarks' material) and A334 Grade 6 (360). NOT
 * ENGINEER-REVIEWED; the CAESAR material database will replace it.
 */
export const LFEA_THERMAL_DEFAULT_SOURCE = 'LFEA_DEFAULT_THERMAL_CAESAR_BACKCALC';

const INSTALLATION_C = 21;

/** [operating C, CAESAR strain from 21 C, benchmark]: the back-calculated points. */
export const LFEA_CAESAR_THERMAL_STRAIN_POINTS = Object.freeze([
  Object.freeze([82, 0.000729305491549891, 'BM1 (1 span)']),
  Object.freeze([120, 0.00121096700947, 'BM4_L (54-span record; 44 spans here, median 0.0012109669)']),
  Object.freeze([325, 0.00406767413087655, 'BM4 (54 spans, 34 within 1e-6)']),
]);

const CURVE = Object.freeze(LFEA_CAESAR_THERMAL_STRAIN_POINTS.map(([celsius, strain]) =>
  Object.freeze([celsius + 273.15, strain / (celsius - INSTALLATION_C)])));

export const LFEA_THERMAL_DEFAULT_BASIS = Object.freeze({
  sourceId: LFEA_THERMAL_DEFAULT_SOURCE,
  sourceRevision: '2',
  installationTemperature: INSTALLATION_C + 273.15,
  meanCoefficientCurveByMaterial: Object.freeze({ 106: CURVE, 360: CURVE }),
});

/** The default's mean coefficient (from 21 C) at an operating temperature in K. */
export function lfeaThermalDefaultCoefficient(temperatureK) {
  return meanCoefficientAt(CURVE, temperatureK);
}

/** One line for the Source tab: which thermal basis the pre-flight used. */
export function lfeaThermalBasisLabel(preFlight) {
  const bindings = preFlight?.preparation?.sourcePreparation?.loadBindings ?? [];
  const thermal = bindings.map((row) => row.thermal).filter((row) => row?.active);
  if (thermal.length === 0) return null;
  const defaulted = thermal.filter((row) => row.installationTemperature === LFEA_THERMAL_DEFAULT_BASIS.installationTemperature
    && row.coefficientPerKelvin === lfeaThermalDefaultCoefficient(row.operatingTemperature));
  const unresolved = thermal.filter((row) => row.status !== 'RESOLVED').length;
  const rest = thermal.length - defaulted.length - unresolved;
  const parts = [];
  if (defaulted.length > 0) {
    const temperatures = [...new Set(defaulted.map((row) => +(row.operatingTemperature - 273.15).toFixed(1)))].sort((a, b) => a - b);
    const outside = temperatures.filter((t) => t < LFEA_CAESAR_THERMAL_STRAIN_POINTS[0][0] || t > LFEA_CAESAR_THERMAL_STRAIN_POINTS.at(-1)[0]);
    parts.push(`${defaulted.length} heated element(s) on the LFEA default (${LFEA_THERMAL_DEFAULT_SOURCE}): carbon-steel strain `
      + `back-calculated from CAESAR output at ${LFEA_CAESAR_THERMAL_STRAIN_POINTS.map(([t]) => t).join(', ')} C, from 21 C, `
      + `at T1 ${temperatures.join(', ')} C${outside.length ? ` (${outside.join(', ')} C extrapolated)` : ''}; NOT ENGINEER-REVIEWED`);
  }
  if (rest > 0) parts.push(`${rest} on a model or material authority`);
  if (unresolved > 0) parts.push(`${unresolved} with no thermal coefficient for their material (no thermal load)`);
  return parts.join('; ');
}
