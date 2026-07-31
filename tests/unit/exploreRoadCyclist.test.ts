import { describe, expect, it } from 'vitest';
import {
  exploreRoadCyclistGeometry,
  exploreRoadCyclistLegPoints,
  exploreRoadCyclistPedalPositions,
  exploreRoadCyclistRotationDegrees,
  exploreRoadCyclistWheelRotationDegrees,
} from '../../src/lib/exploreRoadCyclist';

describe('Explore the World road cyclist rig', () => {
  it('tilts uphill, level, and downhill by the real road angle', () => {
    expect(exploreRoadCyclistRotationDegrees(0)).toBeCloseTo(0);
    expect(exploreRoadCyclistRotationDegrees(10)).toBeCloseTo(-5.7106, 3);
    expect(exploreRoadCyclistRotationDegrees(-10)).toBeCloseTo(5.7106, 3);
  });

  it('moves opposite pedals through a complete 360-degree crank rotation', () => {
    const phases = [0, 0.25, 0.5, 0.75];
    const frontPositions = phases.map((phase) => exploreRoadCyclistPedalPositions(phase).front);
    expect(frontPositions[0].x).toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.x + 8);
    expect(frontPositions[1].y).toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.y + 8);
    expect(frontPositions[2].x).toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.x - 8);
    expect(frontPositions[3].y).toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.y - 8);

    phases.forEach((phase) => {
      const pedals = exploreRoadCyclistPedalPositions(phase);
      expect((pedals.front.x + pedals.rear.x) / 2)
        .toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.x);
      expect((pedals.front.y + pedals.rear.y) / 2)
        .toBeCloseTo(exploreRoadCyclistGeometry.crankCenter.y);
    });
  });

  it('keeps both knees linked to their hips and pedals during the full cycle', () => {
    for (let step = 0; step < 24; step += 1) {
      const legs = exploreRoadCyclistLegPoints(step / 24);
      for (const leg of [legs.front, legs.rear]) {
        expect(Math.hypot(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y)).toBeCloseTo(25);
        expect(Math.hypot(leg.knee.x - leg.pedal.x, leg.knee.y - leg.pedal.y)).toBeCloseTo(25);
      }
    }
  });

  it('rotates road-bike wheels from traveled distance', () => {
    expect(exploreRoadCyclistWheelRotationDegrees(0)).toBe(0);
    expect(exploreRoadCyclistWheelRotationDegrees(2.096)).toBeCloseTo(0);
    expect(exploreRoadCyclistWheelRotationDegrees(1.048)).toBeCloseTo(180);
  });
});
