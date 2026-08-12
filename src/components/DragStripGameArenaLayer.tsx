import { useLayoutEffect, useMemo, useRef } from 'react';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { riderAnimationState, riderCrankStepCount } from '../lib/riderAnimation';
import {
  straightSprintDistanceOptions,
  straightSprintFeetToMeters,
  straightSprintMaximumFeet,
} from '../lib/straightSprint';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import { NewRecordBadge } from './NewRecordBadge';
import type {
  BikeSample,
  DistanceUnit,
  GhostPlaybackRider,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  RiderState,
  SpeedUnit,
} from '../types';
import type { PersonalRecordAchievements } from '../lib/personalRecords';

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
  local: boolean;
};

type DragStripGameArenaLayerProps = {
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  raceState: RaceState;
  startGateActive: boolean;
  startGatePhase: 'idle' | 'staging' | 'cadence' | 'false-start' | 'go';
  raceDistanceMeters: number;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  showHud: boolean;
  newPersonalRecordsByPlayer: PersonalRecordAchievements;
};

type ArenaViewport = {
  id: string;
  riders: ArenaRider[];
};

// Keep the short-sprint scale readable: the start line remains near the left
// edge and the 30-foot marker lands halfway across the initial viewport. The
// full 1,500-foot course then continues at that exact scale as the camera
// scrolls, without changing race distance, timing, or rollout physics.
const arenaStartViewportPercent = 12;
const arenaThirtyFootViewportPercent = 50;
const arenaFinishViewportPaddingPercent = 12;
const arenaThirtyFootSpanViewportPercent = arenaThirtyFootViewportPercent - arenaStartViewportPercent;
const arenaCourseViewportPercent = straightSprintMaximumFeet / 30 * arenaThirtyFootSpanViewportPercent;
const arenaWorldWidth = (
  arenaStartViewportPercent
  + arenaCourseViewportPercent
  + arenaFinishViewportPaddingPercent
);
const arenaWorldScale = arenaWorldWidth / 100;
const arenaViewportWidth = 100 / (arenaWorldWidth / 100);
// The course is much wider than the viewport so 30 feet can occupy half the
// screen. Do not paint a full-size photo into every course segment: that made
// laptop browsers composite roughly twenty 1,600px-wide photos every frame.
// Four viewport-sized tiles are enough for an endlessly recycled backdrop.
const arenaBackgroundTileCount = 4;
const arenaStartPercent = arenaStartViewportPercent / arenaWorldScale;
const arenaFinishPercent = 100 - arenaFinishViewportPaddingPercent / arenaWorldScale;
const arenaTrackTopPercent = 48;
const arenaTrackBottomPercent = 69;
const arenaLaneHeightPercent = (arenaTrackBottomPercent - arenaTrackTopPercent) / 4;
const arenaCourseDistanceMeters = straightSprintFeetToMeters(straightSprintMaximumFeet);
const arenaLaneCenters = [0, 1, 2, 3].map(
  (laneIndex) => arenaTrackTopPercent + arenaLaneHeightPercent * (laneIndex + 0.5),
);
// The route-distance coordinate represents the leading edge of the front tire.
// The wheel is 61.5% across the inner 92%-wide sprite box and is 33.5% wide.
const arenaFrontTireAnchorPercent = 4 + (0.92 * (61.5 + 33.5));
const arenaCameraEaseMs = 180;
const arenaCameraRiderPaddingRatio = 0.16;

function applyArenaWorldCamera(
  element: HTMLDivElement,
  scrollPercent: number,
  viewportPercent: number,
  backgroundStrip?: HTMLDivElement | null,
) {
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const viewportWidthPixels = element.parentElement?.clientWidth ?? window.innerWidth;
  const cameraScale = arenaViewportWidth / viewportPercent;
  const offsetPixels = viewportWidthPixels * scrollPercent / viewportPercent;
  const pixelAlignedOffset = Math.round(offsetPixels * devicePixelRatio) / devicePixelRatio;
  element.style.transform = `translate3d(-${pixelAlignedOffset}px, 0, 0) scaleX(${cameraScale})`;
  const inverseScale = String(1 / cameraScale);
  if (element.style.getPropertyValue('--arena-camera-inverse-scale') !== inverseScale) {
    element.style.setProperty('--arena-camera-inverse-scale', inverseScale);
  }
  element.dataset.cameraScrollPercent = scrollPercent.toFixed(3);
  element.dataset.cameraViewportPercent = viewportPercent.toFixed(3);
  if (backgroundStrip) {
    const backgroundCyclePixels = Math.max(1, viewportWidthPixels * 2);
    const backgroundOffset = ((pixelAlignedOffset % backgroundCyclePixels) + backgroundCyclePixels)
      % backgroundCyclePixels;
    backgroundStrip.style.transform = `translate3d(-${backgroundOffset}px, 0, 0)`;
  }
}

