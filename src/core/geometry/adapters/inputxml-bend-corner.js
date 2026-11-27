import { add, dot, norm, scale, subtract } from '../../shared-analysis-contract/vector3.js';
import { checkDeclaredRadius, resolveBendArcCentre } from './inputxml-bend-arc.js';

export const INPUTXML_CORNER_TANGENT_BASIS = 'INPUTXML_CORNER_INTERSECTION_V1';

/**
 * Arc of a CAESAR InputXML bend that declares internal station nodes
 * (NODE1/NODE2).
 *
 * CAESAR writes these bends the way ACCDB does: FROM_NODE -> TO_NODE runs
 * along the incoming leg to the corner (the straight legs' intersection), and
 * the next element leaves the corner along the outgoing leg. BM4 (11 bends)
 * and BM1 (2) all have that shape: FROM->TO is parallel to the incoming leg
 * and turns 90 degrees into the next element. The tangent points sit R tan(theta/2)
 * back from the corner on each leg. This is the same arithmetic as the ACCDB
 * adapter's attachAccdbBendGeometry, which BM4_L validated against CAESAR.
 *
 * Returns { resolved } with the tangent custody fields, or { reason } when the
 * corner is not a simple two-span route corner or the radius does not fit.
 */
export function resolveInputXmlCornerBend({ declaredRadius, start, corner, outletEnd }) {
  if (!(declaredRadius > 0)) return { reason: 'no positive declared RADIUS' };
  if (!start || !corner || !outletEnd) return { reason: 'a corner or leg node has no coordinates' };
  const incomingLength = norm(subtract(corner, start));
  const outgoingLength = norm(subtract(outletEnd, corner));
  if (!(incomingLength > 0) || !(outgoingLength > 0)) return { reason: 'a leg has zero length' };
  const incomingDirection = scale(subtract(corner, start), 1 / incomingLength);
  const outgoingDirection = scale(subtract(outletEnd, corner), 1 / outgoingLength);
  const bendAngle = Math.acos(Math.min(1, Math.max(-1, dot(incomingDirection, outgoingDirection))));
  if (!(bendAngle > 1e-6 && bendAngle < Math.PI - 1e-6)) return { reason: 'the legs do not turn' };
  const tangentLength = declaredRadius * Math.tan(bendAngle / 2);
  if (!(tangentLength < incomingLength) || !(tangentLength < outgoingLength)) {
    return { reason: `RADIUS ${declaredRadius} gives a tangent length ${tangentLength} longer than a leg` };
  }
  const tangentStart = subtract(corner, scale(incomingDirection, tangentLength));
  const tangentEnd = add(corner, scale(outgoingDirection, tangentLength));
  const arc = resolveBendArcCentre(incomingDirection, tangentStart, tangentEnd);
  if (!arc || !checkDeclaredRadius(arc.computedRadius, declaredRadius, 1e-6).accepted) {
    return { reason: 'the arc centre could not be resolved consistently' };
  }
  return {
    resolved: {
      bendArcCentre: arc.centre,
      bendComputedRadius: arc.computedRadius,
      bendTangentStart: { ...tangentStart },
      bendTangentEnd: { ...tangentEnd },
      bendTangentBasis: INPUTXML_CORNER_TANGENT_BASIS,
    },
  };
}
