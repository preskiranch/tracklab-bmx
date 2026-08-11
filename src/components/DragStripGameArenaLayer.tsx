import { useMemo, type CSSProperties } from 'react';
import { exploreGridClass, groupExploreRiders, type ExploreViewportGroup } from '../lib/explore';
import { riderAnimationState, riderCrankStepCount } from '../lib/riderAnimation';
import type {
  BikeSample,
  ExploreRider,
  GhostPlaybackRider,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  RiderState,
} from '../types';

type ArenaRider = {
  id: string;
  playerId: PlayerSlot['id'];
  name: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  distanceMeters: number;
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
};

const arenaWorldWidth = 310;
const arenaViewportWidth = 100 / (arenaWorldWidth / 100);
const arenaStartPercent = 4;
const arenaFinishPercent = 96;

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
        <div style={{
          position: 'absolute',
          top: '52.5%',
          bottom: '29.5%',
          left: `${arenaStartPercent}%`,
          width: '4px',
          background: '#d8ff3e',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(216,255,62,.8)',
        }} />
        <div style={{
          position: 'absolute',
          top: '52.5%',
          bottom: '29.5%',
          left: `${arenaFinishPercent}%`,
          width: '5px',
          background: '#ffffff',
          boxShadow: '0 0 0 2px #111827, 0 0 12px rgba(255,255,255,.8)',
        }} />
        <div style={{
          position: 'absolute',
          top: '47.5%',
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
          top: '47.5%',
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
        {visibleRiders.map((rider) => {
          const left = progressToWorldPercent(rider.distanceMeters, raceDistanceMeters);
          const laneBottom = 56.8 + (rider.playerId - 1) * 3.85;
          return (
            <div
              key={rider.id}
              aria-label={`${rider.name} arena rider`}
              style={{
                position: 'absolute',
                zIndex: 20 + rider.playerId,
                top: `${laneBottom}%`,
                left: `${left}%`,
                width: 'clamp(70px, 7.5vw, 118px)',
                aspectRatio: '1',
                opacity: rider.ghost ? 0.6 : 1,
                backgroundImage: `url(/assets/rider-${rider.colorName}-animated.png)`,
                backgroundPosition: `${rider.frame * 12.5}% 0`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: '900% 100%',
                filter: `drop-shadow(0 4px 3px rgba(0,0,0,.55)) drop-shadow(0 0 2px ${rider.accent})`,
                transform: 'translate(-88%, -84%)',
              }}
            />
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
        distanceMeters: rider.distance,
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
      distanceMeters: rider.distance,
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
      distanceMeters: rider.distance,
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
      className={exploreGridClass(visibleGroups.length)}
      aria-label="Drag Strip Game Arena"
      style={{
        position: 'absolute',
        inset: 0,
        height: '100%',
        minHeight: 0,
        gap: '4px',
        borderRadius: 0,
        ...gridStyle(visibleGroups.length),
      }}
    >
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
  );
}
