import { requireStressFactorSet } from '../core/linear-fea-b31-code-engine/index.js';
import { requirePipeSectionResolution } from '../core/linear-fea-section/index.js';
import { deepFreeze } from '../core/shared-piping-model/immutable.js';
import { lfeaNativeB31Error } from './native-b31-authority-contract.js';

/**
 * Native expansion check (CAESAR's EXP = OPE - SUS): a DISPLACEMENT_STRESS_RANGE
 * check over a CASE_RANGE from a sustained case to an operating case,
 * evaluated at the operating (hot) state, against the B31.3 Eq. (1a)
 * allowable f (1.25 Sc + 0.25 Sh).
 */
export const LFEA_NATIVE_B31_EXPANSION_CATEGORY = 'DISPLACEMENT_STRESS_RANGE';
export const LFEA_NATIVE_B31_OPERATING_CASE_ROLES = Object.freeze(['WEIGHT_TEMPERATURE', 'WEIGHT_PRESSURE_TEMPERATURE']);

export function canonicalLfeaNativeB31ExpansionCheck(value, field, end) {
  keys(value.actionSource, ['kind', 'fromCaseId', 'toCaseId'], `${field}.actionSource`);
  if (value.actionSource.kind !== 'CASE_RANGE') {
    throw lfeaNativeB31Error('LFEA_NATIVE_B31_ACTION_SOURCE_INVALID', 'A native expansion check needs a CASE_RANGE action source.');
  }
  const actionSource = deepFreeze({
    kind: 'CASE_RANGE',
    fromCaseId: text(value.actionSource.fromCaseId, `${field}.actionSource.fromCaseId`),
    toCaseId: text(value.actionSource.toCaseId, `${field}.actionSource.toCaseId`),
  });
  const evaluationCaseId = text(value.evaluationCaseId, `${field}.evaluationCaseId`);
  if (evaluationCaseId !== actionSource.toCaseId) {
    throw lfeaNativeB31Error('LFEA_NATIVE_B31_EVALUATION_CASE_MISMATCH',
      'A native expansion check must evaluate section/material state from its operating case.');
  }
  if (value.pressureStressContribution !== null || value.sustainedStress !== null || value.occasionalCategoryId !== null) {
    throw lfeaNativeB31Error('LFEA_NATIVE_B31_CATEGORY_FIELDS_INVALID',
      'Native expansion checks require pressureStressContribution, sustainedStress and occasionalCategoryId to be null.');
  }
  keys(value.coldTemperature, ['value', 'source'], `${field}.coldTemperature`);
  if (!Number.isFinite(value.coldTemperature.value)) {
    throw lfeaNativeB31Error('LFEA_NATIVE_B31_INPUT_INVALID', `${field}.coldTemperature.value must be finite.`);
  }
  return deepFreeze({
    checkId: text(value.checkId, `${field}.checkId`),
    category: LFEA_NATIVE_B31_EXPANSION_CATEGORY,
    elementId: text(value.elementId, `${field}.elementId`),
    end,
    combinationId: text(value.combinationId, `${field}.combinationId`),
    actionSource,
    evaluationCaseId,
    stressFactorSet: requireStressFactorSet(value.stressFactorSet),
    sectionBasisReason: text(value.sectionBasisReason, `${field}.sectionBasisReason`),
    // Null (nominal section) except at a reducer end, which is checked with that end's size.
    sustainedSectionResolution: value.sustainedSectionResolution === null
      ? null : requirePipeSectionResolution(value.sustainedSectionResolution),
    pressureStressContribution: null,
    coldTemperature: { value: value.coldTemperature.value, source: text(value.coldTemperature.source, `${field}.coldTemperature.source`) },
    sustainedStress: null,
    occasionalCategoryId: null,
  });
}

function keys(value, expected, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw lfeaNativeB31Error('LFEA_NATIVE_B31_INPUT_INVALID', `${field} keys are invalid.`);
  }
}
function text(value, field) {
  const result = String(value ?? '').trim();
  if (!result) throw lfeaNativeB31Error('LFEA_NATIVE_B31_INPUT_INVALID', `${field} is required.`);
  return result;
}
