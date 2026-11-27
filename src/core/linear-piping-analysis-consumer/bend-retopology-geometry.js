import { discretiseBend } from '../centerline-beam-fea/bend-geometry.js';
import {
  BEND_RETOPOLOGY_RELATIVE_TOLERANCE,
  failBendRetopology,
} from './bend-retopology-contract.js';
import {
  distance, generatedNode, norm, pointOf, registerTrim, repositionedNode, requireCoincident, requireNode,
  requirePoint, stationNodeId,
} from './bend-retopology-nodes.js';
import { tangentAtNodeDefinition, tangentSpanFraction } from './bend-retopology-tangent-at-node.js';

export { BEND_TANGENT_AT_NODE_FRACTION } from './bend-retopology-tangent-at-node.js';

export function buildAccdbBendDefinition(input) {
  const { segment, sourceSegments, sourceNodesById } = input;
  const sourceSegmentId = String(segment.id);
  const cornerNodeId = String(segment.endNodeId);
  const incomingStart = requireNode(sourceNodesById, segment.startNodeId, sourceSegmentId);
  const corner = requireNode(sourceNodesById, cornerNodeId, sourceSegmentId);
  const outgoing = sourceSegments.filter((candidate) =>
    String(candidate.startNodeId) === cornerNodeId && String(candidate.id) !== sourceSegmentId);
  const incident = sourceSegments.filter((candidate) =>
    String(candidate.startNodeId) === cornerNodeId || String(candidate.endNodeId) === cornerNodeId);
  if (outgoing.length !== 1 || incident.length !== 2
    || !incident.some((candidate) => String(candidate.id) === sourceSegmentId)) {
    failBendRetopology(
      'BEND_RETOPOLOGY_CORNER_CONNECTIVITY_AMBIGUOUS',
      `ACCDB bend ${sourceSegmentId} corner ${cornerNodeId} is not a simple two-span route corner.`,
      {
        sourceSegmentId,
        cornerNodeId,
        outgoingSegmentIds: outgoing.map((row) => String(row.id)),
        incidentSegmentIds: incident.map((row) => String(row.id)),
      },
    );
  }
  const outgoingSegment = outgoing[0];
  const outgoingEnd = requireNode(sourceNodesById, outgoingSegment.endNodeId, String(outgoingSegment.id));
  const tangentStartPoint = requirePoint(segment.meta?.bendTangentStart, sourceSegmentId, 'bendTangentStart');
  const tangentEndPoint = requirePoint(segment.meta?.bendTangentEnd, sourceSegmentId, 'bendTangentEnd');
  const startAtNode = tangentSpanFraction(tangentStartPoint, incomingStart, corner, sourceSegmentId, 'incoming') === 'AT_START';
  const endAtNode = tangentSpanFraction(tangentEndPoint, corner, outgoingEnd, sourceSegmentId, 'outgoing') === 'AT_END';
  if (startAtNode || endAtNode) {
    return tangentAtNodeDefinition({
      ...input, sourceSegmentId, cornerNodeId, incomingStart, outgoingSegment, outgoingEnd,
      tangentStartPoint, tangentEndPoint, startAtNode, endAtNode,
    }, discretisedDefinition);
  }

  // The benchmark solve binds the arc to the source's own station nodes:
  // NODE2 to the near tangent, NODE1 to the mid-arc station, and the element's
  // TO_NODE to the far tangent. That last binding is the important one. The
  // adapter reads TO_NODE's coordinate as the corner intersection, which is
  // correct for deriving the arc, but in an analysis model that node belongs at
  // the far tangent -- which is where caesar-accdb-linear-solve.js puts it, and
  // that reading is the one CAESAR's own output validated.
  //
  // Binding it here rather than retiring it is what removes the whole
  // corner-load problem. Every BM4_L bend declares a force/moment at TO_NODE,
  // so retiring it stranded a real applied load on all twelve bends. The node
  // now survives, carries its load, and simply sits at the tangent.
  const tangentStartNode = generatedNode(
    stationNodeId(segment.meta?.bendStationNode2) ?? `${sourceSegmentId}.T0`,
    tangentStartPoint, sourceSegmentId, 'START', input.generatedNodes,
  );
  const tangentEndNode = repositionedNode(
    cornerNodeId, tangentEndPoint, sourceSegmentId, 'END_WORKING_POINT', input.repositionedNodes,
  );
  registerTrim(input.endTrimBySegmentId, sourceSegmentId, tangentStartNode, sourceSegmentId, 'end');
  registerTrim(input.startTrimBySegmentId, String(outgoingSegment.id), tangentEndNode, sourceSegmentId, 'start');

  const definition = discretisedDefinition({
    segment,
    tangentStartNode,
    tangentEndNode,
    chordCount: input.chordCount,
    lengthErrorLimit: input.lengthErrorLimit,
    generatedNodes: input.generatedNodes,
    midArcStationNodeId: segment.meta?.bendStationNode1 ?? null,
    retiredCornerNodeId: null,
  });
  // No retired-node record: the working point is rebound onto the arc rather
  // than removed, so there is nothing to re-target and no binding to resolve.
  return definition;
}

