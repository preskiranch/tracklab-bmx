import { describe, expect, it } from 'vitest';
import {
  projectReactionGateWorldPoint,
  REACTION_GATE_WORLD_WIDTH,
  rotateReactionGateWorldPoint,
  type ReactionGatePoint,
  type ReactionGateQuad,
} from '../../src/lib/reactionGateGeometry';
import { createReactionGatePhotoWarp, projectReactionGatePhotoPoint } from '../../src/lib/reactionGatePhotoWarp';
import {
  buildReactionGatePhotoShell,
  REACTION_GATE_CAP_OUTLINE,
  reactionGatePhotoShellWorldFaces,
} from '../../src/lib/reactionGatePhotoShell';

const poses = [0, 0.01, 0.15, 0.35, 0.5, 0.75, 0.95, 0.999];
const capPlane = (progress: number, across = 0): ReactionGateQuad => [
  { across, downhill: 0, upright: 1 }, { across, downhill: 1, upright: 1 },
  { across, downhill: 1, upright: 0 }, { across, downhill: 0, upright: 0 },
].map(point => projectReactionGateWorldPoint(rotateReactionGateWorldPoint(point, progress))) as ReactionGateQuad;
const sourceProfile = REACTION_GATE_CAP_OUTLINE.slice(0, -1).map(([x, y]) => ({ x: x * 1672 / 1280, y: y * 941 / 720 }));
const gap = (a: ReactionGatePoint, b: ReactionGatePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const signedGroundDistance = (point: ReactionGatePoint, across: number) => {
  const a = projectReactionGateWorldPoint({ across, downhill: 0, upright: 0 });
  const b = projectReactionGateWorldPoint({ across, downhill: 1, upright: 0 });
  return ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / gap(a, b);
};

describe('Photograph-matched gate shell', () => {
  it('meets the same warped cap contour at both ends throughout the return, including the top bevel', () => {
    for (const progress of poses) {
      const faces = reactionGatePhotoShellWorldFaces(progress);
      for (const across of [0, REACTION_GATE_WORLD_WIDTH]) {
        const warp = createReactionGatePhotoWarp(capPlane(0), capPlane(progress, across))!;
        const expected = sourceProfile.map(point => projectReactionGatePhotoPoint(warp.homography, point)!);
        const actual = faces.flat().filter(point => point.across === across);
        // Independent photo homographies determine the expected visible contour,
        // so reverting to a mathematically circular shell fails this check.
        for (const point of expected.filter(point => signedGroundDistance(point, across) < -1e-7)) {
          expect(Math.min(...actual.map(candidate => gap(projectReactionGateWorldPoint(candidate), point))))
            .toBeLessThan(1e-7);
        }
        for (const point of actual.filter(point => point.upright > 1e-7)) {
          expect(Math.min(...expected.map(candidate => gap(projectReactionGateWorldPoint(point), candidate))))
            .toBeLessThan(1e-7);
        }
      }
    }
    const upright = reactionGatePhotoShellWorldFaces(0).flat().filter(point => point.across === 0);
    for (const bevelPoint of sourceProfile.slice(0, 2)) {
      expect(Math.min(...upright.map(point => gap(projectReactionGateWorldPoint(point), bevelPoint))))
        .toBeLessThan(1e-7);
    }
  });

  it('recesses the shell at the receiving plane without changing the eight-unit physical width', () => {
    for (let step = 0; step < 100; step++) {
      const progress = step / 100;
      const faces = reactionGatePhotoShellWorldFaces(progress);
      expect(faces.length).toBeGreaterThan(0);
      const boundary = faces.flat();
      expect(boundary.some(point => point.upright === 0)).toBe(true);
      for (const face of faces) {
        expect(face.some(point => point.upright > 0)).toBe(true);
        for (const point of face) {
          expect(point.upright).toBeGreaterThanOrEqual(0);
          expect([0, REACTION_GATE_WORLD_WIDTH]).toContain(point.across);
          const opposite = face.find(other => other.across !== point.across
            && Math.abs(other.downhill - point.downhill) < 1e-10
            && Math.abs(other.upright - point.upright) < 1e-10);
          expect(opposite).toBeDefined();
          expect(Math.abs(opposite!.across - point.across)).toBe(8);
          if (point.upright === 0) {
            expect(Math.abs(signedGroundDistance(projectReactionGateWorldPoint(point), point.across)))
              .toBeLessThan(1e-7);
          }
        }
      }
    }
    for (const progress of [1, 2, Infinity]) {
      expect(reactionGatePhotoShellWorldFaces(progress)).toEqual([]);
      expect(buildReactionGatePhotoShell(progress)).toEqual([]);
    }
  });

  it('draws only the clipped metal skin without an independent arc stroke or hinge closure', () => {
    for (const progress of poses) {
      const faces = reactionGatePhotoShellWorldFaces(progress);
      const paths = buildReactionGatePhotoShell(progress);
      expect(paths).toHaveLength(faces.length);
      paths.forEach((part, index) => {
        expect(part.fill).toBe('rgb(121,121,123)');
        expect(part.stroke).toBeUndefined();
        const coordinates = [...part.d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)]
          .map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
        expect(coordinates).toHaveLength(faces[index].length);
        coordinates.forEach((point, vertex) => {
          expect(gap(point, projectReactionGateWorldPoint(faces[index][vertex]))).toBeLessThan(1e-6);
        });
      });
    }
    expect(buildReactionGatePhotoShell(NaN)).toEqual(buildReactionGatePhotoShell(0));
    expect(buildReactionGatePhotoShell(-1)).toEqual(buildReactionGatePhotoShell(0));
  });
});
