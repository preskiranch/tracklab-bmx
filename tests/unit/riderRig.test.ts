import { describe, expect, it } from 'vitest';
import {
  riderCrankPedalPositions,
  riderLegKnee,
  riderRigGeometry,
} from '../../src/lib/riderRig';

describe('rider crank and leg rig', () => {
  it('keeps opposite crank arms exactly 180 degrees apart', () => {
    for (const angle of [0, Math.PI / 3, Math.PI, Math.PI * 1.75]) {
      const pedals = riderCrankPedalPositions(angle);
      expect((pedals.front.x + pedals.rear.x) / 2).toBeCloseTo(riderRigGeometry.crankCenter.x);
      expect((pedals.front.y + pedals.rear.y) / 2).toBeCloseTo(riderRigGeometry.crankCenter.y);
      expect(Math.hypot(
        pedals.front.x - riderRigGeometry.crankCenter.x,
        pedals.front.y - riderRigGeometry.crankCenter.y,
      )).toBeCloseTo(riderRigGeometry.crankRadius);
    }
  });

  it('uses a level, horizontal crank at the coast angle', () => {
    const pedals = riderCrankPedalPositions(0);
    expect(pedals.front.y).toBeCloseTo(pedals.rear.y);
    expect(pedals.front.x).toBeGreaterThan(riderRigGeometry.crankCenter.x);
    expect(pedals.rear.x).toBeLessThan(riderRigGeometry.crankCenter.x);
  });

  it('keeps the knee linked to the hip and pedal through a full rotation', () => {
    for (let step = 0; step < 24; step += 1) {
      const pedal = riderCrankPedalPositions((step / 24) * Math.PI * 2).front;
      const knee = riderLegKnee(riderRigGeometry.frontHip, pedal);
      expect(Math.hypot(
        knee.x - riderRigGeometry.frontHip.x,
        knee.y - riderRigGeometry.frontHip.y,
      )).toBeCloseTo(riderRigGeometry.thighLength, 3);
      expect(Math.hypot(knee.x - pedal.x, knee.y - pedal.y)).toBeCloseTo(
        riderRigGeometry.shinLength,
        3,
      );
      expect(knee.x).toBeGreaterThan(riderRigGeometry.frontHip.x);
    }
  });
});
