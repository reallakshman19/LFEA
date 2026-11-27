import {
  LOAD_PRIMITIVE_SCHEMA,
  REPRESENTABLE_LOAD_SIGN_CONVENTION,
} from '../linear-fea-load-case/load-case-contract.js';
import {
  loadLedgerRow,
  physicalCaseError,
  safePhysicalId,
  sourceEvidence,
} from './inputxml-linear-physical-case-builders.js';

const Y_DOWN = Object.freeze([0, -1, 0]);

/** Installation preloads of fully predefined hangers, applied in the W+H family of cases. */
export function collectHangerPreloads(structural, gravityDirection, ledger) {
  const hangers = hangerBindings(structural).filter((row) => !row.hangerDesignMode);
  return hangerLoadPrimitives(hangers, structural, gravityDirection, ledger, false);
}

/**
 * Constant-effort hangers (LFEA_HANGER_CONSTANT_EFFORT_DEFAULT,
 * inputxml-predefined-hanger.js): their restrained-weight load acts wherever
 * the pipe's weight does, so these join every weight-bearing case. A hanger
 * held rigid for the restrained-weight pass, or one designed to no load (its
 * node is held by a rigid restraint, or the pipe lifts off it), applies none;
 * both stay in the ledger.
 */
export function collectConstantEffortHangerLoads(structural, gravityDirection, ledger) {
  const designed = hangerBindings(structural).filter((row) => row.hangerDesignMode);
  for (const binding of designed.filter((row) => !(row.hangerDesignMode === 'CONSTANT_EFFORT' && row.coldLoadTotal > 0))) {
    ledger.push(loadLedgerRow({
      ledgerId: `IXLOAD:HANGER:${safePhysicalId(binding.inventoryId)}`,
      sourceKind: 'HANGER_COLD_LOAD',
      sourceFeatureId: binding.sourceFeatureId,
      segmentId: null,
      elementId: null,
      disposition: 'COMPILED_WITH_DECLARED_LIMITATION',
      primitiveIds: [],
      limitationCode: binding.limitationCode,
      evidence: {
        hangerDesignMode: binding.hangerDesignMode,
        heldByRigidRestraint: binding.heldByRigidRestraint,
        coldLoadTotal: binding.coldLoadTotal,
      },
    }));
  }
  const loaded = designed.filter((row) => row.hangerDesignMode === 'CONSTANT_EFFORT' && row.coldLoadTotal > 0);
  return hangerLoadPrimitives(loaded, structural, gravityDirection, ledger, true);
}

function hangerBindings(structural) {
  return structural.constraintBindings
    .filter((row) => row.sourceKind === 'HANGER')
    .sort((left, right) => compareAscii(left.inventoryId, right.inventoryId));
}

function hangerLoadPrimitives(hangers, structural, gravityDirection, ledger, constantEffort) {
  if (hangers.length === 0) return [];
  const actualGravity = [gravityDirection.x, gravityDirection.y, gravityDirection.z];
  if (actualGravity.some((value, index) => value !== Y_DOWN[index])) {
    throw physicalCaseError(
      'INPUTXML_HANGER_VERTICAL_AXIS_UNSUPPORTED',
      'Predefined InputXML hangers are currently qualified only for Y-up / Y-down gravity.',
      { supportedGravityDirection: Y_DOWN, actualGravityDirection: actualGravity },
    );
  }

  return hangers.map((binding, ordinal) => {
    const coldLoad = binding.coldLoadTotal;
    if (!(typeof coldLoad === 'number' && Number.isFinite(coldLoad) && coldLoad > 0)) {
      throw physicalCaseError(
        'INPUTXML_HANGER_PRELOAD_INVALID',
        `Hanger ${binding.inventoryId} has no positive finite retained cold load.`,
        { inventoryId: binding.inventoryId, coldLoad },
      );
    }
    const nodeId = `${structural.modelId}.N${safePhysicalId(binding.targetNodeId)}`;
    const primitiveId = `${constantEffort ? 'HCE' : 'H'}-${safePhysicalId(binding.inventoryId)}-${ordinal}`;
    const primitive = Object.freeze({
      schema: LOAD_PRIMITIVE_SCHEMA,
      primitiveId,
      kind: 'NODAL_FORCE_MOMENT',
      sourceEvidence: sourceEvidence({
        sourceId: constantEffort ? 'LFEA_HANGER_CONSTANT_EFFORT_DEFAULT' : 'INPUTXML_PREDEFINED_HANGER',
        ...(constantEffort ? { constantEffortBasis: binding.constantEffortBasis } : {}),
        sourceRevision: binding.sourceRecordSemanticHash,
        inventoryId: binding.inventoryId,
        numberOfHangers: binding.numberOfHangers,
        coldLoadPerHanger: binding.coldLoadPerHanger,
        coldLoadTotal: coldLoad,
        verticalAxisAuthority: binding.verticalAxisAuthority,
      }),
      nodeId,
      basis: { kind: 'GLOBAL' },
      force: { fx: 0, fy: coldLoad, fz: 0 },
      moment: { mx: 0, my: 0, mz: 0 },
      units: { force: 'N', moment: 'N*m', length: 'm' },
      signConvention: REPRESENTABLE_LOAD_SIGN_CONVENTION,
    });
    ledger.push(loadLedgerRow({
      ledgerId: `IXLOAD:HANGER:${safePhysicalId(binding.inventoryId)}`,
      sourceKind: 'HANGER_COLD_LOAD',
      sourceFeatureId: binding.sourceFeatureId,
      segmentId: null,
      elementId: null,
      disposition: 'COMPILED_WITH_DECLARED_LIMITATION',
      primitiveIds: [primitiveId],
      limitationCode: constantEffort ? binding.limitationCode : 'DRAFT_SPRING_SUPPORT_NO_REFERENCE',
      evidence: {
        nodeId,
        numberOfHangers: binding.numberOfHangers,
        coldLoadPerHanger: binding.coldLoadPerHanger,
        coldLoadTotal: coldLoad,
        appliedForce: primitive.force,
        verticalAxisAuthority: binding.verticalAxisAuthority,
        ...(constantEffort ? { constantEffortBasis: binding.constantEffortBasis } : {}),
      },
    }));
    return primitive;
  });
}

function compareAscii(left, right) {
  const a = String(left); const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
