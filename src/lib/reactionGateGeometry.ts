export type ReactionGatePoint = { x: number; y: number };
export type ReactionGateQuad = [
  ReactionGatePoint,
  ReactionGatePoint,
  ReactionGatePoint,
  ReactionGatePoint,
];

export type ReactionGateWorldPoint = {
  across: number;
  downhill: number;
  upright: number;
};

export type ReactionGateHomogeneousPoint = {
  w: number;
  x: number;
  y: number;
};

export const REACTION_GATE_WORLD_WIDTH = 8;

// The source crop is the exact gate leaf in the approved master artwork,
// clockwise from the far/top corner. The final two points form the hinge.
export const REACTION_GATE_SOURCE_QUAD: ReactionGateQuad = [
  { x: 929, y: 459 },
  { x: 1174, y: 671 },
  { x: 1147, y: 879 },
  { x: 928, y: 500 },
];

// A calibrated projective camera for the approved photograph. The gate is a
// unit-depth rectangle spanning eight lane units in world space. Animation is
// performed in that world space, then projected once as a single plane.
//
// At zero degrees the first three columns reproduce SOURCE_QUAD exactly. The
// downhill column puts the released leaf inside both painted lane boundaries
// with a deliberate raster/antialiasing margin.
const REACTION_GATE_CAMERA = {
  origin: { x: 928, y: 500, w: 1 },
  across: {
    x: -720.4497389038853 / REACTION_GATE_WORLD_WIDTH,
    y: -340.9444816883116 / REACTION_GATE_WORLD_WIDTH,
    w: -0.8190494672221796 / REACTION_GATE_WORLD_WIDTH,
  },
  upright: {
    x: -13.733804954024862,
    y: -48.27967327656608,
    w: -0.015859854632961974,
  },
  downhill: {
    x: 135.1132,
    y: 75.9432,
    w: 0.0826,
  },
} as const;

function clampProgress(progress: number) {
  return Math.min(1, Math.max(0, progress));
}

export function reactionGateWorldQuad(progress: number): [
  ReactionGateWorldPoint,
  ReactionGateWorldPoint,
  ReactionGateWorldPoint,
  ReactionGateWorldPoint,
] {
  const angle = clampProgress(progress) * (Math.PI / 2);
  const upright = Math.cos(angle);
  const downhill = Math.sin(angle);
  return [
    { across: 0, upright, downhill },
    { across: REACTION_GATE_WORLD_WIDTH, upright, downhill },
    { across: REACTION_GATE_WORLD_WIDTH, upright: 0, downhill: 0 },
    { across: 0, upright: 0, downhill: 0 },
  ];
}

export function projectReactionGateWorldPointHomogeneous(
  point: ReactionGateWorldPoint,
): ReactionGateHomogeneousPoint {
  const { origin, across, upright, downhill } = REACTION_GATE_CAMERA;
  return {
    x: origin.x
      + (point.across * across.x)
      + (point.upright * upright.x)
      + (point.downhill * downhill.x),
    y: origin.y
      + (point.across * across.y)
      + (point.upright * upright.y)
      + (point.downhill * downhill.y),
    w: origin.w
      + (point.across * across.w)
      + (point.upright * upright.w)
      + (point.downhill * downhill.w),
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

export const REACTION_GATE_FLUSH_QUAD = projectReactionGateQuad(1);
