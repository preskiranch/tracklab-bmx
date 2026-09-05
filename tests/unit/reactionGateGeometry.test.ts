import { describe, expect, it } from 'vitest';
import {
  projectReactionGateQuad,
  projectReactionGateWorldPoint,
  projectReactionGateWorldPointHomogeneous,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_SOURCE_QUAD,
  REACTION_GATE_WORLD_WIDTH,
  reactionGateWorldQuad,
  type ReactionGateWorldPoint,
} from '../../src/lib/reactionGateGeometry';

// Includes the required quarter-drop poses plus every intermediate hundredth.
const denseProgressSamples = Array.from({ length: 101 }, (_, index) => index / 100);

function distance(first: ReactionGateWorldPoint, second: ReactionGateWorldPoint) {
  return Math.hypot(
    first.across - second.across,
    first.upright - second.upright,
    first.downhill - second.downhill,
  );
}

function subtract(first: ReactionGateWorldPoint, second: ReactionGateWorldPoint) {
  return {
    across: first.across - second.across,
    downhill: first.downhill - second.downhill,
    upright: first.upright - second.upright,
  };
}

function dot(first: ReactionGateWorldPoint, second: ReactionGateWorldPoint) {
  return (first.across * second.across)
    + (first.downhill * second.downhill)
    + (first.upright * second.upright);
}

function cross(first: ReactionGateWorldPoint, second: ReactionGateWorldPoint) {
  return {
    across: (first.downhill * second.upright) - (first.upright * second.downhill),
    downhill: (first.upright * second.across) - (first.across * second.upright),
    upright: (first.across * second.downhill) - (first.downhill * second.across),
  };
}

function gateWorldPoint(progress: number, across: number, depth: number): ReactionGateWorldPoint {
  const angle = progress * (Math.PI / 2);
  return {
    across,
    downhill: depth * Math.sin(angle),
    upright: depth * Math.cos(angle),
  };
}

function distanceFromProjectedLine(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const lineX = end.x - start.x;
  const lineY = end.y - start.y;
  return Math.abs(
    (lineX * (point.y - start.y)) - (lineY * (point.x - start.x)),
  ) / Math.hypot(lineX, lineY);
}

