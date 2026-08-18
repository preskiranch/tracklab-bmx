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

export function PullSledScene({
  active,
  cadenceRpm = 0,
  compact = false,
  durationSeconds,
  label,
  progress = 0,
  speedKph = 0,
}: PullSledSceneProps) {
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

  return (
    <div
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

      <div aria-hidden="true" data-finish-line="pull" style={{
        position: 'absolute', right: compact ? '2.5%' : '3%', bottom: compact ? 5 : 29,
        zIndex: 2, width: compact ? 3 : 6, height: compact ? 62 : 214, borderRadius: 999,
        background: 'linear-gradient(90deg,#f7fff1,#dfff36,#f7fff1)',
        boxShadow: '0 0 0 2px rgba(8,15,10,.78),0 0 15px rgba(210,255,55,.7)',
      }}>
        {!compact && <span style={{
          position: 'absolute', top: -32, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 10px', border: '2px solid #dfff36', borderRadius: 7,
          background: '#101712', color: '#fff', fontSize: 12, fontWeight: 900, letterSpacing: '.08em',
        }}>FINISH</span>}
      </div>

      <div
        aria-hidden="true"
        data-pull-rig="sled-left-rider-right"
        data-rig-start="sled-at-left-edge"
        data-rig-finish="front-tire-at-right-finish"
        style={rigStyle}
      >
        <div data-pull-assembly="close-coupled" style={{
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
              userSelect: 'none',
            }} />
          </div>

          <svg
            data-tow-attachment="sled-hitch-to-seat-post"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', inset: 0, zIndex: 4,
              width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none',
            }}
          >
            <line x1="42" y1="74" x2="65.5" y2="55" stroke="rgba(2,4,3,.78)" strokeWidth="4.4" />
            <line x1="42" y1="72.5" x2="65.5" y2="53.5" stroke="#d7dddf" strokeWidth="2.15" />
            <circle cx="42" cy="72.5" r="1.7" fill="#111514" stroke="#b9c0c2" strokeWidth=".7" />
            <circle cx="65.5" cy="53.5" r="1.6" fill="#111514" stroke="#b9c0c2" strokeWidth=".7" />
          </svg>

          <div data-pedal-cycle={pedaling ? 'running' : 'stopped'} data-tow-anchor="seat-post-rear" style={{
            position: 'absolute', left: '42%', top: '-2%', zIndex: 5,
            height: '100%', aspectRatio: '1 / 1',
            filter: 'drop-shadow(0 9px 7px rgba(0,0,0,.42))', transformOrigin: '52% 82%',
          }}>
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
