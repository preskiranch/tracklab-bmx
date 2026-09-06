import { describe, expect, it } from 'vitest';
import {
  projectReactionGateQuad,
  REACTION_GATE_SOURCE_QUAD,
  type ReactionGatePoint,
  type ReactionGateQuad,
} from '../../src/lib/reactionGateGeometry';
import {
  createReactionGatePhotoWarp,
  projectReactionGatePhotoPoint,
  type ReactionGatePhotoHomography,
} from '../../src/lib/reactionGatePhotoWarp';

const rectangle: ReactionGateQuad = [
  { x: 100, y: 50 }, { x: 900, y: 50 }, { x: 900, y: 750 }, { x: 100, y: 750 },
];
const expectedProjection = (matrix: ReactionGatePhotoHomography, { x, y }: ReactionGatePoint) => ({
  x: (matrix[0] * x + matrix[1] * y + matrix[2]) / (matrix[6] * x + matrix[7] * y + matrix[8]),
  y: (matrix[3] * x + matrix[4] * y + matrix[5]) / (matrix[6] * x + matrix[7] * y + matrix[8]),
});
const expectPoint = (actual: ReactionGatePoint | null, expected: ReactionGatePoint, precision = 7) => {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, precision);
  expect(actual!.y).toBeCloseTo(expected.y, precision);
};

describe('Reaction gate photo homography', () => {
  it('maps every photographed face corner to its matching corner throughout the drop', () => {
    for (const progress of [0.01, 0.1, 0.3, 0.5, 0.8, 1]) {
      const target = projectReactionGateQuad(progress);
      const warp = createReactionGatePhotoWarp(REACTION_GATE_SOURCE_QUAD, target);
      expect(warp).not.toBeNull();
      REACTION_GATE_SOURCE_QUAD.forEach((point, index) => {
        expectPoint(projectReactionGatePhotoPoint(warp!.homography, point), target[index]);
      });
    }
  });

  it('recovers known perspective mappings for deterministic random interior points', () => {
    const known: ReactionGatePhotoHomography = [1.1, 0.2, 75, -0.15, 0.85, -30, 0.0005, -0.0002, 1];
    const target = rectangle.map((point) => expectedProjection(known, point)) as ReactionGateQuad;
    const warp = createReactionGatePhotoWarp(rectangle, target)!;
    expect(warp).not.toBeNull();
    let seed = 7123;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let index = 0; index < 100; index += 1) {
      const point = { x: 100 + random() * 800, y: 50 + random() * 700 };
      expectPoint(projectReactionGatePhotoPoint(warp.homography, point), expectedProjection(known, point));
      // Independently apply CSS's column-major matrix with z=0, w=1.
      const css = warp.cssTransform.slice('matrix3d('.length, -1).split(',').map(Number);
      const w = css[3] * point.x + css[7] * point.y + css[15];
      expectPoint({
        x: (css[0] * point.x + css[4] * point.y + css[12]) / w,
        y: (css[1] * point.x + css[5] * point.y + css[13]) / w,
      }, expectedProjection(known, point));
    }
  });

  it('supports an invertible homography whose bottom-right coefficient is zero', () => {
    const known: ReactionGatePhotoHomography = [1, 0, 1, 0, 1, 2, 1, 0, 0];
    const source: ReactionGateQuad = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 4 }, { x: 1, y: 4 }];
    const target = source.map((point) => expectedProjection(known, point)) as ReactionGateQuad;
    const warp = createReactionGatePhotoWarp(source, target)!;
    expect(warp).not.toBeNull();
    expectPoint(projectReactionGatePhotoPoint(warp.homography, { x: 2, y: 2.5 }), expectedProjection(known, { x: 2, y: 2.5 }));
    expect(warp.homography[8]).toBeCloseTo(0, 12);
  });

  it('returns exactly identity when the photo quad does not move', () => {
    const warp = createReactionGatePhotoWarp(REACTION_GATE_SOURCE_QUAD, REACTION_GATE_SOURCE_QUAD.map((point) => ({ ...point })) as ReactionGateQuad)!;
    expect(warp.homography).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(warp.cssTransform).toBe('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)');
    expect(projectReactionGatePhotoPoint(warp.homography, { x: 1672, y: 941 })).toEqual({ x: 1672, y: 941 });
  });

  it('still solves finite corner correspondences when the quad center lies on the horizon', () => {
    const known: ReactionGatePhotoHomography = [1, 0, 1, 0, 1, 2, 1, 0, 0];
    const source: ReactionGateQuad = [{ x: -3, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 1 }, { x: -3, y: 1 }];
    const target = source.map((point) => expectedProjection(known, point)) as ReactionGateQuad;
    const warp = createReactionGatePhotoWarp(source, target)!;
    expect(warp).not.toBeNull();
    source.forEach((point, index) => expectPoint(projectReactionGatePhotoPoint(warp.homography, point), target[index]));
    expect(Math.max(...warp.homography.map(Math.abs))).toBeLessThan(2);
  });

  it('handles small quads and large photo offsets without using an absolute area cutoff', () => {
    for (const [offset, scale] of [[0, 1e-7], [1e8, 1]]) {
      const source = rectangle.map(({ x, y }) => ({ x: offset + x * scale, y: offset + y * scale })) as ReactionGateQuad;
      const target = source.map(({ x, y }) => ({ x: x + 25 * scale, y: y - 12 * scale })) as ReactionGateQuad;
      const warp = createReactionGatePhotoWarp(source, target)!;
      expect(warp).not.toBeNull();
      source.forEach((point, index) => expectPoint(projectReactionGatePhotoPoint(warp.homography, point), target[index], offset ? 5 : 12));
    }
  });

  it('rejects repeated, collinear, nonfinite or collapsed corners on either side', () => {
    const invalid: ReactionGateQuad[] = [
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      rectangle.map(() => ({ x: 5, y: 7 })) as ReactionGateQuad,
      [{ x: NaN, y: 0 }, ...rectangle.slice(1)] as ReactionGateQuad,
      [{ x: 0, y: Infinity }, ...rectangle.slice(1)] as ReactionGateQuad,
    ];
    for (const quad of invalid) {
      expect(createReactionGatePhotoWarp(quad, rectangle)).toBeNull();
      expect(createReactionGatePhotoWarp(rectangle, quad)).toBeNull();
      expect(createReactionGatePhotoWarp(quad, quad)).toBeNull();
    }
  });

  it('returns null for points on the horizon and nonfinite coordinates', () => {
    const known: ReactionGatePhotoHomography = [1, 0, 1, 0, 1, 2, 1, 0, 0];
    expect(projectReactionGatePhotoPoint(known, { x: 0, y: 1 })).toBeNull();
    expect(projectReactionGatePhotoPoint(known, { x: Infinity, y: 1 })).toBeNull();
    expect(projectReactionGatePhotoPoint([1, 0, NaN, 0, 1, 0, 0, 0, 1], { x: 1, y: 1 })).toBeNull();
  });
});
