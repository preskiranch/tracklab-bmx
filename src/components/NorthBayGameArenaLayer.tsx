import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  arenaPointToTrackPoint,
  northBayGameArenaHeight as viewHeight,
  northBayGameArenaPixelsForMeters,
  northBayGameArenaWidth as viewWidth,
  trackPointToArenaPoint,
} from '../lib/northBayGameArenaCoordinates';
import { cStartVisualDistance, type CStartOffsetsByPlayer } from '../lib/bmxGateStart';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { riderAnimationState, riderCrankStepCount } from '../lib/riderAnimation';
import { riderLaneOffsetsByPlayer } from '../lib/riderPresentation';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import './NorthBayGameArenaLayer.css';
import './NorthBayGameArenaMapping.css';
import type {
  BikeSample,
  GhostPlaybackRider,
  MappingEditMode,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRouteVariant,
  TrackZone,
} from '../types';

type ArenaPoint = { x: number; y: number };
type CoursePoint = ArenaPoint & { dx: number; dy: number };

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
  gameRoute?: TrackRouteVariant;
  cStartOffsetsByPlayer?: CStartOffsetsByPlayer;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  draftPoints?: TrackPoint[];
  draftZonePoints?: TrackPoint[];
  draftZoneMeters?: number[];
  onMappingPathPointAdd?: (point: TrackPoint) => void;
  onMappingPathPointMove?: (index: number, point: TrackPoint) => void;
  onMappingPathPointRemove?: (index: number) => void;
  onMappingZonePointAdd?: (point: TrackPoint) => void;
  onMappingZonePointMove?: (index: number, point: TrackPoint) => void;
  onMappingZonePointRemove?: (index: number) => void;
  onMappingSplitPointAdd?: (point: TrackPoint) => void;
  onMappingSplitDrawEnd?: () => void;
};

function buildCourse(points: TrackPoint[]) {
  const arenaPoints = points.map(trackPointToArenaPoint);
  const lengths = arenaPoints.reduce<number[]>((result, point, index) => {
    if (index === 0) return [0];
    const previous = arenaPoints[index - 1];
    return [...result, result[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y)];
  }, []);
  return {
    points: arenaPoints,
    lengths,
    pixelLength: lengths[lengths.length - 1] ?? 0,
    path: arenaPoints.length > 1
      ? `M ${arenaPoints.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')}`
      : '',
  };
}

function coursePointAtProgress(course: ReturnType<typeof buildCourse>, progress: number): CoursePoint {
  if (course.points.length < 2 || course.pixelLength <= 0) {
    const point = course.points[0] ?? { x: 0, y: 0 };
    return { ...point, dx: 1, dy: 0 };
  }
  const targetLength = Math.max(0, Math.min(1, progress)) * course.pixelLength;
  let upperIndex = course.lengths.findIndex((length) => length >= targetLength);
  if (upperIndex <= 0) upperIndex = 1;
  const lowerIndex = upperIndex - 1;
  const lowerLength = course.lengths[lowerIndex];
  const upperLength = course.lengths[upperIndex];
  const amount = upperLength === lowerLength ? 0 : (targetLength - lowerLength) / (upperLength - lowerLength);
  const lower = course.points[lowerIndex];
  const upper = course.points[upperIndex];
  const before = course.points[Math.max(0, lowerIndex - 1)];
  const after = course.points[Math.min(course.points.length - 1, upperIndex + 1)];
  return {
    x: lower.x + (upper.x - lower.x) * amount,
    y: lower.y + (upper.y - lower.y) * amount,
    dx: after.x - before.x,
    dy: after.y - before.y,
  };
}

