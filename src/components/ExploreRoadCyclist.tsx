import { useId, type CSSProperties } from 'react';
import {
  exploreRoadCyclistGeometry,
  exploreRoadCyclistLegPoints,
  exploreRoadCyclistRotationDegrees,
  exploreRoadCyclistWheelRotationDegrees,
} from '../lib/exploreRoadCyclist';
import { formatExploreGrade } from '../lib/exploreElevation';
import './ExploreRoadCyclist.css';

type ExploreRoadCyclistProps = {
  accent: string;
  cadenceRpm: number;
  distanceMeters: number;
  gradePercent: number;
  name: string;
  pedalPhase: number;
  riding: boolean;
};

function pointPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

function Wheel({
  centerX,
  rotationDegrees,
}: {
  centerX: number;
  rotationDegrees: number;
}) {
  return (
    <g transform={`rotate(${rotationDegrees} ${centerX} 78)`}>
      <circle className="explore-road-bike-tire" cx={centerX} cy="78" r="24" />
      <circle className="explore-road-bike-rim" cx={centerX} cy="78" r="20.5" />
      <g className="explore-road-bike-spokes">
        <line x1={centerX - 20} y1="78" x2={centerX + 20} y2="78" />
        <line x1={centerX} y1="58" x2={centerX} y2="98" />
        <line x1={centerX - 14} y1="64" x2={centerX + 14} y2="92" />
        <line x1={centerX - 14} y1="92" x2={centerX + 14} y2="64" />
      </g>
      <circle className="explore-road-bike-hub" cx={centerX} cy="78" r="2.5" />
    </g>
  );
}

export function ExploreRoadCyclist({
  accent,
  cadenceRpm,
  distanceMeters,
  gradePercent,
  name,
  pedalPhase,
  riding,
}: ExploreRoadCyclistProps) {
  const id = useId().replaceAll(':', '');
  const rotationDegrees = exploreRoadCyclistRotationDegrees(gradePercent);
  const wheelRotationDegrees = exploreRoadCyclistWheelRotationDegrees(distanceMeters);
  const pedaling = riding && cadenceRpm >= 1;
  const visiblePedalPhase = pedaling ? pedalPhase : 0;
  const legs = exploreRoadCyclistLegPoints(visiblePedalPhase);
  const gradeLabel = formatExploreGrade(gradePercent).replace('-', '−');
  const slopeClass = gradePercent >= 0.75
    ? 'climb'
    : gradePercent <= -0.75 ? 'descent' : 'level';
  const ariaSlope = slopeClass === 'climb'
    ? `climbing at ${gradeLabel}`
    : slopeClass === 'descent' ? `descending at ${gradeLabel}` : 'on level ground';
  const cyclistStyle = {
    '--explore-road-rider-accent': accent,
  } as CSSProperties;
  const crankStep = Math.floor((((visiblePedalPhase % 1) + 1) % 1) * 24) % 24;

  return (
    <div
      className={`explore-road-cyclist ${slopeClass}`}
      style={cyclistStyle}
      role="img"
      aria-label={`${name} road cyclist ${ariaSlope}, ${pedaling ? 'pedaling' : 'coasting'}.`}
      data-pedaling={pedaling ? 'true' : 'false'}
      data-crank-step={crankStep}
    >
      <span className="explore-road-grade-badge" aria-hidden="true">{gradeLabel}</span>
      <svg viewBox="0 0 180 132" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-frame`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f8fafc" />
            <stop offset="0.22" stopColor={accent} />
            <stop offset="1" stopColor="#16212d" />
          </linearGradient>
          <linearGradient id={`${id}-jersey`} x1="0" x2="0.85" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.18" stopColor={accent} />
            <stop offset="1" stopColor="#111827" />
          </linearGradient>
          <linearGradient id={`${id}-skin`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f2c6a0" />
            <stop offset="1" stopColor="#8b4d32" />
          </linearGradient>
        </defs>

        <g
          className="explore-road-grade-surface"
          transform={`rotate(${rotationDegrees.toFixed(3)} 90 104)`}
          data-grade-surface="true"
        >
          <line className="explore-road-ground-shadow" x1="12" y1="104" x2="168" y2="104" />
          <line className="explore-road-ground" x1="12" y1="104" x2="168" y2="104" />
          <ellipse className="explore-road-bike-shadow" cx="89" cy="103" rx="64" ry="5" />

          <Wheel centerX={45} rotationDegrees={wheelRotationDegrees} />
          <Wheel centerX={134} rotationDegrees={wheelRotationDegrees} />

          <path
            className="explore-road-rider-leg rear"
            d={pointPath([legs.rear.hip, legs.rear.knee, legs.rear.pedal])}
          />
          <path className="explore-road-frame-shadow" d="M45 78 L82 74 L70 44 L108 56 L82 74 L134 78 L108 56 L105 39 L70 44 L45 78" />
          <path
            className="explore-road-frame"
            stroke={`url(#${id}-frame)`}
            d="M45 78 L82 74 L70 44 L108 56 L82 74 L134 78 L108 56 L105 39 L70 44 L45 78"
          />
          <path className="explore-road-bike-fork" d="M105 39 L108 56 L134 78" />
          <path className="explore-road-bike-seat" d="M62 42 L74 42" />
          <path className="explore-road-bike-bars" d="M103 37 C112 33 117 38 114 44 C112 48 117 49 120 46" />

          <line className="explore-road-crank rear" x1="82" y1="74" x2={legs.rear.pedal.x} y2={legs.rear.pedal.y} />
          <path
            className="explore-road-rider-leg front"
            d={pointPath([legs.front.hip, legs.front.knee, legs.front.pedal])}
          />
          <line className="explore-road-crank front" x1="82" y1="74" x2={legs.front.pedal.x} y2={legs.front.pedal.y} />
          <line className="explore-road-pedal rear" x1={legs.rear.pedal.x - 3} y1={legs.rear.pedal.y} x2={legs.rear.pedal.x + 4} y2={legs.rear.pedal.y} />
          <line className="explore-road-pedal front" x1={legs.front.pedal.x - 3} y1={legs.front.pedal.y} x2={legs.front.pedal.x + 4} y2={legs.front.pedal.y} />
          <circle className="explore-road-chainring" cx={exploreRoadCyclistGeometry.crankCenter.x} cy={exploreRoadCyclistGeometry.crankCenter.y} r="5.5" />

          <path className="explore-road-rider-torso-shadow" d="M70 37 C73 27 81 19 90 17 C98 22 103 28 108 37 L98 43 L81 35 Z" />
          <path className="explore-road-rider-torso" fill={`url(#${id}-jersey)`} d="M71 36 C74 27 82 19 90 17 C98 22 103 28 107 36 L98 42 L81 34 Z" />
          <path className="explore-road-rider-arm rear" stroke={`url(#${id}-skin)`} d="M87 22 L99 28 L113 39" />
          <path className="explore-road-rider-arm front" stroke={`url(#${id}-skin)`} d="M91 21 L103 28 L116 41" />
          <circle className="explore-road-rider-head" fill={`url(#${id}-skin)`} cx="91" cy="12" r="7" />
          <path className="explore-road-rider-helmet" fill={`url(#${id}-jersey)`} d="M82 11 C83 2 94 0 101 6 L98 12 L92 9 Z" />
          <path className="explore-road-rider-shorts" d="M68 34 L82 33 L84 41 L75 45 L68 41 Z" />
        </g>
      </svg>
    </div>
  );
}
