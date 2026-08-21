import { useMemo, type CSSProperties } from 'react';
import { Activity, Download, Gauge, HeartPulse, ListFilter, Timer, Trophy } from 'lucide-react';
import { buildRaceZoneResults, zoneRiderResult } from '../lib/raceReview';
import {
  formatDistanceMeters,
  formatDistanceRangeMeters,
  formatReactionTime,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import { straightSprintFeetToMeters } from '../lib/straightSprint';
import type {
  DistanceUnit,
  GhostLap,
  MetricKey,
  PlayerSlot,
  PrivateHeartRateCapture,
  RaceCapture,
  RaceSummaryEntry,
  ReactionTimesByPlayer,
  SpeedUnit,
  StudioRider,
  TrackRecord,
  TrackZone,
} from '../types';
import { PodiumTrophy } from './PodiumTrophy';
import { RiderAvatar } from './RiderAvatar';
import { NewRecordBadge } from './NewRecordBadge';
import type { PersonalRecordAchievements } from '../lib/personalRecords';

type AnalyticsPanelProps = {
  track: TrackRecord;
  players: PlayerSlot[];
  raceSummary: RaceSummaryEntry[];
  selectedMetrics: MetricKey[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  activeZones: TrackZone[];
  raceCapture: RaceCapture | null;
  ghostLaps: GhostLap[];
  selectedGhostIds: string[];
  studioRiders: StudioRider[];
  sprintConfiguration?: { distanceFeet: number; airSetting: number };
  newPersonalRecordsByPlayer: PersonalRecordAchievements;
  onRaceCaptureJsonExport: () => void;
  onRaceCaptureCsvExport: () => void;
  onGhostToggle: (ghostId: string) => void;
  onGhostClear: () => void;
  heartRateByPlayer?: Partial<Record<PlayerSlot['id'], PrivateHeartRateCapture>>;
};

const metricMeta: Record<MetricKey, { label: string; unit: string; icon: typeof Activity }> = {
  cadence: { label: 'Cadence', unit: 'RPM', icon: Activity },
  speed: { label: 'Speed', unit: '', icon: Gauge },
  power: { label: 'Private power', unit: 'W', icon: Activity },
  reaction: { label: 'Reaction', unit: 'RT', icon: Timer },
};

function zoneTypeLabel(zone: TrackZone) {
  if (zone.type === 'recovery') {
    return 'Coast';
  }

  if (zone.type === 'technical') {
    return 'Technical';
  }

  return 'Pedal Zone';
}

function formatGhostRaceTime(milliseconds: number) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(2)}s`;
}

function ghostSourceLabel(ghost: GhostLap) {
  if (ghost.source === 'friend') {
    return 'Friend best';
  }

  if (ghost.source === 'top') {
    return 'Top rider';
  }

  return 'My best';
}

function zoneRiderNameParts(value: string) {
  const enteredName = value.trim().replace(/\s+/g, ' ');
  const nicknameMatch = enteredName.match(/^(.*?)\s*(?:["“]([^"”]+)["”]|\(([^()]+)\))\s*(.*)$/u);
  const legalName = nicknameMatch
    ? `${nicknameMatch[1]} ${nicknameMatch[4]}`.trim().replace(/\s+/g, ' ')
    : enteredName;
  const [firstName = 'Rider', ...lastNameParts] = legalName.split(' ').filter(Boolean);
  return {
    firstName,
    nickname: nicknameMatch?.[2] ?? nicknameMatch?.[3] ?? '',
    lastName: lastNameParts.join(' '),
  };
}

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

export function formatAnalyticsFeetDistance(distanceFeet: number, distanceUnit: DistanceUnit) {
  return formatDistanceMeters(straightSprintFeetToMeters(distanceFeet), distanceUnit);
}

function bestSummaryValue(
  raceSummary: RaceSummaryEntry[],
  pickValue: (summary: RaceSummaryEntry) => number | null,
) {
  return raceSummary.reduce<number | null>((best, summary) => {
    const value = pickValue(summary);
    if (value == null || !Number.isFinite(value)) {
      return best;
    }

    return best == null ? value : Math.max(best, value);
  }, null);
}

function bestReactionTime(raceSummary: RaceSummaryEntry[], reactionTimesByPlayer: ReactionTimesByPlayer) {
  return raceSummary.reduce<number | null>((best, summary) => {
    const value = reactionTimesByPlayer[summary.playerId];
    if (value == null || !Number.isFinite(value)) {
      return best;
    }

    return best == null ? value : Math.min(best, value);
  }, null);
}

function bestSplitTime(raceSummary: RaceSummaryEntry[]) {
  return raceSummary.reduce<number | null>((best, summary) => {
    const value = summary.thirtyFootTimeMs;
    if (value == null || !Number.isFinite(value)) {
      return best;
    }

    return best == null ? value : Math.min(best, value);
  }, null);
}

export function AnalyticsPanel({
  track,
  players,
  raceSummary,
  selectedMetrics,
  reactionTimesByPlayer,
  speedUnit,
  distanceUnit,
  activeZones,
  raceCapture,
  ghostLaps,
  selectedGhostIds,
  studioRiders,
  sprintConfiguration,
  newPersonalRecordsByPlayer,
  onRaceCaptureJsonExport,
  onRaceCaptureCsvExport,
  onGhostToggle,
  onGhostClear,
  heartRateByPlayer = {},
}: AnalyticsPanelProps) {
  const zonesToDisplay = activeZones.length > 0
    ? activeZones
    : track.routeStatus === 'user-mapped'
      ? track.zones
      : [];
  const zoneResults = useMemo(() => {
    if (!raceCapture || raceCapture.status !== 'finished') {
      return [];
    }

    return raceCapture.zoneResults?.length
      ? raceCapture.zoneResults
      : buildRaceZoneResults(raceCapture);
  }, [raceCapture]);
  const showSpeedSummary = selectedMetrics.includes('speed');
  const showCadenceSummary = selectedMetrics.includes('cadence');
  const showReactionSummary = selectedMetrics.includes('reaction');
  const winner = raceSummary[0];
  const bestSpeed = bestSummaryValue(raceSummary, (summary) => summary.topSpeedKph);
  const bestCadence = bestSummaryValue(raceSummary, (summary) => summary.topCadence);
  const bestReaction = bestReactionTime(raceSummary, reactionTimesByPlayer);
  const bestThirtyFoot = bestSplitTime(raceSummary);
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const playerByName = useMemo(
    () => new Map(players.map((player) => [player.name.trim().toLocaleLowerCase(), player])),
    [players],
  );
  const studioRiderPhotoByName = useMemo(
    () => new Map(studioRiders.flatMap((rider) => (
      rider.photoUrl ? [[rider.name.trim().toLocaleLowerCase(), rider.photoUrl] as const] : []
    ))),
    [studioRiders],
  );
  const rankedGhosts = useMemo(
    () => [...ghostLaps]
      .sort((left, right) => left.finishTimeMs - right.finishTimeMs || right.savedAt - left.savedAt)
      .slice(0, 50),
    [ghostLaps],
  );
  const podiumGhosts = rankedGhosts.slice(0, 3);
  const remainingGhosts = rankedGhosts.slice(3);
  const selectedGhostCount = selectedGhostIds.filter((ghostId) => (
    rankedGhosts.some((ghost) => ghost.id === ghostId)
  )).length;
  const hasHeartRate = Object.values(heartRateByPlayer).some((capture) => (
    (capture?.summary?.sampleCount ?? 0) > 0
  ));
  const renderGhostOption = (ghost: GhostLap, rank: number) => {
    const selected = selectedGhostIds.includes(ghost.id);
    const normalizedRiderName = ghost.riderName.trim().toLocaleLowerCase();
    const currentPlayer = playerByName.get(normalizedRiderName);
    const photoUrl = ghost.photoUrl
      ?? currentPlayer?.photoUrl
      ?? studioRiderPhotoByName.get(normalizedRiderName);
    const savedDate = new Date(ghost.savedAt).toLocaleDateString();

    if (rank <= 3) {
      return (
        <button
          className={`leaderboard-row leaderboard-podium-row ghost-option ghost-leaderboard-entry ${selected ? 'selected' : ''}`}
          type="button"
          onClick={() => onGhostToggle(ghost.id)}
          aria-pressed={selected}
          key={ghost.id}
        >
          <PodiumTrophy rank={rank} className="leaderboard-trophy" />
          <div className="leaderboard-rider-heading">
            <RiderAvatar
              name={ghost.riderName}
              photoUrl={photoUrl}
              accent={ghost.accent}
              className="leaderboard-rider-avatar"
            />
            <span className="leaderboard-rank">#{rank}</span>
            <div>
              <strong>{ghost.riderName}</strong>
              <span>{selected ? 'Selected to race' : `${ghostSourceLabel(ghost)} • ${savedDate}`}</span>
            </div>
          </div>
          <strong className="leaderboard-value">
            {formatGhostRaceTime(ghost.finishTimeMs)}
          </strong>
        </button>
      );
    }

    return (
      <button
        className={`leaderboard-ranked-row ghost-option ghost-leaderboard-entry ${selected ? 'selected' : ''}`}
        type="button"
        onClick={() => onGhostToggle(ghost.id)}
        aria-pressed={selected}
        key={ghost.id}
      >
        <span className="leaderboard-rank">#{rank}</span>
        <RiderAvatar
          name={ghost.riderName}
          photoUrl={photoUrl}
          accent={ghost.accent}
          className="leaderboard-rider-avatar"
        />
        <div>
          <strong>{ghost.riderName}</strong>
          <span>{selected ? 'Selected to race' : `${ghostSourceLabel(ghost)} • ${savedDate}`}</span>
        </div>
        <strong>{formatGhostRaceTime(ghost.finishTimeMs)}</strong>
      </button>
    );
  };

  return (
    <section className="analytics-panel">
      <div className="analytics-header">
        <div>
          <div className="eyebrow">
            <ListFilter size={14} />
            Zone-based summary
          </div>
          <h2>Post-race analysis</h2>
          <p>Cadence, speed, reaction, finish, and private Apple Watch heart-rate results by zone and rider.</p>
        </div>
        <div className="metric-summary">
          {selectedMetrics.map((metric) => {
            const Icon = metricMeta[metric].icon;
            return <span key={metric}><Icon size={14} /> {metricMeta[metric].label}</span>;
          })}
        </div>
      </div>

      {raceCapture && (
        <div className="capture-export-card">
          <div>
            <span className={`capture-status ${raceCapture.status}`} />
            <strong>Race capture</strong>
            <small>
              {raceCapture.status} / {raceCapture.samples.length} samples / {raceCapture.events.length} events
              {' / '}shared exports exclude private power
            </small>
          </div>
          <div className="capture-actions">
            <button type="button" onClick={onRaceCaptureJsonExport}>
              <Download size={14} />
              JSON
            </button>
            <button type="button" onClick={onRaceCaptureCsvExport}>
              <Download size={14} />
              CSV
            </button>
          </div>
        </div>
      )}

      {raceSummary.length > 0 && (
        <div className="race-summary-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Race Summary</span>
              <h3>Final rider results</h3>
            </div>
            <Trophy size={18} />
          </div>

          <div className="race-summary-stats">
            <div>
              <span>Winner</span>
              <strong>{winner?.riderName ?? '--'}</strong>
              <small>{winner ? formatFinishTime(winner.finishTimeMs) : 'No finish'}</small>
            </div>
            <div>
              <span>Fastest</span>
              <strong>{formatNullableSpeed(bestSpeed, speedUnit)}</strong>
              <small>top speed</small>
            </div>
            <div>
              <span>Cadence</span>
              <strong>{formatNullableMetric(bestCadence, 'RPM')}</strong>
              <small>peak</small>
            </div>
            <div>
              <span>Reaction</span>
              <strong>{formatReactionTime(bestReaction)}</strong>
              <small>best RT</small>
            </div>
            <div>
              <span>{formatAnalyticsFeetDistance(30, distanceUnit)}</span>
              <strong>{formatSplitTime(bestThirtyFoot)}</strong>
              <small>best split</small>
            </div>
          </div>

          <div className="race-summary-table-wrap">
            <table className="race-summary-table">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Rider</th>
                  <th>Finish</th>
                  <th>{formatAnalyticsFeetDistance(30, distanceUnit)}</th>
                  {showReactionSummary && <th>Reaction</th>}
                  {showSpeedSummary && <th>Top speed</th>}
                  {showSpeedSummary && <th>Avg speed</th>}
                  {showCadenceSummary && <th>Top cadence</th>}
                  {showCadenceSummary && <th>Avg cadence</th>}
                  {hasHeartRate && <th>Private heart rate</th>}
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {raceSummary.map((summary) => (
                  <tr key={summary.playerId}>
                    <td>
                      <span className="place-badge">{ordinal(summary.rank)}</span>
                    </td>
                    <td>
                      <div className="summary-rider">
                        <RiderAvatar
                          name={summary.riderName}
                          photoUrl={playerById.get(summary.playerId)?.photoUrl}
                          accent={summary.accent}
                          className="summary-rider-avatar"
                        />
                        <span
                          className="player-chip"
                          style={{ '--player-color': summary.accent } as CSSProperties}
                        >
                          P{summary.playerId}
                        </span>
                        <div>
                          <strong>{summary.riderName}</strong>
                          <span>{summary.deviceLabel}</span>
                        </div>
                      </div>
                    </td>
                    <td style={newPersonalRecordsByPlayer[summary.playerId] ? {
                      background: '#fee2e2',
                      color: '#b91c1c',
                      fontWeight: 900,
                    } : undefined}>
                      <span className="race-result-time">{formatFinishTime(summary.finishTimeMs)}</span>
                      {newPersonalRecordsByPlayer[summary.playerId] && (
                        <NewRecordBadge style={{ marginLeft: '6px' }} />
                      )}
                    </td>
                    <td>{formatSplitTime(summary.thirtyFootTimeMs)}</td>
                    {showReactionSummary && <td>{formatReactionTime(reactionTimesByPlayer[summary.playerId])}</td>}
                    {showSpeedSummary && <td>{formatNullableSpeed(summary.topSpeedKph, speedUnit)}</td>}
                    {showSpeedSummary && <td>{formatNullableSpeed(summary.averageSpeedKph, speedUnit)}</td>}
                    {showCadenceSummary && <td>{formatNullableMetric(summary.topCadence, 'RPM')}</td>}
                    {showCadenceSummary && <td>{formatNullableMetric(summary.averageCadence, 'RPM')}</td>}
                    {hasHeartRate && (
                      <td>
                        {heartRateByPlayer[summary.playerId]?.summary?.sampleCount
                          ? <span aria-label="Private Apple Watch heart rate">
                            {formatNullableMetric(heartRateByPlayer[summary.playerId]?.summary?.averageBpm ?? null, 'BPM')} avg
                            {' / '}
                            {formatNullableMetric(heartRateByPlayer[summary.playerId]?.summary?.peakBpm ?? null, 'BPM')} peak
                          </span>
                          : '—'}
                      </td>
                    )}
                    <td>{summary.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="analytics-grid">
        <div className="zone-table-card">
          <table className="zone-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Range</th>
                {players.map((player) => {
                  const name = zoneRiderNameParts(player.name);
                  return (
                    <th key={player.id} aria-label={`P${player.id} ${player.name}`}>
                      <div className="zone-rider-header">
                        <span
                          className="player-chip"
                          style={{ '--player-color': player.accent } as CSSProperties}
                        >
                          P{player.id}
                        </span>
                        <strong>{name.firstName}</strong>
                        {name.nickname && <em>“{name.nickname}”</em>}
                        {name.lastName && <span>{name.lastName}</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {zonesToDisplay.length > 0 ? zonesToDisplay.map((zone) => (
                <tr key={zone.id}>
                  <td>
                    <strong>{zone.name}</strong>
                    <span>{zoneTypeLabel(zone)}</span>
                  </td>
                  <td>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</td>
                  {players.map((player) => {
                    const stats = zoneRiderResult(zoneResults, zone.id, player.id);
                    const heartRateZone = heartRateByPlayer[player.id]?.zones?.find((item) => item.zoneId === zone.id);

                    return (
                      <td className="zone-rider-metrics" key={player.id}>
                        <span className="table-metric">
                          <small>Max cadence</small>
                          <strong>{formatNullableMetric(stats?.topCadence ?? null, 'RPM')}</strong>
                        </span>
                        <span className="table-metric">
                          <small>Max speed</small>
                          <strong>{formatNullableSpeed(stats?.topSpeedKph ?? null, speedUnit)}</strong>
                        </span>
                        {hasHeartRate && (
                          <span className="table-metric private-heart-rate-metric">
                            <small><HeartPulse size={12} /> Private HR avg / peak</small>
                            <strong>{heartRateZone?.summary.sampleCount
                              ? `${Math.round(heartRateZone.summary.averageBpm ?? 0)} / ${Math.round(heartRateZone.summary.peakBpm ?? 0)} BPM`
                              : 'No heart-rate sample'}</strong>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )) : (
                <tr>
                  <td colSpan={Math.max(2, players.length + 2)}>No mapped pedal zones</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="leaderboard-card ghost-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Ghost Racer Leaderboard</span>
              <h3>{track.name}</h3>
              {sprintConfiguration && (
                <small className="leaderboard-configuration">
                  {formatAnalyticsFeetDistance(sprintConfiguration.distanceFeet, distanceUnit)} sprint • Wattbike Air {sprintConfiguration.airSetting}
                </small>
              )}
            </div>
            <Trophy size={18} />
          </div>

          <div className="ghost-summary-row">
            <span>{selectedGhostCount} selected to race</span>
            <button type="button" onClick={onGhostClear} disabled={selectedGhostCount === 0}>
              Clear
            </button>
          </div>

          {rankedGhosts.length === 0 ? (
            <small className="ghost-group-empty">
              {sprintConfiguration
                ? `Complete a live ${formatAnalyticsFeetDistance(sprintConfiguration.distanceFeet, distanceUnit)} sprint at Air ${sprintConfiguration.airSetting} to create this configuration’s first record.`
                : 'Complete a live Wattbike race on this track to create the first ranked ghost.'}
            </small>
          ) : (
            <div className="ghost-picker">
              <div className="ghost-group">
                <span>Top 3 — Fastest Lap</span>
                <div className="leaderboard-list leaderboard-podium">
                  {podiumGhosts.map((ghost, index) => renderGhostOption(ghost, index + 1))}
                </div>
              </div>

              {remainingGhosts.length > 0 && (
                <details className="ghost-rank-dropdown">
                  <summary>
                    <span>Ranks 4–{rankedGhosts.length}</span>
                    <small>Choose another ghost</small>
                  </summary>
                  <div className="ghost-group ghost-ranked-list">
                    {remainingGhosts.map((ghost, index) => renderGhostOption(ghost, index + 4))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
