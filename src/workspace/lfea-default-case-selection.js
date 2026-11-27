/**
 * Practical-analysis default for the requested load cases.
 *
 * Until a person applies a case selection, LFEA requests weight, the sustained
 * case (weight + pressure) and one operating case (weight + pressure +
 * temperature, or weight + temperature when the model has no pressure), so the
 * B31 sustained and expansion checks both run. The intake still starts at
 * weight only because the available cases are not known before pre-flight.
 * Applying a selection on the Model tab replaces this default.
 */
export const LFEA_DEFAULT_CASE_SELECTION_SOURCE = 'LFEA default: weight, sustained and operating cases';

const ROLE_ORDER = Object.freeze([
  ['WEIGHT_BASE'],
  ['WEIGHT_PRESSURE'],
  ['WEIGHT_PRESSURE_TEMPERATURE', 'WEIGHT_TEMPERATURE'],
]);

/** Case ids to request by default, or [] when the source offers no weight case. */
export function lfeaDefaultRequestedCaseIds(preFlight) {
  const cases = preFlight?.preparation?.physicalPreparation?.physicalCases;
  if (!Array.isArray(cases)) return [];
  const firstOfRole = (role) => cases
    .filter((row) => row?.caseRole === role && typeof row.caseId === 'string')
    .map((row) => row.caseId)
    .sort()[0] ?? null;
  const picked = [];
  for (const roles of ROLE_ORDER) {
    const id = roles.map(firstOfRole).find((value) => value !== null) ?? null;
    if (id !== null) picked.push(id);
  }
  return firstOfRole('WEIGHT_BASE') === null ? [] : picked;
}
