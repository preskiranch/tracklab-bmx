import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_RADIUS,
  REACTION_GATE_SOURCE_QUAD,
  REACTION_GATE_WORLD_WIDTH,
  type ReactionGateQuad,
} from '../lib/reactionGateGeometry';
import { buildReactionGateFrame, REACTION_GATE_FIXED_PATHS, type ReactionGatePath } from '../lib/reactionGateRendering';

export {
  projectReactionGateQuad,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_SOURCE_QUAD,
  reactionGateWorldQuad,
} from '../lib/reactionGateGeometry';

const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;
export const REACTION_GATE_DROP_MS = 260;
const serializeQuad = (quad: ReactionGateQuad) => quad.map(({ x, y }) => `${x},${y}`).join(' ');

function GatePaths({ paths, prefix }: { paths: ReactionGatePath[]; prefix: string }) {
  return paths.map((part, index) => (
    <path
      key={index}
      d={part.d}
      fill={part.fill.startsWith('@') ? `url(#${prefix}-${part.fill.slice(1)})` : part.fill}
      opacity={part.opacity}
      stroke={part.stroke}
      strokeWidth={part.strokeWidth}
    />
  ));
}

export type ReactionGateLayerProps = { released: boolean; onSettled: () => void };

export function ReactionGateLayer({ released, onSettled }: ReactionGateLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const coordinateSpaceRef = useRef<HTMLDivElement | null>(null);
  const onSettledRef = useRef(onSettled);
  const settledForReleaseRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const prefix = `reaction-gate-${useId().replace(/:/g, '')}`;
  const frame = useMemo(() => buildReactionGateFrame(progress), [progress]);

  useEffect(() => { onSettledRef.current = onSettled; }, [onSettled]);

  useEffect(() => {
    const layer = layerRef.current;
    const coordinateSpace = coordinateSpaceRef.current;
    if (!layer || !coordinateSpace) return undefined;
    const updateScale = () => {
      const { width, height } = layer.getBoundingClientRect();
      coordinateSpace.style.transform = `scale(${width / SCENE_WIDTH}, ${height / SCENE_HEIGHT})`;
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!released) {
      settledForReleaseRef.current = false;
      setProgress(0);
      return undefined;
    }
    let active = true;
    let animationFrame: number | null = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      if (!active) return;
      setProgress(1);
      if (!settledForReleaseRef.current) {
        settledForReleaseRef.current = true;
        onSettledRef.current();
      }
    };
    const startedAt = performance.now();
    const animate = (now: number) => {
      if (!active) return;
      const linear = Math.min(1, Math.max(0, (now - startedAt) / REACTION_GATE_DROP_MS));
      // Preserve the existing 260ms gravity-accelerated drop. Scoring remains
      // owned by the fourth UCI cadence event, not by the drawing lifecycle.
      if (linear === 1) {
        animationFrame = null;
        settle();
      } else {
        setProgress(linear * linear);
        animationFrame = window.requestAnimationFrame(animate);
      }
    };
    const handleMotionChange = () => {
      if (reducedMotion.matches) {
        if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
        settle();
      }
    };
    reducedMotion.addEventListener('change', handleMotionChange);
    if (reducedMotion.matches) settle();
    else animationFrame = window.requestAnimationFrame(animate);
    return () => {
      active = false;
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener('change', handleMotionChange);
    };
  }, [released]);

  return (
    <div
      aria-hidden="true"
      className="reaction-gate-layer"
      data-gate-motion="rigid-quarter-cylinder"
      data-gate-renderer="native-svg"
      data-gate-projection="fixed-hinge-world-rotation"
      data-gate-progress={progress.toFixed(3)}
      data-gate-upright-quad={serializeQuad(REACTION_GATE_SOURCE_QUAD)}
      data-gate-flush-quad={serializeQuad(REACTION_GATE_FLUSH_QUAD)}
      data-gate-radius={REACTION_GATE_RADIUS}
      data-gate-height={REACTION_GATE_RADIUS}
      data-gate-depth={REACTION_GATE_RADIUS}
      data-gate-far-end={REACTION_GATE_WORLD_WIDTH}
      data-gate-diagnostics={JSON.stringify({ height: REACTION_GATE_RADIUS, depth: REACTION_GATE_RADIUS, farEndPlane: REACTION_GATE_WORLD_WIDTH, farEndOverrun: 0, meshMaxZ: frame.maxMeshHeight })}
      ref={layerRef}
    >
      <div className="reaction-gate-coordinate-space" ref={coordinateSpaceRef}>
        <svg className="reaction-gate-svg" width={SCENE_WIDTH} height={SCENE_HEIGHT} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`${prefix}-cap`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#99978f" /><stop offset="0.35" stopColor="#838078" />
              <stop offset="0.78" stopColor="#73716a" /><stop offset="1" stopColor="#65635e" />
            </linearGradient>
            <linearGradient id={`${prefix}-frame`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#b7b8b8" /><stop offset="0.38" stopColor="#999a9a" />
              <stop offset="0.75" stopColor="#747677" /><stop offset="1" stopColor="#a0a1a1" />
            </linearGradient>
            <radialGradient id={`${prefix}-bolt`} cx="0.35" cy="0.25" r="0.8">
              <stop offset="0" stopColor="#dadada" /><stop offset="0.4" stopColor="#969696" /><stop offset="1" stopColor="#464646" />
            </radialGradient>
          </defs>
          <g data-gate-part="fixed"><GatePaths paths={REACTION_GATE_FIXED_PATHS} prefix={prefix} /></g>
          <g className="reaction-gate-body" data-gate-part="body" data-gate-body-visible={progress < 1}>
            {progress < 1 && <>
              <GatePaths paths={frame.shell} prefix={prefix} />
              <g data-gate-part="cap">
                <GatePaths paths={frame.cap} prefix={prefix} />
                {frame.bolts.map(({ x, y }, index) => <circle key={index} cx={x} cy={y} r="2.7" fill={`url(#${prefix}-bolt)`} stroke="#565857" strokeWidth="0.6" />)}
              </g>
            </>}
          </g>
          <g className="reaction-gate-mesh" data-gate-part="mesh" data-gate-quad={serializeQuad(frame.quad)}>
            <GatePaths paths={frame.mesh} prefix={prefix} />
          </g>
        </svg>
      </div>
    </div>
  );
}
