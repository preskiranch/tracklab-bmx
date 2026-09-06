import type { ReactionGatePoint, ReactionGateQuad } from './reactionGateGeometry';

/** Row-major 3×3 matrix acting on the column vector [x, y, 1]. */
export type ReactionGatePhotoHomography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type ReactionGatePhotoWarp = {
  homography: ReactionGatePhotoHomography;
  cssTransform: string;
};

const EPSILON = 1e-12;
const IDENTITY: ReactionGatePhotoHomography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function multiply(a: ReactionGatePhotoHomography, b: ReactionGatePhotoHomography) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3) * 3;
    const column = index % 3;
    return a[row] * b[column] + a[row + 1] * b[column + 3] + a[row + 2] * b[column + 6];
  }) as unknown as ReactionGatePhotoHomography;
}

/** Center and scale before solving so pixel offsets do not dominate pivots. */
function normalizeQuad(quad: Readonly<ReactionGateQuad>) {
  if (quad.length !== 4 || !quad.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return null;
  const center = {
    x: quad.reduce((sum, point) => sum + point.x / 4, 0),
    y: quad.reduce((sum, point) => sum + point.y / 4, 0),
  };
  const distances = quad.map(({ x, y }) => Math.hypot(x - center.x, y - center.y));
  const largest = Math.max(...distances);
  if (!Number.isFinite(largest) || largest === 0) return null;
  const rms = largest * Math.sqrt(distances.reduce((sum, distance) => sum + (distance / largest) ** 2, 0) / 4);
  const scale = Math.SQRT2 / rms;
  const points = quad.map(({ x, y }) => ({ x: (x - center.x) * scale, y: (y - center.y) * scale }));
  if (!Number.isFinite(scale) || !points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return null;

  // Four point correspondences define an invertible projectivity only when
  // every triple is noncollinear. This also rejects repeated corners.
  for (let a = 0; a < 2; a += 1) {
    for (let b = a + 1; b < 3; b += 1) {
      for (let c = b + 1; c < 4; c += 1) {
        const ab = { x: points[b].x - points[a].x, y: points[b].y - points[a].y };
        const ac = { x: points[c].x - points[a].x, y: points[c].y - points[a].y };
        const area = Math.abs(ab.x * ac.y - ab.y * ac.x);
        if (area <= EPSILON * Math.hypot(ab.x, ab.y) * Math.hypot(ac.x, ac.y)) return null;
      }
    }
  }

  const transform: ReactionGatePhotoHomography = [scale, 0, -center.x * scale, 0, scale, -center.y * scale, 0, 0, 1];
  const inverse: ReactionGatePhotoHomography = [1 / scale, 0, center.x, 0, 1 / scale, center.y, 0, 0, 1];
  return { center, points, scale, transform, inverse };
}

/** Solve the homogeneous 8×9 system without assuming that h33 is nonzero. */
function solveHomography(rows: number[][]): ReactionGatePhotoHomography | null {
  const columns = Array.from({ length: 9 }, (_, index) => index);
  for (let pivot = 0; pivot < 8; pivot += 1) {
    let bestRow = pivot;
    let bestColumn = pivot;
    for (let row = pivot; row < 8; row += 1) {
      for (let column = pivot; column < 9; column += 1) {
        if (Math.abs(rows[row][column]) > Math.abs(rows[bestRow][bestColumn])) {
          bestRow = row;
          bestColumn = column;
        }
      }
    }
    if (Math.abs(rows[bestRow][bestColumn]) <= EPSILON) return null;
    [rows[pivot], rows[bestRow]] = [rows[bestRow], rows[pivot]];
    for (const row of rows) [row[pivot], row[bestColumn]] = [row[bestColumn], row[pivot]];
    [columns[pivot], columns[bestColumn]] = [columns[bestColumn], columns[pivot]];

    const divisor = rows[pivot][pivot];
    for (let column = pivot; column < 9; column += 1) rows[pivot][column] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      for (let column = pivot; column < 9; column += 1) rows[row][column] -= factor * rows[pivot][column];
    }
  }
  const result = Array<number>(9).fill(0);
  result[columns[8]] = 1;
  for (let row = 0; row < 8; row += 1) result[columns[row]] = -rows[row][8];
  return result.every(Number.isFinite) ? result as unknown as ReactionGatePhotoHomography : null;
}

/** Returns null at the projective horizon or for nonfinite inputs. */
export function projectReactionGatePhotoPoint(
  homography: ReactionGatePhotoHomography,
  point: ReactionGatePoint,
): ReactionGatePoint | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !homography.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f, g, h, i] = homography;
  const denominator = g * point.x + h * point.y + i;
  const magnitude = Math.abs(g * point.x) + Math.abs(h * point.y) + Math.abs(i);
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= EPSILON * magnitude) return null;
  const projected = {
    x: (a * point.x + b * point.y + c) / denominator,
    y: (d * point.x + e * point.y + f) / denominator,
  };
  return Number.isFinite(projected.x) && Number.isFinite(projected.y) ? projected : null;
}

