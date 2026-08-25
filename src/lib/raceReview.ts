import type {
  PlayerSlot,
  RaceCapture,
  RaceCaptureFrame,
  RaceCaptureSample,
  RaceSummaryEntry,
  RaceZoneResult,
  RaceZoneRiderResult,
  SplitBranchChoice,
  TrackZone,
} from '../types';
import { reportedBmxTopSpeedKph } from '../game/bmxRollout';
import { zoneMatchesBranchSelections } from './trackMapping';
import {
  acceptedBikeCadenceRpm,
  acceptedTrainingSpeedKph,
  cleanBikeCadenceRpm,
  cleanTrainingSpeedKph,
} from './bikeSampleSanity';

type RaceMetricPoint = {
  elapsedMs: number;
  distanceMeters: number;
  speedKph: number | null;
  cadence: number | null;
  watts: number | null;
};

const distanceEpsilonMeters = 0.05;

function finiteOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolateNullable(left: number | null, right: number | null, ratio: number) {
  if (left == null) {
    return right;
  }

  if (right == null) {
    return left;
  }

  return left + (right - left) * ratio;
}

function interpolatePoint(left: RaceMetricPoint, right: RaceMetricPoint, distanceMeters: number): RaceMetricPoint {
  const distanceDelta = right.distanceMeters - left.distanceMeters;
  const ratio = Math.abs(distanceDelta) <= distanceEpsilonMeters
    ? 0
    : clamp((distanceMeters - left.distanceMeters) / distanceDelta, 0, 1);

  return {
    elapsedMs: Math.round(left.elapsedMs + (right.elapsedMs - left.elapsedMs) * ratio),
    distanceMeters,
    speedKph: interpolateNullable(left.speedKph, right.speedKph, ratio),
    cadence: interpolateNullable(left.cadence, right.cadence, ratio),
    watts: interpolateNullable(left.watts, right.watts, ratio),
  };
}

function framePoint(
  frame: RaceCaptureFrame,
  rider: RaceCaptureFrame['riders'][number],
  startedAt: number | null,
): RaceMetricPoint {
  return {
    elapsedMs: Math.max(0, startedAt == null ? frame.elapsedMs : frame.at - startedAt),
    distanceMeters: Math.max(0, rider.distanceMeters),
    speedKph: cleanTrainingSpeedKph(rider.velocityMps * 3.6),
    cadence: cleanBikeCadenceRpm(rider.rawCadence),
    watts: finiteOrNull(rider.rawWatts),
  };
}

function pointsFromFrames(capture: RaceCapture, playerId: PlayerSlot['id']) {
  return (capture.frames ?? [])
    .filter((frame) => (
      frame.raceState !== 'ready'
      && (capture.startedAt == null || frame.at >= capture.startedAt)
    ))
    .flatMap((frame) => {
      const rider = frame.riders.find((candidate) => candidate.playerId === playerId);
      return rider ? [framePoint(frame, rider, capture.startedAt)] : [];
    });
}

function samplePoint(sample: RaceCaptureSample, startedAt: number | null): RaceMetricPoint | null {
  if (sample.riderDistanceMeters == null || !Number.isFinite(sample.riderDistanceMeters)) {
    return null;
  }

  return {
    elapsedMs: Math.max(0, startedAt == null ? sample.elapsedMs : sample.at - startedAt),
    distanceMeters: Math.max(0, sample.riderDistanceMeters),
    speedKph: cleanTrainingSpeedKph(
      sample.riderVelocityMps == null ? sample.speedKph : sample.riderVelocityMps * 3.6,
    ),
    cadence: cleanBikeCadenceRpm(sample.cadence),
    watts: finiteOrNull(sample.watts),
  };
}

function pointsFromSamples(capture: RaceCapture, playerId: PlayerSlot['id']) {
  return capture.samples
    .filter((sample) => (
      sample.playerId === playerId
      && (capture.startedAt == null || sample.at >= capture.startedAt)
    ))
    .map((sample) => samplePoint(sample, capture.startedAt))
    .filter((point): point is RaceMetricPoint => point != null);
}

