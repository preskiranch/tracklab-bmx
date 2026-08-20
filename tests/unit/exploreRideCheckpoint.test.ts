import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearExploreRideCheckpoint,
  loadExploreRideCheckpoint,
  saveExploreRideCheckpoint,
} from '../../src/lib/exploreRideCheckpoint';
import type { ExploreRider, ExploreRoute } from '../../src/types';

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
  it('restores an unfinished ride only inside the same rider or tablet-athlete scope', () => {
    installStorage();
    const saved = saveExploreRideCheckpoint('athlete-a@example.com', {
      route: route(),
      riders: [rider()],
      elapsedMs: 742_500,
      savedAt: 1_700_000_124_000,
    });

    expect(saved).toMatchObject({
      version: 1,
      elapsedMs: 742_500,
      route: { id: 'EXPLORE-RESUME-1' },
      riders: [{ distanceMeters: 5_125, watts: 312 }],
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
