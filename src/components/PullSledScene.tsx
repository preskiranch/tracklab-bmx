import type { CSSProperties } from 'react';

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
  to { transform: translate3d(66.667%,0,0); }
}
@keyframes tracklab-pull-rider-cycle {
  from { background-position-x: 0%; }
  to { background-position-x: 100%; }
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
  const pedalDurationSeconds = Math.min(2, Math.max(0.12, 60 / Math.max(1, cadenceRpm)));
  const directTravelPercent = clampedProgress * 66.667;
  const sceneStyle = {
    '--tracklab-pedal-duration': `${pedalDurationSeconds.toFixed(3)}s`,
    '--tracklab-pull-duration': `${Math.max(0.1, durationSeconds ?? 1).toFixed(3)}s`,
  } as CSSProperties;
  const rigStyle = {
    position: 'absolute',
    left: 0,
    bottom: compact ? 3 : 24,
    zIndex: 3,
    width: compact ? '61%' : '62%',
    height: compact ? 79 : 268,
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
        <div data-pull-sled="trailing" style={{
          position: 'absolute', left: compact ? '-1%' : '-1.5%', bottom: compact ? 9 : 15,
          zIndex: 3, width: compact ? '25%' : '26%', height: compact ? 48 : 124,
          overflow: 'hidden', filter: 'drop-shadow(0 8px 6px rgba(0,0,0,.44))',
        }}>
          <img alt="" draggable={false} src="/assets/get-pulled/tracklab-bmx-pull-sled-v1.png" style={{
            position: 'absolute', right: 0, bottom: 0, width: '310%', height: 'auto',
            maxWidth: 'none', userSelect: 'none',
          }} />
        </div>

        <svg
          data-tow-attachment="sled-hitch-to-seat-post"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'visible', pointerEvents: 'none' }}
        >
          <line x1="24" y1="72" x2="70.5" y2="51.5" stroke="rgba(4,6,5,.45)" strokeWidth="2.2" />
          <line x1="24" y1="70.5" x2="70.5" y2="50" stroke="#171a18" strokeWidth="1.2" />
          <circle cx="24" cy="70.5" r="1.4" fill="#161916" stroke="#838a84" strokeWidth=".5" />
          <circle cx="70.5" cy="50" r="1.3" fill="#161916" stroke="#838a84" strokeWidth=".5" />
        </svg>

        <div data-pedal-cycle={pedaling ? 'running' : 'stopped'} data-tow-anchor="seat-post-rear" style={{
          position: 'absolute', left: compact ? '56%' : '55%', bottom: 0, zIndex: 4,
          width: compact ? '35%' : '36%', aspectRatio: '1 / 1',
          filter: 'drop-shadow(0 9px 7px rgba(0,0,0,.42))', transformOrigin: '52% 82%',
        }}>
          <span style={{
            position: 'absolute', inset: 0, display: 'block',
            backgroundImage: "url('/assets/rider-lime-animated.png')", backgroundPosition: '0% center',
            backgroundRepeat: 'no-repeat', backgroundSize: '900% 100%',
            animation: pedaling ? 'tracklab-pull-rider-cycle var(--tracklab-pedal-duration) steps(8,end) infinite' : 'none',
            willChange: pedaling ? 'background-position' : 'auto',
          }} />
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