function dedupePoints(points: RaceMetricPoint[]) {
  const byMoment = new Map<string, RaceMetricPoint>();
  points.forEach((point) => {
    const key = `${Math.round(point.elapsedMs)}:${point.distanceMeters.toFixed(2)}`;
    byMoment.set(key, point);
  });

  return [...byMoment.values()].sort((left, right) => (
    left.elapsedMs - right.elapsedMs || left.distanceMeters - right.distanceMeters
  ));
}

function pointsForPlayer(capture: RaceCapture, playerId: PlayerSlot['id']) {
  const samplePoints = pointsFromSamples(capture, playerId);
  const framePoints = pointsFromFrames(capture, playerId);
  const summary = capture.summary.find((entry) => entry.playerId === playerId);
  // Bike packets carry the authoritative cadence and power readings. Frames are
  // a fallback for devices that emit too few packets to cover a complete race.
  const points = dedupePoints(samplePoints.length >= 2 ? samplePoints : framePoints)
    .filter((point) => summary?.finishTimeMs == null || point.elapsedMs <= summary.finishTimeMs);
  if (points.length === 0) {
    return points;
  }

  const first = points[0];
  if (first.elapsedMs > 0 || first.distanceMeters > distanceEpsilonMeters) {
    points.unshift({
      elapsedMs: 0,
      distanceMeters: 0,
      speedKph: 0,
      cadence: 0,
      watts: 0,
    });
  }

  const routeLengthMeters = capture.track.routeLengthMeters ?? capture.track.lengthMeters;
  const last = points.at(-1);
  if (
    last
    && summary?.finishTimeMs != null
    && last.distanceMeters < routeLengthMeters - distanceEpsilonMeters
  ) {
    points.push({
      ...last,
      elapsedMs: Math.max(last.elapsedMs, summary.finishTimeMs),
      distanceMeters: routeLengthMeters,
    });
  }

  return points;
}

function boundaryPoint(points: RaceMetricPoint[], boundaryMeters: number) {
  const exact = points.find((point) => Math.abs(point.distanceMeters - boundaryMeters) <= distanceEpsilonMeters);
  if (exact) {
    return { ...exact, distanceMeters: boundaryMeters };
  }

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (left.distanceMeters <= boundaryMeters && right.distanceMeters >= boundaryMeters) {
      return interpolatePoint(left, right, boundaryMeters);
    }
  }

  return null;
}

function pointsForZone(points: RaceMetricPoint[], zone: TrackZone) {
  if (points.length === 0) {
    return [];
  }

  const zoneStart = Math.min(zone.startMeter, zone.endMeter);
  const zoneEnd = Math.max(zone.startMeter, zone.endMeter);
  const inside = points.filter((point) => (
    point.distanceMeters >= zoneStart - distanceEpsilonMeters
    && point.distanceMeters <= zoneEnd + distanceEpsilonMeters
  ));
  const start = boundaryPoint(points, zoneStart);
  const end = boundaryPoint(points, zoneEnd);

  return dedupePoints([
    ...(start ? [start] : []),
    ...inside,
    ...(end ? [end] : []),
  ]);
}

function valuesFor(points: RaceMetricPoint[], key: 'speedKph' | 'cadence' | 'watts') {
  return points
    .map((point) => point[key])
    .filter((value): value is number => value != null && Number.isFinite(value));
}

