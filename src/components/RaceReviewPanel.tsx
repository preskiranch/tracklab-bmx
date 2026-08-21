import { useMemo, type CSSProperties } from 'react';
import { Pause, Play, RotateCcw, Timer, Trophy } from 'lucide-react';
import { buildRaceZoneResults, zoneRiderResult } from '../lib/raceReview';
import {
  formatDistanceMeters,
  formatDistanceRangeMeters,
  formatReactionTime,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import type {
  DistanceUnit,
  PlayerSlot,
  RaceCapture,
  RaceSummaryEntry,
  ReactionTimesByPlayer,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';
import { straightSprintFeetToMeters } from '../lib/straightSprint';
import { RiderAvatar } from './RiderAvatar';

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

export function formatRaceReviewSplitDistance(distanceUnit: DistanceUnit) {
  return formatDistanceMeters(straightSprintFeetToMeters(30), distanceUnit);
}

function formatZoneTime(durationMs: number | null | undefined) {
  if (durationMs == null) {
    return '--';
  }

  return `${Math.max(0, durationMs / 1000).toFixed(2)}s`;
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
  const zoneResults = useMemo(() => {
    if (!raceCapture) {
      return [];
    }

    return raceCapture.zoneResults?.length
      ? raceCapture.zoneResults
      : buildRaceZoneResults(raceCapture);
  }, [raceCapture]);
  const reviewSummary = raceCapture?.status === 'finished' && raceCapture.summary.length > 0
    ? raceCapture.summary
    : raceSummary;
  const orderedPlayers = reviewSummary.length > 0
    ? reviewSummary.map((summary) => ({
      id: summary.playerId,
      name: summary.riderName,
      colorName: summary.colorName,
      accent: summary.accent,
      deviceId: null,
    }))
    : players;
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  return (
    <section className="race-review-panel" aria-label="Post-race review">
      <div className="race-review-header">
        <div>
          <div className="eyebrow">
            <Trophy size={14} />
            Post-race review
          </div>
          <h2>{track.name}</h2>
          <p>Match the labeled pedal zones on the satellite map to each rider's performance below.</p>
        </div>

        <div className="race-review-controls">
          <div className="race-review-timer">
            <Timer size={16} />
            <strong>{remainingSeconds}s</strong>
            <span>{paused ? 'paused' : 'to dashboard'}</span>
          </div>
          <button type="button" onClick={onExtend}>
            <RotateCcw size={15} />
            +20 sec
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

      {reviewSummary.length > 0 && (
        <div className="race-review-results">
          {reviewSummary.map((summary) => (
            <div className="race-review-rider-card" key={summary.playerId}>
              <div className="race-review-rider-heading">
                <RiderAvatar
                  name={summary.riderName}
                  photoUrl={playerById.get(summary.playerId)?.photoUrl}
                  accent={summary.accent}
                  className="race-review-rider-avatar"
                />
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
                <span>
                  <strong>{formatSplitTime(summary.thirtyFootTimeMs)}</strong>
                  <small>{formatRaceReviewSplitDistance(distanceUnit)}</small>
                </span>
                <span><strong>{formatReactionTime(reactionTimesByPlayer[summary.playerId])}</strong><small>reaction</small></span>
                <span><strong>{formatNullableSpeed(summary.topSpeedKph, speedUnit)}</strong><small>top speed</small></span>
                <span><strong>{formatNullableSpeed(summary.averageSpeedKph, speedUnit)}</strong><small>avg speed</small></span>
                <span><strong>{formatNullableMetric(summary.topCadence, 'RPM')}</strong><small>max cadence</small></span>
                <span><strong>{formatNullableMetric(summary.averageCadence, 'RPM')}</strong><small>avg cadence</small></span>
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
                  <strong>{zone.name || `Zone ${zoneIndex + 1}`}</strong>
                  <small>{zone.type === 'pedal' ? 'Pedal section' : zone.type}</small>
                </td>
                <td>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</td>
                {orderedPlayers.map((player) => {
                  const stats = zoneRiderResult(zoneResults, zone.id, player.id);

                  return (
                    <td key={player.id}>
                      <span className="table-metric">Zone time: {formatZoneTime(stats?.durationMs)}</span>
                      <span className="table-metric">Max speed: {formatNullableSpeed(stats?.topSpeedKph ?? null, speedUnit)}</span>
                      <span className="table-metric">Avg speed: {formatNullableSpeed(stats?.averageSpeedKph ?? null, speedUnit)}</span>
                      <span className="table-metric">Max cadence: {formatNullableMetric(stats?.topCadence ?? null, 'RPM')}</span>
                      <span className="table-metric">Avg cadence: {formatNullableMetric(stats?.averageCadence ?? null, 'RPM')}</span>
                      <span className="table-metric muted">
                        {stats?.sampleCount ? `${stats.sampleCount} analysis points` : 'No telemetry captured'}
                      </span>
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
