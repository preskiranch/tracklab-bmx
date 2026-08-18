import type { CSSProperties } from 'react';
import { bmxSpeedKphFromCadence } from '../game/bmxRollout';

type PullSledSceneProps = {
  active: boolean;
  cadenceRpm?: number;
  compact?: boolean;
  label?: string;
  progress?: number;
  speedKph?: number;
};

const sceneStyles = `
@keyframes tracklab-pull-scenery-scroll {
  from { transform: translate3d(0,0,0); }
  to { transform: translate3d(-66.666667%,0,0); }
}
@keyframes tracklab-pull-rider-cycle {
  from { background-position-x: 0%; }
  to { background-position-x: 100%; }
}
@keyframes tracklab-pull-sled-shudder {
  0%,100% { transform: translate3d(0,0,0); }
  50% { transform: translate3d(-1px,0,0); }
}
`;

const venueUrl = '/assets/get-pulled/tracklab-pull-venue-v2.png';

export function PullSledScene({
  active,
  cadenceRpm = 0,
  compact = false,
  label,
  progress = 0,
  speedKph = 0,
}: PullSledSceneProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const pedaling = active && cadenceRpm >= 1;
  const height = compact ? 112 : 420;
  const pedalDurationSeconds = 60 / Math.max(24, cadenceRpm || 24);
  const motionSpeedKph = Math.max(speedKph, bmxSpeedKphFromCadence(cadenceRpm));
  const sceneryDurationSeconds = Math.min(14, Math.max(3.5, 16 - (Math.max(0, motionSpeedKph) * 0.45)));
  const riderWidth = compact ? 92 : 218;
  const riderBottom = compact ? 6 : 31;
  const sledWidth = compact ? 112 : 268;
  const sledHeight = compact ? 55 : 132;
  const sceneStyle = {
    '--tracklab-pedal-duration': `${pedalDurationSeconds.toFixed(3)}s`,
    '--tracklab-scenery-duration': `${sceneryDurationSeconds.toFixed(3)}s`,
  } as CSSProperties;

  return (
    <div
      className="pull-sled-scene"
      aria-label={label ?? (active ? 'BMX rider actively pulling the TrackLab sled' : 'BMX rider ready to pull the TrackLab sled')}
      data-pedaling={pedaling ? 'true' : 'false'}
      data-rider-side="right"
      data-sled-side="left"
      data-pull-scrolling={pedaling ? 'true' : 'false'}
      data-pull-speed-kph={speedKph.toFixed(1)}
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

      <div
        aria-hidden="true"
        data-pull-scenery="track"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          width: '300%',
          willChange: pedaling ? 'transform' : 'auto',
          animation: pedaling
            ? 'tracklab-pull-scenery-scroll var(--tracklab-scenery-duration) linear infinite'
            : 'none',
        }}
      >
        {[false, true, false].map((mirrored, index) => (
          <div
            key={index}
            style={{
              flex: '0 0 33.333334%',
              height: '100%',
              backgroundImage: `linear-gradient(180deg,rgba(6,12,8,.01),rgba(3,6,5,.15)),url('${venueUrl}')`,
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: compact ? 'auto 165%' : 'cover',
              transform: mirrored ? 'scaleX(-1)' : undefined,
            }}
          />
        ))}
      </div>

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg,rgba(5,11,7,.01) 0%,rgba(3,7,5,.03) 55%,rgba(2,5,4,.22) 100%)',
          zIndex: 1,
        }}
      />

      <div
        aria-hidden="true"
        data-pedal-cycle={pedaling ? 'running' : 'stopped'}
        style={{
          position: 'absolute',
          left: compact ? '58%' : '60%',
          bottom: riderBottom,
          zIndex: 3,
          width: riderWidth,
          aspectRatio: '1 / 1',
          filter: 'drop-shadow(0 9px 7px rgba(0,0,0,.42))',
          transformOrigin: '52% 82%',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            backgroundImage: "url('/assets/rider-lime-animated.png')",
            backgroundPosition: '0% center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '900% 100%',
            animation: pedaling
              ? 'tracklab-pull-rider-cycle var(--tracklab-pedal-duration) steps(8,end) infinite'
              : 'none',
          }}
        />
      </div>

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: compact ? '31%' : '32%',
          bottom: compact ? 38 : 108,
          zIndex: 2,
          width: compact ? '31%' : '30%',
          height: compact ? 3 : 7,
          borderRadius: 999,
          background: '#171916',
          boxShadow: '0 2px 2px rgba(0,0,0,.38)',
          transform: 'rotate(-4deg)',
          transformOrigin: 'left center',
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: compact ? '8%' : '9%',
          bottom: compact ? 17 : 42,
          zIndex: 3,
          width: sledWidth,
          height: sledHeight,
          overflow: 'hidden',
          animation: pedaling ? 'tracklab-pull-sled-shudder calc(var(--tracklab-pedal-duration) / 2) ease-in-out infinite' : 'none',
          filter: 'drop-shadow(0 9px 7px rgba(0,0,0,.44))',
        }}
      >
        <img
          alt=""
          draggable={false}
          src="/assets/get-pulled/tracklab-bmx-pull-sled-v1.png"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: '220%',
            height: 'auto',
            maxWidth: 'none',
            userSelect: 'none',
          }}
        />
      </div>

      {!compact && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 14,
            zIndex: 4,
            height: 5,
            borderRadius: 999,
            background: 'rgba(7,12,9,.62)',
            overflow: 'hidden',
          }}
        >
          <span style={{
            display: 'block',
            width: `${clampedProgress * 100}%`,
            height: '100%',
            borderRadius: 'inherit',
            background: 'linear-gradient(90deg,#78df3b,#d8ff42)',
            transition: 'width .1s linear',
          } as CSSProperties} />
        </div>
      )}
    </div>
  );
}

export default PullSledScene;