function maximum(values: number[]) {
  return values.length > 0 ? Math.max(...values) : null;
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function reportedTopSpeedForPoints(points: RaceMetricPoint[]) {
  return maximum(points.flatMap((point) => (
    point.cadence == null && point.speedKph == null
      ? []
      : [reportedBmxTopSpeedKph(point.cadence, point.speedKph)]
  )));
}

function zoneResultForPlayer(
  playerId: PlayerSlot['id'],
  zone: TrackZone,
  playerPoints: RaceMetricPoint[],
): RaceZoneRiderResult {
  const points = pointsForZone(playerPoints, zone);
  const speedValues = valuesFor(points, 'speedKph');
  const cadenceValues = valuesFor(points, 'cadence');
  const wattsValues = valuesFor(points, 'watts');
  const entryElapsedMs = points[0]?.elapsedMs ?? null;
  const exitElapsedMs = points.at(-1)?.elapsedMs ?? null;

  return {
    playerId,
    sampleCount: points.length,
    entryElapsedMs,
    exitElapsedMs,
    durationMs: entryElapsedMs == null || exitElapsedMs == null
      ? null
      : Math.max(0, exitElapsedMs - entryElapsedMs),
    topSpeedKph: reportedTopSpeedForPoints(points),
    averageSpeedKph: average(speedValues),
    topCadence: maximum(cadenceValues),
    averageCadence: average(cadenceValues),
    topWatts: maximum(wattsValues),
    averageWatts: average(wattsValues),
  };
}

export function buildRaceZoneResults(
  capture: RaceCapture,
  actualBranchesByPlayer: Partial<Record<PlayerSlot['id'], Record<string, SplitBranchChoice>>> = {},
): RaceZoneResult[] {
  const pointsByPlayer = new Map(capture.players.map((player) => [
    player.id,
    pointsForPlayer(capture, player.id),
  ]));

  return capture.zones.map((zone, zoneIndex) => ({
    zoneId: zone.id,
    zoneName: zone.name || `Zone ${zoneIndex + 1}`,
    zoneType: zone.type,
    startMeter: zone.startMeter,
    endMeter: zone.endMeter,
    riders: capture.players.map((player) => zoneResultForPlayer(
      player.id,
      zone,
      actualBranchesByPlayer[player.id] == null
        || zoneMatchesBranchSelections(zone, actualBranchesByPlayer[player.id])
        ? pointsByPlayer.get(player.id) ?? []
        : [],
    )),
  }));
}

export function raceSummaryWithCapturedMetrics(
  capture: RaceCapture,
  summary: RaceSummaryEntry[],
): RaceSummaryEntry[] {
  const captureWithSummary: RaceCapture = {
    ...capture,
    summary,
  };

  return summary.map((entry) => {
    const points = pointsForPlayer(captureWithSummary, entry.playerId);
    const speedValues = valuesFor(points, 'speedKph');
    const cadenceValues = valuesFor(points, 'cadence');
    const wattsValues = valuesFor(points, 'watts');
    const deviceLabel = capture.samples.find((sample) => sample.playerId === entry.playerId)?.deviceLabel;
    const capturedTopSpeedKph = reportedTopSpeedForPoints(points);
    const capturedAverageSpeedKph = average(speedValues);
    const capturedTopCadence = maximum(cadenceValues);
    const capturedAverageCadence = average(cadenceValues);

    return {
      ...entry,
      deviceLabel: deviceLabel ?? entry.deviceLabel,
      sampleCount: Math.max(entry.sampleCount, points.length),
      topSpeedKph: capturedTopSpeedKph ?? acceptedTrainingSpeedKph(entry.topSpeedKph),
      averageSpeedKph: capturedAverageSpeedKph ?? acceptedTrainingSpeedKph(entry.averageSpeedKph),
      topCadence: capturedTopCadence ?? acceptedBikeCadenceRpm(entry.topCadence),
      averageCadence: capturedAverageCadence ?? acceptedBikeCadenceRpm(entry.averageCadence),
      topWatts: maximum(wattsValues) ?? entry.topWatts,
      averageWatts: average(wattsValues) ?? entry.averageWatts,
    };
  });
}

export function zoneRiderResult(
  results: RaceZoneResult[],
  zoneId: string,
  playerId: PlayerSlot['id'],
) {
  return results.find((zone) => zone.zoneId === zoneId)
    ?.riders.find((rider) => rider.playerId === playerId) ?? null;
}
