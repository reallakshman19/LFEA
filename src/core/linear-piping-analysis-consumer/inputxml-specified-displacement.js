import { isCaesarUnsetSentinel } from '../geometry/adapters/caesar-unset-sentinel.js';
import { declaredLengthToSiFactor } from './restraint-spring-rate.js';
import {
  DISCLOSED_GENERIC_ANALYZER_APPROXIMATION_PROFILE as APPROXIMATE,
  STRICT_INPUTXML_LINEAR_STATIC_PROFILE as STRICT,
  approximationDisposition,
  inactiveDisposition,
  invalidDisposition,
  unsupportedDisposition,
} from './inputxml-model-health-profile.js';

/**
 * CAESAR specified displacements (InputXML DISPLACEMENTS), practical analysis
 * (docs/PRACTICAL_ANALYSIS_POLICY.md).
 *
 * In CAESAR a DOF given a value in any displacement vector is held -- that is
 * how an equipment nozzle anchors a line -- and moved by the vector the load
 * case names. CAESAR's default operating case is W+D1+T1+P1, so here every
 * specified DOF is held in every case and moved by vector 1 (D1) in the
 * temperature cases; vectors 2-9 belong to cases LFEA does not build and are
 * counted, not applied. A DOF left unset in every vector is free, as in CAESAR.
 * Values are in the model's length unit and degrees.
 */
export const LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1 = 'LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1';
/** A record naming a node the model does not have (left over from an edit): listed, not applied. */
export const LFEA_DISPLACEMENT_NODE_ABSENT_IGNORED = 'LFEA_DISPLACEMENT_NODE_ABSENT_IGNORED';

const AXES = Object.freeze([
  ['UX', 'DX', 'LENGTH'], ['UY', 'DY', 'LENGTH'], ['UZ', 'DZ', 'LENGTH'],
  ['RX', 'RX', 'ROTATION'], ['RY', 'RY', 'ROTATION'], ['RZ', 'RZ', 'ROTATION'],
]);

export function classifySpecifiedDisplacement(feature, lengthUnit, modelNodeIds) {
  const nodeId = nodeOf(feature.rawAttributes);
  const nodeAbsent = nodeId !== null && !modelNodeIds.has(nodeId);
  const lengthToSi = declaredLengthToSiFactor(lengthUnit);
  const vectors = (feature.vectors ?? []).map((vector) => ({ number: numberOf(vector, 'NUMBER'), vector }));
  const heldDofs = [];
  const d1 = {};
  for (const [dof, attribute, kind] of AXES) {
    const given = vectors.filter((row) => numberOf(row.vector, attribute) !== null);
    if (given.length === 0) continue;
    heldDofs.push(dof);
    const value = numberOf(vectors.find((row) => row.number === 1)?.vector, attribute);
    d1[dof] = value === null ? 0 : kind === 'LENGTH'
      ? (lengthToSi === null ? null : value * lengthToSi)
      : value * Math.PI / 180;
  }
  return Object.freeze({
    kind: 'DISPLACEMENTS',
    nodeId,
    nodeAbsent,
    heldDofs: Object.freeze(heldDofs),
    d1Values: Object.freeze(d1),
    otherVectorsWithValues: vectors.filter((row) => row.number !== 1
      && AXES.some(([, attribute]) => numberOf(row.vector, attribute) !== null)).length,
    unitsResolvable: lengthToSi !== null,
  });
}

export function specifiedDisplacementActive(classification) {
  return classification.nodeId !== null && classification.heldDofs.length > 0;
}

export function specifiedDisplacementDispositions(classification) {
  if (!specifiedDisplacementActive(classification)) return both(inactiveDisposition());
  if (classification.nodeAbsent) return both(approximationDisposition(LFEA_DISPLACEMENT_NODE_ABSENT_IGNORED));
  if (!classification.unitsResolvable) return both(invalidDisposition('MODEL_DISPLACEMENT_UNITS_UNRESOLVED'));
  return Object.freeze({
    [STRICT]: unsupportedDisposition('MODEL_DISPLACEMENT_UNSUPPORTED'),
    [APPROXIMATE]: approximationDisposition(LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1),
  });
}

function nodeOf(attributes) {
  const value = numberOf(attributes, 'NODE_NUM') ?? numberOf(attributes, 'NODE');
  return value === null ? null : String(value);
}

function numberOf(attributes, name) {
  if (!attributes) return null;
  const key = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (key === undefined) return null;
  const text = String(attributes[key] ?? '').trim();
  if (text === '') return null;
  const number = Number(text);
  if (!Number.isFinite(number) || isCaesarUnsetSentinel(number)) return null;
  return number;
}

function both(disposition) {
  return Object.freeze({ [STRICT]: disposition, [APPROXIMATE]: disposition });
}
