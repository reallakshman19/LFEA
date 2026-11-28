/**
 * Which CAESAR II output row and end an LFEA element end corresponds to.
 *
 * Most LFEA elements are CAESAR elements: the key is `${from}-${to}`. A
 * CAESAR bend element is a straight lead plus arc chords in LFEA, through
 * synthetic tangent and arc nodes. Its ends are compared only at CAESAR's
 * own nodes (the bend's FROM, its mid stations and its TO), against the
 * CAESAR row of the same source element that arrives at (J) or leaves (I)
 * that node. Synthetic nodes have no CAESAR row.
 */
export function createCaesarEndKey(preFlight, caesarKeys) {
  const keys = [...caesarKeys];
  const bends = new Map((preFlight.preparation.sourcePreparation?.normalizedGeometry?.segments ?? [])
    .filter((row) => row.meta?.bendDeclaredRadius > 0).map((row) => [String(row.id), row]));
  return function caesarEndKey(binding, end) {
    const direct = `${binding.startNodeId}-${binding.endNodeId}`;
    if (caesarKeys.has(direct)) return { key: direct, end };
    const bend = bends.get(String(binding.bendChordOf ?? binding.sourceSegmentId));
    if (!bend) return null;
    const { meta } = bend;
    const members = new Set([bend.startNodeId, bend.endNodeId, meta.bendStationNode1, meta.bendStationNode2, meta.bendStationNode3]
      .filter((node) => node !== undefined && node !== null).map(String));
    const node = String(end === 'I' ? binding.startNodeId : binding.endNodeId);
    if (!members.has(node)) return null;
    const key = keys.find((candidate) => {
      const [from, to] = candidate.split('-');
      return members.has(from) && members.has(to) && (end === 'J' ? to === node : from === node);
    });
    return key ? { key, end } : null;
  };
}