describe('Reaction Test rigid gate geometry', () => {
  it('rotates one unchanged eight-lane rectangle around one fixed hinge', () => {
    const reference = reactionGateWorldQuad(0);
    const referenceDistances = reference.flatMap((point, firstIndex) => (
      reference.slice(firstIndex + 1).map((other) => distance(point, other))
    ));
    for (const progress of denseProgressSamples) {
      const [farFree, nearFree, nearHinge, farHinge] = reactionGateWorldQuad(progress);
      const points = [farFree, nearFree, nearHinge, farHinge];
      const pairwiseDistances = points.flatMap((point, firstIndex) => (
        points.slice(firstIndex + 1).map((other) => distance(point, other))
      ));
      pairwiseDistances.forEach((measurement, index) => {
        expect(measurement).toBeCloseTo(referenceDistances[index], 12);
      });
      expect(distance(farFree, farHinge)).toBeCloseTo(1, 12);
      expect(distance(nearFree, nearHinge)).toBeCloseTo(1, 12);
      expect(distance(farFree, nearFree)).toBeCloseTo(REACTION_GATE_WORLD_WIDTH, 12);
      expect(distance(farHinge, nearHinge)).toBeCloseTo(REACTION_GATE_WORLD_WIDTH, 12);
      expect(distance(farFree, nearHinge)).toBeCloseTo(
        Math.hypot(REACTION_GATE_WORLD_WIDTH, 1),
        12,
      );
      expect(nearHinge).toEqual({
        across: REACTION_GATE_WORLD_WIDTH,
        upright: 0,
        downhill: 0,
      });
      expect(farHinge).toEqual({ across: 0, upright: 0, downhill: 0 });

      // Both halves of the rendered leaf must be the same plane. This catches
      // the former endpoint morph, which sheared its two texture triangles by
      // different amounts as the gate dropped.
      const acrossEdge = subtract(nearFree, farFree);
      const farDepthEdge = subtract(farHinge, farFree);
      const firstTriangleNormal = cross(acrossEdge, subtract(nearHinge, farFree));
      const secondTriangleNormal = cross(subtract(nearHinge, farFree), farDepthEdge);
      expect(dot(acrossEdge, farDepthEdge)).toBeCloseTo(0, 12);
      expect(dot(firstTriangleNormal, secondTriangleNormal)).toBeCloseTo(
        Math.hypot(
          firstTriangleNormal.across,
          firstTriangleNormal.downhill,
          firstTriangleNormal.upright,
        ) * Math.hypot(
          secondTriangleNormal.across,
          secondTriangleNormal.downhill,
          secondTriangleNormal.upright,
        ),
        10,
      );
      expect(dot(firstTriangleNormal, subtract(farHinge, farFree))).toBeCloseTo(0, 12);

      // The across coordinates are the physical painted-line constraint. The
      // elevated free edge can project above a ground stripe while upright,
      // but it may never widen beyond either side of the eight-lane footprint.
      for (const point of points) {
        expect(point.across).toBeGreaterThanOrEqual(0);
        expect(point.across).toBeLessThanOrEqual(REACTION_GATE_WORLD_WIDTH);
      }
    }
  });

  it('reproduces the approved upright crop and keeps the projected hinge fixed', () => {
    const upright = projectReactionGateQuad(0);
    upright.forEach((point, index) => {
      expect(point.x).toBeCloseTo(REACTION_GATE_SOURCE_QUAD[index].x, 5);
      expect(point.y).toBeCloseTo(REACTION_GATE_SOURCE_QUAD[index].y, 5);
    });
    const hinge = upright.slice(2);
    for (const progress of denseProgressSamples.slice(1)) {
      const projected = projectReactionGateQuad(progress);
      expect(projected.slice(2)).toEqual(hinge);
    }
  });

  it('projects one continuous plane with no texture kink at either triangle', () => {
    for (const progress of denseProgressSamples) {
      // These lines deliberately cross the renderer's 0 -> 2 triangle split.
      // A single perspective plane keeps every sample collinear. The removed
      // two-affine-triangle implementation deviated by as much as 19 px.
      for (const [startLocal, endLocal] of [
        [{ across: 0, depth: 0.2 }, { across: REACTION_GATE_WORLD_WIDTH, depth: 0.8 }],
        [{ across: 0, depth: 0.72 }, { across: REACTION_GATE_WORLD_WIDTH, depth: 0.28 }],
        [{ across: 1.1, depth: 0 }, { across: 6.9, depth: 1 }],
      ] as const) {
        const start = projectReactionGateWorldPoint(
          gateWorldPoint(progress, startLocal.across, startLocal.depth),
        );
        const end = projectReactionGateWorldPoint(
          gateWorldPoint(progress, endLocal.across, endLocal.depth),
        );
        for (const amount of [0.125, 0.25, 0.5, 0.75, 0.875]) {
          const point = projectReactionGateWorldPoint(gateWorldPoint(
            progress,
            startLocal.across + ((endLocal.across - startLocal.across) * amount),
            startLocal.depth + ((endLocal.depth - startLocal.depth) * amount),
          ));
          expect(distanceFromProjectedLine(point, start, end)).toBeLessThan(0.000001);
        }
      }
    }
  });

  it('keeps every sampled projection finite, front-facing, and convex', () => {
    for (const progress of denseProgressSamples) {
      const world = reactionGateWorldQuad(progress);
      const homogeneous = world.map(projectReactionGateWorldPointHomogeneous);
      for (const point of homogeneous) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(Number.isFinite(point.w)).toBe(true);
        expect(point.w).toBeGreaterThan(0.1);
      }
      const projected = projectReactionGateQuad(progress);
      const turns = projected.map((point, index) => {
        const next = projected[(index + 1) % projected.length];
        const afterNext = projected[(index + 2) % projected.length];
        return ((next.x - point.x) * (afterNext.y - next.y))
          - ((next.y - point.y) * (afterNext.x - next.x));
      });
      expect(turns.every((turn) => turn > 1_000)).toBe(true);
    }
  });

  it('settles inside both painted lane boundaries without twisting', () => {
    const upperBoundaryY = (x: number) => 150.7 + (0.37044 * x);
    const lowerBoundaryY = (x: number) => 879 + ((x - 1147) * ((941 - 879) / (1490 - 1147)));
    for (const point of REACTION_GATE_FLUSH_QUAD.slice(0, 2)) {
      expect(point.y - upperBoundaryY(point.x)).toBeGreaterThan(10);
      expect(lowerBoundaryY(point.x) - point.y).toBeGreaterThan(10);
    }
    const turns = REACTION_GATE_FLUSH_QUAD.map((point, index) => {
      const next = REACTION_GATE_FLUSH_QUAD[(index + 1) % REACTION_GATE_FLUSH_QUAD.length];
      const afterNext = REACTION_GATE_FLUSH_QUAD[(index + 2) % REACTION_GATE_FLUSH_QUAD.length];
      return ((next.x - point.x) * (afterNext.y - next.y))
        - ((next.y - point.y) * (afterNext.x - next.x));
    });
    expect(turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0)).toBe(true);
  });
});
