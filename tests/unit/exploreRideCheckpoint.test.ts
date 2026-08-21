import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearExploreRideCheckpoint,
  createExploreRideSessionArm,
  createExploreRideStudioBinding,
  exploreRideSessionArmMatches,
  loadExploreRideCheckpoint,
  saveExploreRideCheckpoint,
} from '../../src/lib/exploreRideCheckpoint';
import type { ExploreRider, ExploreRoute, PlayerSlot } from '../../src/types';

function route(): ExploreRoute {
  return {
    id: 'EXPLORE-RESUME-1',
    name: 'Halfway home',
    origin: { lat: 38.5, lng: -121.5 },
    destination: { lat: 38.6, lng: -121.4 },
    originLabel: 'TrackLab',
    destinationLabel: 'Home',
    travelMode: 'bicycle',
    distanceMeters: 10_000,
    durationSeconds: 1_800,
    encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    createdAt: 1_700_000_000_000,
  };
}

function rider(distanceMeters = 5_125): ExploreRider {
  return {
    id: 'local:1',
    clientId: 'local',
    playerId: 1,
    riderId: 'athlete-a',
    name: 'Rider One',
    colorName: 'lime',
    accent: '#b7ff33',
    distanceMeters,
    velocityMps: 7.4,
    cadence: 83,
    watts: 312,
    signal: 0.94,
    recommendedAirSetting: 3,
    finishedAt: null,
    at: 1_700_000_123_000,
  };
}

function player(): PlayerSlot {
  return {
    id: 1,
    riderId: 'athlete-a',
    name: 'Rider One',
    colorName: 'lime',
    accent: '#b7ff33',
    deviceId: 250_439_950,
    deviceLabel: 'Wattbike 950',
  };
}

function installStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Explore ride checkpoints', () => {
  it('freezes one-to-four rider/player/device snapshots and rejects a changed bike binding', () => {
    const riders = ([1, 2, 3, 4] as const).map((playerId) => ({
      ...rider(1_000 + playerId),
      id: `local:${playerId}`,
      playerId,
      riderId: `athlete-${playerId}`,
      name: `Rider ${playerId}`,
    }));
    const players = riders.map((entry, index): PlayerSlot => ({
      id: entry.playerId,
      riderId: entry.riderId,
      name: entry.name,
      colorName: 'lime',
      accent: '#b7ff33',
      deviceId: 91_001 + index,
      deviceLabel: `Wattbike ${index + 1}`,
    }));
    const arm = createExploreRideSessionArm(route(), riders, players, 1_700_000_000_000, () => 'four-bikes');

    expect(arm?.riderBindings).toHaveLength(4);
    expect(Object.isFrozen(arm)).toBe(true);
    expect(Object.isFrozen(arm?.riderBindings)).toBe(true);
    expect(exploreRideSessionArmMatches(arm!, route(), riders, players)).toBe(true);
    expect(exploreRideSessionArmMatches(arm!, route(), riders, [
      { ...players[0], deviceId: 999_999 },
      ...players.slice(1),
    ])).toBe(false);
  });

  it('treats an empty arm decision as personal and binds only the authorized rider subset', () => {
    installStorage();
    const riders = ([1, 2, 3, 4] as const).map((playerId) => ({
      ...rider(1_000 + playerId),
      id: `local:${playerId}`,
      playerId,
      riderId: `athlete-${playerId}`,
      name: `Rider ${playerId}`,
    }));
    const players = riders.map((entry, index): PlayerSlot => ({
      id: entry.playerId,
      riderId: entry.riderId,
      name: entry.name,
      colorName: 'lime',
      accent: '#b7ff33',
      deviceId: 92_001 + index,
      deviceLabel: `Wattbike ${index + 1}`,
    }));
    const arm = createExploreRideSessionArm(
      route(),
      riders,
      players,
      1_700_000_000_000,
      () => 'authorized-subset',
    )!;

    expect(createExploreRideStudioBinding(arm, null)).toBeNull();
    expect(createExploreRideStudioBinding(arm, undefined)).toBeNull();
    expect(createExploreRideStudioBinding(arm, {
      authorizationGroupId: 'group-unknown-player',
      riders: [{ playerId: 99 as PlayerSlot['id'], authorizationId: 'authorization-99' }],
    })).toBeNull();

    const studioBinding = createExploreRideStudioBinding(arm, {
      authorizationGroupId: 'group-subset',
      riders: [
        { playerId: 2, authorizationId: 'authorization-2' },
        { playerId: 4, authorizationId: 'authorization-4' },
      ],
    });
    expect(studioBinding?.riders.map((binding) => binding.playerId)).toEqual([2, 4]);

    const saved = saveExploreRideCheckpoint('studio-subset', {
      route: route(),
      riders,
      elapsedMs: 500,
      savedAt: 1_700_000_002_000,
      sessionId: arm.sessionId,
      startedAt: 1_700_000_001_000,
      studioBinding: studioBinding!,
    });
    expect(saved?.studioBinding?.riders.map((binding) => binding.playerId)).toEqual([2, 4]);
    expect(loadExploreRideCheckpoint('studio-subset')).toEqual(saved);

    const mismatched = saveExploreRideCheckpoint('studio-subset-mismatch', {
      route: route(),
      riders,
      elapsedMs: 500,
      savedAt: 1_700_000_002_000,
      sessionId: arm.sessionId,
      startedAt: 1_700_000_001_000,
      studioBinding: {
        ...studioBinding!,
        riders: studioBinding!.riders.map((binding, index) => (
          index === 0 ? { ...binding, riderName: 'Different rider' } : binding
        )),
      },
    });
    expect(mismatched?.studioBinding).toBeUndefined();
  });

  it('restores pause/resume clocks plus non-secret studio binding metadata', () => {
    installStorage();
    const sessionArm = createExploreRideSessionArm(
      route(),
      [rider()],
      [player()],
      1_700_000_000_000,
      () => 'studio-group-arm',
    );
    const studioBinding = createExploreRideStudioBinding(sessionArm!, {
      authorizationGroupId: 'group-22',
      riders: [{ playerId: 1, authorizationId: 'authorization-1' }],
    });

    const saved = saveExploreRideCheckpoint('studio-owner', {
      route: route(),
      riders: [rider()],
      elapsedMs: 250,
      savedAt: 1_700_000_001_400,
      sessionId: sessionArm!.sessionId,
      startedAt: 1_700_000_001_000,
      activeClockSegments: [{
        startedAt: 1_700_000_001_000,
        endedAt: 1_700_000_001_100,
        activeElapsedAtStartMs: 0,
      }, {
        startedAt: 1_700_000_001_200,
        endedAt: null,
        activeElapsedAtStartMs: 100,
      }],
      studioBinding: studioBinding!,
    });

    expect(saved).toMatchObject({
      sessionId: 'explore:studio-group-arm',
      activeClockSegments: [{
        startedAt: 1_700_000_001_000,
        endedAt: 1_700_000_001_100,
        activeElapsedAtStartMs: 0,
      }, {
        startedAt: 1_700_000_001_200,
        endedAt: 1_700_000_001_400,
        activeElapsedAtStartMs: 100,
      }],
      studioBinding: {
        authorizationGroupId: 'group-22',
        riders: [{
          authorizationId: 'authorization-1',
          playerId: 1,
          riderId: 'athlete-a',
          riderName: 'Rider One',
          deviceId: 250_439_950,
          deviceLabel: 'Wattbike 950',
        }],
      },
    });
    expect(loadExploreRideCheckpoint('studio-owner')).toEqual(saved);
  });

  it('allow-lists checkpoint authorization metadata and never serializes a token', () => {
    const values = installStorage();
    const sessionArm = createExploreRideSessionArm(route(), [rider()], [player()], 1_700_000_000_000, () => 'no-token');
    const safeBinding = createExploreRideStudioBinding(sessionArm!, {
      authorizationGroupId: 'group-safe',
      riders: [{ playerId: 1, authorizationId: 'authorization-safe' }],
    })!;
    const studioBinding = {
      ...safeBinding,
      token: 'DO-NOT-PERSIST-GROUP-TOKEN',
      riders: [{
        ...safeBinding.riders[0],
        authorizationId: 'authorization-safe',
        bearerToken: 'DO-NOT-PERSIST-RIDER-TOKEN',
      }],
    };

    saveExploreRideCheckpoint('studio-token-test', {
      route: route(),
      riders: [rider()],
      elapsedMs: 500,
      savedAt: 1_700_000_001_500,
      sessionId: sessionArm!.sessionId,
      startedAt: 1_700_000_001_000,
      studioBinding,
    });

    const serialized = [...values.values()].join('\n');
    expect(serialized).toContain('authorization-safe');
    expect(serialized).not.toContain('DO-NOT-PERSIST');
    expect(serialized).not.toMatch(/bearerToken|"token"/u);
  });

  it('restores an unfinished ride only inside the same rider or tablet-athlete scope', () => {
    installStorage();
    const saved = saveExploreRideCheckpoint('athlete-a@example.com', {
      route: route(),
      riders: [rider()],
      elapsedMs: 742_500,
      savedAt: 1_700_000_124_000,
      sessionId: 'explore:EXPLORE-RESUME-1:1699999381500',
      startedAt: 1_699_999_381_500,
      activeClockSegments: [{
        startedAt: 1_699_999_381_500,
        endedAt: null,
        activeElapsedAtStartMs: 0,
      }],
    });

    expect(saved).toMatchObject({
      version: 1,
      elapsedMs: 742_500,
      route: { id: 'EXPLORE-RESUME-1' },
      riders: [{ distanceMeters: 5_125, watts: 312 }],
      sessionId: 'explore:EXPLORE-RESUME-1:1699999381500',
      startedAt: 1_699_999_381_500,
      activeClockSegments: [{
        startedAt: 1_699_999_381_500,
        endedAt: 1_700_000_124_000,
        activeElapsedAtStartMs: 0,
      }],
    });
    expect(loadExploreRideCheckpoint('athlete-a@example.com')).toEqual(saved);
    expect(loadExploreRideCheckpoint('athlete-b@example.com')).toBeNull();
  });

  it('does not restore corrupt or already-completed rides', () => {
    const values = installStorage();
    values.set('tracklab-explore-ride-checkpoint-v1:broken', '{nope');
    expect(loadExploreRideCheckpoint('broken')).toBeNull();
    values.set('tracklab-explore-ride-checkpoint-v1:future', JSON.stringify({
      version: 2,
      route: route(),
      riders: [rider()],
      elapsedMs: 100,
      savedAt: 1_700_000_124_000,
    }));
    expect(loadExploreRideCheckpoint('future')).toBeNull();

    expect(saveExploreRideCheckpoint('finished', {
      route: route(),
      riders: [rider(10_000)],
      elapsedMs: 900_000,
      savedAt: 1_700_000_124_000,
    })).toBeNull();
    expect(loadExploreRideCheckpoint('finished')).toBeNull();
  });

  it('clears the saved ride when the rider resets it', () => {
    installStorage();
    saveExploreRideCheckpoint('athlete-a', {
      route: route(),
      riders: [rider()],
      elapsedMs: 742_500,
      savedAt: 1_700_000_124_000,
    });

    clearExploreRideCheckpoint('athlete-a');

    expect(loadExploreRideCheckpoint('athlete-a')).toBeNull();
  });
});
