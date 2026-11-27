import { BEND_RETOPOLOGY_RELATIVE_TOLERANCE, failBendRetopology } from './bend-retopology-contract.js';

/**
 * Node and point helpers shared by the bend retopology definitions
 * (bend-retopology-geometry.js, bend-retopology-tangent-at-node.js).
 */

/**
 * A source node kept, with its analysis-model position.
 *
 * Distinct from a generated node because the id already exists in the source:
 * anything bound to it -- an applied load, a support -- stays bound. Only the
 * coordinate changes, from the working point to the tangent it represents.
 */
export function repositionedNode(nodeId, point, sourceSegmentId, role, repositionedNodes) {
  const id = String(nodeId);
  const existing = repositionedNodes.get(id);
  if (existing) return existing;
  const node = Object.freeze({
    id,
    x: point.x,
    y: point.y,
    z: point.z,
    meta: Object.freeze({ bendWorkingPointOf: sourceSegmentId, bendArcRole: role }),
  });
  repositionedNodes.set(id, node);
  return node;
}

/**
 * A CAESAR bend station node, when the source declares one.
 *
 * ACCDB carries NODE1/NODE2 on the bend record. The benchmark solve binds them
 * onto the arc rather than generating names for those stations, and a code
 * stress check reads the bend at NODE1, so losing them would move the station a
 * reader is looking for.
 */
export function stationNodeId(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return String(numeric);
}

export function registerTrim(map, segmentId, node, bendSegmentId, side) {
  if (map.has(segmentId)) {
    const existing = map.get(segmentId);
    failBendRetopology(
      'BEND_RETOPOLOGY_TRIM_COLLISION',
      `Segment ${segmentId} receives more than one ${side} trim.`,
      { segmentId, side, existingBendSegmentId: existing.bendSegmentId, bendSegmentId },
    );
  }
  map.set(segmentId, Object.freeze({ node, bendSegmentId }));
}

export function generatedNode(id, point, bendSegmentId, role, generatedNodes) {
  const existing = generatedNodes.get(id);
  if (existing) {
    requireCoincident(existing, point, bendSegmentId, `generated node ${id}`);
    return existing;
  }
  const node = Object.freeze({
    id,
    x: point.x,
    y: point.y,
    z: point.z,
    restraint: 'FREE',
    meta: Object.freeze({ bendRetopologyOf: bendSegmentId, bendRetopologyRole: role }),
  });
  generatedNodes.set(id, node);
  return node;
}

export function requireCoincident(left, right, segmentId, label) {
  const delta = distance(left, right);
  const scaleValue = Math.max(norm(left), norm(right), 1);
  if (delta / scaleValue > BEND_RETOPOLOGY_RELATIVE_TOLERANCE) {
    failBendRetopology(
      'BEND_RETOPOLOGY_TANGENT_ENDPOINT_MISMATCH',
      `Bend ${segmentId} ${label} is inconsistent with the source endpoint.`,
      { segmentId, label, relativeResidual: delta / scaleValue },
    );
  }
}

export function requireNode(nodesById, nodeId, segmentId) {
  const node = nodesById.get(String(nodeId)) ?? null;
  if (node === null) {
    failBendRetopology('BEND_RETOPOLOGY_NODE_MISSING',
      `Segment ${segmentId} references missing node ${nodeId}.`, { segmentId, nodeId });
  }
  return node;
}

export function requirePoint(value, segmentId, field) {
  if (!value || typeof value !== 'object'
    || ![value.x, value.y, value.z].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    failBendRetopology('BEND_RETOPOLOGY_POINT_INVALID',
      `Bend ${segmentId} has invalid ${field}.`, { segmentId, field });
  }
  return value;
}

export function pointOf(node) { return { x: node.x, y: node.y, z: node.z }; }
export function distance(left, right) { return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z); }
export function norm(point) { return Math.hypot(point.x, point.y, point.z); }
export function subtract(left, right) { return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }; }
export function add(left, right) { return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }; }
export function scale(vector, factor) { return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }; }
export function dot(left, right) { return left.x * right.x + left.y * right.y + left.z * right.z; }
