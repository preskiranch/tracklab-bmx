import { describe, expect, it } from 'vitest';
import {
  projectReactionGateQuad,
  projectReactionGateWorldPoint,
  projectReactionGateWorldPointHomogeneous,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_RADIUS,
  REACTION_GATE_SOURCE_QUAD,
  REACTION_GATE_WORLD_WIDTH,
  reactionGateBodyArc,
  reactionGateBodySection,
  reactionGateWorldPoint,
  reactionGateWorldQuad,
  rotateReactionGateWorldPoint,
  type ReactionGateWorldPoint,
} from '../../src/lib/reactionGateGeometry';

const progressSamples = Array.from({ length: 101 }, (_, index) => index / 100);
const ends = [0, 8];
const distance = (a: ReactionGateWorldPoint, b: ReactionGateWorldPoint) => Math.hypot(
  a.across - b.across, a.downhill - b.downhill, a.upright - b.upright,
);
const sectionArea = (points: ReactionGateWorldPoint[]) => Math.abs(points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length];
  return sum + a.downhill * b.upright - a.upright * b.downhill;
}, 0)) / 2;

describe('Reaction Test native gate geometry', () => {
  it('keeps the eight-unit mesh rigid, rectangular, planar, and hinged throughout the drop', () => {
    expect(REACTION_GATE_WORLD_WIDTH).toBe(8);
    expect(REACTION_GATE_RADIUS).toBe(1);
    const reference = reactionGateWorldQuad(0);
    for (const progress of progressSamples) {
      const quad = reactionGateWorldQuad(progress);
      const [farFree, nearFree, nearHinge, farHinge] = quad;
      expect(nearHinge).toEqual({ across: 0, downhill: 0, upright: 0 });
      expect(farHinge).toEqual({ across: 8, downhill: 0, upright: 0 });
      quad.forEach((point, i) => quad.slice(i + 1).forEach((other, j) => {
        expect(distance(point, other)).toBeCloseTo(distance(reference[i], reference[i + j + 1]), 12);
      }));
      expect(distance(farFree, nearFree)).toBeCloseTo(8, 12);
      expect(distance(nearFree, nearHinge)).toBeCloseTo(1, 12);
      expect(distance(farFree, nearHinge)).toBeCloseTo(Math.hypot(8, 1), 12);
      for (const across of [0, 1.25, 4, 6.75, 8]) {
        for (const radius of [0, 0.2, 0.6, 1]) {
          const point = reactionGateWorldPoint(across, radius, progress);
          expect(point.across).toBe(across);
          expect(distance(point, { across, downhill: 0, upright: 0 })).toBeCloseTo(radius, 12);
          // Every grille point lies in the same plane through the fixed hinge.
          expect(point.downhill * nearFree.upright - point.upright * nearFree.downhill)
            .toBeCloseTo(0, 12);
        }
      }
    }
  });

  it('rotates the rounded shell and mesh as one rigid assembly without an end overhang', () => {
    const original = ends.flatMap((across) => [
      { across, downhill: 0, upright: 1 },
      { across, downhill: Math.SQRT1_2, upright: Math.SQRT1_2 },
      { across, downhill: 1, upright: 0 },
    ]);
    for (const progress of progressSamples) {
      const rotated = original.map((point) => rotateReactionGateWorldPoint(point, progress));
      rotated.forEach((point, i) => {
        expect(point.across).toBe(original[i].across);
        expect(Math.hypot(point.downhill, point.upright)).toBeCloseTo(1, 12);
        rotated.slice(i + 1).forEach((other, j) => {
          expect(distance(point, other)).toBeCloseTo(distance(original[i], original[i + j + 1]), 12);
        });
      });
      for (const across of ends) {
        const meshTop = reactionGateWorldPoint(across, 1, progress);
        const rotatedTop = rotated[across === 0 ? 0 : 3];
        expect(distance(meshTop, rotatedTop)).toBeCloseTo(0, 12);
        for (const point of reactionGateBodySection(progress, across)) {
          expect(point.across).toBe(across);
        }
      }
    }
  });

  it('clips the equal-radius quarter-round body at ground level until fully recessed', () => {
    let previousArea = Infinity;
    for (const progress of progressSamples.slice(0, -1)) {
      for (const across of ends) {
        const arc = reactionGateBodyArc(progress, across, 64);
        const section = reactionGateBodySection(progress, across, 64);
        expect(arc.length).toBeGreaterThan(1);
        expect(section[0]).toEqual({ across, downhill: 0, upright: 0 });
        expect(section.slice(1)).toEqual(arc);
        expect(distance(arc[0], reactionGateWorldPoint(across, 1, progress))).toBeCloseTo(0, 12);
        expect(distance(arc[arc.length - 1], { across, downhill: 1, upright: 0 })).toBeCloseTo(0, 12);
        for (const point of arc) {
          expect(point.upright).toBeGreaterThanOrEqual(0);
          expect(point.downhill).toBeGreaterThanOrEqual(0);
          expect(Math.hypot(point.downhill, point.upright)).toBeCloseTo(1, 12);
        }
        const area = sectionArea(section);
        expect(Math.abs(area - (Math.PI / 4) * (1 - progress))).toBeLessThan(0.0002);
        if (across === 0) {
          expect(area).toBeLessThan(previousArea);
          previousArea = area;
        }
      }
    }
    for (const across of ends) {
      expect(reactionGateBodyArc(1, across)).toEqual([]);
      expect(reactionGateBodySection(1, across)).toEqual([]);
    }
  });

  it('uses the corrected photograph anchors and keeps both projected hinges stationary', () => {
    const expected = [
      { x: 656 * 1672 / 1280, y: 298 * 941 / 720 },
      { x: 764 * 1672 / 1280, y: 461 * 941 / 720 },
      { x: 712 * 1672 / 1280, y: 610 * 941 / 720 },
      { x: 639 * 1672 / 1280, y: 354 * 941 / 720 },
    ];
    REACTION_GATE_SOURCE_QUAD.forEach((point, i) => {
      expect(point.x).toBeCloseTo(expected[i].x, 9);
      expect(point.y).toBeCloseTo(expected[i].y, 9);
    });
    for (const progress of progressSamples) {
      projectReactionGateQuad(progress).slice(2).forEach((point, i) => {
        expect(point.x).toBeCloseTo(expected[i + 2].x, 9);
        expect(point.y).toBeCloseTo(expected[i + 2].y, 9);
      });
    }
  });

  it('projects straight grille lines continuously with finite homogeneous coordinates', () => {
    for (const progress of progressSamples) {
      for (const [startRadius, endRadius] of [[0, 0], [1, 1], [0.2, 0.8], [0.75, 0.25]]) {
        const start = projectReactionGateWorldPoint(reactionGateWorldPoint(0, startRadius, progress));
        const end = projectReactionGateWorldPoint(reactionGateWorldPoint(8, endRadius, progress));
        for (const fraction of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
          const world = reactionGateWorldPoint(8 * fraction, startRadius + (endRadius - startRadius) * fraction, progress);
          const homogeneous = projectReactionGateWorldPointHomogeneous(world);
          expect(Object.values(homogeneous).every(Number.isFinite)).toBe(true);
          expect(homogeneous.w).toBeCloseTo(1 + 0.2232254223834902 * world.across - 0.04297539403560494 * world.upright, 12);
          expect(homogeneous.w).toBeGreaterThan(0);
          const point = projectReactionGateWorldPoint(world);
          const deviation = Math.abs((end.x - start.x) * (point.y - start.y)
            - (end.y - start.y) * (point.x - start.x)) / Math.hypot(end.x - start.x, end.y - start.y);
          expect(deviation).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('finishes exactly flush across the full width and one-unit receiving footprint', () => {
    expect(reactionGateWorldQuad(1)).toEqual([
      { across: 8, downhill: 1, upright: 0 },
      { across: 0, downhill: 1, upright: 0 },
      { across: 0, downhill: 0, upright: 0 },
      { across: 8, downhill: 0, upright: 0 },
    ]);
    for (const across of [0, 2, 4, 6, 8]) {
      for (const radius of [0, 0.25, 0.5, 0.75, 1]) {
        expect(reactionGateWorldPoint(across, radius, 1)).toEqual({ across, downhill: radius, upright: 0 });
      }
    }
    const expected = [
      { x: 907.8414105747314, y: 480.4858258484388 },
      { x: 868 * 1672 / 1280, y: 648 * 941 / 720 },
      { x: 712 * 1672 / 1280, y: 610 * 941 / 720 },
      { x: 639 * 1672 / 1280, y: 354 * 941 / 720 },
    ];
    REACTION_GATE_FLUSH_QUAD.forEach((point, i) => {
      expect(point.x).toBeCloseTo(expected[i].x, 9);
      expect(point.y).toBeCloseTo(expected[i].y, 9);
    });
  });
});