export function buildInputXmlBendDefinition(input) {
  const sourceSegmentId = String(input.segment.id);
  const startNode = requireNode(input.sourceNodesById, input.segment.startNodeId, sourceSegmentId);
  const endNode = requireNode(input.sourceNodesById, input.segment.endNodeId, sourceSegmentId);
  const tangentStart = requirePoint(input.segment.meta?.bendTangentStart, sourceSegmentId, 'bendTangentStart');
  const tangentEnd = requirePoint(input.segment.meta?.bendTangentEnd, sourceSegmentId, 'bendTangentEnd');
  requireCoincident(tangentStart, startNode, sourceSegmentId, 'InputXML tangent start/source start');
  requireCoincident(tangentEnd, endNode, sourceSegmentId, 'InputXML tangent end/source end');
  return discretisedDefinition({
    segment: input.segment,
    tangentStartNode: startNode,
    tangentEndNode: endNode,
    chordCount: input.chordCount,
    lengthErrorLimit: input.lengthErrorLimit,
    generatedNodes: input.generatedNodes,
    retiredCornerNodeId: null,
  });
}

export function distanceBetween(left, right) {
  return distance(left, right);
}

export function absoluteGeometryTolerance(left, right) {
  return BEND_RETOPOLOGY_RELATIVE_TOLERANCE * Math.max(norm(left), norm(right), 1);
}

function discretisedDefinition(input) {
  const sourceSegmentId = String(input.segment.id);
  const centre = requirePoint(input.segment.meta?.bendArcCentre, sourceSegmentId, 'bendArcCentre');
  const discretised = discretiseBend(
    pointOf(input.tangentStartNode),
    pointOf(input.tangentEndNode),
    centre,
    input.chordCount,
  );
  if (!(discretised.lengthErrorFraction <= input.lengthErrorLimit)) {
    failBendRetopology(
      'BEND_RETOPOLOGY_LENGTH_ERROR_EXCEEDS_LIMIT',
      `Bend ${sourceSegmentId} chord length error ${discretised.lengthErrorFraction} exceeds ${input.lengthErrorLimit}.`,
      { sourceSegmentId, lengthErrorFraction: discretised.lengthErrorFraction, limit: input.lengthErrorLimit },
    );
  }
  const chain = [input.tangentStartNode];
  for (let index = 1; index < discretised.points.length - 1; index += 1) {
    const isMidArc = index === input.chordCount / 2;
    const declaredMidArc = isMidArc ? stationNodeId(input.midArcStationNodeId) : null;
    chain.push(generatedNode(
      declaredMidArc ?? `${sourceSegmentId}.A${index}`,
      discretised.points[index],
      sourceSegmentId,
      isMidArc ? 'MID_ARC' : 'ARC',
      input.generatedNodes,
    ));
  }
  chain.push(input.tangentEndNode);
  const chordSegments = [];
  for (let index = 1; index < chain.length; index += 1) {
    chordSegments.push(Object.freeze({
      id: `${sourceSegmentId}.B${index}`,
      startNodeId: String(chain[index - 1].id),
      endNodeId: String(chain[index].id),
      length: distance(chain[index - 1], chain[index]),
    }));
  }
  return Object.freeze({
    sourceSegmentId,
    tangentBasis: String(input.segment.meta.bendTangentBasis),
    chordSegments: Object.freeze(chordSegments),
    midArcNodeId: String(chain[input.chordCount / 2].id),
    arcLength: discretised.arcLength,
    chordChainLength: discretised.chordLength,
    lengthErrorFraction: discretised.lengthErrorFraction,
    retiredCornerNodeId: input.retiredCornerNodeId,
  });
}
