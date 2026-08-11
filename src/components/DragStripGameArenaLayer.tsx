import { useMemo, type CSSProperties } from 'react';
import { exploreGridClass, groupExploreRiders, type ExploreViewportGroup } from '../lib/explore';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { riderAnimationState, riderCrankStepCount } from '../lib/riderAnimation';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import type {
  BikeSample,
  ExploreRider,
  GhostPlaybackRider,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  RiderState,
  SpeedUnit,
} from '../types';

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

type DragStripGameArenaLayerProps = {
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  raceState: RaceState;
  raceDistanceMeters: number;
  speedUnit: SpeedUnit;
  showHud: boolean;
};

const arenaWorldWidth = 310;
const arenaViewportWidth = 100 / (arenaWorldWidth / 100);
const arenaStartPercent = 4;
const arenaFinishPercent = 96;
const arenaTrackTopPercent = 48;
const arenaTrackBottomPercent = 69;
const arenaLaneHeightPercent = (arenaTrackBottomPercent - arenaTrackTopPercent) / 4;
const arenaLaneCenters = [0, 1, 2, 3].map(
  (laneIndex) => arenaTrackTopPercent + arenaLaneHeightPercent * (laneIndex + 0.5),
);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function progressToWorldPercent(distanceMeters: number, raceDistanceMeters: number) {
  const progress = clamp(distanceMeters / Math.max(1, raceDistanceMeters), 0, 1);
  return arenaStartPercent + progress * (arenaFinishPercent - arenaStartPercent);
}

