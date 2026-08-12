import { useMemo, type CSSProperties } from 'react';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { riderAnimationState, riderCrankStepCount } from '../lib/riderAnimation';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import './NorthBayGameArenaLayer.css';
import type {
  BikeSample,
  GhostPlaybackRider,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  RiderState,
  SpeedUnit,
  TrackZone,
} from '../types';

type ArenaPoint = { x: number; y: number };

type ArenaRider = {
  id: string;
  playerId: PlayerSlot['id'];
  name: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  photoUrl?: string;
  distanceMeters: number;
  rank: number;
  speedKph: number | null;
  finishedAt: number | null;
  frame: number;
  ghost: boolean;
};

type NorthBayGameArenaLayerProps = {
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  raceState: RaceState;
  trackLengthMeters: number;
  activeZones: TrackZone[];
  speedUnit: SpeedUnit;
  showHud: boolean;
};

const viewWidth = 1586;
const viewHeight = 992;

// This full-course path is registered to the North Bay illustration. Its only
// scale is the saved TrackLab route length, so rider timing and pedal-zone
// boundaries remain driven by the published mapping rather than the artwork.
const courseControlPoints: ArenaPoint[] = [
  { x: 470, y: 180 },
  { x: 720, y: 224 },
  { x: 1000, y: 286 },
  { x: 1290, y: 350 },
  { x: 1470, y: 392 },
  { x: 1540, y: 424 },
  { x: 1570, y: 470 },
  { x: 1552, y: 520 },
  { x: 1490, y: 570 },
  { x: 1320, y: 620 },
  { x: 1050, y: 684 },
  { x: 760, y: 730 },
  { x: 470, y: 770 },
  { x: 255, y: 780 },
  { x: 130, y: 760 },
  { x: 72, y: 712 },
  { x: 92, y: 660 },
  { x: 170, y: 615 },
  { x: 350, y: 582 },
  { x: 620, y: 552 },
  { x: 930, y: 526 },
  { x: 1220, y: 528 },
  { x: 1400, y: 558 },
  { x: 1460, y: 544 },
  { x: 1490, y: 506 },
  { x: 1470, y: 470 },
  { x: 1410, y: 444 },
  { x: 1280, y: 422 },
  { x: 1100, y: 405 },
  { x: 900, y: 382 },
  { x: 720, y: 354 },
  { x: 600, y: 332 },
  { x: 520, y: 310 },
];

function catmullRomPoint(
  previous: ArenaPoint,
  current: ArenaPoint,
  next: ArenaPoint,
  afterNext: ArenaPoint,
  amount: number,
): ArenaPoint {
  const squared = amount * amount;
  const cubed = squared * amount;
  return {
    x: 0.5 * ((2 * current.x)
      + (-previous.x + next.x) * amount
      + (2 * previous.x - 5 * current.x + 4 * next.x - afterNext.x) * squared
      + (-previous.x + 3 * current.x - 3 * next.x + afterNext.x) * cubed),
    y: 0.5 * ((2 * current.y)
      + (-previous.y + next.y) * amount
      + (2 * previous.y - 5 * current.y + 4 * next.y - afterNext.y) * squared
      + (-previous.y + 3 * current.y - 3 * next.y + afterNext.y) * cubed),
  };
}

function smoothCourse(points: ArenaPoint[], samplesPerSection = 10) {
  const samples: ArenaPoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    for (let sample = 0; sample < samplesPerSection; sample += 1) {
      samples.push(catmullRomPoint(previous, current, next, afterNext, sample / samplesPerSection));
    }
  }
  samples.push(points[points.length - 1]);
  return samples;
}

const coursePoints = smoothCourse(courseControlPoints);
const courseLengths = coursePoints.reduce<number[]>((lengths, point, index) => {
  if (index === 0) {
    return [0];
  }
  const previous = coursePoints[index - 1];
  return [...lengths, lengths[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y)];
}, []);
const coursePixelLength = courseLengths[courseLengths.length - 1];
const coursePath = `M ${coursePoints.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')}`;

function coursePointAtProgress(progress: number) {
  const targetLength = Math.max(0, Math.min(1, progress)) * coursePixelLength;
  let upperIndex = courseLengths.findIndex((length) => length >= targetLength);
  if (upperIndex <= 0) {
    upperIndex = 1;
  }
  const lowerIndex = upperIndex - 1;
  const lowerLength = courseLengths[lowerIndex];
  const upperLength = courseLengths[upperIndex];
  const amount = upperLength === lowerLength ? 0 : (targetLength - lowerLength) / (upperLength - lowerLength);
  const lower = coursePoints[lowerIndex];
  const upper = coursePoints[upperIndex];
  const point = {
    x: lower.x + (upper.x - lower.x) * amount,
    y: lower.y + (upper.y - lower.y) * amount,
  };
  const before = coursePoints[Math.max(0, lowerIndex - 1)];
  const after = coursePoints[Math.min(coursePoints.length - 1, upperIndex + 1)];
  return {
    ...point,
    dx: after.x - before.x,
    dy: after.y - before.y,
  };
}

