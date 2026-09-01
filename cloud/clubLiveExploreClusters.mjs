import { createHash } from 'node:crypto';

export const clubLiveExploreSplitMeters = 100;
export const clubLiveExploreMergeMeters = 50;

function durablePairKey(leftIdentity, rightIdentity) {
  return [String(leftIdentity), String(rightIdentity)].sort().join('\u0000');
}

export function planClubLiveExploreClusters({
  generationKey,
  participants,
  previousKnownDurablePairs = new Set(),
  previousTogetherDurablePairs = new Set(),
}) {
  const normalized = participants
    .filter((participant) => participant?.id && participant?.durableIdentity)
    .map((participant) => ({
      id: String(participant.id),
      durableIdentity: String(participant.durableIdentity),
      distanceMeters: participant.distanceMeters != null
        && Number.isFinite(Number(participant.distanceMeters))
        ? Math.max(0, Number(participant.distanceMeters))
        : null,
    }));
  const adjacent = new Map(normalized.map(({ id }) => [id, new Set()]));

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const pairKey = durablePairKey(left.durableIdentity, right.durableIdentity);
      const pairWasKnown = previousKnownDurablePairs.has(pairKey);
      const pairWasTogether = previousTogetherDurablePairs.has(pairKey);
      const eitherDistanceMissing = left.distanceMeters == null || right.distanceMeters == null;
      // New tablets begin in the same pack until the server accepts their
      // first distance sample. A reconnect keeps its last split/together
      // relationship instead of being treated as 0m or as a brand-new socket.
      const connected = eitherDistanceMissing
        ? !pairWasKnown || pairWasTogether
        : Math.abs(left.distanceMeters - right.distanceMeters) <= (
            !pairWasKnown || pairWasTogether
              ? clubLiveExploreSplitMeters
              : clubLiveExploreMergeMeters
          );
      if (connected) {
        adjacent.get(left.id).add(right.id);
        adjacent.get(right.id).add(left.id);
      }
    }
  }

  const clusterByParticipantId = new Map();
  const visited = new Set();
  for (const participant of normalized) {
    if (visited.has(participant.id)) continue;
    const pending = [participant.id];
    const componentIds = [];
    visited.add(participant.id);
    while (pending.length > 0) {
      const memberId = pending.shift();
      componentIds.push(memberId);
      for (const peerId of adjacent.get(memberId) ?? []) {
        if (visited.has(peerId)) continue;
        visited.add(peerId);
        pending.push(peerId);
      }
    }
    const durableIdentities = componentIds
      .map((memberId) => normalized.find(({ id }) => id === memberId).durableIdentity)
      .sort();
    const clusterId = createHash('sha256').update(JSON.stringify({
      generationKey: String(generationKey ?? ''),
      members: durableIdentities,
    })).digest('base64url').slice(0, 24);
    componentIds.forEach((memberId) => clusterByParticipantId.set(memberId, clusterId));
  }
  // Keep pair history for absent durable devices for this ride generation.
  // This lets a replaced socket resume the same hysteresis state. Present
  // pairs are always refreshed from the newly planned components.
  const knownDurablePairs = new Set(previousKnownDurablePairs);
  const togetherDurablePairs = new Set(previousTogetherDurablePairs);
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const pairKey = durablePairKey(left.durableIdentity, right.durableIdentity);
      knownDurablePairs.add(pairKey);
      if (clusterByParticipantId.get(left.id) === clusterByParticipantId.get(right.id)) {
        togetherDurablePairs.add(pairKey);
      } else {
        togetherDurablePairs.delete(pairKey);
      }
    }
  }
  const signature = normalized
    .map(({ id, durableIdentity }) => `${durableIdentity}:${clusterByParticipantId.get(id) ?? ''}`)
    .sort()
    .join('|');
  return {
    clusterByParticipantId,
    knownDurablePairs,
    togetherDurablePairs,
    signature,
  };
}
