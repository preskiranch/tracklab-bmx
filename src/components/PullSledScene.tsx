import type { CSSProperties } from 'react';

type PullSledSceneProps = {
  active: boolean;
  compact?: boolean;
  label?: string;
  progress?: number;
};

const sceneStyles = `
@keyframes tracklab-pull-road-scroll { from { background-position-x: 0; } to { background-position-x: -520px; } }
@keyframes tracklab-pull-rider-drive { 0%,100% { transform: translateY(0) rotate(-0.4deg); } 50% { transform: translateY(2px) rotate(0.4deg); } }
@keyframes tracklab-pull-sled-shudder { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-2px); } }
`;

export function PullSledScene({ active, compact = false, label, progress = 0 }: PullSledSceneProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const height = compact ? 112 : 420;
  return (
    <div
      aria-label={label ?? (active ? 'BMX rider actively pulling the TrackLab sled' : 'BMX rider ready to pull the TrackLab sled')}
      role="img"
      style={{
        position: 'relative',
        width: '100%',
        height,
        minHeight: height,
        overflow: 'hidden',
        borderRadius: compact ? 12 : 22,
        backgroundColor: '#162018',
        backgroundImage: "linear-gradient(180deg, rgba(6,12,8,.02) 0%, rgba(6,12,8,.05) 57%, rgba(3,6,5,.18) 100%), url('/assets/get-pulled/tracklab-pull-venue-v2.png')",
        backgroundSize: compact ? 'auto 165%' : 'cover',
        backgroundPosition: compact ? 'center 56%' : 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)',
      }}
    >
      <style>{sceneStyles}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: compact ? '37%' : '39%',
          opacity: active ? 0.28 : 0,
          backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 48px, rgba(255,255,255,.16) 49px 51px, transparent 52px 104px)',
          animation: active ? 'tracklab-pull-road-scroll .9s linear infinite' : 'none',
          transition: 'opacity .2s ease',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: compact ? '7%' : '13%',
          bottom: compact ? '-4%' : '-3%',
          width: compact ? '78%' : '67%',
          height: compact ? '88%' : '78%',
          background: "url('/assets/get-pulled/tracklab-bmx-pull-sled-v1.png') center bottom / contain no-repeat",
          transformOrigin: '42% 80%',
          animation: active ? 'tracklab-pull-rider-drive .18s ease-in-out infinite' : 'none',
          filter: 'drop-shadow(0 10px 10px rgba(0,0,0,.35))',
        }}
      />
      {!compact && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 14,
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
