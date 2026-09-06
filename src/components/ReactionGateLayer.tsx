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
import { REACTION_SCENE_IMAGE } from '../lib/reactionScene';

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
const PHOTO = REACTION_SCENE_IMAGE;
const REVEAL = '/assets/reaction-test-bmx-original-gate-reveal.png';
// Reveal the hidden surface only where the original raised gate occluded it.
// Feather the outer safety margin to avoid a cut-out edge; the ready photo and
// all other background pixels stay fixed.
const originalPath = (points: number[][]) => points.map(([x, y], index) =>
  `${index ? 'L' : 'M'}${x * SCENE_WIDTH / 1280},${y * SCENE_HEIGHT / 720}`).join(' ') + ' Z';
const CAP_OUTLINE = originalPath([[764,460],[794,461],[810,478],[826,499],[841,523],[852,548],[861,577],[867,604],[869,628],[867,650],[713,612]]);
const OCCLUSION_PATH = originalPath([[651,294],[669,297],[803,458],[817,474],[834,496],[849,521],[860,547],[869,576],[874,604],[875,632],[871,653],[710,614],[636,356]]);
const OCCLUSION_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941"><defs><filter id="edge" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><path d="${OCCLUSION_PATH}" fill="white" filter="url(#edge)"/></svg>`)}")`;
// Clip the rotating photographed end cap at the actual receiving plane.
// Its exact source outline is retained, including the top rail and bevel.
const ABOVE_GROUND = `path("${originalPath([[-1000,-1000],[3000,-1000],[3000,610 + (3000-712)*38/156],[-1000,610 + (-1000-712)*38/156]])}")`;
const PHOTO_STYLE: CSSProperties = { position: 'absolute', inset: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT, maxWidth: 'none', transformOrigin: '0 0', pointerEvents: 'none' };
const SOURCE_CAP = CAP_OUTLINE;
// Keep the photographed hinge metal above the hidden-background repair. It
// belongs to the fixed platform, so it never opens a dirt seam as the face turns.
const HINGE_STRIP = originalPath([[635,351],[643,354],[718,615],[704,612]]);
// The original photo also contains this same grating viewed flat. Sample it
// near the end of the drop, where stretching the foreshortened upright photo
// would discard most of the grille detail. Both views follow the same quad.
const FLAT_GRATING_SOURCE = [[639,354],[710,608],[540,575],[587,350]]
  .map(([x, y]) => ({ x: x * SCENE_WIDTH / 1280, y: y * SCENE_HEIGHT / 720 })) as ReactionGateQuad;
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
  const flatMeshWarp = useMemo(() => createReactionGatePhotoWarp(FLAT_GRATING_SOURCE, frame.quad), [frame.quad]);
  const flatMeshOpacity = Math.max(0, Math.min(1, (progress - 0.65) / 0.35));
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
        <img data-gate-photo="reveal" src={REVEAL} alt="" draggable={false} style={{ ...PHOTO_STYLE, maskImage: OCCLUSION_MASK, WebkitMaskImage: OCCLUSION_MASK, opacity: progress > 0 ? 1 : 0 }} />
        <svg className="reaction-gate-svg" style={{ opacity: progress > 0 ? 1 : 0 }} width={SCENE_WIDTH} height={SCENE_HEIGHT} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} preserveAspectRatio="none" focusable="false">
          <defs>
            <pattern id={`${prefix}-shell-metal`} patternUnits="userSpaceOnUse" width="13.0625" height="13.06944" viewBox="725 385 10 10">
              {/* Original rail sample averages RGB121/121/123. Keep its silver
                  color and subtle grain without magnifying isolated specks. */}
              <rect x="725" y="385" width="10" height="10" fill="#79797b" />
              <image href={PHOTO} width="1280" height="720" preserveAspectRatio="none" opacity="0.15" />
            </pattern>
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
            {progress < 1 && <GatePaths paths={frame.shell.map(part => part.fill.startsWith('rgb(')
              ? { ...part, fill: '@shell-metal' }
              : { ...part, stroke: '#8c8a80' })} prefix={prefix} />}
            {progress < 1 && !capWarp && <>
              <g data-gate-part="cap" opacity={capWarp ? 0 : 1}>
                <GatePaths paths={frame.cap} prefix={prefix} />
                {frame.bolts.map(({ x, y }, index) => <circle key={index} cx={x} cy={y} r="2.7" fill={`url(#${prefix}-bolt)`} stroke="#565857" strokeWidth="0.6" />)}
              </g>
            </>}
          </g>
          <g className="reaction-gate-mesh" data-gate-part="mesh" data-gate-quad={serializeQuad(frame.quad)} opacity={meshWarp ? 0 : 1}>
            <GatePaths paths={frame.mesh} prefix={prefix} />
          </g>
        </svg>
        <div data-gate-photo-clip="cap" style={{ ...PHOTO_STYLE, clipPath: ABOVE_GROUND, opacity: progress > 0 && progress < 1 && capWarp ? 1 : 0 }}>
          <img data-gate-photo="cap" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: `path("${SOURCE_CAP}")`, transform: capWarp?.cssTransform }} />
        </div>
        <div data-gate-photo-clip="mesh" style={{ ...PHOTO_STYLE, clipPath: polygon(frame.quad), opacity: progress > 0 && meshWarp ? 1 : 0 }}>
          <img data-gate-photo="mesh" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: polygon(REACTION_GATE_SOURCE_QUAD), transform: meshWarp?.cssTransform }} />
          {flatMeshWarp && <img data-gate-photo="flat-mesh" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: polygon(FLAT_GRATING_SOURCE), transform: flatMeshWarp.cssTransform, opacity: flatMeshOpacity }} />}
        </div>
        <img data-gate-photo="hinge" src={PHOTO} alt="" draggable={false} style={{ ...PHOTO_STYLE, clipPath: `path("${HINGE_STRIP}")`, opacity: progress > 0 ? 1 : 0 }} />
      </div>
    </div>
  );
}