function gridStyle(groupCount: number): CSSProperties {
  if (groupCount <= 1) {
    return { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' };
  }
  if (groupCount === 2) {
    return { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'minmax(0, 1fr)' };
  }
  return {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
  };
}

function panelSpanStyle(groupCount: number, index: number): CSSProperties | undefined {
  return groupCount === 3 && index === 0 ? { gridRow: '1 / -1' } : undefined;
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
}: {
  riders: ArenaRider[];
  raceState: RaceState;
  raceDistanceMeters: number;
  speedUnit: SpeedUnit;
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
        <span>{Math.round(raceDistanceMeters * 3.28084).toLocaleString()} ft sprint</span>
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
                    color: 'rgba(255,255,255,.82)',
                    fontSize: 'clamp(10px, .85vw, 14px)',
                    fontWeight: 800,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {progress}% track · {formatSpeedFromKph(rider.speedKph, speedUnit)} {speedUnitLabel(speedUnit)}
                  </span>
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
}: {
  group: ExploreViewportGroup;
  riders: ArenaRider[];
  raceDistanceMeters: number;
}) {
  const groupRiders = riders.filter((rider) => group.riders.some((member) => member.id === rider.id));
  const nearbyGhosts = riders.filter((rider) => rider.ghost && (
    rider.distanceMeters >= group.startMeter - 70
    && rider.distanceMeters <= group.endMeter + 70
  ));
  const visibleRiders = [...groupRiders, ...nearbyGhosts];
  const centerMeter = group.riders.length > 0
    ? group.riders.reduce((sum, rider) => sum + rider.distanceMeters, 0) / group.riders.length
    : 0;
  const centerPercent = progressToWorldPercent(centerMeter, raceDistanceMeters);
  const scrollPercent = clamp(
    centerPercent - arenaViewportWidth / 2,
    0,
    100 - arenaViewportWidth,
  );
  const leadRider = [...group.riders].sort((left, right) => right.distanceMeters - left.distanceMeters)[0];

  return (
    <section
      className="explore-map-panel"
      aria-label={group.riders.length > 0
        ? `Game arena for ${group.riders.map((rider) => rider.name).join(', ')}`
        : 'Drag Strip game arena preview'}
      style={{ width: '100%', height: '100%', background: '#121820' }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${arenaWorldWidth}%`,
          overflow: 'hidden',
          backgroundImage: 'linear-gradient(rgba(5, 10, 16, 0.02), rgba(5, 10, 16, 0.22)), url(/assets/drag-strip-game-arena.jpg)',
          backgroundPosition: 'left center',
          backgroundRepeat: 'repeat-x',
          backgroundSize: `${100 / (arenaWorldWidth / 100)}% 100%`,
          transform: `translate3d(-${scrollPercent}%, 0, 0)`,
          transition: 'transform 180ms linear',
          willChange: 'transform',
        }}
      >
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
        <div style={{
          position: 'absolute',
          zIndex: 5,
          top: `${arenaTrackTopPercent}%`,
          bottom: `${100 - arenaTrackBottomPercent}%`,
          left: `${arenaStartPercent}%`,
          width: '4px',
          background: '#d8ff3e',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(216,255,62,.8)',
        }} />
        <div style={{
          position: 'absolute',
          zIndex: 5,
          top: `${arenaTrackTopPercent}%`,
          bottom: `${100 - arenaTrackBottomPercent}%`,
          left: `${arenaFinishPercent}%`,
          width: '5px',
          background: '#ffffff',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(255,255,255,.8)',
        }} />
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
          transform: 'translateX(-50%)',
        }}>START</div>
        <div style={{
          position: 'absolute',
          zIndex: 6,
          top: `${arenaTrackTopPercent - 5}%`,
          left: `${arenaFinishPercent}%`,
          padding: '4px 8px',
          border: '2px solid #ffffff',
          borderRadius: '5px',
          background: '#111827',
          color: '#ffffff',
          fontSize: 'clamp(8px, .8vw, 12px)',
          fontWeight: 950,
          transform: 'translateX(-50%)',
        }}>FINISH</div>
        {arenaLaneCenters.map((laneCenter, laneIndex) => {
          const player = riders.find((rider) => rider.playerId === laneIndex + 1);
          return (
            <div
              key={`arena-lane-${laneIndex + 1}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                zIndex: 8,
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
                transform: 'translateY(-50%)',
              }}
            >P{laneIndex + 1}</div>
          );
        })}
        {visibleRiders.map((rider) => {
          const left = progressToWorldPercent(rider.distanceMeters, raceDistanceMeters);
          const laneCenter = arenaLaneCenters[rider.playerId - 1];
          return (
            <div
              key={rider.id}
              aria-label={`${rider.name} arena rider`}
              data-lane={rider.playerId}
              data-lane-center={laneCenter}
              style={{
                position: 'absolute',
                zIndex: 20 + rider.playerId,
                top: `${laneCenter}%`,
                left: `${left}%`,
                width: 'clamp(62px, 5.2vw, 84px)',
                aspectRatio: '1',
                opacity: rider.ghost ? 0.6 : 1,
                transform: 'translate(-88%, -75%)',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: '4%',
                  filter: 'brightness(1.04) contrast(1.08) drop-shadow(0 3px 2px rgba(0,0,0,.48))',
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
      <div className="explore-map-group-label">
        <strong>
          {group.riders.length === 0
            ? 'Drag Strip preview'
            : group.riders.length === 1
              ? leadRider?.name
              : `${group.riders.length} riders together`}
        </strong>
        <span>{Math.round(leadRider?.distanceMeters ?? 0)} m down the strip</span>
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
  raceDistanceMeters,
  speedUnit,
  showHud,
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
  const activeRiders = arenaRiders.filter((rider) => !rider.ghost);
  const exploreRiders = activeRiders.map<ExploreRider>((rider) => ({
    id: rider.id,
    clientId: rider.id,
    playerId: rider.playerId,
    name: rider.name,
    colorName: rider.colorName,
    accent: rider.accent,
    distanceMeters: rider.distanceMeters,
    velocityMps: 0,
    cadence: null,
    watts: 0,
    signal: 1,
    finishedAt: null,
    at: 0,
  }));
  const groups = groupExploreRiders(exploreRiders);
  const visibleGroups = groups.length > 0 ? groups : [{
    id: 'drag-strip-preview',
    riders: [],
    startMeter: 0,
    endMeter: 0,
  }];

  return (
    <div
      aria-label="Drag Strip Game Arena"
      style={{
        position: 'absolute',
        inset: 0,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div className={exploreGridClass(visibleGroups.length)} style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        height: '100%',
        minHeight: 0,
        gap: '4px',
        borderRadius: 0,
        ...gridStyle(visibleGroups.length),
      }}>
        {visibleGroups.map((group, index) => (
          <div key={group.id} style={{
            position: 'relative',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            ...panelSpanStyle(visibleGroups.length, index),
          }}>
            <ArenaPanel group={group} riders={arenaRiders} raceDistanceMeters={raceDistanceMeters} />
          </div>
        ))}
      </div>
      {showHud && (
        <GameArenaHud
          riders={arenaRiders}
          raceState={raceState}
          raceDistanceMeters={raceDistanceMeters}
          speedUnit={speedUnit}
        />
      )}
    </div>
  );
}
