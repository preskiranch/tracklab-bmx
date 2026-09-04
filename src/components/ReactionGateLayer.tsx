import { useCallback, useEffect, useRef } from 'react';

const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;
export const REACTION_GATE_DROP_MS = 260;

type Point = { x: number; y: number };
type Quad = [Point, Point, Point, Point];

// Corners of the exact gate the user selected, clockwise from its far/top
// corner. The fixed hinge is the final two points and never moves.
export const REACTION_GATE_SOURCE_QUAD: Quad = [
  // The far side is trimmed at the upper painted lane boundary. This keeps
  // scenery from the approved full-resolution plate out of the moving layer.
  { x: 929, y: 459 },
  { x: 1174, y: 671 },
  { x: 1147, y: 879 },
  { x: 928, y: 500 },
];

export const REACTION_GATE_FLUSH_QUAD: Quad = [
  // The released edge lands inside the narrow dirt recess. The painted lane
  // boundaries remain outside this footprint while the hinge edge stays
  // registered to the fixed metal platform.
  { x: 970, y: 535 },
  { x: 1305, y: 886 },
  REACTION_GATE_SOURCE_QUAD[2],
  REACTION_GATE_SOURCE_QUAD[3],
];

function add(first: Point, second: Point): Point {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first: Point, second: Point): Point {
  return { x: first.x - second.x, y: first.y - second.y };
}