function courseSlicePath(startMeter: number, endMeter: number, trackLengthMeters: number) {
  const points: ArenaPoint[] = [];
  const span = Math.max(0, endMeter - startMeter);
  const sampleCount = Math.max(2, Math.ceil(span / 2));
  for (let index = 0; index <= sampleCount; index += 1) {
    points.push(coursePointAtProgress(
      (startMeter + span * index / sampleCount) / Math.max(1, trackLengthMeters),
    ));
  }
  return `M ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')}`;
}

function riderFrame(crankStep: number) {
  return Math.min(8, Math.floor(crankStep / riderCrankStepCount * 9));
}

function ordinal(rank: number) {
  return `${rank}${rank === 1 ? 'ST' : rank === 2 ? 'ND' : rank === 3 ? 'RD' : 'TH'}`;
}

function NorthBayHud({
  riders,
  raceState,
  trackLengthMeters,
  speedUnit,
}: {
  riders: ArenaRider[];
  raceState: RaceState;
  trackLengthMeters: number;
  speedUnit: SpeedUnit;
}) {
  const entries = [...riders]
    .filter((rider) => !rider.ghost)
    .sort((left, right) => left.rank - right.rank || right.distanceMeters - left.distanceMeters)
    .slice(0, 4);
  const positionsEstablished = racePositionsAreEstablished(raceState, entries);
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="north-bay-game-hud" aria-label="North Bay BMX live timing">
      <header><span>TrackLab North Bay Live</span><span>Full course</span></header>
      <div className="north-bay-game-hud-grid">
        {entries.map((rider) => {
          const progress = Math.round(Math.max(0, Math.min(1, rider.distanceMeters / Math.max(1, trackLengthMeters))) * 100);
          return (
            <article key={rider.id} style={{ '--rider-accent': rider.accent } as CSSProperties}>
              <div className="north-bay-game-hud-rider">
                <RiderAvatar name={rider.name} photoUrl={rider.photoUrl} accent={rider.accent} />
                <strong className="north-bay-game-player-number">P{rider.playerId}</strong>
                <div><b>{rider.name}</b><span>{progress}% · {formatSpeedFromKph(rider.speedKph, speedUnit)} {speedUnitLabel(speedUnit)}</span></div>
              </div>
              <div className={`north-bay-game-place${positionsEstablished ? ' established' : ''}`}>
                {positionsEstablished ? <><b>{ordinal(rider.rank)}</b><span>Place</span></> : <span>At the gate</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function NorthBayGameArenaLayer({
  riders,
  ghostRiders,
  remoteRaceStates,
  players,
  samplesByDevice,
  raceState,
  trackLengthMeters,
  activeZones,
  speedUnit,
  showHud,
}: NorthBayGameArenaLayerProps) {
  const arenaRiders = useMemo<ArenaRider[]>(() => {
    const local = riders.flatMap((rider) => {
      const player = players.find((candidate) => candidate.id === rider.playerId);
      if (!player) return [];
      const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
      const animation = riderAnimationState({
        raceState,
        distanceMeters: rider.distance,
        pedalPhase: rider.pedalPhase,
        driveAllowed: rider.driveAllowed,
        driveSource: rider.driveSource,
        cadenceRpm: sample?.cadence ?? 0,
        watts: sample?.watts ?? 0,
      });
      return [{
        id: `local-${player.id}`,
        playerId: player.id,
        name: player.name,
        colorName: player.colorName,
        accent: player.accent,
        photoUrl: player.photoUrl,
        distanceMeters: rider.distance,
        rank: rider.rank,
        speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
        finishedAt: rider.finishedAt,
        frame: animation.pedaling ? riderFrame(animation.crankStep) : 0,
        ghost: false,
      }];
    });
    const remote = remoteRaceStates.flatMap((state) => state.riders.map((rider) => ({
      id: `remote-${state.clientId}-${rider.id}`,
      playerId: rider.playerId,
      name: rider.name,
      colorName: rider.colorName,
      accent: rider.accent,
      photoUrl: rider.photoUrl,
      distanceMeters: rider.distance,
      rank: rider.rank,
      speedKph: rider.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null),
      finishedAt: rider.finishedAt,
      frame: raceState === 'racing' && (rider.cadence ?? 0) >= 1
        ? Math.floor(Math.max(0, rider.distance) * 1.7) % 9
        : 0,
      ghost: false,
    })));
    const ghosts = ghostRiders.map((rider, index) => ({
      id: `ghost-${rider.id}`,
      playerId: ((index % 4) + 1) as PlayerSlot['id'],
      name: rider.name,
      colorName: rider.colorName,
      accent: rider.accent,
      photoUrl: undefined,
      distanceMeters: rider.distance,
      rank: rider.rank,
      speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
      finishedAt: rider.finishedAt,
      frame: raceState === 'racing' ? Math.floor(Math.max(0, rider.distance) * 1.7) % 9 : 0,
      ghost: true,
    }));
    return [...local, ...remote, ...ghosts];
  }, [ghostRiders, players, raceState, remoteRaceStates, riders, samplesByDevice]);

  const start = coursePointAtProgress(0);
  const finish = coursePointAtProgress(1);
  return (
    <div className="north-bay-game-arena" aria-label="North Bay BMX fixed full-course game view">
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="North Bay BMX course and racers">
        <image href="/assets/north-bay-game-arena.jpg" width={viewWidth} height={viewHeight} />
        <path className="north-bay-game-route-shadow" d={coursePath} />
        <path className="north-bay-game-route" d={coursePath} />
        {activeZones.filter((zone) => zone.type === 'pedal').map((zone, index) => (
          <path
            key={zone.id}
            className="north-bay-game-pedal-zone"
            d={courseSlicePath(zone.startMeter, zone.endMeter, trackLengthMeters)}
          >
            <title>{`Pedal Zone ${index + 1}: ${Math.round(zone.startMeter)}–${Math.round(zone.endMeter)} m`}</title>
          </path>
        ))}
        <g className="north-bay-game-line" transform={`translate(${start.x} ${start.y}) rotate(${Math.atan2(start.dy, start.dx) * 180 / Math.PI + 90})`}>
          <line x1="-28" y1="0" x2="28" y2="0" />
        </g>
        <g className="north-bay-game-line-label" transform={`translate(${start.x} ${start.y - 42})`}>
          <rect x="-42" y="-14" width="84" height="28" rx="7" />
          <text x="0" y="6">START</text>
        </g>
        <g className="north-bay-game-line finish" transform={`translate(${finish.x} ${finish.y}) rotate(${Math.atan2(finish.dy, finish.dx) * 180 / Math.PI + 90})`}>
          <line x1="-28" y1="0" x2="28" y2="0" />
        </g>
        <g className="north-bay-game-line-label finish" transform={`translate(${finish.x} ${finish.y - 42})`}>
          <rect x="-45" y="-14" width="90" height="28" rx="7" />
          <text x="0" y="6">FINISH</text>
        </g>
        {arenaRiders.map((rider) => {
          const position = coursePointAtProgress(rider.distanceMeters / Math.max(1, trackLengthMeters));
          const tangentLength = Math.max(1, Math.hypot(position.dx, position.dy));
          const normalX = -position.dy / tangentLength;
          const normalY = position.dx / tangentLength;
          const laneOffset = (rider.playerId - 2.5) * 10;
          const x = position.x + normalX * laneOffset;
          const y = position.y + normalY * laneOffset;
          const facesLeft = position.dx < 0;
          const lean = Math.max(-7, Math.min(7, Math.atan2(position.dy, Math.abs(position.dx)) * 180 / Math.PI));
          return (
            <foreignObject
              key={rider.id}
              x={facesLeft ? x - 12 : x - 58}
              y={y - 54}
              width="70"
              height="70"
              opacity={rider.ghost ? 0.55 : 1}
              className="north-bay-game-rider-object"
            >
              <div
                className="north-bay-game-rider"
                style={{
                  backgroundImage: `url(/assets/rider-${rider.colorName}-animated.png)`,
                  backgroundPosition: `${rider.frame * 12.5}% 0`,
                  transform: `rotate(${lean}deg) scaleX(${facesLeft ? -1 : 1})`,
                }}
                title={rider.name}
              />
            </foreignObject>
          );
        })}
      </svg>
      {showHud && (
        <NorthBayHud
          riders={arenaRiders}
          raceState={raceState}
          trackLengthMeters={trackLengthMeters}
          speedUnit={speedUnit}
        />
      )}
    </div>
  );
}
