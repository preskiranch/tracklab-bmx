import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_RADIUS,
  REACTION_GATE_SOURCE_QUAD,
  REACTION_GATE_WORLD_WIDTH,
  projectReactionGateWorldPoint,
  rotateReactionGateWorldPoint,
  type ReactionGateQuad,
} from '../lib/reactionGateGeometry';
import { buildReactionGateFrame, REACTION_GATE_FIXED_PATHS, type ReactionGatePath } from '../lib/reactionGateRendering';
import { playReactionGateAirSound, reactionGateAirProfiles } from '../lib/reactionGateAudio';
import { createReactionGatePhotoWarp } from '../lib/reactionGatePhotoWarp';

export {
  projectReactionGateQuad,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_SOURCE_QUAD,
  reactionGateWorldQuad,
} from '../lib/reactionGateGeometry';

const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;
export const REACTION_GATE_DROP_MS = 260;
export const REACTION_GATE_RAISE_MS = reactionGateAirProfiles.raise.durationSeconds * 1_000;
const serializeQuad = (quad: ReactionGateQuad) => quad.map(({ x, y }) => `${x},${y}`).join(' ');
const polygon = (quad: ReactionGateQuad) => `polygon(${quad.map(({ x, y }) => `${x}px ${y}px`).join(',')})`;
const PHOTO = '/assets/reaction-test-bmx-approved-4k.jpg';
const REVEAL = '/assets/reaction-test-bmx-gate-reveal.jpg';
// Only the photographed raised gate can uncover the lower-resolution hidden
// surface. The hill, deck, spectators, and all other master pixels stay fixed.
const OCCLUSION = 'path("M849 390 L878 390 L1040 588 L1041 590 L1067 610 L1088 630 L1105 650 L1120 670 L1132 690 L1142 710 L1150 730 L1156 750 L1160 770 L1163 790 L1165 810 L1167 830 L1167 849 L952 811 L844 474 Z")';
const PHOTO_STYLE: CSSProperties = { position: 'absolute', inset: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT, maxWidth: 'none', transformOrigin: '0 0', pointerEvents: 'none' };
const SOURCE_CAP = buildReactionGateFrame(0).cap[0].d;
const capPlane = (progress: number): ReactionGateQuad => [
  { across: 0, downhill: 0, upright: 1 }, { across: 0, downhill: 1, upright: 1 },
  { across: 0, downhill: 1, upright: 0 }, { across: 0, downhill: 0, upright: 0 },
].map(point => projectReactionGateWorldPoint(rotateReactionGateWorldPoint(point, progress))) as ReactionGateQuad;
const SOURCE_CAP_PLANE = capPlane(0);

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
  const progressRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const prefix = `reaction-gate-${useId().replace(/:/g, '')}`;
  const frame = useMemo(() => buildReactionGateFrame(progress), [progress]);
  const meshWarp = useMemo(() => createReactionGatePhotoWarp(REACTION_GATE_SOURCE_QUAD, frame.quad), [frame.quad]);
  const capWarp = useMemo(() => createReactionGatePhotoWarp(SOURCE_CAP_PLANE, capPlane(progress)), [progress]);

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
    const from = progressRef.current;
    const target = released ? 1 : 0;
    if (!released) settledForReleaseRef.current = false;
    // Initial mounting and a retry after a false start do not move the gate.
    if (from === target) {
      return undefined;
    }
    let active = true;
    let animationFrame: number | null = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // This decorative cue follows the gate; it never starts or changes scoring.
    const stopAirSound = playReactionGateAirSound(released ? 'drop' : 'raise');
    const updateProgress = (next: number) => {
      progressRef.current = next;
      setProgress(next);
    };
    const settle = () => {
      if (!active) return;
      updateProgress(target);
      if (released && !settledForReleaseRef.current) {
        settledForReleaseRef.current = true;
        onSettledRef.current();
      }
    };
    const startedAt = performance.now();
    const duration = released ? REACTION_GATE_DROP_MS : REACTION_GATE_RAISE_MS;
    const animate = (now: number) => {
      if (!active) return;
      const linear = Math.min(1, Math.max(0, (now - startedAt) / duration));
      // Preserve the existing 260ms gravity-accelerated drop. Scoring remains
      // owned by the fourth UCI cadence event, not by the drawing lifecycle.
      if (linear === 1) {
        animationFrame = null;
        settle();
      } else {
        const eased = released ? linear * linear : 1 - (1 - linear) ** 2;
        updateProgress(from + (target - from) * eased);
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
      stopAirSound();
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener('change', handleMotionChange);
    };
  }, [released]);

  return (
    <div
      aria-hidden="true"
      className="reaction-gate-layer"
      data-gate-motion="rigid-quarter-cylinder"
      data-gate-renderer="photo-projective-svg"
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
        <img data-gate-photo="reveal" src={REVEAL} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: OCCLUSION, opacity: progress > 0 ? 1 : 0 }} />
        <svg className="reaction-gate-svg" style={{ opacity: progress > 0 ? 1 : 0 }} width={SCENE_WIDTH} height={SCENE_HEIGHT} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} preserveAspectRatio="none" focusable="false">
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
          <g data-gate-part="fixed" opacity="0"><GatePaths paths={REACTION_GATE_FIXED_PATHS} prefix={prefix} /></g>
          <g className="reaction-gate-body" data-gate-part="body" data-gate-body-visible={progress < 1}>
            {progress < 1 && <>
              <GatePaths paths={frame.shell} prefix={prefix} />
              <g data-gate-part="cap">
                <GatePaths paths={frame.cap} prefix={prefix} />
                {frame.bolts.map(({ x, y }, index) => <circle key={index} cx={x} cy={y} r="2.7" fill={`url(#${prefix}-bolt)`} stroke="#565857" strokeWidth="0.6" />)}
              </g>
            </>}
          </g>
          <g className="reaction-gate-mesh" data-gate-part="mesh" data-gate-quad={serializeQuad(frame.quad)} opacity={meshWarp ? 0 : 1}>
            <GatePaths paths={frame.mesh} prefix={prefix} />
          </g>
        </svg>
        <div data-gate-photo-clip="cap" style={{ ...PHOTO_STYLE, clipPath: frame.cap.length ? `path("${frame.cap[0].d}")` : 'polygon(0 0,0 0,0 0)', opacity: progress > 0 && capWarp ? 1 : 0 }}>
          <img data-gate-photo="cap" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: `path("${SOURCE_CAP}")`, transform: capWarp?.cssTransform }} />
        </div>
        <div data-gate-photo-clip="mesh" style={{ ...PHOTO_STYLE, clipPath: polygon(frame.quad), opacity: progress > 0 && meshWarp ? 1 : 0 }}>
          <img data-gate-photo="mesh" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: polygon(REACTION_GATE_SOURCE_QUAD), transform: meshWarp?.cssTransform }} />
        </div>
      </div>
    </div>
  );
}
