import { describe, expect, it } from 'vitest';
import { planClubLiveExploreClusters } from '../../cloud/clubLiveExploreClusters.mjs';

const participants = (distances: Array<number | null>) => distances.map((distanceMeters, index) => ({
  id: `client-${index + 1}`,
  durableIdentity: `device-${index + 1}`,
  distanceMeters,
}));

function clusterCount(plan: ReturnType<typeof planClubLiveExploreClusters>) {
  return new Set(plan.clusterByParticipantId.values()).size;
}

describe('Club Live Explore presentation clusters', () => {
  it('starts as one stable pack while telemetry is missing or riders remain close', () => {
    const initiallyMeasured = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 20, 45, 75]),
    });
    const missing = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([null, null, null, null]),
    });
    const close = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 20, 45, 70]),
      previousKnownDurablePairs: missing.knownDurablePairs,
      previousTogetherDurablePairs: missing.togetherDurablePairs,
    });
    expect(clusterCount(initiallyMeasured)).toBe(1);
    expect(clusterCount(missing)).toBe(1);
    expect(clusterCount(close)).toBe(1);
  });

  it('splits beyond 100m and uses 50m merge hysteresis', () => {
    const initial = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 10, 20, 30]),
    });
    const split = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 10, 20, 140]),
      previousKnownDurablePairs: initial.knownDurablePairs,
      previousTogetherDurablePairs: initial.togetherDurablePairs,
    });
    const stillSplit = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 10, 20, 75]),
      previousKnownDurablePairs: split.knownDurablePairs,
      previousTogetherDurablePairs: split.togetherDurablePairs,
    });
    const merged = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 10, 20, 49]),
      previousKnownDurablePairs: stillSplit.knownDurablePairs,
      previousTogetherDurablePairs: stillSplit.togetherDurablePairs,
    });
    expect(clusterCount(split)).toBe(2);
    expect(clusterCount(stillSplit)).toBe(2);
    expect(clusterCount(merged)).toBe(1);
  });

  it('creates four individual clusters and stable ids from durable identities', () => {
    const first = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 150, 300, 450]),
    });
    const reordered = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: [...participants([0, 150, 300, 450])].reverse(),
      previousKnownDurablePairs: first.knownDurablePairs,
      previousTogetherDurablePairs: first.togetherDurablePairs,
    });
    expect(clusterCount(first)).toBe(4);
    expect(reordered.signature).toBe(first.signature);
  });

  it('does not coerce missing telemetry to zero or collapse a prior split', () => {
    const initial = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 150]),
    });
    const reconnecting = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, null]),
      previousKnownDurablePairs: initial.knownDurablePairs,
      previousTogetherDurablePairs: initial.togetherDurablePairs,
    });
    expect(clusterCount(initial)).toBe(2);
    expect(clusterCount(reconnecting)).toBe(2);
  });

  it('keeps hysteresis across a durable device socket replacement and full absence', () => {
    const initial = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: participants([0, 75]),
    });
    const absent = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: [participants([0])[0]],
      previousKnownDurablePairs: initial.knownDurablePairs,
      previousTogetherDurablePairs: initial.togetherDurablePairs,
    });
    const reconnected = planClubLiveExploreClusters({
      generationKey: 'ride-1',
      participants: [
        participants([0])[0],
        { id: 'replacement-socket', durableIdentity: 'device-2', distanceMeters: 75 },
      ],
      previousKnownDurablePairs: absent.knownDurablePairs,
      previousTogetherDurablePairs: absent.togetherDurablePairs,
    });
    expect(clusterCount(initial)).toBe(1);
    expect(clusterCount(reconnected)).toBe(1);
  });
});
