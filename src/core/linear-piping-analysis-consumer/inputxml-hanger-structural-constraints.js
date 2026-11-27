import { InputXmlLinearStructuralPreparationError } from './inputxml-linear-structural-profile.js';
import { predefinedHangerLimitationCodes } from './inputxml-predefined-hanger.js';
import { restraintRigidTwoWayDofs } from './inputxml-feature-inventory-restraints.js';
import { isMergedDuplicateRestraint } from './inputxml-restraint-duplicate-merge.js';
import {
  requireStructuralConstraintNode,
  resolveStructuralConstraintNode,
} from './inputxml-structural-constraint-target.js';

const ALLOWED_DISPOSITIONS = new Set([
  'IMPLEMENTED_EXACTLY',
  'IMPLEMENTED_WITH_DECLARED_APPROXIMATION',
]);

export function compileInputXmlHangerConstraints({
  inventory,
  modelId,
  analysisProfileId,
  nodeRetargeting,
  conditionedNodeIds,
}) {
  const declarations = [];
  const bindings = [];
  const available = conditionedNodeIds === undefined || conditionedNodeIds === null
    ? null
    : new Set(conditionedNodeIds.map(String));
  const hangers = inventory
    .filter((row) => row.active && row.sourceKind === 'HANGER')
    .sort((left, right) => compareAscii(left.inventoryId, right.inventoryId));
  const rigidlyHeldUy = new Set(inventory
    .filter((row) => row.active && row.sourceKind === 'RESTRAINT' && !isMergedDuplicateRestraint(row)
      && restraintRigidTwoWayDofs(row.classification).includes('UY'))
    .map((row) => String(row.classification.nodeId)));

  for (const item of hangers) {
    const disposition = item.dispositionByProfile[analysisProfileId] ?? null;
    if (!ALLOWED_DISPOSITIONS.has(disposition?.disposition)) {
      fail(
        'INPUTXML_STRUCTURAL_HANGER_NOT_REPRESENTABLE',
        `Hanger ${item.inventoryId} is not representable under ${analysisProfileId}.`,
        { inventoryId: item.inventoryId, disposition },
      );
    }
    if (item.classification.designMode) {
      const designed = designedHanger(item, disposition, {
        modelId, nodeRetargeting, available, rigidlyHeldUy,
      });
      declarations.push(...designed.declarations);
      bindings.push(designed.binding);
      continue;
    }
    const sourceNodeId = item.classification.nodeId ?? null;
    const stiffness = item.classification.springRateTotal ?? null;
    const coldLoad = item.classification.coldLoadTotal ?? null;
    if (sourceNodeId === null || !(stiffness > 0) || !(coldLoad > 0)) {
      fail(
        'INPUTXML_STRUCTURAL_HANGER_DATA_INVALID',
        `Hanger ${item.inventoryId} has no qualified node, rate or cold load.`,
        { inventoryId: item.inventoryId, sourceNodeId, stiffness, coldLoad },
      );
    }
    const targetNodeId = resolveStructuralConstraintNode(
      sourceNodeId,
      nodeRetargeting,
      item.inventoryId,
    );
    requireStructuralConstraintNode(available, targetNodeId, item.inventoryId, sourceNodeId);
    const declarationId = `${modelId}-C-${safe(item.sourceFeatureId)}-HGR-UY`;
    declarations.push(Object.freeze({
      declarationId,
      kind: 'PARTIAL_RELEASE_SPRING',
      nodeId: `${modelId}.N${safe(targetNodeId)}`,
      dof: 'UY',
      stiffness,
    }));
    bindings.push(Object.freeze({
      sourceKind: 'HANGER',
      sourceFeatureId: item.sourceFeatureId,
      inventoryId: item.inventoryId,
      sourceRecordSemanticHash: item.sourceRecordSemanticHash,
      sourceNodeId: String(sourceNodeId),
      targetNodeId,
      retargetedByBendRetopology: targetNodeId !== String(sourceNodeId),
      targetDofs: Object.freeze(['UY']),
      implementation: disposition.disposition,
      limitationCode: disposition.limitationCode,
      limitationCodes: predefinedHangerLimitationCodes(item.classification),
      declarationIds: Object.freeze([declarationId]),
      numberOfHangers: item.classification.numberOfHangers,
      springRatePerHanger: item.classification.springRatePerHanger,
      springRateTotal: stiffness,
      coldLoadPerHanger: item.classification.coldLoadPerHanger,
      coldLoadTotal: coldLoad,
      verticalDirection: Object.freeze([...item.classification.verticalDirection]),
      verticalAxisAuthority: item.classification.verticalAxisAuthority,
    }));
  }
  return Object.freeze({
    declarations: Object.freeze(declarations),
    bindings: Object.freeze(bindings),
  });
}

/**
 * A hanger being designed (inputxml-predefined-hanger.js). In the restrained
 * weight pass it holds UY rigidly, unless a rigid restraint already holds that
 * node (the restraint then takes the weight and the hanger carries none). As a
 * constant-effort support it has no stiffness: only its load, applied by
 * inputxml-linear-hanger-preloads.js.
 */
function designedHanger(item, disposition, { modelId, nodeRetargeting, available, rigidlyHeldUy }) {
  const sourceNodeId = String(item.classification.nodeId);
  const targetNodeId = resolveStructuralConstraintNode(sourceNodeId, nodeRetargeting, item.inventoryId);
  requireStructuralConstraintNode(available, targetNodeId, item.inventoryId, sourceNodeId);
  const mode = item.classification.designMode;
  const heldByRestraint = rigidlyHeldUy.has(sourceNodeId);
  const declarations = [];
  if (mode === 'RESTRAINED_WEIGHT' && !heldByRestraint) {
    declarations.push(Object.freeze({
      declarationId: `${modelId}-C-${safe(item.sourceFeatureId)}-HGR-RW-UY`,
      kind: 'NODAL_RESTRAINT',
      nodeId: `${modelId}.N${safe(targetNodeId)}`,
      dof: 'UY',
      behavior: 'FIXED',
    }));
  }
  const load = mode === 'CONSTANT_EFFORT' ? item.classification.constantEffortLoad : null;
  return {
    declarations,
    binding: Object.freeze({
      sourceKind: 'HANGER',
      sourceFeatureId: item.sourceFeatureId,
      inventoryId: item.inventoryId,
      sourceRecordSemanticHash: item.sourceRecordSemanticHash,
      sourceNodeId,
      targetNodeId,
      retargetedByBendRetopology: targetNodeId !== sourceNodeId,
      targetDofs: Object.freeze(['UY']),
      implementation: disposition.disposition,
      limitationCode: disposition.limitationCode,
      limitationCodes: predefinedHangerLimitationCodes(item.classification),
      declarationIds: Object.freeze(declarations.map((row) => row.declarationId)),
      hangerDesignMode: mode,
      heldByRigidRestraint: heldByRestraint,
      numberOfHangers: item.classification.numberOfHangers,
      springRatePerHanger: null,
      springRateTotal: mode === 'CONSTANT_EFFORT' ? 0 : null,
      coldLoadPerHanger: null,
      coldLoadTotal: load,
      constantEffortBasis: item.classification.constantEffortBasis,
      verticalDirection: Object.freeze([...item.classification.verticalDirection]),
      verticalAxisAuthority: item.classification.verticalAxisAuthority,
    }),
  };
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
