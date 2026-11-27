import { InputXmlLinearStructuralPreparationError } from './inputxml-linear-structural-profile.js';
import {
  requireStructuralConstraintNode,
  resolveStructuralConstraintNode,
} from './inputxml-structural-constraint-target.js';

const ALLOWED_DISPOSITIONS = new Set(['IMPLEMENTED_EXACTLY', 'IMPLEMENTED_WITH_DECLARED_APPROXIMATION']);

/**
 * Specified displacements (inputxml-specified-displacement.js) as prescribed
 * slots: each held DOF is a NODAL_RESTRAINT the load cases give a value --
 * zero, or D1 in the temperature cases (inputxml-linear-displacement-loads.js).
 * `occupied` is the restraint compiler's node:DOF map: a DOF a restraint
 * already holds cannot also be moved, so that combination is refused.
 */
export function compileInputXmlDisplacementConstraints({
  inventory, modelId, analysisProfileId, nodeRetargeting, available, occupied,
}) {
  const declarations = [];
  const bindings = [];
  const rows = inventory
    // A record on a node the model does not have is listed, never compiled.
    .filter((row) => row.active && row.sourceKind === 'DISPLACEMENTS' && !row.classification.nodeAbsent)
    .sort((left, right) => compareAscii(left.inventoryId, right.inventoryId));
  for (const item of rows) {
    const disposition = item.dispositionByProfile[analysisProfileId] ?? null;
    if (!ALLOWED_DISPOSITIONS.has(disposition?.disposition)) {
      fail('INPUTXML_STRUCTURAL_DISPLACEMENT_NOT_REPRESENTABLE',
        `Specified displacement ${item.inventoryId} is not representable under ${analysisProfileId}.`,
        { inventoryId: item.inventoryId, disposition });
    }
    const sourceNodeId = String(item.classification.nodeId);
    const targetNodeId = resolveStructuralConstraintNode(sourceNodeId, nodeRetargeting, item.inventoryId);
    requireStructuralConstraintNode(available, targetNodeId, item.inventoryId, sourceNodeId);
    const declarationIds = [];
    const slots = [];
    for (const dof of item.classification.heldDofs) {
      const key = `${targetNodeId}:${dof}`;
      if (occupied.has(key)) {
        fail('INPUTXML_STRUCTURAL_DISPLACEMENT_DOF_COLLISION',
          `Specified displacement ${item.inventoryId} and restraint ${occupied.get(key)} both hold ${key}.`,
          { key, sourceFeatureIds: [occupied.get(key), item.sourceFeatureId] });
      }
      occupied.set(key, item.sourceFeatureId);
      const declarationId = `${modelId}-C-${safe(item.sourceFeatureId)}-DISP-${dof}`;
      declarations.push(Object.freeze({
        declarationId,
        kind: 'NODAL_RESTRAINT',
        nodeId: `${modelId}.N${safe(targetNodeId)}`,
        dof,
        behavior: 'PRESCRIBED_SLOT',
      }));
      declarationIds.push(declarationId);
      slots.push(Object.freeze({ slotId: declarationId, dof, d1Value: item.classification.d1Values[dof] }));
    }
    bindings.push(Object.freeze({
      sourceKind: 'DISPLACEMENTS',
      sourceFeatureId: item.sourceFeatureId,
      inventoryId: item.inventoryId,
      sourceRecordSemanticHash: item.sourceRecordSemanticHash,
      sourceNodeId,
      targetNodeId,
      retargetedByBendRetopology: targetNodeId !== sourceNodeId,
      targetDofs: Object.freeze([...item.classification.heldDofs]),
      implementation: disposition.disposition,
      limitationCode: disposition.limitationCode,
      limitationCodes: Object.freeze([disposition.limitationCode].filter(Boolean)),
      declarationIds: Object.freeze(declarationIds),
      prescribedSlots: Object.freeze(slots),
      otherVectorsWithValues: item.classification.otherVectorsWithValues,
    }));
  }
  return Object.freeze({ declarations: Object.freeze(declarations), bindings: Object.freeze(bindings) });
}

function fail(code, message, data) {
  throw new InputXmlLinearStructuralPreparationError(message, code, data);
}

function safe(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/gu, '-');
}

function compareAscii(left, right) {
  const a = String(left); const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
