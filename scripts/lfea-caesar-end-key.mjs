/**
 * Which CAESAR II output row and end an LFEA element end corresponds to.
 *
 * Most LFEA elements are CAESAR elements: the key is `${from}-${to}`. A
 * CAESAR bend element is a straight lead plus arc chords in LFEA, through
 * synthetic tangent and arc nodes. Its ends are compared only at CAESAR's
 * own nodes (the bend's FROM, its mid stations and its TO), against the
 * CAESAR row of the same source element that arrives at (J) or leaves (I)
 * that node. Synthetic nodes have no CAESAR row.
 *
 * CAESAR also splits some elements at a node of its own (BM4: the B31J tee
 * branches 20150-20161-20160 and 20295-20296-21429). An end at a CAESAR node
 * N then takes the one row that has N at that end and, at its other end, a
 * node LFEA does not have; when the element's other node O is a CAESAR node,
 * the row must also continue to O.
 */
export function createCaesarEndKey(preFlight, caesarKeys) {
  const keys = [...caesarKeys];
  const bends = new Map((preFlight.preparation.sourcePreparation?.normalizedGeometry?.segments ?? [])
    .filter((row) => row.meta?.bendDeclaredRadius > 0).map((row) => [String(row.id), row]));
  const lfeaNodes = new Set(preFlight.preparation.structuralPreparation.segmentBindings
    .flatMap((row) => [String(row.startNodeId), String(row.endNodeId)]));
  const caesarNodes = new Set(keys.flatMap((key) => key.split('-')));
  return function caesarEndKey(binding, end) {
    const direct = `${binding.startNodeId}-${binding.endNodeId}`;
    if (caesarKeys.has(direct)) return { key: direct, end };
    return bendEndKey(binding, end) ?? splitEndKey(binding, end);
  };

  function bendEndKey(binding, end) {
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
  }

  function splitEndKey(binding, end) {
    const node = String(end === 'I' ? binding.startNodeId : binding.endNodeId);
    const other = String(end === 'I' ? binding.endNodeId : binding.startNodeId);
    const found = keys.filter((candidate) => {
      const [from, to] = candidate.split('-');
      const [at, split] = end === 'I' ? [from, to] : [to, from];
      if (at !== node || lfeaNodes.has(split)) return false;
      return !caesarNodes.has(other) || caesarKeys.has(end === 'I' ? `${split}-${other}` : `${other}-${split}`);
    });
    return found.length === 1 ? { key: found[0], end } : null;
  }
}
