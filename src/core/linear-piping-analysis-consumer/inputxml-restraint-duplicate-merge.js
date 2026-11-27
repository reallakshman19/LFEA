import { restraintRigidTwoWayDofs } from './inputxml-feature-inventory-restraints.js';
import {
  DISCLOSED_GENERIC_ANALYZER_APPROXIMATION_PROFILE as APPROXIMATE,
  STRICT_INPUTXML_LINEAR_STATIC_PROFILE as STRICT,
  approximationDisposition,
} from './inputxml-model-health-profile.js';

/**
 * Duplicate restraints, merged (practical analysis, docs/PRACTICAL_ANALYSIS_POLICY.md).
 *
 * Real CAESAR models declare the same support twice at one node -- the same
 * guide typed on two adjacent elements, a Y support repeated, a +Y under an
 * anchor. The compiler keeps one declaration per node and DOF, so these used
 * to block. When every DOF a restraint acts on is already held rigidly both
 * ways (no gap, spring or connecting node) by another restraint at the same
 * node, it adds nothing to a linear analysis -- a rigid hold in parallel with
 * anything is the rigid hold -- so it is merged into that restraint: still
 * listed, labelled LFEA_RESTRAINT_DUPLICATE_MERGED, and not compiled.
 * Duplicates no rigid hold covers (two springs, two gapped stops, connecting
 * nodes) still block.
 */
export const LFEA_RESTRAINT_DUPLICATE_MERGED = 'LFEA_RESTRAINT_DUPLICATE_MERGED';

export function mergeCoveredDuplicateRestraints(rows) {
  const byNode = new Map();
  for (const row of rows) {
    if (row.sourceKind !== 'RESTRAINT' || !row.active) continue;
    const nodeId = row.classification?.nodeId;
    if (nodeId === null || nodeId === undefined || (row.classification.targetDofs ?? []).length === 0) continue;
    if (!byNode.has(nodeId)) byNode.set(nodeId, []);
    byNode.get(nodeId).push(row);
  }
  const mergedInto = new Map();
  for (const group of byNode.values()) {
    if (group.length < 2) continue;
    // Widest rigid holds first (an anchor before a single axis), then source order.
    const ordered = group.map((row) => ({ row, rigid: restraintRigidTwoWayDofs(row.classification) }))
      .sort((left, right) => right.rigid.length - left.rigid.length || compareAscii(left.row.inventoryId, right.row.inventoryId));
    const holds = [];
    for (const { row, rigid } of ordered) {
      const covering = row.classification.connectingNodeActive
        ? null
        : holds.find((hold) => row.classification.targetDofs.every((dof) => hold.dofs.includes(dof)));
      if (covering) {
        mergedInto.set(row.inventoryId, covering.inventoryId);
        continue;
      }
      if (rigid.length > 0) holds.push({ inventoryId: row.inventoryId, dofs: rigid });
    }
  }
  if (mergedInto.size === 0) return rows;
  const disposition = approximationDisposition(LFEA_RESTRAINT_DUPLICATE_MERGED);
  return rows.map((row) => (mergedInto.has(row.inventoryId)
    ? Object.freeze({
      ...row,
      classification: Object.freeze({ ...row.classification, mergedIntoInventoryId: mergedInto.get(row.inventoryId) }),
      dispositionByProfile: Object.freeze({ [STRICT]: disposition, [APPROXIMATE]: disposition }),
    })
    : row));
}

export function isMergedDuplicateRestraint(row) {
  return typeof row?.classification?.mergedIntoInventoryId === 'string';
}

function compareAscii(left, right) {
  const a = String(left); const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
