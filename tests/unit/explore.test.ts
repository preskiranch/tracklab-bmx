import { describe, expect, it } from 'vitest';
import {
  decodeGooglePolyline,
  exploreCameraOffsetMeters,
  exploreGridClass,
  exploreRoutePoint,
  groupExploreRiders,
  smoothExploreCameraPoint,
  smoothExploreHeading,
} from '../../src/lib/explore';
import { exploreBikeAudioMode } from '../../src/lib/bikeRaceAudio';
import { formatExploreDistanceMeters } from '../../src/units';
import type { ExploreRider } from '../../src/types';

function rider(id: number, distanceMeters: number): ExploreRider {
  return {
    id: `client:${id}`,
    clientId: 'client',
    playerId: id,
    name: `Rider ${id}`,
    colorName: 'lime',
    accent: '#65d636',
    distanceMeters,
    velocityMps: 8,
    cadence: 90,
    watts: 400,
    signal: 0.9,
    finishedAt: null,
    at: Date.now(),
  };
}

describe('Explore route geometry', () => {
  it('decodes Google encoded polylines and follows them by route progress', () => {
    const points = decodeGooglePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);

    expect(exploreRoutePoint(points, 0, 1_000)).toEqual(points[0]);
    expect(exploreRoutePoint(points, 1_000, 1_000)).toEqual(points[2]);
  });
});

describe('Explore mileage display', () => {
  it('always uses miles or kilometers instead of short-distance feet or meters', () => {
    expect(formatExploreDistanceMeters(1_000, 'mi')).toBe('0.62 mi');
    expect(formatExploreDistanceMeters(1_000, 'km')).toBe('1.00 km');
    expect(formatExploreDistanceMeters(16_093.44, 'mi')).toBe('10.0 mi');
  });
});

describe('Explore automatic map layouts', () => {
  it('keeps nearby riders together', () => {
    const groups = groupExploreRiders([
      rider(1, 100),
      rider(2, 115),
      rider(3, 130),
      rider(4, 145),
    ]);
    expect(groups.map((group) => group.riders.length)).toEqual([4]);
    expect(exploreGridClass(groups.length)).toBe('explore-map-grid single');
  });

  it('creates the requested 3+1 and 2+2 split views', () => {
    const threeAndOne = groupExploreRiders([
      rider(1, 500),
      rider(2, 510),
      rider(3, 520),
      rider(4, 100),
    ]);
    expect(threeAndOne.map((group) => group.riders.length)).toEqual([3, 1]);
    expect(exploreGridClass(threeAndOne.length)).toBe('explore-map-grid split');

    const twoAndTwo = groupExploreRiders([
      rider(1, 500),
      rider(2, 515),
      rider(3, 100),
      rider(4, 110),
    ]);
    expect(twoAndTwo.map((group) => group.riders.length)).toEqual([2, 2]);
    expect(exploreGridClass(twoAndTwo.length)).toBe('explore-map-grid split');
  });

  it('creates four maps when every rider is separated', () => {
    const groups = groupExploreRiders([
      rider(1, 0),
      rider(2, 100),
      rider(3, 200),
      rider(4, 300),
    ]);
    expect(groups.map((group) => group.riders.length)).toEqual([1, 1, 1, 1]);
    expect(exploreGridClass(groups.length)).toBe('explore-map-grid four-way');
  });
});

describe('Explore follow camera', () => {
  it('eases toward live rider positions instead of jumping to each update', () => {
    const current = { lat: 37.795, lng: -122.394 };
    const target = { lat: 37.805, lng: -122.384 };
    const firstFrame = smoothExploreCameraPoint(current, target, 16);
    const laterFrame = smoothExploreCameraPoint(current, target, 180);

    expect(firstFrame.lat).toBeGreaterThan(current.lat);
    expect(firstFrame.lat).toBeLessThan(target.lat);
    expect(laterFrame.lat).toBeGreaterThan(firstFrame.lat);
    expect(laterFrame.lng).toBeGreaterThan(firstFrame.lng);
    expect(smoothExploreCameraPoint(current, target, 0)).toEqual(current);
  });

  it('frames ahead or behind while keeping close zoom offsets on-screen', () => {
    expect(exploreCameraOffsetMeters('center', 18)).toBe(0);
    expect(exploreCameraOffsetMeters('ahead', 18)).toBe(60);
    expect(exploreCameraOffsetMeters('behind', 18)).toBe(-60);
    expect(exploreCameraOffsetMeters('ahead', 20)).toBe(18);
    expect(exploreCameraOffsetMeters('behind', 12)).toBe(-400);
  });

  it('turns direction-up camera headings along the shortest arc', () => {
    const next = smoothExploreHeading(350, 10, 120);
    expect(next).toBeGreaterThan(350);
    expect(smoothExploreHeading(20, 340, 120)).toBeLessThan(20);
    expect(smoothExploreHeading(90, 270, 0)).toBe(90);
  });
});

describe('Explore bike mechanics audio', () => {
  it('uses pedaling audio with cadence and freewheel audio while coasting', () => {
    expect(exploreBikeAudioMode('riding', {
      cadence: 92,
      velocityMps: 8,
      finishedAt: null,
    })).toBe('pedaling');
    expect(exploreBikeAudioMode('riding', {
      cadence: 0,
      velocityMps: 7,
      finishedAt: null,
    })).toBe('freewheel');
  });

  it('stays silent before, while paused, and after an Explore ride', () => {
    expect(exploreBikeAudioMode('ready', {
      cadence: 92,
      velocityMps: 8,
      finishedAt: null,
    })).toBe('silent');
    expect(exploreBikeAudioMode('paused', {
      cadence: 0,
      velocityMps: 8,
      finishedAt: null,
    })).toBe('silent');
    expect(exploreBikeAudioMode('finished', {
      cadence: 0,
      velocityMps: 0,
      finishedAt: Date.now(),
    })).toBe('silent');
  });
});