function courseSlicePath(
  course: ReturnType<typeof buildCourse>,
  startMeter: number,
  endMeter: number,
  trackLengthMeters: number,
) {
  if (course.points.length < 2) return '';
  const points: ArenaPoint[] = [];
  const span = Math.max(0, endMeter - startMeter);
  const sampleCount = Math.max(2, Math.ceil(span / 2));
  for (let index = 0; index <= sampleCount; index += 1) {
    points.push(coursePointAtProgress(
      course,
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

function NorthBayHud({ riders, raceState, trackLengthMeters, speedUnit }: {
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
  if (entries.length === 0) return null;
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
  gameRoute,
  cStartOffsetsByPlayer = {},
  mappingMode = false,
  mappingEditMode = 'navigate',
  draftPoints = [],
  draftZonePoints = [],
  draftZoneMeters = [],
  onMappingPathPointAdd,
  onMappingPathPointMove,
  onMappingPathPointRemove,
  onMappingZonePointAdd,
  onMappingZonePointMove,
  onMappingZonePointRemove,
  onMappingSplitPointAdd,
  onMappingSplitDrawEnd,
}: NorthBayGameArenaLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef(false);
  const lastDrawPointRef = useRef<ArenaPoint | null>(null);
  const [dragRouteIndex, setDragRouteIndex] = useState<number | null>(null);
  const [dragZoneIndex, setDragZoneIndex] = useState<number | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number | null>(null);
  const routePoints = mappingMode ? draftPoints : gameRoute?.centerline ?? [];
  const course = useMemo(() => buildCourse(routePoints), [routePoints]);
  const visibleTrackLengthMeters = mappingMode
    ? Math.max(1, course.pixelLength * 0.085)
    : Math.max(1, trackLengthMeters);

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

  const riderPoses = useMemo(() => {
    const laneOffsets = riderLaneOffsetsByPlayer(players);
    return arenaRiders.map((rider) => {
      const visualDistance = Math.max(0, cStartVisualDistance(
        rider.distanceMeters,
        rider.ghost ? 0 : cStartOffsetsByPlayer[rider.playerId] ?? 0,
      ));
      const position = coursePointAtProgress(
        course,
        visualDistance / Math.max(1, visibleTrackLengthMeters),
      );
      const tangentLength = Math.max(1, Math.hypot(position.dx, position.dy));
      // Match the satellite renderer's real-world lane spacing. The old game
      // view used a much larger fixed screen offset, which pushed riders off
      // the mapped centerline and made them crowd/cross on turns.
      const laneOffset = northBayGameArenaPixelsForMeters(
        laneOffsets.get(rider.playerId) ?? 0,
      );
      const normalX = -position.dy / tangentLength;
      const normalY = position.dx / tangentLength;
      return {
        rider,
        x: position.x + normalX * laneOffset,
        y: position.y + normalY * laneOffset,
        facesLeft: position.dx < 0,
        lean: Math.max(-7, Math.min(
          7,
          Math.atan2(position.dy, Math.abs(position.dx)) * 180 / Math.PI,
        )),
      };
    }).sort((left, right) => left.y - right.y || left.rider.playerId - right.rider.playerId);
  }, [arenaRiders, cStartOffsetsByPlayer, course, players, visibleTrackLengthMeters]);

  const eventPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const scale = Math.min(rect.width / viewWidth, rect.height / viewHeight);
    const offsetX = (rect.width - viewWidth * scale) / 2;
    const offsetY = (rect.height - viewHeight * scale) / 2;
    return {
      x: Math.max(0, Math.min(viewWidth, (event.clientX - rect.left - offsetX) / scale)),
      y: Math.max(0, Math.min(viewHeight, (event.clientY - rect.top - offsetY) / scale)),
    };
  };
  const asTrackPoint = (event: { clientX: number; clientY: number }) => {
    const point = eventPoint(event);
    return point ? arenaPointToTrackPoint(point.x, point.y) : null;
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!mappingMode || mappingEditMode === 'navigate') return;
    const point = asTrackPoint(event);
    const arenaPoint = eventPoint(event);
    if (!point || !arenaPoint) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mappingEditMode === 'draw' || mappingEditMode === 'curve') {
      drawingRef.current = true;
      lastDrawPointRef.current = arenaPoint;
      onMappingPathPointAdd?.(point);
    } else if (mappingEditMode === 'zones') {
      onMappingZonePointAdd?.(point);
    } else if (mappingEditMode === 'split') {
      drawingRef.current = true;
      onMappingSplitPointAdd?.(point);
    } else if (mappingEditMode === 'adjust' && selectedRouteIndex != null) {
      onMappingPathPointMove?.(selectedRouteIndex, point);
      setSelectedRouteIndex(null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!mappingMode) return;
    const point = asTrackPoint(event);
    const arenaPoint = eventPoint(event);
    if (!point || !arenaPoint) return;
    if (dragRouteIndex != null) {
      event.preventDefault();
      onMappingPathPointMove?.(dragRouteIndex, point);
      return;
    }
    if (dragZoneIndex != null) {
      event.preventDefault();
      onMappingZonePointMove?.(dragZoneIndex, point);
      return;
    }
    if (!drawingRef.current) return;
    if (mappingEditMode === 'draw' || mappingEditMode === 'curve') {
      const last = lastDrawPointRef.current;
      if (!last || Math.hypot(arenaPoint.x - last.x, arenaPoint.y - last.y) >= 12) {
        lastDrawPointRef.current = arenaPoint;
        onMappingPathPointAdd?.(point);
      }
    } else if (mappingEditMode === 'split') {
      onMappingSplitPointAdd?.(point);
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drawingRef.current && mappingEditMode === 'split') onMappingSplitDrawEnd?.();
    drawingRef.current = false;
    lastDrawPointRef.current = null;
    setDragRouteIndex(null);
    setDragZoneIndex(null);
  };

  const start = coursePointAtProgress(course, 0);
  const finish = coursePointAtProgress(course, 1);
  const routeReady = course.points.length >= 2;
  return (
    <div className={`north-bay-game-arena${mappingMode ? ' mapping' : ''}`} aria-label="North Bay BMX fixed full-course game view">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={mappingMode ? 'North Bay BMX Game Track mapping canvas' : 'North Bay BMX course and racers'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(event) => mappingMode && event.preventDefault()}
      >
        <image href="/assets/north-bay-game-arena-wide-v2.jpg" width={viewWidth} height={viewHeight} />
        {mappingMode && routeReady && <path className="north-bay-game-route-shadow" d={course.path} />}
        {mappingMode && routeReady && <path className="north-bay-game-route" d={course.path} />}
        {!mappingMode && activeZones.filter((zone) => zone.type === 'pedal').map((zone, index) => (
          <path key={zone.id} className="north-bay-game-pedal-zone" d={courseSlicePath(course, zone.startMeter, zone.endMeter, visibleTrackLengthMeters)}>
            <title>{`Pedal Zone ${index + 1}: ${Math.round(zone.startMeter)}–${Math.round(zone.endMeter)} m`}</title>
          </path>
        ))}
        {mappingMode && draftZoneMeters.map((meter, index) => {
          if (index % 2 !== 0 || draftZoneMeters[index + 1] == null) return null;
          return <path key={`draft-zone-${index}`} className="north-bay-game-pedal-zone" d={courseSlicePath(course, meter, draftZoneMeters[index + 1], visibleTrackLengthMeters)} />;
        })}
        {routeReady && (
          <>
            <g className="north-bay-game-line" transform={`translate(${start.x} ${start.y}) rotate(${Math.atan2(start.dy, start.dx) * 180 / Math.PI + 90})`}><line x1="-28" y1="0" x2="28" y2="0" /></g>
            <g className="north-bay-game-line-label" transform={`translate(${start.x} ${start.y - 42})`}><rect x="-42" y="-14" width="84" height="28" rx="7" /><text x="0" y="6">START</text></g>
            <g className="north-bay-game-line finish" transform={`translate(${finish.x} ${finish.y}) rotate(${Math.atan2(finish.dy, finish.dx) * 180 / Math.PI + 90})`}><line x1="-28" y1="0" x2="28" y2="0" /></g>
            <g className="north-bay-game-line-label finish" transform={`translate(${finish.x} ${finish.y - 42})`}><rect x="-45" y="-14" width="90" height="28" rx="7" /><text x="0" y="6">FINISH</text></g>
          </>
        )}
        {mappingMode && mappingEditMode === 'adjust' && course.points.map((point, index) => (
          <g key={`route-point-${index}`} className={`north-bay-game-map-point${selectedRouteIndex === index ? ' selected' : ''}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === course.points.length - 1 ? 13 : 9}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedRouteIndex(index);
                setDragRouteIndex(index);
                svgRef.current?.setPointerCapture(event.pointerId);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onMappingPathPointRemove?.(index);
              }}
            />
            {(index === 0 || index === course.points.length - 1) && <text x={point.x} y={point.y + 5}>{index === 0 ? 'S' : 'F'}</text>}
          </g>
        ))}
        {mappingMode && mappingEditMode === 'zones' && draftZonePoints.map((point, index) => {
          const arena = trackPointToArenaPoint(point);
          return (
            <g key={`zone-point-${index}`} className="north-bay-game-zone-point">
              <circle
                cx={arena.x}
                cy={arena.y}
                r="12"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragZoneIndex(index);
                  svgRef.current?.setPointerCapture(event.pointerId);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onMappingZonePointRemove?.(index);
                }}
              />
              <text x={arena.x} y={arena.y + 5}>{index + 1}</text>
            </g>
          );
        })}
        {!mappingMode && routeReady && riderPoses.map(({ rider, x, y, facesLeft, lean }) => {
          const frameSize = 192;
          const drawSize = 70;
          // The native rider sheet has transparent padding. Anchor the leading
          // edge of the front tire and the tire contact patch to the route
          // point, just as the satellite marker renderer does.
          const frontTireAnchor = drawSize * (183 / frameSize);
          const groundAnchor = drawSize * (183 / frameSize);
          const clipId = `north-bay-rider-clip-${rider.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          return (
            <g
              key={rider.id}
              className="north-bay-game-rider-object"
              data-player-id={rider.playerId}
              data-distance-meters={rider.distanceMeters.toFixed(2)}
              data-route-x={x.toFixed(2)}
              data-route-y={y.toFixed(2)}
              opacity={rider.ghost ? 0.55 : 1}
              transform={`translate(${x} ${y}) rotate(${lean}) scale(${facesLeft ? -1 : 1} 1)`}
            >
              <title>{rider.name}</title>
              <defs>
                <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                  <rect x={-frontTireAnchor} y={-groundAnchor} width={drawSize} height={drawSize} />
                </clipPath>
              </defs>
              <image
                className="north-bay-game-rider-frame"
                href={`/assets/rider-${rider.colorName}-animated.png`}
                x={-frontTireAnchor - rider.frame * drawSize}
                y={-groundAnchor}
                width={drawSize * 9}
                height={drawSize}
                preserveAspectRatio="none"
                clipPath={`url(#${clipId})`}
              />
            </g>
          );
        })}
      </svg>
      {mappingMode && routePoints.length < 2 && (
        <div className="north-bay-game-map-empty"><b>Draw the Game Track</b><span>Choose Draw path, then trace the center of the illustrated course from start to finish.</span></div>
      )}
      {showHud && !mappingMode && <NorthBayHud riders={arenaRiders} raceState={raceState} trackLengthMeters={visibleTrackLengthMeters} speedUnit={speedUnit} />}
    </div>
  );
}
