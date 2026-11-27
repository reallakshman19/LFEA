import { LOAD_PRIMITIVE_SCHEMA } from '../linear-fea-load-case/load-case-contract.js';
import { loadLedgerRow, safePhysicalId, sourceEvidence } from './inputxml-linear-physical-case-builders.js';

/**
 * D1 of each specified displacement (inputxml-specified-displacement.js), as
 * prescribed movements. They travel with the temperature primitives, so they
 * act exactly where T1 does (CAESAR's W+D1+T1+P1); every other case holds the
 * slot at zero, which the solver does for a slot a case leaves unset.
 */
export function collectDisplacementMovements(structural, ledger) {
  const primitives = [];
  const bindings = structural.constraintBindings
    .filter((row) => row.sourceKind === 'DISPLACEMENTS')
    .sort((left, right) => compareAscii(left.inventoryId, right.inventoryId));
  for (const binding of bindings) {
    const nodeId = `${structural.modelId}.N${safePhysicalId(binding.targetNodeId)}`;
    const ids = [];
    for (const slot of binding.prescribedSlots) {
      if (!(typeof slot.d1Value === 'number' && Number.isFinite(slot.d1Value)) || slot.d1Value === 0) continue;
      const primitiveId = `D1-${safePhysicalId(binding.inventoryId)}-${slot.dof}`;
      primitives.push(Object.freeze({
        schema: LOAD_PRIMITIVE_SCHEMA,
        primitiveId,
        kind: 'PRESCRIBED_MOVEMENT',
        sourceEvidence: sourceEvidence({
          sourceId: 'LFEA_SPECIFIED_DISPLACEMENT_D1_WITH_T1',
          sourceRevision: binding.sourceRecordSemanticHash,
          inventoryId: binding.inventoryId,
          vector: 1,
          dof: slot.dof,
          value: slot.d1Value,
        }),
        prescribedSlotId: slot.slotId,
        nodeId,
        dof: slot.dof,
        value: slot.d1Value,
      }));
      ids.push(primitiveId);
    }
    ledger.push(loadLedgerRow({
      ledgerId: `IXLOAD:DISPLACEMENT:${safePhysicalId(binding.inventoryId)}`,
      sourceKind: 'SPECIFIED_DISPLACEMENT',
      sourceFeatureId: binding.sourceFeatureId,
      segmentId: null,
      elementId: null,
      disposition: 'COMPILED_WITH_DECLARED_LIMITATION',
      primitiveIds: ids,
      limitationCode: binding.limitationCode,
      evidence: {
        nodeId,
        heldDofs: binding.targetDofs,
        d1: Object.fromEntries(binding.prescribedSlots.map((slot) => [slot.dof, slot.d1Value])),
        otherVectorsWithValues: binding.otherVectorsWithValues,
      },
    }));
  }
  return primitives;
}

function compareAscii(left, right) {
  const a = String(left); const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
