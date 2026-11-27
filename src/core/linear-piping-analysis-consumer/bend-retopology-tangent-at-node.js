import { BEND_RETOPOLOGY_RELATIVE_TOLERANCE, failBendRetopology } from './bend-retopology-contract.js';
import {
  add, distance, dot, generatedNode, registerTrim, repositionedNode, scale, stationNodeId, subtract,
} from './bend-retopology-nodes.js';

/**
 * A tangent point this close to a span's end node (as a share of the span) is
 * on that node. CAESAR models routinely put the next node exactly at a bend's
 * far tangent, or start a bend straight off a node; their deltas then land the
 * computed tangent on the node, give or take rounding (BM_CII: 0.0004 mm).
 */
export const BEND_TANGENT_AT_NODE_FRACTION = 1e-4;

/** 'INSIDE', 'AT_START' or 'AT_END'; anything off the span, or past it, still fails. */
export function tangentSpanFraction(point, start, end, segmentId, side) {
  const vector = subtract(end, start);
  const lengthSquared = dot(vector, vector);
  if (!(lengthSquared > 0)) {
    failBendRetopology('BEND_RETOPOLOGY_TANGENT_OVERRUN',
      `Bend ${segmentId} ${side} span has zero length.`, { segmentId, side });
  }
  const fraction = dot(subtract(point, start), vector) / lengthSquared;
  const projected = add(start, scale(vector, fraction));
  const relativeResidual = distance(point, projected) / Math.sqrt(lengthSquared);
  if (!(fraction >= -BEND_TANGENT_AT_NODE_FRACTION && fraction <= 1 + BEND_TANGENT_AT_NODE_FRACTION)
    || relativeResidual > BEND_RETOPOLOGY_RELATIVE_TOLERANCE) {
    failBendRetopology(
      'BEND_RETOPOLOGY_TANGENT_OVERRUN',
      `Bend ${segmentId} ${side} tangent is not inside its adjacent source span.`,
      { segmentId, side, fraction, relativeResidual },
    );
  }
  if (fraction <= BEND_TANGENT_AT_NODE_FRACTION) return 'AT_START';
  if (fraction >= 1 - BEND_TANGENT_AT_NODE_FRACTION) return 'AT_END';
  return 'INSIDE';
}

/**
 * A corner bend whose tangent lands on a node.
 *
 * Near tangent on the bend's own FROM node: the arc starts at that node and
 * the bend element has no straight part. Far tangent on the next element's TO
 * node: the arc ends at that node, the next element is consumed by the arc
 * (it has no straight part either), and the corner working point is retired
 * into that node, so whatever was bound to it -- a support, a load -- moves
 * with it. Anything a consumed element itself carries (an applied load record)
 * blocks rather than being dropped. The node moves onto the exact tangent (at
 * most 1e-4 of the span), so the arc the structure carries is the arc the bend
 * component is built from. `discretise` is bend-retopology-geometry.js's chord
 * builder.
 */
export function tangentAtNodeDefinition(input, discretise) {
  const { segment, sourceSegmentId, cornerNodeId, incomingStart, outgoingSegment, outgoingEnd } = input;
  const nearStation = stationNodeId(segment.meta?.bendStationNode2);
  const tangentStartNode = input.startAtNode
    ? repositionedNode(incomingStart.id, input.tangentStartPoint, sourceSegmentId, 'START_AT_NODE', input.repositionedNodes)
    : generatedNode(nearStation ?? `${sourceSegmentId}.T0`, input.tangentStartPoint, sourceSegmentId, 'START', input.generatedNodes);
  registerTrim(input.endTrimBySegmentId, sourceSegmentId, tangentStartNode, sourceSegmentId, 'end');
  let tangentEndNode;
  if (input.endAtNode) {
    const outgoingId = String(outgoingSegment.id);
    if ((outgoingSegment.meta?.analysis?.forcesMoments ?? []).length > 0) {
      failBendRetopology('BEND_RETOPOLOGY_CONSUMED_SPAN_CARRIES_LOAD',
        `Element ${outgoingId} lies wholly inside bend ${sourceSegmentId}'s arc but declares an applied load.`,
        { sourceSegmentId, consumedSegmentId: outgoingId });
    }
    tangentEndNode = repositionedNode(outgoingEnd.id, input.tangentEndPoint, sourceSegmentId, 'END_AT_NODE', input.repositionedNodes);
    input.consumedSegments.set(outgoingId, sourceSegmentId);
    input.retiredNodeRecords.set(cornerNodeId, {
      sourceNodeId: cornerNodeId,
      bendSegmentId: sourceSegmentId,
      candidates: [{ nodeId: String(outgoingEnd.id), distance: distance(input.tangentEndPoint, outgoingEnd) }],
      nearestNodeId: String(outgoingEnd.id),
      codeStationNodeId: null,
      reason: 'BEND_FAR_TANGENT_AT_NEXT_NODE',
    });
  } else {
    tangentEndNode = repositionedNode(cornerNodeId, input.tangentEndPoint, sourceSegmentId, 'END_WORKING_POINT', input.repositionedNodes);
    registerTrim(input.startTrimBySegmentId, String(outgoingSegment.id), tangentEndNode, sourceSegmentId, 'start');
  }
  return discretise({
    segment,
    tangentStartNode,
    tangentEndNode,
    chordCount: input.chordCount,
    lengthErrorLimit: input.lengthErrorLimit,
    generatedNodes: input.generatedNodes,
    midArcStationNodeId: segment.meta?.bendStationNode1 ?? null,
    retiredCornerNodeId: input.endAtNode ? cornerNodeId : null,
  });
}
