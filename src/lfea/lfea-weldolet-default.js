/**
 * Weldolet run-end SIFs back-calculated from CAESAR II output
 * (docs/PRACTICAL_ANALYSIS_POLICY.md). LFEA has no B31J weldolet equations,
 * so for benchmarking the default reproduces what CAESAR printed at the
 * weldolet run ends of BM4_L (B31.3-2022, B31J; OUTPUT_COMPONENT_STRESSES):
 *
 * - expansion (CASE 14): in-plane = out-of-plane = axial SIF i, torsion i_t;
 * - sustained (CASE 6): index = max(1, min(0.75 i, sqrt(i))), axial 1, which
 *   is sqrt(i) at both sizes, to float precision.
 *
 * A power law c (R/T)^n through CAESAR's two run sizes (R the run pipe's
 * mean radius, T its nominal wall) lands on round numbers to within 4e-6:
 * i = (R/T)^0.43 and i_t = 1.2 (R/T)^0.46. Those are stored; the CAESAR
 * points are the evidence they are checked against
 * (scripts/lfea-weldolet-caesar-backcalc-check.mjs). How CAESAR's run SIF
 * varies with branch size is not known from these runs (branch not modelled).
 * Outside the measured R/T range the note says "extrapolated". Labelled,
 * never a stop.
 */
export const LFEA_WELDOLET_DEFAULT = Object.freeze({
  standard: 'LFEA_CAESAR_BACKCALC',
  ruleId: 'WELDOLET_RUN_CAESAR_B31J_BACKCALC',
  sourceId: 'LFEA_DEFAULT_WELDOLET_CAESAR_BACKCALC',
  sourceRevision: '1',
  label: 'NOT ENGINEER-REVIEWED (LFEA default: weldolet run SIFs fitted to CAESAR B31J output on BM4_L; LFEA has no B31J weldolet equations)',
});

/** CAESAR's weldolet run SIFs, BM4_L CASE 14 (EXP); millimetres as CAESAR stores them. */
export const LFEA_CAESAR_WELDOLET_RUN_POINTS = Object.freeze([
  Object.freeze({ outerDiameter: 273, wallThickness: 18.26259994506836, bending: 2.3051810264587402, torsion: 2.9321844577789307, source: 'BM4_L 20240' }),
  Object.freeze({ outerDiameter: 168.3000030517578, wallThickness: 10.972800254821777, bending: 2.332632064819336, torsion: 2.9695537090301514, source: 'BM4_L 21740, 21800, 21850' }),
]);

export const radiusToThickness = (outerDiameter, wallThickness) => (outerDiameter - wallThickness) / 2 / wallThickness;
const measured = LFEA_CAESAR_WELDOLET_RUN_POINTS.map((row) => radiusToThickness(row.outerDiameter, row.wallThickness));

/** The power law through CAESAR's points (for the check), c (R/T)^n. */
export function powerFitThroughCaesarPoints(field) {
  const [low, high] = LFEA_CAESAR_WELDOLET_RUN_POINTS.map((row, index) => ({ value: row[field], rt: measured[index] }))
    .sort((a, b) => a.rt - b.rt);
  const exponent = Math.log(high.value / low.value) / Math.log(high.rt / low.rt);
  return { coefficient: low.value / low.rt ** exponent, exponent };
}

export const LFEA_WELDOLET_RUN_FIT = Object.freeze({
  bending: Object.freeze({ coefficient: 1, exponent: 0.43 }),
  torsion: Object.freeze({ coefficient: 1.2, exponent: 0.46 }),
  radiusToThicknessRange: Object.freeze([Math.min(...measured), Math.max(...measured)]),
});

const atLeastOne = (value) => Math.max(1, value);
const sustainedIndex = (sif) => atLeastOne(Math.min(0.75 * sif, Math.sqrt(sif)));

/** Run-end factors for a weldolet on a run pipe of the given OD and wall (any one length unit). */
export function lfeaWeldoletRunFactors(outerDiameter, wallThickness) {
  const rt = radiusToThickness(outerDiameter, wallThickness);
  const fitted = ({ coefficient, exponent }) => atLeastOne(coefficient * rt ** exponent);
  const bending = fitted(LFEA_WELDOLET_RUN_FIT.bending);
  const torsion = fitted(LFEA_WELDOLET_RUN_FIT.torsion);
  const [low, high] = LFEA_WELDOLET_RUN_FIT.radiusToThicknessRange;
  // Float32 source data: the measured sizes themselves count as inside.
  const extrapolated = rt < low * (1 - 1e-9) || rt > high * (1 + 1e-9);
  return Object.freeze({
    radiusToThickness: rt,
    extrapolated,
    displacementSifs: Object.freeze({ axial: bending, torsional: torsion, inPlaneBending: bending, outOfPlaneBending: bending }),
    sustainedIndices: Object.freeze({
      axial: 1, torsional: sustainedIndex(torsion), inPlaneBending: sustainedIndex(bending), outOfPlaneBending: sustainedIndex(bending),
    }),
  });
}