function rotateGate(progress: number): Quad {
  const angle = Math.min(1, Math.max(0, progress)) * (Math.PI / 2);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const farHinge = REACTION_GATE_SOURCE_QUAD[3];
  const nearHinge = REACTION_GATE_SOURCE_QUAD[2];
  const uprightFar = subtract(REACTION_GATE_SOURCE_QUAD[0], farHinge);
  const uprightNear = subtract(REACTION_GATE_SOURCE_QUAD[1], nearHinge);
  const flushFar = subtract(REACTION_GATE_FLUSH_QUAD[0], farHinge);
  const flushNear = subtract(REACTION_GATE_FLUSH_QUAD[1], nearHinge);
  const projected = (upright: Point, flush: Point) => ({
    x: (upright.x * cosine) + (flush.x * sine),
    y: (upright.y * cosine) + (flush.y * sine),
  });
  return [
    add(farHinge, projected(uprightFar, flushFar)),
    add(nearHinge, projected(uprightNear, flushNear)),
    nearHinge,
    farHinge,
  ];
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  sourcePoints: [Point, Point, Point],
  destinationPoints: [Point, Point, Point],
) {
  const [sourceOrigin, sourceX, sourceY] = sourcePoints;
  const [destinationOrigin, destinationX, destinationY] = destinationPoints;
  const sourceXX = sourceX.x - sourceOrigin.x;
  const sourceXY = sourceX.y - sourceOrigin.y;
  const sourceYX = sourceY.x - sourceOrigin.x;
  const sourceYY = sourceY.y - sourceOrigin.y;
  const determinant = (sourceXX * sourceYY) - (sourceYX * sourceXY);
  if (Math.abs(determinant) < 0.000001) return;

  const destinationXX = destinationX.x - destinationOrigin.x;
  const destinationXY = destinationX.y - destinationOrigin.y;
  const destinationYX = destinationY.x - destinationOrigin.x;
  const destinationYY = destinationY.y - destinationOrigin.y;
  const a = ((destinationXX * sourceYY) - (destinationYX * sourceXY)) / determinant;
  const b = ((destinationXY * sourceYY) - (destinationYY * sourceXY)) / determinant;
  const c = ((destinationYX * sourceXX) - (destinationXX * sourceYX)) / determinant;
  const d = ((destinationYY * sourceXX) - (destinationXY * sourceYX)) / determinant;
  const e = destinationOrigin.x - (a * sourceOrigin.x) - (c * sourceOrigin.y);
  const f = destinationOrigin.y - (b * sourceOrigin.x) - (d * sourceOrigin.y);
  const minX = Math.max(0, Math.floor(Math.min(...sourcePoints.map(({ x }) => x))) - 1);
  const minY = Math.max(0, Math.floor(Math.min(...sourcePoints.map(({ y }) => y))) - 1);
  const maxX = Math.min(source.naturalWidth, Math.ceil(Math.max(...sourcePoints.map(({ x }) => x))) + 1);
  const maxY = Math.min(source.naturalHeight, Math.ceil(Math.max(...sourcePoints.map(({ y }) => y))) + 1);

  context.save();
  context.beginPath();
  context.moveTo(destinationOrigin.x, destinationOrigin.y);
  context.lineTo(destinationX.x, destinationX.y);
  context.lineTo(destinationY.x, destinationY.y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
  context.restore();
}

function drawGate(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  destination: Quad,
) {
  context.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  // A projective CSS matrix can become numerically unstable while a gate is
  // almost edge-on and produce a long triangular spike. The two affine
  // triangles below share the gate's physical diagonal, so every transformed
  // sample is finite and the leaf remains one continuous, untwisted piece
  // throughout the drop.
  context.save();
  context.beginPath();
  context.moveTo(destination[0].x, destination[0].y);
  context.lineTo(destination[1].x, destination[1].y);
  context.lineTo(destination[2].x, destination[2].y);
  context.lineTo(destination[3].x, destination[3].y);
  context.closePath();
  context.clip();
  drawTexturedTriangle(
    context,
    source,
    [REACTION_GATE_SOURCE_QUAD[0], REACTION_GATE_SOURCE_QUAD[1], REACTION_GATE_SOURCE_QUAD[2]],
    [destination[0], destination[1], destination[2]],
  );
  drawTexturedTriangle(
    context,
    source,
    [REACTION_GATE_SOURCE_QUAD[0], REACTION_GATE_SOURCE_QUAD[2], REACTION_GATE_SOURCE_QUAD[3]],
    [destination[0], destination[2], destination[3]],
  );
  context.restore();
}

export type ReactionGateLayerProps = {
  released: boolean;
  onSettled: () => void;
};

export function ReactionGateLayer({ released, onSettled }: ReactionGateLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const coordinateSpaceRef = useRef<HTMLDivElement | null>(null);
  const gateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gateSourceRef = useRef<HTMLImageElement | null>(null);
  const progressRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const layer = layerRef.current;
    const coordinateSpace = coordinateSpaceRef.current;
    if (!layer || !coordinateSpace) return undefined;
    const updateScale = () => {
      coordinateSpace.style.transform = `scale(${layer.clientWidth / SCENE_WIDTH}, ${layer.clientHeight / SCENE_HEIGHT})`;
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  const paint = useCallback((progress: number) => {
    const gate = gateCanvasRef.current;
    const source = gateSourceRef.current;
    const layer = layerRef.current;
    if (!gate || !source || !layer) return;
    const normalized = Math.min(1, Math.max(0, progress));
    progressRef.current = normalized;
    if (source.complete && source.naturalWidth > 0) {
      const context = gate.getContext('2d');
      if (context) drawGate(context, source, rotateGate(normalized));
    }
    layer.dataset.gateProgress = normalized.toFixed(3);
  }, []);

  useEffect(() => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (!released) {
      paint(0);
      return undefined;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      paint(1);
      onSettledRef.current();
      return undefined;
    }
    const startedAt = performance.now();
    const animate = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / REACTION_GATE_DROP_MS);
      // Gravity accelerates the exact selected gate toward the dirt; timing and
      // scoring remain owned by the fourth UCI cadence event.
      paint(linear * linear);
      if (linear < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        onSettledRef.current();
      }
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [paint, released]);

  return (
    <div
      aria-hidden="true"
      className="reaction-gate-layer"
      data-gate-flush-quad={REACTION_GATE_FLUSH_QUAD.map(({ x, y }) => `${x},${y}`).join(' ')}
      data-gate-motion="single-rigid-source"
      data-gate-progress="0.000"
      ref={layerRef}
    >
      <div className="reaction-gate-coordinate-space" ref={coordinateSpaceRef}>
        <canvas
          className="reaction-gate-canvas"
          height={SCENE_HEIGHT}
          ref={gateCanvasRef}
          width={SCENE_WIDTH}
        />
        <img
          alt=""
          className="reaction-gate-selected-source"
          draggable={false}
          height={SCENE_HEIGHT}
          onLoad={() => paint(progressRef.current)}
          ref={gateSourceRef}
          src="/assets/reaction-test-eight-lane-gate-source.png"
          width={SCENE_WIDTH}
        />
      </div>
    </div>
  );
}
