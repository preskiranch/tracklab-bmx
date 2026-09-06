import {
  clampReactionGateProgress,
  projectReactionGateWorldPoint,
  projectReactionGateWorldPointHomogeneous,
  REACTION_GATE_WORLD_WIDTH,
  rotateReactionGateWorldPoint,
  type ReactionGateWorldPoint,
} from './reactionGateGeometry';
import type { ReactionGatePath } from './reactionGateRendering';

/** The photographed end cap in the original 1280×720 image, including its bevel. */
export const REACTION_GATE_CAP_OUTLINE = [
  [764, 460], [794, 461], [810, 478], [826, 499], [841, 523],
  [852, 548], [861, 577], [867, 604], [869, 628], [867, 650], [713, 612],
] as const;

const EPSILON = 1e-10;
const origin = projectReactionGateWorldPointHomogeneous({ across: 0, downhill: 0, upright: 0 });
const depth = projectReactionGateWorldPointHomogeneous({ across: 0, downhill: 1, upright: 0 });
const height = projectReactionGateWorldPointHomogeneous({ across: 0, downhill: 0, upright: 1 });

/** Invert the shared camera on the near end plane; do not fit a second camera. */
function sourceWorldPoint([sourceX, sourceY]: readonly [number, number]): ReactionGateWorldPoint {
  const x = sourceX * 1672 / 1280;
  const y = sourceY * 941 / 720;
  const a = depth.x - origin.x - x * (depth.w - origin.w);
  const b = height.x - origin.x - x * (height.w - origin.w);
  const c = depth.y - origin.y - y * (depth.w - origin.w);
  const d = height.y - origin.y - y * (height.w - origin.w);
  const u = x * origin.w - origin.x;
  const v = y * origin.w - origin.y;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < EPSILON) throw new Error('Reaction gate cap plane cannot be inverted.');
  return { across: 0, downhill: (u * d - b * v) / determinant, upright: (a * v - u * c) / determinant };
}

// The closing hinge point belongs to the end cap, not the curved metal skin.
const outerProfile = REACTION_GATE_CAP_OUTLINE.slice(0, -1).map(sourceWorldPoint);

function distance(a: ReactionGateWorldPoint, b: ReactionGateWorldPoint) {
  return Math.hypot(a.across - b.across, a.downhill - b.downhill, a.upright - b.upright);
}

function aboveGround(polygon: ReactionGateWorldPoint[]) {
  const clipped: ReactionGateWorldPoint[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const current = polygon[index];
    if ((previous.upright >= 0) !== (current.upright >= 0)) {
      const fraction = previous.upright / (previous.upright - current.upright);
      clipped.push({
        across: previous.across + fraction * (current.across - previous.across),
        downhill: previous.downhill + fraction * (current.downhill - previous.downhill),
        upright: 0,
      });
    }
    if (current.upright >= 0) clipped.push(current);
  }
  const unique = clipped.filter((point, index) => index === 0 || distance(point, clipped[index - 1]) > EPSILON);
  if (unique.length > 1 && distance(unique[0], unique[unique.length - 1]) < EPSILON) unique.pop();
  return unique;
}

/** Photographic skin, rigidly extruded between the same two fixed end planes. */
export function reactionGatePhotoShellWorldFaces(progress: number): ReactionGateWorldPoint[][] {
  const normalized = clampReactionGateProgress(progress);
  if (normalized === 1) return [];
  const near = outerProfile.map(point => rotateReactionGateWorldPoint(point, normalized));
  const far = near.map(point => ({ ...point, across: REACTION_GATE_WORLD_WIDTH }));
  return near.slice(0, -1).map((point, index) =>
    aboveGround([far[index], point, near[index + 1], far[index + 1]]),
  ).filter(points => points.length >= 3);
}

export function buildReactionGatePhotoShell(progress: number): ReactionGatePath[] {
  return reactionGatePhotoShellWorldFaces(progress).map(points => ({
    d: points.map((point, index) => {
      const projected = projectReactionGateWorldPoint(point);
      return `${index ? 'L' : 'M'}${projected.x.toFixed(6)},${projected.y.toFixed(6)}`;
    }).join(' ') + ' Z',
    // The component maps this to the existing silver photo texture. No stroke:
    // the photographed cap already supplies the exact outer edge and bevel.
    fill: 'rgb(121,121,123)',
  }));
}
