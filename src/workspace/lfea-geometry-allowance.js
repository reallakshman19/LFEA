/**
 * How much geometry discrepancy this application accepts without blocking.
 *
 * Real CAESAR models carry millimetre-scale overlaps and clearances between
 * spans where a support or SIF node was placed with a sign slip or a rounded
 * coordinate -- BM4_L overlaps itself by 1 mm in three places, on 273 mm pipe.
 * Refusing to analyze a model over that is stricter than the engineering
 * warrants, and it stops an engineer reaching results they can act on.
 *
 * 25 mm is the declared allowance, matching the length limit the InputXML
 * backtrack repair already uses to decide what counts as a modelling stub
 * rather than a real run. Anything inside it is still detected, still named,
 * still counted and still shown -- it is dispositioned as something to review
 * rather than something that stops the analysis, and it says the allowance it
 * was accepted under. Anything outside it blocks exactly as before.
 *
 * Applied in metres because canonical geometry is in metres.
 */
export const LFEA_GEOMETRY_ALLOWANCE_MM = 25;
export const LFEA_GEOMETRY_ALLOWANCE_M = LFEA_GEOMETRY_ALLOWANCE_MM / 1000;

/** Proximity options carrying the allowance, for every path that diagnoses one model. */
export function lfeaProximityOptions(overrides = {}) {
  return Object.freeze({
    smallDiscrepancyAllowance: LFEA_GEOMETRY_ALLOWANCE_M,
    ...overrides,
  });
}

const METRES_PER_UNIT = Object.freeze({ m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 });

/**
 * The same allowance for a path whose pre-FEA diagnostics see geometry in the
 * source's own length unit. InputXML is diagnosed before unit normalization,
 * in mm or in, so 25 mm has to be expressed in that unit; passing the metre
 * value there made it 0.025 mm and blocked BM4's 1 mm backtracking elements,
 * which the ACCDB path (already in metres) accepts. An unknown unit gets no
 * allowance rather than a guessed one.
 */
export function lfeaProximityOptionsForSourceUnit(sourceUnit, overrides = {}) {
  const metresPerUnit = METRES_PER_UNIT[String(sourceUnit ?? '').trim().toLowerCase()];
  if (metresPerUnit === undefined) return Object.freeze({ ...overrides });
  return lfeaProximityOptions({ smallDiscrepancyAllowance: LFEA_GEOMETRY_ALLOWANCE_M / metresPerUnit, ...overrides });
}
