import { describe, expect, it } from 'vitest';
import {
  decodeGooglePolyline,
  exploreAverageSpeedMph,
  exploreCameraOffsetMeters,
  exploreDemoMaximumCruiseMph,
  exploreDemoMinimumCruiseMph,
  exploreDemoRiderMotion,
  exploreGridClass,
  exploreLiveDriveActive,
  exploreRoutePoint,
  groupExploreRiders,
  smoothExploreCameraPoint,
  smoothExploreHeading,
  stepExploreLiveVelocity,
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

  it('calculates average MPH from active riding time', () => {
    expect(exploreAverageSpeedMph(1_609.344, 60 * 60 * 1_000)).toBeCloseTo(1, 5);
    expect(exploreAverageSpeedMph(0, 1_000)).toBe(0);
    expect(exploreAverageSpeedMph(100, 0)).toBe(0);
  });
});

describe('Explore demo rider pacing', () => {
  it('launches naturally from zero before reaching a controlled cruise', () => {
    const stopped = exploreDemoRiderMotion(1, 0);
    const rolling = exploreDemoRiderMotion(1, 2);
    const accelerating = exploreDemoRiderMotion(1, 5);

    expect(stopped.speedMph).toBe(0);
    expect(rolling.speedMph).toBeGreaterThan(0);
    expect(accelerating.speedMph).toBeGreaterThan(rolling.speedMph);
  });

  it('keeps every rider within a distinct 12 to 18 MPH average cruise profile', () => {
    const averages = [1, 2, 3, 4].map((playerId) => {
      const samples = Array.from(
        { length: 181 },
        (_, index) => exploreDemoRiderMotion(playerId as 1 | 2 | 3 | 4, index + 20).speedMph,
      );
      samples.forEach((speedMph) => {
        expect(speedMph).toBeGreaterThanOrEqual(exploreDemoMinimumCruiseMph);
        expect(speedMph).toBeLessThanOrEqual(exploreDemoMaximumCruiseMph);
      });
      return samples.reduce((total, speedMph) => total + speedMph, 0) / samples.length;
    });

    averages.forEach((averageMph) => {
      expect(averageMph).toBeGreaterThanOrEqual(exploreDemoMinimumCruiseMph);
      expect(averageMph).toBeLessThanOrEqual(exploreDemoMaximumCruiseMph);
    });
    expect(new Set(averages.map((averageMph) => averageMph.toFixed(2))).size).toBe(4);
  });

  it('includes repeatable coasting windows for bike mechanics audio', () => {
    const motions = Array.from(
      { length: 24 },
      (_, index) => exploreDemoRiderMotion(3, index + 10),
    );

    expect(motions.some((motion) => motion.pedaling)).toBe(true);
    expect(motions.some((motion) => !motion.pedaling)).toBe(true);
  });
});

describe('Explore live Wattbike physics', () => {
  it('requires rider power as well as cadence before the Wattbike propels the rider', () => {
    expect(exploreLiveDriveActive(92, 400)).toBe(true);
    expect(exploreLiveDriveActive(92, 0)).toBe(false);
    expect(exploreLiveDriveActive(0, 400)).toBe(false);
  });

  it('accelerates naturally toward the Explore road rollout speed', () => {
    const firstFrame = stepExploreLiveVelocity(0, 8, true, 0.1);
    const nextFrame = stepExploreLiveVelocity(firstFrame, 8, true, 0.1);
    expect(firstFrame).toBeGreaterThan(0);
    expect(firstFrame).toBeLessThan(8);
    expect(nextFrame).toBeGreaterThan(firstFrame);
  });

  it('gradually coasts to a complete stop after pedaling ends', () => {
    const firstCoastFrame = stepExploreLiveVelocity(8, 0, false, 0.1);
    expect(firstCoastFrame).toBeGreaterThan(0);
    expect(firstCoastFrame).toBeLessThan(8);

    let velocity = firstCoastFrame;
    for (let step = 0; step < 1_200; step += 1) {
      const next = stepExploreLiveVelocity(velocity, 0, false, 0.1);
      expect(next).toBeLessThanOrEqual(velocity);
      velocity = next;
    }
    expect(velocity).toBe(0);
  });

  it('slows climbing riders and carries descending riders farther', () => {
    const flatPedaling = stepExploreLiveVelocity(5, 8, true, 0.1, 0);
    const climbing = stepExploreLiveVelocity(5, 8, true, 0.1, 6);
    const flatCoasting = stepExploreLiveVelocity(8, 0, false, 0.1, 0);
    const descending = stepExploreLiveVelocity(8, 0, false, 0.1, -6);

    expect(climbing).toBeLessThan(flatPedaling);
    expect(descending).toBeGreaterThan(flatCoasting);
  });

  it('loses uphill momentum faster and can roll from rest on a descent', () => {
    const flatCoasting = stepExploreLiveVelocity(8, 0, false, 0.1, 0);
    const climbing = stepExploreLiveVelocity(8, 0, false, 0.1, 6);
    const descendingFromRest = stepExploreLiveVelocity(0, 0, false, 0.1, -6);

    expect(climbing).toBeLessThan(flatCoasting);
    expect(descendingFromRest).toBeGreaterThan(0);
  });

  it('builds downhill speed, then sheds it gradually after returning to level ground', () => {
    let downhillVelocity = 8;
    for (let step = 0; step < 50; step += 1) {
      downhillVelocity = stepExploreLiveVelocity(downhillVelocity, 0, false, 0.1, -8);
    }
    expect(downhillVelocity).toBeGreaterThan(8);

    const firstFlatFrame = stepExploreLiveVelocity(downhillVelocity, 0, false, 0.1, 0);
    const secondFlatFrame = stepExploreLiveVelocity(firstFlatFrame, 0, false, 0.1, 0);
    expect(firstFlatFrame).toBeLessThan(downhillVelocity);
    expect(firstFlatFrame).toBeGreaterThan(0);
    expect(secondFlatFrame).toBeLessThan(firstFlatFrame);
  });

  it('keeps long descents within a safe road-bike speed ceiling', () => {
    let velocity = 0;
    for (let step = 0; step < 4_000; step += 1) {
      velocity = stepExploreLiveVelocity(velocity, 0, false, 0.1, -30);
    }
    expect(velocity).toBeLessThanOrEqual(25);
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
