import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw, Timer, Trophy } from 'lucide-react';
import {
  formatDistanceRangeMeters,
  formatReactionTime,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import type {
  DistanceUnit,
  PlayerSlot,
  RaceCapture,
  RaceCaptureSample,
  RaceSummaryEntry,
  ReactionTimesByPlayer,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';

type RaceReviewPanelProps = {
  track: TrackRecord;
  players: PlayerSlot[];
  raceSummary: RaceSummaryEntry[];
  raceCapture: RaceCapture | null;
  activeZones: TrackZone[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  remainingSeconds: number;
  paused: boolean;
  onExtend: () => void;
  onPauseToggle: () => void;
  onReturnToDashboard: () => void;
};

type ZoneRiderStats = {
  sampleCount: number;
  entryElapsedMs: number | null;
  exitElapsedMs: number | null;
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  topCadence: number | null;
  averageCadence: number | null;
  topWatts: number | null;
  averageWatts: number | null;
};

function ordinal(rank: number) {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13
    ? 'th'
    : ['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th';
  return `${rank}${suffix}`;
}

function formatFinishTime(milliseconds: number | null) {
  if (milliseconds == null) {
    return 'DNF';
  }

  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function formatSplitTime(milliseconds: number | null) {
  if (milliseconds == null) {
    return '--';
  }

  return `${(milliseconds / 1000).toFixed(3)}s`;
}

function formatNullableMetric(value: number | null, unit: string) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }

  return `${Math.round(value)} ${unit}`;
}

function formatNullableSpeed(speedKph: number | null, speedUnit: SpeedUnit) {
  if (speedKph == null || !Number.isFinite(speedKph)) {
    return '--';
  }

  return `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function max(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function samplesForZone(samples: RaceCaptureSample[], playerId: PlayerSlot['id'], zone: TrackZone) {
  return samples
    .filter((sample) => (
      sample.playerId === playerId
      && sample.riderDistanceMeters != null
      && sample.riderDistanceMeters >= zone.startMeter
      && sample.riderDistanceMeters <= zone.endMeter
    ))
    .sort((left, right) => left.elapsedMs - right.elapsedMs);
}

function zoneStatsForPlayer(samples: RaceCaptureSample[], playerId: PlayerSlot['id'], zone: TrackZone): ZoneRiderStats {
  const zoneSamples = samplesForZone(samples, playerId, zone);
  const speedValues = zoneSamples
    .map((sample) => sample.speedKph)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const cadenceValues = zoneSamples
    .map((sample) => sample.cadence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const wattsValues = zoneSamples
    .map((sample) => sample.watts)
    .filter((value) => Number.isFinite(value));

  return {
    sampleCount: zoneSamples.length,
    entryElapsedMs: zoneSamples[0]?.elapsedMs ?? null,
    exitElapsedMs: zoneSamples.at(-1)?.elapsedMs ?? null,
    topSpeedKph: max(speedValues),
    averageSpeedKph: average(speedValues),
    topCadence: max(cadenceValues),
    averageCadence: average(cadenceValues),
    topWatts: max(wattsValues),
    averageWatts: average(wattsValues),
  };
}

function formatZoneTime(stats: ZoneRiderStats) {
  if (stats.entryElapsedMs == null || stats.exitElapsedMs == null) {
    return '--';
  }

  return `${Math.max(0, (stats.exitElapsedMs - stats.entryElapsedMs) / 1000).toFixed(2)}s`;
}

export function RaceReviewPanel({
  track,
  players,
  raceSummary,
  raceCapture,
  activeZones,
  reactionTimesByPlayer,
  speedUnit,
  distanceUnit,
  remainingSeconds,
  paused,
  onExtend,
  onPauseToggle,
  onReturnToDashboard,
}: RaceReviewPanelProps) {
  const zonesToDisplay = raceCapture?.zones.length
    ? raceCapture.zones
    : activeZones.length
      ? activeZones
      : track.zones;
  const samples = raceCapture?.samples ?? [];
  const summariesByPlayer = new Map(raceSummary.map((summary) => [summary.playerId, summary]));
  const orderedPlayers = players.length > 0
    ? players
    : raceSummary.map((summary) => ({
      id: summary.playerId,
      name: summary.riderName,
      colorName: summary.colorName,
      accent: summary.accent,
      deviceId: null,
    }));

  return (
    <section className="race-review-panel" aria-label="Post-race review">
      <div className="race-review-header">
        <div>
          <div className="eyebrow">
            <Trophy size={14} />
            Post-race review
          </div>
          <h2>{track.name}</h2>
          <p>Match the pedal-zone map above to each rider's zone-by-zone performance below.</p>
        </div>

        <div className="race-review-controls">
          <div className="race-review-timer">
            <Timer size={16} />
            <strong>{remainingSeconds}s</strong>
            <span>{paused ? 'paused' : 'to dashboard'}</span>
          </div>
          <button type="button" onClick={onExtend}>
            <RotateCcw size={15} />
            +15 sec
          </button>
          <button type="button" onClick={onPauseToggle}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="primary" type="button" onClick={onReturnToDashboard}>
            Dashboard
          </button>
        </div>
      </div>

      {raceSummary.length > 0 && (
        <div className="race-review-results">
          {raceSummary.map((summary) => (
            <div className="race-review-rider-card" key={summary.playerId}>
              <div className="race-review-rider-heading">
                <span
                  className="player-chip"
                  style={{ '--player-color': summary.accent } as CSSProperties}
                >
                  P{summary.playerId}
                </span>
                <div>
                  <strong>{summary.riderName}</strong>
                  <small>{summary.deviceLabel}</small>
                </div>
                <span className="place-badge">{ordinal(summary.rank)}</span>
              </div>
              <div className="race-review-rider-metrics">
                <span><strong>{formatFinishTime(summary.finishTimeMs)}</strong><small>finish</small></span>
                <span><strong>{formatSplitTime(summary.thirtyFootTimeMs)}</strong><small>30 ft</small></span>
                <span><strong>{formatReactionTime(reactionTimesByPlayer[summary.playerId])}</strong><small>reaction</small></span>
                <span><strong>{formatNullableSpeed(summary.topSpeedKph, speedUnit)}</strong><small>top speed</small></span>
                <span><strong>{formatNullableMetric(summary.averageCadence, 'RPM')}</strong><small>avg cadence</small></span>
                <span><strong>{formatNullableMetric(summary.averageWatts, 'W')}</strong><small>avg watts</small></span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="race-review-zone-table-wrap">
        <table className="race-review-zone-table">
          <thead>
            <tr>
              <th>Pedal zone</th>
              <th>Track distance</th>
              {orderedPlayers.map((player) => (
                <th key={player.id}>
                  <span
                    className="player-chip"
                    style={{ '--player-color': player.accent } as CSSProperties}
                  >
                    P{player.id}
                  </span>
                  {player.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zonesToDisplay.length > 0 ? zonesToDisplay.map((zone, zoneIndex) => (
              <tr key={zone.id}>
                <td>
                  <strong>{zone.name || `Pedal Zone ${zoneIndex + 1}`}</strong>
                  <small>{zone.type === 'pedal' ? 'Pedal section' : zone.type}</small>
                </td>
                <td>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</td>
                {orderedPlayers.map((player) => {
                  const stats = zoneStatsForPlayer(samples, player.id, zone);
                  const summary = summariesByPlayer.get(player.id);

                  return (
                    <td key={player.id}>
                      <span className="table-metric">Time: {formatZoneTime(stats)}</span>
                      <span className="table-metric">Top: {formatNullableSpeed(stats.topSpeedKph, speedUnit)}</span>
                      <span className="table-metric">Avg cad: {formatNullableMetric(stats.averageCadence ?? summary?.averageCadence ?? null, 'RPM')}</span>
                      <span className="table-metric">Peak cad: {formatNullableMetric(stats.topCadence ?? null, 'RPM')}</span>
                      <span className="table-metric">Avg W: {formatNullableMetric(stats.averageWatts ?? summary?.averageWatts ?? null, 'W')}</span>
                      <span className="table-metric">Peak W: {formatNullableMetric(stats.topWatts ?? null, 'W')}</span>
                      <span className="table-metric muted">Samples: {stats.sampleCount}</span>
                    </td>
                  );
                })}
              </tr>
            )) : (
              <tr>
                <td colSpan={Math.max(2, orderedPlayers.length + 2)}>No mapped pedal zones for this race.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
