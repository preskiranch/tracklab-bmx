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

/** One shared camera fits the original photograph: the fixed hinge, upright
 * grille corners, and the receiving surface at the dirt/concrete seam.
 * Anchors are measured in the original 1280×720 photo, then scaled into the
 * shared 1672×941 scene. Rotation and equal gate height/depth stay in world space. */
export function projectReactionGateWorldPointHomogeneous(point: ReactionGateWorldPoint): ReactionGateHomogeneousPoint {
  return {
    w: 1 + (0.2232254223834902 * point.across) - (0.04297539403560494 * point.upright),
    x: (712 + (133.51604490305024 * point.across) + (156 * point.downhill) + (19.166798956797827 * point.upright)) * (1672 / 1280),
    y: (610 + (47.02179952375554 * point.across) + (38 * point.downhill) - (168.81165665041388 * point.upright)) * (941 / 720),
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