function BmxStartGate({
  phase,
  raceState,
}: {
  phase: DragStripGameArenaLayerProps['startGatePhase'];
  raceState: RaceState;
}) {
  // App sets phase="go" only after the UCI green tone (the fourth beep), so
  // the visual plate and the race-input release share the same gate-drop edge.
  const rearming = phase === 'staging' || phase === 'cadence' || phase === 'false-start';
  const dropped = !rearming && (
    phase === 'go' || raceState === 'racing' || raceState === 'finished'
  );
  const falseStart = phase === 'false-start';

  return (
    <div
      aria-label="BMX start gate"
      data-arena-start-gate
      data-gate-phase={phase}
      data-gate-state={dropped ? 'dropped' : 'upright'}
      style={{
        position: 'absolute',
        zIndex: 12,
        top: `${arenaTrackTopPercent}%`,
        left: `${arenaStartPercent}%`,
        width: 'clamp(18px, 1.7vw, 29px)',
        height: `${arenaTrackBottomPercent - arenaTrackTopPercent}%`,
        pointerEvents: 'none',
        transform: 'translateX(-50%)',
      }}
    >
      {arenaLaneCenters.map((laneCenter, laneIndex) => {
        const laneTop = arenaTrackTopPercent + arenaLaneHeightPercent * laneIndex;
        const localLaneCenter = ((laneCenter - arenaTrackTopPercent) / (arenaTrackBottomPercent - arenaTrackTopPercent)) * 100;
        const localLaneBottom = ((laneTop + arenaLaneHeightPercent - arenaTrackTopPercent)
          / (arenaTrackBottomPercent - arenaTrackTopPercent)) * 100;
        return (
          <div key={`start-gate-lane-${laneIndex + 1}`}>
            <div
              aria-hidden="true"
              data-start-platform-lane={laneIndex + 1}
              style={{
                position: 'absolute',
                zIndex: 0,
                top: `${localLaneCenter}%`,
                right: '50%',
                width: 'clamp(42px, 4.8vw, 76px)',
                height: 'clamp(6px, .7vh, 10px)',
                borderTop: '1px solid rgba(230,236,241,.72)',
                borderBottom: '2px solid rgba(5,8,11,.76)',
                background: 'linear-gradient(180deg, #aab3ba 0 20%, #4e5962 21% 58%, #202830 59% 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.42), 0 3px 5px rgba(0,0,0,.42)',
                clipPath: 'polygon(0 45%, 100% 0, 100% 100%, 0 82%)',
                transform: 'translateY(-18%)',
              }}
            />
            <div
              data-start-gate-lane={laneIndex + 1}
              style={{
                position: 'absolute',
                zIndex: 2,
                top: `${localLaneCenter}%`,
                left: '50%',
                width: 'clamp(7px, .65vw, 11px)',
                height: `${Math.max(48, localLaneBottom - localLaneCenter + 42)}%`,
                maxHeight: 'clamp(23px, 3.1vh, 38px)',
                border: `1px solid ${falseStart ? '#ff4d4d' : dropped ? '#d8ff3e' : '#d7dde3'}`,
                borderRadius: '2px 2px 1px 1px',
                backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,.34) 0 1px, transparent 1px 5px), linear-gradient(90deg, #626c75, #d3d9de 48%, #59636c)',
                boxShadow: falseStart
                  ? '0 0 8px rgba(255,77,77,.78), inset 0 0 0 1px rgba(255,255,255,.28)'
                  : '0 2px 5px rgba(0,0,0,.58), inset 0 0 0 1px rgba(255,255,255,.28)',
                transformOrigin: '0 100%',
                transform: dropped
                  ? 'translate(0, -100%) rotate(86deg)'
                  : 'translate(0, -100%) rotate(0deg)',
                transition: dropped
                  ? 'transform 210ms cubic-bezier(.55,.02,.92,.42), border-color 120ms linear'
                  : 'transform 360ms cubic-bezier(.2,.72,.28,1), border-color 120ms linear',
                willChange: 'transform',
              }}
            />
            <div aria-hidden="true" style={{
              position: 'absolute',
              zIndex: 4,
              top: `${localLaneCenter}%`,
              left: '50%',
              width: 'clamp(7px, .65vw, 10px)',
              aspectRatio: '1',
              border: '1px solid rgba(232,237,241,.9)',
              borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 32%, #e7ecef 0 14%, #75818a 18% 48%, #222a31 52% 100%)',
              boxShadow: '0 1px 3px rgba(0,0,0,.65)',
              transform: 'translate(-50%, -50%)',
            }} />
          </div>
        );
      })}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          zIndex: 3,
          top: 0,
          bottom: 0,
          left: '50%',
          width: '3px',
          borderRadius: '1px',
          background: 'linear-gradient(90deg, #313a42, #aeb7be 52%, #3e4850)',
          boxShadow: '1px 1px 3px rgba(0,0,0,.48)',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function dragStripAdaptiveCameraWindow(riderWorldPositions: number[]) {
  const safePositions = riderWorldPositions.filter(Number.isFinite).map((position) => (
    clamp(position, 0, 100)
  ));
  const minimumRiderWorldPercent = safePositions.length > 0
    ? Math.min(...safePositions)
    : arenaStartPercent;
  const maximumRiderWorldPercent = safePositions.length > 0
    ? Math.max(...safePositions)
    : arenaStartPercent;
  const riderWorldSpreadPercent = maximumRiderWorldPercent - minimumRiderWorldPercent;
  const viewportPercent = clamp(
    Math.max(
      arenaViewportWidth,
      riderWorldSpreadPercent / (1 - arenaCameraRiderPaddingRatio * 2),
    ),
    arenaViewportWidth,
    100,
  );
  const riderCenterPercent = (minimumRiderWorldPercent + maximumRiderWorldPercent) / 2;
  return {
    scrollPercent: clamp(
      riderCenterPercent - viewportPercent / 2,
      0,
      100 - viewportPercent,
    ),
    viewportPercent,
  };
}

function progressToWorldPercent(distanceMeters: number, raceDistanceMeters: number) {
  const progress = clamp(distanceMeters / Math.max(1, raceDistanceMeters), 0, 1);
  return arenaStartPercent + progress * (arenaFinishPercent - arenaStartPercent);
}

function SprintDistanceMarkers({
  raceDistanceMeters,
  distanceUnit,
}: {
  raceDistanceMeters: number;
  distanceUnit: DistanceUnit;
}) {
  return (
    <div aria-label="Trackside marker posts" data-arena-distance-markers>
      {straightSprintDistanceOptions.map((distanceFeet) => {
        const distanceMeters = straightSprintFeetToMeters(distanceFeet);
        const markerLabel = distanceUnit === 'm'
          ? `${Math.round(distanceMeters).toLocaleString()} m`
          : `${distanceFeet.toLocaleString()}′`;
        const isActiveFinish = Math.abs(
          distanceMeters - raceDistanceMeters,
        ) < 0.2;
        return (
          <div
            key={`arena-distance-marker-${distanceFeet}`}
            aria-label={`${markerLabel} marker`}
            data-active-finish={isActiveFinish ? 'true' : 'false'}
            data-distance-feet={distanceFeet}
            data-distance-meters={distanceMeters.toFixed(3)}
            data-world-percent={progressToWorldPercent(
              distanceMeters,
              arenaCourseDistanceMeters,
            ).toFixed(4)}
            style={{
              position: 'absolute',
              zIndex: 8,
              top: `${arenaTrackTopPercent - 0.8}%`,
              left: `${progressToWorldPercent(distanceMeters, arenaCourseDistanceMeters)}%`,
              pointerEvents: 'none',
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div data-arena-marker-label style={{
              display: 'grid',
              minWidth: 'clamp(48px, 4.3vw, 72px)',
              minHeight: 'clamp(30px, 3.5vh, 44px)',
              padding: '4px 8px',
              placeItems: 'center',
              border: `3px solid ${isActiveFinish ? '#ffffff' : '#d8ff3e'}`,
              borderRadius: '7px',
              background: '#05080c',
              boxShadow: isActiveFinish
                ? 'inset 0 0 0 1px rgba(255,255,255,.28), 0 0 10px rgba(255,255,255,.58)'
                : 'inset 0 0 0 1px rgba(255,255,255,.16), 0 4px 10px rgba(0,0,0,.72)',
              color: '#ffffff',
              fontSize: 'clamp(13px, 1.15vw, 18px)',
              fontWeight: 1000,
              letterSpacing: '.01em',
              lineHeight: 1,
              textShadow: '0 1px 2px #000000',
              whiteSpace: 'nowrap',
              transform: `${isActiveFinish ? 'translateX(62%) ' : ''}scaleX(var(--arena-camera-inverse-scale, 1))`,
            }}>
              {markerLabel}
            </div>
            <div aria-hidden="true" style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              width: '4px',
              height: 'clamp(9px, 1.4vh, 17px)',
              border: '1px solid rgba(230,236,241,.72)',
              borderTop: 0,
              background: 'linear-gradient(90deg, #4a555f, #d2d8dd 50%, #46515b)',
              boxShadow: '1px 2px 3px rgba(0,0,0,.5)',
              transform: 'translateX(-50%)',
            }} />
          </div>
        );
      })}
    </div>
  );
}

function riderFrame(crankStep: number) {
  return Math.min(8, Math.floor(crankStep / riderCrankStepCount * 9));
}

function ordinal(value: number) {
  return `${value}${value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'}`;
}

function GameArenaHud({
  riders,
  raceState,
  raceDistanceMeters,
  speedUnit,
  distanceUnit,
  newPersonalRecordsByPlayer,
}: {
  riders: ArenaRider[];
  raceState: RaceState;
  raceDistanceMeters: number;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  newPersonalRecordsByPlayer: PersonalRecordAchievements;
}) {
  const entries = [...riders]
    .sort((left, right) => left.rank - right.rank || right.distanceMeters - left.distanceMeters)
    .slice(0, 4);
  const positionsEstablished = racePositionsAreEstablished(raceState, entries);

  if (entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Game arena rider data"
      style={{
        position: 'absolute',
        zIndex: 1200,
        right: 'clamp(10px, 2vw, 30px)',
        bottom: 'clamp(10px, 1.8vh, 22px)',
        left: 'clamp(10px, 2vw, 30px)',
        minHeight: 'clamp(150px, 20vh, 218px)',
        padding: 'clamp(8px, 1vw, 13px)',
        overflow: 'hidden',
        border: '2px solid rgba(214, 224, 235, .78)',
        borderRadius: '10px',
        background: 'linear-gradient(180deg, rgba(18, 25, 34, .96), rgba(4, 8, 13, .97))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.28), inset 0 -3px 0 #080b10, 0 14px 34px rgba(0,0,0,.58)',
        color: '#ffffff',
      }}
    >
      <div style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.18,
        pointerEvents: 'none',
        backgroundImage: 'linear-gradient(115deg, transparent 0 35%, rgba(255,255,255,.18) 45%, transparent 55% 100%), repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 1px, transparent 1px 7px)',
      }} />
      <header style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        minHeight: '25px',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '0 4px 7px',
        color: 'rgba(255,255,255,.78)',
        fontSize: 'clamp(9px, .8vw, 12px)',
        fontWeight: 900,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
      }}>
        <span>TrackLab Live Timing</span>
        <span>{formatDistanceMeters(raceDistanceMeters, distanceUnit)} sprint</span>
      </header>
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(4, entries.length)}, minmax(0, 1fr))`,
        gap: 'clamp(6px, .7vw, 12px)',
        minHeight: 'clamp(112px, 15vh, 166px)',
      }}>
        {entries.map((rider) => {
          const progress = Math.round(Math.max(0, Math.min(1, rider.distanceMeters / Math.max(1, raceDistanceMeters))) * 100);
          return (
            <article
              key={rider.id}
              className="game-arena-hud-card"
              style={{
                display: 'grid',
                gridTemplateRows: 'auto minmax(52px, 1fr)',
                minWidth: 0,
                overflow: 'hidden',
                border: `1px solid ${rider.accent}`,
                borderTop: `4px solid ${rider.accent}`,
                borderRadius: '7px',
                background: 'linear-gradient(145deg, rgba(35,45,58,.96), rgba(10,15,22,.98))',
                boxShadow: `inset 0 0 18px ${rider.accent}20, 0 5px 12px rgba(0,0,0,.34)`,
              }}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto auto minmax(0, 1fr)',
                minWidth: 0,
                alignItems: 'center',
                gap: 'clamp(5px, .6vw, 9px)',
                padding: 'clamp(5px, .6vw, 9px)',
              }}>
                <RiderAvatar
                  name={rider.name}
                  photoUrl={rider.photoUrl}
                  accent={rider.accent}
                />
                <strong style={{
                  display: 'grid',
                  width: 'clamp(34px, 3vw, 46px)',
                  height: 'clamp(30px, 2.8vw, 42px)',
                  placeItems: 'center',
                  borderRadius: '6px',
                  background: rider.accent,
                  color: '#07101b',
                  fontSize: 'clamp(13px, 1.2vw, 18px)',
                  fontWeight: 1000,
                }}>P{rider.playerId}</strong>
                <div style={{ display: 'grid', minWidth: 0, gap: '2px' }}>
                  <strong style={{
                    overflow: 'hidden',
                    fontSize: 'clamp(13px, 1.3vw, 20px)',
                    lineHeight: 1.05,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>{rider.name}</strong>
                  <span style={{
                    overflow: 'hidden',
                    color: newPersonalRecordsByPlayer[rider.playerId] && rider.local ? '#f87171' : 'rgba(255,255,255,.82)',
                    fontSize: 'clamp(10px, .85vw, 14px)',
                    fontWeight: newPersonalRecordsByPlayer[rider.playerId] && rider.local ? 1000 : 800,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {newPersonalRecordsByPlayer[rider.playerId] && rider.local
                      ? `${((rider.finishedAt ?? 0) / 1000).toFixed(2)}s finish`
                      : `${progress}% track · ${formatSpeedFromKph(rider.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`}
                  </span>
                  {newPersonalRecordsByPlayer[rider.playerId] && rider.local && (
                    <NewRecordBadge />
                  )}
                </div>
              </div>
              <div style={{
                display: 'flex',
                minHeight: 0,
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                margin: '0 clamp(5px, .6vw, 9px) clamp(5px, .6vw, 9px)',
                borderRadius: '5px',
                background: positionsEstablished ? rider.accent : 'rgba(255,255,255,.08)',
                color: positionsEstablished ? '#07101b' : 'rgba(255,255,255,.72)',
                textTransform: 'uppercase',
              }}>
                {positionsEstablished ? (
                  <>
                    <strong style={{
                      fontSize: 'clamp(34px, 4.3vw, 68px)',
                      fontWeight: 1000,
                      letterSpacing: '-.06em',
                      lineHeight: .88,
                    }}>{ordinal(rider.rank)}</strong>
                    <span style={{ fontSize: 'clamp(9px, .8vw, 13px)', fontWeight: 950, letterSpacing: '.1em' }}>Place</span>
                  </>
                ) : (
                  <span style={{ fontSize: 'clamp(11px, 1vw, 15px)', fontWeight: 900, letterSpacing: '.14em' }}>At the gate</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ArenaPanel({
  group,
  riders,
  raceDistanceMeters,
  raceState,
  startGatePhase,
  distanceUnit,
}: {
  group: ArenaViewport;
  riders: ArenaRider[];
  raceDistanceMeters: number;
  raceState: RaceState;
  startGatePhase: DragStripGameArenaLayerProps['startGatePhase'];
  distanceUnit: DistanceUnit;
}) {
  const visibleRiders = riders;
  const riderWorldPositions = visibleRiders.map((rider) => (
    progressToWorldPercent(rider.distanceMeters, arenaCourseDistanceMeters)
  ));
  const {
    scrollPercent,
    viewportPercent: cameraViewportPercent,
  } = dragStripAdaptiveCameraWindow(riderWorldPositions);
  const leadRider = [...group.riders].sort((left, right) => right.distanceMeters - left.distanceMeters)[0];
  const worldRef = useRef<HTMLDivElement>(null);
  const backgroundStripRef = useRef<HTMLDivElement>(null);
  const cameraScrollRef = useRef(scrollPercent);
  const cameraViewportRef = useRef(cameraViewportPercent);
  const cameraTargetRef = useRef(scrollPercent);
  const cameraViewportTargetRef = useRef(cameraViewportPercent);
  const cameraFrameRef = useRef<number | null>(null);
  const cameraFrameTimeRef = useRef(0);
  const smoothCamera = raceState === 'racing' || raceState === 'finished';

  useLayoutEffect(() => {
    cameraTargetRef.current = scrollPercent;
    cameraViewportTargetRef.current = cameraViewportPercent;
    const world = worldRef.current;
    if (!world) {
      return;
    }

    if (!smoothCamera) {
      if (cameraFrameRef.current != null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
        cameraFrameRef.current = null;
      }
      cameraScrollRef.current = scrollPercent;
      cameraViewportRef.current = cameraViewportPercent;
      applyArenaWorldCamera(world, scrollPercent, cameraViewportPercent, backgroundStripRef.current);
      return;
    }

    if (cameraFrameRef.current != null) {
      return;
    }

    cameraFrameTimeRef.current = window.performance.now();
    const updateCamera = (now: number) => {
      const elapsedMs = Math.min(64, Math.max(0, now - cameraFrameTimeRef.current));
      cameraFrameTimeRef.current = now;
      const current = cameraScrollRef.current;
      const target = cameraTargetRef.current;
      const currentViewport = cameraViewportRef.current;
      const targetViewport = cameraViewportTargetRef.current;
      const ease = 1 - Math.exp(-elapsedMs / arenaCameraEaseMs);
      const next = Math.abs(target - current) < 0.0001
        ? target
        : current + (target - current) * ease;
      const nextViewport = Math.abs(targetViewport - currentViewport) < 0.0001
        ? targetViewport
        : currentViewport + (targetViewport - currentViewport) * ease;
      cameraScrollRef.current = next;
      cameraViewportRef.current = nextViewport;
      applyArenaWorldCamera(world, next, nextViewport, backgroundStripRef.current);

      if (
        Math.abs(cameraTargetRef.current - next) < 0.0001
        && Math.abs(cameraViewportTargetRef.current - nextViewport) < 0.0001
      ) {
        cameraScrollRef.current = cameraTargetRef.current;
        cameraViewportRef.current = cameraViewportTargetRef.current;
        applyArenaWorldCamera(
          world,
          cameraTargetRef.current,
          cameraViewportTargetRef.current,
          backgroundStripRef.current,
        );
        cameraFrameRef.current = null;
        return;
      }
      cameraFrameRef.current = window.requestAnimationFrame(updateCamera);
    };
    cameraFrameRef.current = window.requestAnimationFrame(updateCamera);
  }, [cameraViewportPercent, scrollPercent, smoothCamera]);

  useLayoutEffect(() => () => {
    if (cameraFrameRef.current != null) {
      window.cancelAnimationFrame(cameraFrameRef.current);
    }
  }, []);

  return (
    <section
      className="explore-map-panel"
      aria-label={group.riders.length > 0
        ? `Game arena for ${group.riders.map((rider) => rider.name).join(', ')}`
        : 'Drag Strip game arena preview'}
      style={{ width: '100%', height: '100%', background: '#121820' }}
    >
      <div
        aria-hidden="true"
        data-arena-background
        style={{ position: 'absolute', zIndex: 0, inset: 0, overflow: 'hidden' }}
      >
        <div
          ref={backgroundStripRef}
          data-arena-background-strip
          style={{
            position: 'absolute',
            inset: 0,
            width: '400%',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
          }}
        >
          {Array.from({ length: arenaBackgroundTileCount }, (_, tileIndex) => (
            <div
              key={`arena-background-tile-${tileIndex}`}
              data-arena-background-tile={tileIndex}
              data-tile-mirrored={tileIndex % 2 === 1 ? 'true' : 'false'}
              style={{
                position: 'absolute',
                insetBlock: 0,
                left: `${tileIndex * 25}%`,
                width: '25%',
                overflow: 'hidden',
              }}
            >
              <div style={{
                position: 'absolute',
                inset: '-1px',
                backgroundImage: 'linear-gradient(rgba(5, 10, 16, 0.02), rgba(5, 10, 16, 0.22)), url(/assets/drag-strip-game-arena.jpg)',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'cover',
                transform: tileIndex % 2 === 1 ? 'scaleX(-1)' : 'none',
                backfaceVisibility: 'hidden',
              }} />
            </div>
          ))}
        </div>
      </div>
      {arenaLaneCenters.map((_, laneIndex) => (
        <div
          key={`arena-lane-band-${laneIndex + 1}`}
          aria-hidden="true"
          data-arena-lane-band={laneIndex + 1}
          style={{
            position: 'absolute',
            zIndex: 1,
            top: `${arenaTrackTopPercent + arenaLaneHeightPercent * laneIndex}%`,
            left: 0,
            width: '100%',
            height: `${arenaLaneHeightPercent}%`,
            borderTop: '1px solid rgba(218, 224, 232, .66)',
            borderBottom: laneIndex === 3 ? '2px solid rgba(218, 224, 232, .84)' : undefined,
            backgroundColor: '#17191c',
            backgroundImage: 'linear-gradient(180deg, rgba(4,6,8,.15), rgba(0,0,0,.28)), url(/assets/drag-strip-asphalt.jpg)',
            backgroundPosition: `center, ${laneIndex * 67}px ${laneIndex * 83}px`,
            backgroundSize: '100% 100%, 420px 420px',
            boxShadow: laneIndex === 0 ? 'inset 0 2px 0 rgba(255,255,255,.12)' : undefined,
          }}
        />
      ))}
      <div
        ref={worldRef}
        data-arena-world
        data-camera-layout="adaptive-single"
        data-camera-scroll-percent={scrollPercent.toFixed(3)}
        data-camera-viewport-percent={cameraViewportPercent.toFixed(3)}
        style={{
          position: 'absolute',
          zIndex: 2,
          inset: 0,
          width: `${arenaWorldWidth}%`,
          overflow: 'hidden',
          background: 'transparent',
          transform: 'translate3d(0, 0, 0)',
          transformOrigin: 'left top',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        <div data-arena-start-line style={{
          position: 'absolute',
          zIndex: 5,
          top: `${arenaTrackTopPercent}%`,
          bottom: `${100 - arenaTrackBottomPercent}%`,
          left: `${arenaStartPercent}%`,
          width: '4px',
          background: '#d8ff3e',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(216,255,62,.8)',
        }} />
        <BmxStartGate phase={startGatePhase} raceState={raceState} />
        <div data-arena-finish-line style={{
          position: 'absolute',
          zIndex: 5,
          top: `${arenaTrackTopPercent}%`,
          bottom: `${100 - arenaTrackBottomPercent}%`,
          left: `${progressToWorldPercent(raceDistanceMeters, arenaCourseDistanceMeters)}%`,
          width: '5px',
          background: '#ffffff',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(255,255,255,.8)',
        }} />
        <SprintDistanceMarkers
          raceDistanceMeters={raceDistanceMeters}
          distanceUnit={distanceUnit}
        />
        <div style={{
          position: 'absolute',
          zIndex: 6,
          top: `${arenaTrackTopPercent - 5}%`,
          left: `${arenaStartPercent}%`,
          padding: '4px 8px',
          border: '2px solid #d8ff3e',
          borderRadius: '5px',
          background: '#111827',
          color: '#ffffff',
          fontSize: 'clamp(8px, .8vw, 12px)',
          fontWeight: 950,
          transform: 'translateX(-50%) scaleX(var(--arena-camera-inverse-scale, 1))',
        }}>START</div>
        <div style={{
          position: 'absolute',
          zIndex: 6,
          top: `${arenaTrackTopPercent - 5}%`,
          left: `${progressToWorldPercent(raceDistanceMeters, arenaCourseDistanceMeters)}%`,
          padding: '4px 8px',
          border: '2px solid #ffffff',
          borderRadius: '5px',
          background: '#111827',
          color: '#ffffff',
          fontSize: 'clamp(8px, .8vw, 12px)',
          fontWeight: 950,
          transform: 'translateX(-50%) scaleX(var(--arena-camera-inverse-scale, 1))',
        }}>FINISH</div>
        {arenaLaneCenters.map((laneCenter, laneIndex) => {
          const player = riders.find((rider) => rider.playerId === laneIndex + 1);
          return (
            <div
              key={`arena-lane-${laneIndex + 1}`}
              aria-hidden="true"
              data-arena-lane-label={laneIndex + 1}
              style={{
                position: 'absolute',
                zIndex: 80,
                top: `${laneCenter}%`,
                left: `${arenaStartPercent + 1.15}%`,
                minWidth: 'clamp(22px, 2vw, 30px)',
                padding: '2px 5px',
                border: `1px solid ${player?.accent ?? 'rgba(255,255,255,.6)'}`,
                borderRadius: '999px',
                background: 'rgba(8, 13, 20, .82)',
                boxShadow: '0 2px 6px rgba(0,0,0,.42)',
                color: '#ffffff',
                fontSize: 'clamp(7px, .65vw, 10px)',
                fontWeight: 950,
                lineHeight: 1.1,
                textAlign: 'center',
                transform: 'translateY(-50%) scaleX(var(--arena-camera-inverse-scale, 1))',
              }}
            >P{laneIndex + 1}</div>
          );
        })}
        {visibleRiders.map((rider) => {
          const left = progressToWorldPercent(rider.distanceMeters, arenaCourseDistanceMeters);
          const laneCenter = arenaLaneCenters[rider.playerId - 1];
          return (
            <div
              key={rider.id}
              aria-label={`${rider.name} arena rider`}
              data-lane={rider.playerId}
              data-lane-center={laneCenter}
              data-distance-meters={rider.distanceMeters.toFixed(3)}
              data-progress={(rider.distanceMeters / Math.max(1, raceDistanceMeters)).toFixed(4)}
              style={{
                position: 'absolute',
                zIndex: 20 + rider.playerId,
                top: `${laneCenter}%`,
                left: `${left}%`,
                width: 'clamp(62px, 5.2vw, 84px)',
                aspectRatio: '1',
                opacity: rider.ghost ? 0.6 : 1,
                transform: `translate3d(-${arenaFrontTireAnchorPercent}%, -75%, 0)`,
                willChange: 'left, transform',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: '4%',
                  filter: 'brightness(1.04) contrast(1.08) drop-shadow(0 3px 2px rgba(0,0,0,.48))',
                  transform: 'scaleX(var(--arena-camera-inverse-scale, 1))',
                }}
              >
                {[6.2, 61.5].map((wheelLeft, wheelIndex) => (
                  <div
                    key={`${rider.id}-wheel-${wheelIndex}`}
                    data-arena-wheel={wheelIndex === 0 ? 'rear' : 'front'}
                    style={{
                      position: 'absolute',
                      zIndex: 2,
                      top: '60.2%',
                      left: `${wheelLeft}%`,
                      width: '33.5%',
                      aspectRatio: '1',
                      boxSizing: 'border-box',
                      border: '2px solid #07090b',
                      borderRadius: '50%',
                      boxShadow: 'inset 0 0 0 1px rgba(225,230,235,.22)',
                    }}
                  />
                ))}
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 1,
                    inset: 0,
                  backgroundImage: `url(/assets/rider-${rider.colorName}-animated.png)`,
                  backgroundPosition: `${rider.frame * 12.5}% 0`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '900% 100%',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="explore-map-group-label" style={{ left: 'auto', right: '12px' }}>
        <strong>
          {group.riders.length === 0
            ? 'Drag Strip preview'
            : group.riders.length === 1
              ? leadRider?.name
              : `${group.riders.length} riders together`}
        </strong>
        <span>{formatDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} down the strip</span>
      </div>
    </section>
  );
}

export function DragStripGameArenaLayer({
  riders,
  ghostRiders,
  remoteRaceStates,
  players,
  samplesByDevice,
  raceState,
  startGateActive,
  startGatePhase,
  raceDistanceMeters,
  speedUnit,
  distanceUnit,
  showHud,
  newPersonalRecordsByPlayer,
}: DragStripGameArenaLayerProps) {
  const arenaRiders = useMemo<ArenaRider[]>(() => {
    const local = riders.flatMap((rider) => {
      const player = players.find((candidate) => candidate.id === rider.playerId);
      if (!player) {
        return [];
      }
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
        local: true,
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
      local: false,
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
      local: false,
    }));
    return [...local, ...remote, ...ghosts];
  }, [ghostRiders, players, raceState, remoteRaceStates, riders, samplesByDevice]);
  const activeRiders = arenaRiders.filter((rider) => !rider.ghost);
  const arenaViewport: ArenaViewport = {
    id: 'drag-strip-adaptive-viewport',
    riders: activeRiders,
  };

  return (
    <div
      aria-label="Drag Strip Game Arena"
      data-race-distance-meters={raceDistanceMeters.toFixed(3)}
      data-start-gate-active={startGateActive ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div data-arena-adaptive-viewport style={{
        position: 'absolute',
        inset: 0,
        height: '100%',
        minHeight: 0,
        borderRadius: 0,
        overflow: 'hidden',
      }}>
        <ArenaPanel
          group={arenaViewport}
          riders={arenaRiders}
          raceDistanceMeters={raceDistanceMeters}
          raceState={raceState}
          startGatePhase={startGatePhase}
          distanceUnit={distanceUnit}
        />
      </div>
      {showHud && (
        <GameArenaHud
          riders={arenaRiders}
          raceState={raceState}
          raceDistanceMeters={raceDistanceMeters}
          speedUnit={speedUnit}
          distanceUnit={distanceUnit}
          newPersonalRecordsByPlayer={newPersonalRecordsByPlayer}
        />
      )}
    </div>
  );
}
