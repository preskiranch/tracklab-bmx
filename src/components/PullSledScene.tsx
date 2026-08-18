import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { AnimatedBmxRider } from './AnimatedBmxRider';

type PullSledSceneProps = {
  active: boolean;
  cadenceRpm?: number;
  compact?: boolean;
  durationSeconds?: number;
  label?: string;
  progress?: number;
  speedKph?: number;
};

const sceneStyles = `
@keyframes tracklab-pull-rig-travel {
  from { transform: translate3d(0,0,0); }
  to { transform: translate3d(64%,0,0); }
}
`;

const venueUrl = '/assets/get-pulled/tracklab-pull-venue-v2.png';
const venueGeometry = {
  width: 1672,
  height: 941,
  roadTop: 613,
  roadBottom: 764,
} as const;

export function PullSledScene({
  active,
  cadenceRpm = 0,
  compact = false,
  durationSeconds,
  label,
  progress = 0,
  speedKph = 0,
}: PullSledSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const finishLineRef = useRef<HTMLDivElement>(null);
  const assemblyRef = useRef<HTMLDivElement>(null);
  const sledHitchRef = useRef<HTMLSpanElement>(null);
  const rearAxleRef = useRef<HTMLSpanElement>(null);
  const towSvgRef = useRef<SVGSVGElement>(null);
  const towShadowRef = useRef<SVGPathElement>(null);
  const towBarRef = useRef<SVGPathElement>(null);
  const sledJointRef = useRef<SVGCircleElement>(null);
  const bikeJointRef = useRef<SVGCircleElement>(null);
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const pedaling = active && cadenceRpm >= 1;
  const timedTravel = active && typeof durationSeconds === 'number' && durationSeconds > 0;
  const height = compact ? 112 : 420;
  const directTravelPercent = clampedProgress * 64;
  const sceneStyle = {
    '--tracklab-pull-duration': `${Math.max(0.1, durationSeconds ?? 1).toFixed(3)}s`,
  } as CSSProperties;
  const rigStyle = {
    position: 'absolute', inset: 0,
    zIndex: 3,
    willChange: active ? 'transform' : 'auto',
    transform: timedTravel ? undefined : `translate3d(${directTravelPercent}%,0,0)`,
    animation: timedTravel
      ? 'tracklab-pull-rig-travel var(--tracklab-pull-duration) linear forwards'
      : 'none',
  } as CSSProperties;

  useLayoutEffect(() => {
    const assembly = assemblyRef.current;
    const sledHitch = sledHitchRef.current;
    const rearAxle = rearAxleRef.current;
    if (!assembly || !sledHitch || !rearAxle) return undefined;

    const updateTowBar = () => {
      const assemblyBox = assembly.getBoundingClientRect();
      const hitchBox = sledHitch.getBoundingClientRect();
      const axleBox = rearAxle.getBoundingClientRect();
      const start = {
        x: hitchBox.left + hitchBox.width / 2 - assemblyBox.left,
        y: hitchBox.top + hitchBox.height / 2 - assemblyBox.top,
      };
      const end = {
        x: axleBox.left + axleBox.width / 2 - assemblyBox.left,
        y: axleBox.top + axleBox.height / 2 - assemblyBox.top,
      };
      const path = [
        `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
        `L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
      ].join(' ');
      towSvgRef.current?.setAttribute(
        'viewBox',
        `0 0 ${assemblyBox.width.toFixed(2)} ${assemblyBox.height.toFixed(2)}`,
      );
      towShadowRef.current?.setAttribute('d', path);
      towBarRef.current?.setAttribute('d', path);
      sledJointRef.current?.setAttribute('cx', start.x.toFixed(2));
      sledJointRef.current?.setAttribute('cy', start.y.toFixed(2));
      bikeJointRef.current?.setAttribute('cx', end.x.toFixed(2));
      bikeJointRef.current?.setAttribute('cy', end.y.toFixed(2));
    };

    updateTowBar();
    const resizeObserver = new ResizeObserver(updateTowBar);
    resizeObserver.observe(assembly);
    resizeObserver.observe(sledHitch);
    resizeObserver.observe(rearAxle);
    return () => resizeObserver.disconnect();
  }, [compact]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const finishLine = finishLineRef.current;
    if (!scene || !finishLine) return undefined;

    const clipFinishLineToRoad = () => {
      const sceneBox = scene.getBoundingClientRect();
      const coverScale = Math.max(
        sceneBox.width / venueGeometry.width,
        sceneBox.height / venueGeometry.height,
      );
      const renderedHeight = venueGeometry.height * coverScale;
      const centeredOffsetY = (sceneBox.height - renderedHeight) / 2;
      const roadTop = Math.max(
        0,
        centeredOffsetY + venueGeometry.roadTop * coverScale,
      );
      const roadBottom = Math.min(
        sceneBox.height,
        centeredOffsetY + venueGeometry.roadBottom * coverScale,
      );
      finishLine.style.top = `${roadTop.toFixed(2)}px`;
      finishLine.style.height = `${Math.max(1, roadBottom - roadTop).toFixed(2)}px`;
    };

    clipFinishLineToRoad();
    const resizeObserver = new ResizeObserver(clipFinishLineToRoad);
    resizeObserver.observe(scene);
    return () => resizeObserver.disconnect();
  }, [compact]);

  return (
    <div
      ref={sceneRef}
      className="pull-sled-scene"
      aria-label={label ?? (active ? 'BMX rider actively pulling the TrackLab sled' : 'BMX rider ready to pull the TrackLab sled')}
      data-course-mode="fixed-screen"
      data-pedaling={pedaling ? 'true' : 'false'}
      data-rider-side="right"
      data-sled-side="left"
      data-pull-scrolling="false"
      data-pull-speed-kph={speedKph.toFixed(1)}
      data-travel-duration-seconds={durationSeconds ?? ''}
      role="img"
      style={{
        ...sceneStyle,
        position: 'relative',
        width: '100%',
        height,
        minHeight: height,
        overflow: 'hidden',
        borderRadius: compact ? 12 : 22,
        background: '#162018',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)',
        isolation: 'isolate',
      }}
    >
      <style>{sceneStyles}</style>

      <div aria-hidden="true" data-pull-scenery="fixed-track" style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(180deg,rgba(6,12,8,.01),rgba(3,6,5,.15)),url('${venueUrl}')`,
        backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundSize: 'cover',
      }} />

      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,rgba(5,11,7,.01) 0%,rgba(3,7,5,.03) 55%,rgba(2,5,4,.22) 100%)',
        zIndex: 1,
      }} />

      <div ref={finishLineRef} aria-hidden="true" data-finish-line="pull" data-finish-surface="road-only-checkered" data-road-clip="source-image-coordinates" style={{
        position: 'absolute', right: compact ? '2.5%' : '3%', top: '65%',
        zIndex: 2, width: compact ? 7 : 14, height: '16%',
        backgroundColor: '#f4f4ef',
        backgroundImage: 'linear-gradient(45deg,#090a0a 25%,transparent 25%,transparent 75%,#090a0a 75%),linear-gradient(45deg,#090a0a 25%,transparent 25%,transparent 75%,#090a0a 75%)',
        backgroundPosition: '0 0,6px 6px',
        backgroundSize: compact ? '8px 8px' : '12px 12px',
        border: compact ? '1px solid rgba(0,0,0,.78)' : '2px solid rgba(0,0,0,.82)',
        boxShadow: '0 2px 5px rgba(0,0,0,.46)',
        transform: 'skewY(-1.5deg)',
      }}>
        {!compact && <span style={{
          position: 'absolute', top: -29, left: '50%', transform: 'translateX(-50%) skewY(1.5deg)',
          padding: '4px 8px', border: '1px solid rgba(255,255,255,.72)', borderRadius: 5,
          background: '#0a0b0b', color: '#fff', fontSize: 11, fontWeight: 900, letterSpacing: '.08em',
        }}>FINISH</span>}
      </div>

      <div
        aria-hidden="true"
        data-pull-rig="sled-left-rider-right"
        data-rig-start="sled-at-left-edge"
        data-rig-finish="front-tire-at-right-finish"
        style={rigStyle}
      >
        <div ref={assemblyRef} data-pull-assembly="close-coupled" style={{
          position: 'absolute', left: compact ? '2.5%' : '2%', top: compact ? '29%' : '40%',
          width: compact ? '35%' : '31%', height: compact ? '63%' : '40%',
        }}>
          <div data-pull-sled="trailing" style={{
            position: 'absolute', left: 0, bottom: 0,
            zIndex: 3, width: '41.5%', height: '54%',
            filter: 'drop-shadow(0 8px 6px rgba(0,0,0,.44))',
          }}>
            <img alt="" draggable={false} src="/assets/get-pulled/tracklab-bmx-pull-sled-clean-v2.png" style={{
              position: 'absolute', inset: 'auto 0 0', width: '100%', height: 'auto',
              userSelect: 'none', transform: 'scaleX(-1)',
            }} />
            <span ref={sledHitchRef} data-tow-joint="sled-front" style={{
              position: 'absolute', left: '78.5%', top: '84%', zIndex: 2,
              width: compact ? 5 : 7, height: compact ? 5 : 7,
              borderRadius: '50%', border: '1.5px solid #303436', background: '#050606',
              transform: 'translate(-50%,-50%)',
            }} />
          </div>

          <svg
            ref={towSvgRef}
            data-tow-attachment="sled-hitch-to-rear-axle"
            data-tow-color="matte-black"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', inset: 0, zIndex: 4,
              width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none',
            }}
          >
            <path ref={towShadowRef} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={compact ? 4.2 : 5.8} strokeLinecap="round" strokeLinejoin="round" />
            <path ref={towBarRef} fill="none" stroke="#070809" strokeWidth={compact ? 3.1 : 4.5} strokeLinecap="round" strokeLinejoin="round" />
            <circle ref={sledJointRef} r={compact ? 1.8 : 2.5} fill="#050606" stroke="#303436" strokeWidth=".8" />
            <circle ref={bikeJointRef} r={compact ? 1.8 : 2.5} fill="#050606" stroke="#303436" strokeWidth=".8" />
          </svg>

          <div data-pedal-cycle={pedaling ? 'running' : 'stopped'} data-tow-anchor="rear-axle-hitch" style={{
            position: 'absolute', left: '40%', top: '-8%', zIndex: 5,
            height: '108%', aspectRatio: '303 / 312',
            filter: 'drop-shadow(0 9px 7px rgba(0,0,0,.42))', transformOrigin: '52% 82%',
          }}>
            <span ref={rearAxleRef} data-tow-joint="bike-rear-axle" style={{
              position: 'absolute', left: '18.5%', top: '82.7%', zIndex: 2,
              width: compact ? 5 : 7, height: compact ? 5 : 7,
              borderRadius: '50%', border: '1.5px solid #303436', background: '#050606',
              transform: 'translate(-50%,-50%)', boxSizing: 'border-box',
            }} />
            <AnimatedBmxRider active={pedaling} cadenceRpm={cadenceRpm} />
          </div>
        </div>
      </div>

      {!compact && <div aria-hidden="true" style={{
        position: 'absolute', left: 20, right: 20, bottom: 14, zIndex: 4, height: 5,
        borderRadius: 999, background: 'rgba(7,12,9,.62)', overflow: 'hidden',
      }}>
        <span style={{
          display: 'block', width: `${clampedProgress * 100}%`, height: '100%', borderRadius: 'inherit',
          background: 'linear-gradient(90deg,#78df3b,#d8ff42)', transition: 'width .1s linear',
        } as CSSProperties} />
      </div>}
    </div>
  );
}

export default PullSledScene;