function cssMatrix(homography: ReactionGatePhotoHomography) {
  const [a, b, c, d, e, f, g, h, i] = homography;
  // CSS matrix3d is column-major; z remains zero for the photo plane.
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(', ')})`;
}

/**
 * Map matching ordered photo-space corners to their new screen positions.
 * Apply cssTransform to the entire 1672×941 image with transform-origin: 0 0;
 * source clipping also stays in those original image coordinates. Parent
 * scene scaling can then resize the whole composition without recalibration.
 * Returns null for singular or numerically unresolved quads.
 */
export function createReactionGatePhotoWarp(
  sourceQuad: Readonly<ReactionGateQuad>,
  targetQuad: Readonly<ReactionGateQuad>,
): ReactionGatePhotoWarp | null {
  const source = normalizeQuad(sourceQuad);
  const target = normalizeQuad(targetQuad);
  if (!source || !target) return null;
  if (sourceQuad.every((point, index) => point.x === targetQuad[index].x && point.y === targetQuad[index].y)) {
    return { homography: IDENTITY, cssTransform: cssMatrix(IDENTITY) };
  }

  const rows = source.points.flatMap(({ x, y }, index) => {
    const { x: u, y: v } = target.points[index];
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, -u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, -v],
    ];
  });
  const normalized = solveHomography(rows);
  if (!normalized) return null;
  const denormalized = multiply(multiply(target.inverse, normalized), source.transform);
  // Positive homogeneous w at the source center keeps the visible plane in
  // front of CSS's camera. A projectivity may put the center on its horizon
  // while leaving all four corners finite, so use a corner in that case.
  const denominators = sourceQuad.map(({ x, y }) => denormalized[6] * x + denormalized[7] * y + denormalized[8]);
  const cornerDivisor = denominators.reduce((largest, value) => Math.abs(value) > Math.abs(largest) ? value : largest, 0);
  const centerDivisor = denormalized[6] * source.center.x + denormalized[7] * source.center.y + denormalized[8];
  const divisor = Math.abs(centerDivisor) > EPSILON * Math.abs(cornerDivisor) ? centerDivisor : cornerDivisor;
  if (!Number.isFinite(divisor) || divisor === 0) return null;
  const homography = denormalized.map((value) => value / divisor) as unknown as ReactionGatePhotoHomography;
  if (!homography.every(Number.isFinite)) return null;
  for (let index = 0; index < 4; index += 1) {
    const mapped = projectReactionGatePhotoPoint(homography, sourceQuad[index]);
    if (!mapped || Math.hypot(mapped.x - targetQuad[index].x, mapped.y - targetQuad[index].y) * target.scale > 1e-7) return null;
  }
  return { homography, cssTransform: cssMatrix(homography) };
}
