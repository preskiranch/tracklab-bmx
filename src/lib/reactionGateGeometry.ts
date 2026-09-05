export type ReactionGatePoint = { x: number; y: number };
export type ReactionGateQuad = [ReactionGatePoint, ReactionGatePoint, ReactionGatePoint, ReactionGatePoint];
export type ReactionGateWorldPoint = { across: number; downhill: number; upright: number };
export type ReactionGateHomogeneousPoint = { w: number; x: number; y: number };

export const REACTION_GATE_WORLD_WIDTH = 8;
export const REACTION_GATE_RADIUS = 1;
export const REACTION_GATE_FRONT_STRIP_DEPTH = 0.12;
const HALF_PI = Math.PI / 2;
const EPSILON = 1e-9;

export function clampReactionGateProgress(progress: number) {
  return Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
}

/** Across is zero at the near end and eight at the far end for every surface. */
export function rotateReactionGateWorldPoint(
  point: ReactionGateWorldPoint,
  progress: number,
): ReactionGateWorldPoint {
  const angle = clampReactionGateProgress(progress) * HALF_PI;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const upright = (point.upright * cosine) - (point.downhill * sine);
  return {
    across: point.across,
    downhill: (point.downhill * cosine) + (point.upright * sine),
    upright: Math.abs(upright) < EPSILON ? 0 : upright,
  };
}

export function reactionGateWorldPoint(across: number, radius: number, progress: number) {
  return rotateReactionGateWorldPoint({ across, downhill: 0, upright: radius }, progress);
}

/** Clockwise from the far free corner; the final two corners form the fixed hinge. */
export function reactionGateWorldQuad(progress: number): [
  ReactionGateWorldPoint, ReactionGateWorldPoint, ReactionGateWorldPoint, ReactionGateWorldPoint,
] {
  return [
    reactionGateWorldPoint(REACTION_GATE_WORLD_WIDTH, REACTION_GATE_RADIUS, progress),
    reactionGateWorldPoint(0, REACTION_GATE_RADIUS, progress),
    reactionGateWorldPoint(0, 0, progress),
    reactionGateWorldPoint(REACTION_GATE_WORLD_WIDTH, 0, progress),
  ];
}

/**
 * The barrel is a quarter cylinder, sharing the mesh's radius. Intersect its
 * rotated section with upright >= 0 before projection; the receiver conceals
 * the rest. Its width and both end planes remain unchanged during the drop.
 */
export function reactionGateBodyArc(progress: number, across = 0, segments = 64): ReactionGateWorldPoint[] {
  const normalized = clampReactionGateProgress(progress);
  if (normalized === 1) return [];
  const angle = normalized * HALF_PI;
  const steps = Math.max(1, Math.floor(segments));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const theta = angle + ((HALF_PI - angle) * index / steps);
    return {
      across,
      downhill: REACTION_GATE_RADIUS * Math.sin(theta),
      upright: index === steps ? 0 : REACTION_GATE_RADIUS * Math.cos(theta),
    };
  });
}

export function reactionGateBodySection(progress: number, across = 0, segments = 64): ReactionGateWorldPoint[] {
  const arc = reactionGateBodyArc(progress, across, segments);
  return arc.length ? [{ across, downhill: 0, upright: 0 }, ...arc] : [];
}

/** One shared camera aligns the entire assembly with the approved pad/hill seam. */
export function projectReactionGateWorldPointHomogeneous(point: ReactionGateWorldPoint): ReactionGateHomogeneousPoint {
  return {
    w: 1 + (0.32 * point.across),
    x: 949 + (255.175 * point.across) + (225 * point.downhill) + (55 * point.upright),
    y: 801 + (106.355 * point.across) + (55 * point.downhill) - (217 * point.upright),
  };
}

export function projectReactionGateWorldPoint(point: ReactionGateWorldPoint): ReactionGatePoint {
  const projected = projectReactionGateWorldPointHomogeneous(point);
  if (!Number.isFinite(projected.w) || Math.abs(projected.w) < 0.000001) {
    throw new Error('Reaction gate projected through the camera plane.');
  }
  return { x: projected.x / projected.w, y: projected.y / projected.w };
}

export function projectReactionGateQuad(progress: number): ReactionGateQuad {
  return reactionGateWorldQuad(progress).map(projectReactionGateWorldPoint) as ReactionGateQuad;
}

// Legacy names remain available to callers; these now describe the native
// geometry, rather than a hand-selected crop in an obsolete source image.
export const REACTION_GATE_SOURCE_QUAD = projectReactionGateQuad(0);
export const REACTION_GATE_FLUSH_QUAD = projectReactionGateQuad(1);
