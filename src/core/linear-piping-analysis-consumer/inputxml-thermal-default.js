import { semanticHash } from '../shared-piping-model/canonical-json.js';
import { deepFreeze, isPlainRecord } from '../shared-piping-model/immutable.js';
import { InputXmlLinearSolvePreparationError } from './inputxml-linear-preparation-profile.js';
import {
  INPUTXML_THERMAL_EXPANSION_AUTHORITY_SCHEMA,
  resolveInputXmlThermalExpansionAuthority,
} from './inputxml-thermal-authority.js';

export const INPUTXML_THERMAL_DEFAULT_BASIS = 'DECLARED_DEFAULT_MATERIAL';

/**
 * A caller's declared default thermal basis: one installation temperature
 * and one mean coefficient per material number, used where no model-interval
 * authority is given. A material the basis does not name keeps the generic
 * project authority (returns null). `defaultBasis` null means no default.
 */
export function resolveInputXmlDefaultThermalInput(defaultBasis, materialNumber) {
  if (defaultBasis === null) return null;
  const basis = requireBasis(defaultBasis);
  const generic = resolveInputXmlThermalExpansionAuthority(materialNumber);
  const coefficientPerKelvin = generic.materialNumber === null
    ? undefined
    : basis.coefficientsByMaterial[generic.materialNumber];
  if (coefficientPerKelvin === undefined) return null;
  const evidence = {
    sourceId: basis.sourceId,
    sourceRevision: basis.sourceRevision,
    sourceSemanticHash: semanticHash({
      materialNumber: generic.materialNumber,
      coefficientPerKelvin,
      installationTemperature: basis.installationTemperature,
      sourceId: basis.sourceId,
      sourceRevision: basis.sourceRevision,
    }),
  };
  const payload = {
    schema: INPUTXML_THERMAL_EXPANSION_AUTHORITY_SCHEMA,
    materialNumber: generic.materialNumber,
    materialLabel: generic.materialLabel,
    status: 'RESOLVED',
    coefficientPerKelvin,
    sourceEvidence: evidence,
  };
  return Object.freeze({
    basis: INPUTXML_THERMAL_DEFAULT_BASIS,
    installationTemperature: basis.installationTemperature,
    thermalAuthority: deepFreeze({ ...payload, semanticHash: semanticHash(payload) }),
  });
}

function requireBasis(value) {
  if (!isPlainRecord(value) || !isPlainRecord(value.coefficientsByMaterial)
    || typeof value.sourceId !== 'string' || value.sourceId.trim() === ''
    || typeof value.sourceRevision !== 'string' || value.sourceRevision.trim() === ''
    || !(Number.isFinite(value.installationTemperature) && value.installationTemperature > 0)
    || !Object.values(value.coefficientsByMaterial).every((entry) => Number.isFinite(entry) && entry > 0)) {
    throw new InputXmlLinearSolvePreparationError(
      'Declared default thermal basis is invalid.',
      'INPUTXML_THERMAL_DEFAULT_BASIS_INVALID',
      { sourceId: value?.sourceId ?? null },
    );
  }
  return value;
}
