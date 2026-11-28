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
 * and, per material number, a mean-coefficient curve [[temperature K, mean
 * alpha from the installation temperature], ...] in ascending temperature.
 * The coefficient at an element's operating temperature is read off the curve
 * linearly, and past either end along the end segment's slope; one point is a
 * constant. Used where no model-interval authority is given. A material the
 * basis does not name keeps the generic project authority (returns null).
 * `defaultBasis` null means no default.
 */
export function resolveInputXmlDefaultThermalInput(defaultBasis, materialNumber, operatingTemperature) {
  if (defaultBasis === null) return null;
  const basis = requireBasis(defaultBasis);
  const generic = resolveInputXmlThermalExpansionAuthority(materialNumber);
  const curve = generic.materialNumber === null
    ? undefined
    : basis.meanCoefficientCurveByMaterial[generic.materialNumber];
  if (curve === undefined) return null;
  const evaluationTemperature = Number.isFinite(operatingTemperature) ? operatingTemperature : curve[0][0];
  const coefficientPerKelvin = meanCoefficientAt(curve, evaluationTemperature);
  if (!(coefficientPerKelvin > 0)) {
    fail('Declared default thermal curve gives no positive coefficient here.', { materialNumber, evaluationTemperature });
  }
  const evidence = {
    sourceId: basis.sourceId,
    sourceRevision: basis.sourceRevision,
    sourceSemanticHash: semanticHash({
      materialNumber: generic.materialNumber,
      curve,
      evaluationTemperature,
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

/** Mean coefficient on a [[T, alpha], ...] curve, linear between and beyond its points. */
export function meanCoefficientAt(curve, temperature) {
  if (curve.length === 1) return curve[0][1];
  let index = curve.findIndex(([point]) => point >= temperature);
  if (index <= 0) index = index === 0 ? 1 : curve.length - 1;
  const [t0, a0] = curve[index - 1];
  const [t1, a1] = curve[index];
  return a0 + ((a1 - a0) * (temperature - t0)) / (t1 - t0);
}

function requireBasis(value) {
  const curves = isPlainRecord(value) ? value.meanCoefficientCurveByMaterial : null;
  if (!isPlainRecord(curves)
    || typeof value.sourceId !== 'string' || value.sourceId.trim() === ''
    || typeof value.sourceRevision !== 'string' || value.sourceRevision.trim() === ''
    || !(Number.isFinite(value.installationTemperature) && value.installationTemperature > 0)
    || !Object.values(curves).every(validCurve)) {
    fail('Declared default thermal basis is invalid.', { sourceId: value?.sourceId ?? null });
  }
  return value;
}

function validCurve(curve) {
  return Array.isArray(curve) && curve.length > 0
    && curve.every((point, index) => Array.isArray(point) && point.length === 2
      && Number.isFinite(point[0]) && point[1] > 0 && Number.isFinite(point[1])
      && (index === 0 || point[0] > curve[index - 1][0]));
}

function fail(message, data) {
  throw new InputXmlLinearSolvePreparationError(message, 'INPUTXML_THERMAL_DEFAULT_BASIS_INVALID', data);
}
