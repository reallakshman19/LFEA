/**
 * Practical-analysis thermal default for carbon steel, taken from CAESAR II's
 * own BM4_L run: the T1 strain CAESAR applied, reconstructed from 54 straight
 * spans (benchmarks/LFEA/CAESAR_ACCDB/m047-bm4l-t1-interval-authority.json),
 * is 0.00121097 for 21 -> 120 C, a mean 1.2232e-5 /K from 21 C. It replaces
 * the generic 1.17e-5 /K from 20 C for A106 Grade B (106) and A334 Grade 6
 * (360). It is exact for that interval; at other temperatures it is the same
 * mean, so hotter lines run low (CAESAR's mean rises with temperature) until
 * the CAESAR material database gives the curve. NOT ENGINEER-REVIEWED.
 */
export const LFEA_THERMAL_DEFAULT_SOURCE = 'LFEA_DEFAULT_THERMAL_CAESAR_BM4L_21_120C';

const BM4L_MEAN_ALPHA_PER_K = 0.00121096700947 / 99;

export const LFEA_THERMAL_DEFAULT_BASIS = Object.freeze({
  sourceId: LFEA_THERMAL_DEFAULT_SOURCE,
  sourceRevision: '1',
  installationTemperature: 294.15,
  coefficientsByMaterial: Object.freeze({ 106: BM4L_MEAN_ALPHA_PER_K, 360: BM4L_MEAN_ALPHA_PER_K }),
});

/** One line for the Source tab: which thermal basis the pre-flight used. */
export function lfeaThermalBasisLabel(preFlight) {
  const bindings = preFlight?.preparation?.sourcePreparation?.loadBindings ?? [];
  const thermal = bindings.map((row) => row.thermal).filter((row) => row?.active);
  if (thermal.length === 0) return null;
  const defaulted = thermal.filter((row) => row.coefficientPerKelvin === BM4L_MEAN_ALPHA_PER_K
    && row.installationTemperature === LFEA_THERMAL_DEFAULT_BASIS.installationTemperature).length;
  const unresolved = thermal.filter((row) => row.status !== 'RESOLVED').length;
  const rest = thermal.length - defaulted - unresolved;
  const parts = [];
  if (defaulted > 0) {
    parts.push(`${defaulted} heated element(s) on the LFEA default (${LFEA_THERMAL_DEFAULT_SOURCE}): alpha 1.2232e-5 /K `
      + 'from 21 C, CAESAR\'s carbon-steel strain on BM4_L for 21 -> 120 C, low above 120 C; NOT ENGINEER-REVIEWED');
  }
  if (rest > 0) parts.push(`${rest} on a model or material authority`);
  if (unresolved > 0) parts.push(`${unresolved} with no thermal coefficient for their material (no thermal load)`);
  return parts.join('; ');
}
