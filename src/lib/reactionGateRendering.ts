import {
  clampReactionGateProgress,
  projectReactionGateQuad,
  projectReactionGateWorldPoint,
  reactionGateBodyArc,
  reactionGateBodySection,
  reactionGateWorldPoint,
  rotateReactionGateWorldPoint,
  REACTION_GATE_FRONT_STRIP_DEPTH,
  REACTION_GATE_RADIUS as RADIUS,
  REACTION_GATE_WORLD_WIDTH as WIDTH,
  type ReactionGateWorldPoint,
} from './reactionGateGeometry';

export type ReactionGatePath = {
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};
type PlanePoint = (depth: number, across: number) => ReactionGateWorldPoint;
const ground: PlanePoint = (downhill, across) => ({ downhill, across, upright: 0 });

function path(points: ReactionGateWorldPoint[], close = true) {
  if (!points.length) return '';
  return points.map((point, index) => {
    const screen = projectReactionGateWorldPoint(point);
    return `${index ? 'L' : 'M'}${screen.x.toFixed(3)},${screen.y.toFixed(3)}`;
  }).join(' ') + (close ? ' Z' : '');
}

function rectangle(x0: number, x1: number, y0: number, y1: number, point: PlanePoint) {
  return path([point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)]);
}

// Physical strut widths shrink with distance. Constant SVG stroke widths would
// merge the far-end grid into an opaque slab and make the face appear curved.
function grid(x0: number, x1: number, width: number, point: PlanePoint) {
  const nx = Math.max(1, Math.round((x1 - x0) / 0.055));
  const ny = Math.round(WIDTH / 0.055);
  const half = width / 2;
  const bars: string[] = [];
  for (let index = 0; index <= nx; index++) {
    const x = x0 + ((x1 - x0) * index / nx);
    bars.push(rectangle(Math.max(x0, x - half), Math.min(x1, x + half), 0, WIDTH, point));
  }
  for (let index = 0; index <= ny; index++) {
    const y = WIDTH * index / ny;
    bars.push(rectangle(x0, x1, Math.max(0, y - half), Math.min(WIDTH, y + half), point));
  }
  return bars.join(' ');
}

function frame(x0: number, x1: number, width: number, point: PlanePoint) {
  return [
    rectangle(x0, x0 + width, 0, WIDTH, point),
    rectangle(x1 - width, x1, 0, WIDTH, point),
    rectangle(x0, x1, 0, width, point),
    rectangle(x0, x1, WIDTH - width, WIDTH, point),
  ].join(' ');
}

function crossbars(x0: number, x1: number, halfWidth: number, point: PlanePoint) {
  return Array.from({ length: WIDTH - 1 }, (_, index) => {
    const y = index + 1;
    return rectangle(x0, x1, y - halfWidth, y + halfWidth, point);
  }).join(' ');
}

const frontEdge = RADIUS + REACTION_GATE_FRONT_STRIP_DEPTH;
export const REACTION_GATE_FIXED_PATHS: ReactionGatePath[] = [
  { d: rectangle(0, RADIUS, 0, WIDTH, ground), fill: '#141617', opacity: 0.94, stroke: '#55595b', strokeWidth: 2.2 },
  { d: rectangle(RADIUS, frontEdge, 0, WIDTH, ground), fill: '#181b1d', opacity: 0.8 },
  { d: grid(RADIUS, frontEdge, 0.007, ground), fill: '#101212' },
  { d: grid(RADIUS, frontEdge, 0.0038, ground), fill: '#7e817c' },
  { d: frame(RADIUS, frontEdge, 0.013, ground), fill: '@frame' },
  { d: crossbars(RADIUS, frontEdge, 0.007, ground), fill: '#747770' },
  { d: rectangle(-0.008, 0.008, 0, WIDTH, ground), fill: '#666b65' },
];

export function buildReactionGateFrame(progress: number) {
  const normalized = clampReactionGateProgress(progress);
  const angle = normalized * Math.PI / 2;
  const nearArc = reactionGateBodyArc(normalized);
  const farArc = reactionGateBodyArc(normalized, WIDTH);
  const shell: ReactionGatePath[] = [];
  for (let index = 0; index < nearArc.length - 1; index++) {
    const midpoint = angle + (((Math.PI / 2) - angle) * (index + 0.5) / (nearArc.length - 1));
    const shade = Math.round(116 + (36 * Math.cos(midpoint)) + (7 * Math.sin(midpoint)));
    shell.push({
      d: path([farArc[index], nearArc[index], nearArc[index + 1], farArc[index + 1]]),
      fill: `rgb(${shade},${shade},${shade - 1})`,
    });
  }
  if (nearArc.length) {
    shell.push(
      { d: path(nearArc, false), fill: 'none', stroke: '#b5b6b6', strokeWidth: 1.8 },
      { d: path(farArc, false), fill: 'none', stroke: '#808283', strokeWidth: 1.6 },
    );
  }

  const cap: ReactionGatePath[] = nearArc.length ? [
    { d: path(reactionGateBodySection(normalized)), fill: '@cap', stroke: '#b5b5b3', strokeWidth: 1.9 },
    {
      d: path(nearArc.map(point => ({ ...point, downhill: point.downhill * 0.974, upright: point.upright * 0.974 })), false),
      fill: 'none', stroke: '#606362', strokeWidth: 1.3, opacity: 0.46,
    },
  ] : [];
  const bolts = [0.11, 0.55, 1.08, 1.43].flatMap(theta => {
    const point = rotateReactionGateWorldPoint({
      across: 0, downhill: 0.935 * Math.sin(theta), upright: 0.935 * Math.cos(theta),
    }, normalized);
    return point.upright > 0.035 ? [projectReactionGateWorldPoint(point)] : [];
  });
  const onFace: PlanePoint = (radius, across) => reactionGateWorldPoint(across, radius, normalized);
  const mesh: ReactionGatePath[] = [
    { d: rectangle(0, RADIUS, 0, WIDTH, onFace), fill: '#0a0c0e', opacity: 0.12 },
    { d: grid(0, RADIUS, 0.007, onFace), fill: '#131614' },
    { d: grid(0, RADIUS, 0.0038, onFace), fill: '#7d817b' },
    { d: crossbars(0, RADIUS, 0.01, onFace), fill: '#70756e' },
    { d: frame(0, RADIUS, 0.015, onFace), fill: '@frame' },
    { d: rectangle(RADIUS - 0.018, RADIUS, 0, WIDTH, onFace), fill: '@frame' },
  ];
  return {
    shell, cap, bolts, mesh,
    quad: projectReactionGateQuad(normalized),
    maxMeshHeight: reactionGateWorldPoint(0, RADIUS, normalized).upright,
  };
}
