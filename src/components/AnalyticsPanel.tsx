import { useMemo, useState, type CSSProperties } from 'react';
import { Activity, Download, Gauge, ListFilter, Timer, Trophy, Zap } from 'lucide-react';
import { buildRaceZoneResults, zoneRiderResult } from '../lib/raceReview';
import { formatDistanceRangeMeters, formatReactionTime, formatSpeedFromKph, speedUnitLabel } from '../units';
import type {
  DistanceUnit,
  GhostLap,
  MetricKey,
  PlayerSlot,
  RaceCapture,
  RaceSummaryEntry,
  ReactionTimesByPlayer,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';
import { PodiumTrophy } from './PodiumTrophy';
import { RiderAvatar } from './RiderAvatar';

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
  currentProfileKey: string;
  onRaceCaptureJsonExport: () => void;
  onRaceCaptureCsvExport: () => void;
  onGhostToggle: (ghostId: string) => void;
  onGhostClear: () => void;
  onGhostAnalyticsSharingChange: (ghostId: string, analyticsPublic: boolean) => void;
};

const metricMeta: Record<MetricKey, { label: string; unit: string; icon: typeof Activity }> = {
  cadence: { label: 'Cadence', unit: 'RPM', icon: Activity },
  speed: { label: 'Speed', unit: '', icon: Gauge },
  power: { label: 'Power', unit: 'W', icon: Zap },
  reaction: { label: 'Reaction', unit: 'RT', icon: Timer },
};

type GhostLeaderboardMetric =
  | 'finish'
  | 'thirtyFoot'
  | 'topCadence'
  | 'averageCadence'
  | 'topSpeed'
  | 'averageSpeed'
  | 'topWatts'
  | 'averageWatts';

const ghostLeaderboardLabels: Record<GhostLeaderboardMetric, string> = {
  finish: 'Fastest Lap',
  thirtyFoot: 'Fastest 30 ft',
  topCadence: 'Peak RPM',
  averageCadence: 'Average RPM',
  topSpeed: 'Top Speed',
  averageSpeed: 'Average Speed',
  topWatts: 'Peak Power',
  averageWatts: 'Average Power',
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

function ghostMetricValue(ghost: GhostLap, metric: GhostLeaderboardMetric) {
  switch (metric) {
    case 'finish':
      return ghost.finishTimeMs;
    case 'thirtyFoot':
      return ghost.thirtyFootTimeMs;
    case 'topCadence':
      return ghost.summary?.topCadence ?? null;
    case 'averageCadence':
      return ghost.summary?.averageCadence ?? null;
    case 'topSpeed':
      return ghost.summary?.topSpeedKph ?? null;
    case 'averageSpeed':
      return ghost.summary?.averageSpeedKph ?? null;
    case 'topWatts':
      return ghost.summary?.topWatts ?? null;
    case 'averageWatts':
      return ghost.summary?.averageWatts ?? null;
  }
}

function formatGhostMetric(
  ghost: GhostLap,
  metric: GhostLeaderboardMetric,
  speedUnit: SpeedUnit,
) {
  const value = ghostMetricValue(ghost, metric);
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }

  if (metric === 'finish' || metric === 'thirtyFoot') {
    return formatGhostRaceTime(value);
  }

  if (metric === 'topSpeed' || metric === 'averageSpeed') {
    return `${formatSpeedFromKph(value, speedUnit)} ${speedUnitLabel(speedUnit)}`;
  }

  return `${Math.round(value)} ${metric === 'topCadence' || metric === 'averageCadence' ? 'RPM' : 'W'}`;
}

function compareGhosts(left: GhostLap, right: GhostLap, metric: GhostLeaderboardMetric) {
  const leftValue = ghostMetricValue(left, metric);
  const rightValue = ghostMetricValue(right, metric);
  if (leftValue == null && rightValue != null) {
    return 1;
  }
  if (leftValue != null && rightValue == null) {
    return -1;
  }
  if (leftValue != null && rightValue != null && leftValue !== rightValue) {
    return metric === 'finish' || metric === 'thirtyFoot'
      ? leftValue - rightValue
      : rightValue - leftValue;
  }

  return left.finishTimeMs - right.finishTimeMs || right.savedAt - left.savedAt;
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
  currentProfileKey,
  onRaceCaptureJsonExport,
  onRaceCaptureCsvExport,
  onGhostToggle,
  onGhostClear,
  onGhostAnalyticsSharingChange,
}: AnalyticsPanelProps) {
  const [ghostLeaderboardMetric, setGhostLeaderboardMetric] = useState<GhostLeaderboardMetric>('finish');
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
  const showPowerSummary = selectedMetrics.includes('power');
  const showReactionSummary = selectedMetrics.includes('reaction');
  const winner = raceSummary[0];
  const bestSpeed = bestSummaryValue(raceSummary, (summary) => summary.topSpeedKph);
  const bestCadence = bestSummaryValue(raceSummary, (summary) => summary.topCadence);
  const bestWatts = bestSummaryValue(raceSummary, (summary) => summary.topWatts);
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
  const rankedGhosts = useMemo(
    () => [...ghostLaps]
      .sort((left, right) => compareGhosts(left, right, ghostLeaderboardMetric))
      .slice(0, 50),
    [ghostLaps, ghostLeaderboardMetric],
  );
  const podiumGhosts = rankedGhosts.slice(0, 3);
  const remainingGhosts = rankedGhosts.slice(3);
  const selectedGhostCount = selectedGhostIds.filter((ghostId) => (
    rankedGhosts.some((ghost) => ghost.id === ghostId)
  )).length;
  const selectedGhosts = rankedGhosts.filter((ghost) => selectedGhostIds.includes(ghost.id));
  const renderGhostOption = (ghost: GhostLap, rank: number) => {
    const selected = selectedGhostIds.includes(ghost.id);
    const currentPlayer = playerByName.get(ghost.riderName.trim().toLocaleLowerCase());
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
              photoUrl={ghost.photoUrl ?? currentPlayer?.photoUrl}
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
            {formatGhostMetric(ghost, ghostLeaderboardMetric, speedUnit)}
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
          photoUrl={ghost.photoUrl ?? currentPlayer?.photoUrl}
          accent={ghost.accent}
          className="leaderboard-rider-avatar"
        />
        <div>
          <strong>{ghost.riderName}</strong>
          <span>{selected ? 'Selected to race' : `${ghostSourceLabel(ghost)} • ${savedDate}`}</span>
        </div>
        <strong>{formatGhostMetric(ghost, ghostLeaderboardMetric, speedUnit)}</strong>
      </button>
    );
  };
  const renderSelectedGhostPerformance = (ghost: GhostLap) => {
    const ownsGhost = ghost.ownerKey === currentProfileKey;
    const riderZoneResults = ghost.zoneResults.flatMap((zone) => (
      zone.riders[0] ? [{ zone, rider: zone.riders[0] }] : []
    ));

    return (
      <details className="ghost-analytics ghost-option" key={ghost.id}>
        <summary>{ghost.riderName} — recorded performance</summary>
        <div className="ghost-overall-metrics">
          <span>Lap {formatGhostRaceTime(ghost.finishTimeMs)}</span>
          <span>30 ft {ghost.thirtyFootTimeMs == null ? '--' : formatGhostRaceTime(ghost.thirtyFootTimeMs)}</span>
          <span>{ghost.lapCount} {ghost.lapCount === 1 ? 'lap' : 'laps'}</span>
          <span>
            Cadence {formatNullableMetric(ghost.summary?.topCadence ?? null, 'RPM')} peak
            {' / '}{formatNullableMetric(ghost.summary?.averageCadence ?? null, 'RPM')} avg
          </span>
          <span>
            Speed {formatNullableSpeed(ghost.summary?.topSpeedKph ?? null, speedUnit)} peak
            {' / '}{formatNullableSpeed(ghost.summary?.averageSpeedKph ?? null, speedUnit)} avg
          </span>
          <span>
            Power {formatNullableMetric(ghost.summary?.topWatts ?? null, 'W')} peak
            {' / '}{formatNullableMetric(ghost.summary?.averageWatts ?? null, 'W')} avg
          </span>
        </div>
        <small>
          {ghost.analyticsPublic
            ? 'Replay and performance data public'
            : ownsGhost
              ? 'Replay public / your performance private'
              : 'Replay public / performance private'}
        </small>
        {ownsGhost && (
          <label className="ghost-share-toggle">
            <input
              type="checkbox"
              checked={ghost.analyticsPublic}
              onChange={(event) => onGhostAnalyticsSharingChange(ghost.id, event.target.checked)}
            />
            <span>Share performance and zone data with other racers</span>
          </label>
        )}
        {riderZoneResults.map(({ zone, rider }) => (
          <div className="ghost-zone-row" key={zone.zoneId}>
            <strong>{zone.zoneName}</strong>
            <span>
              {formatNullableMetric(rider.topCadence, 'RPM')} peak
              {' / '}{formatNullableMetric(rider.averageCadence, 'RPM')} avg
            </span>
            <span>
              {formatNullableSpeed(rider.topSpeedKph, speedUnit)} peak
              {' / '}{formatNullableSpeed(rider.averageSpeedKph, speedUnit)} avg
            </span>
            <span>
              {formatNullableMetric(rider.topWatts, 'W')} peak
              {' / '}{formatNullableMetric(rider.averageWatts, 'W')} avg
            </span>
          </div>
        ))}
      </details>
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
          <p>Peak cadence, speed, and power by zone and rider.</p>
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
              <span>Power</span>
              <strong>{formatNullableMetric(bestWatts, 'W')}</strong>
              <small>peak</small>
            </div>
            <div>
              <span>Reaction</span>
              <strong>{formatReactionTime(bestReaction)}</strong>
              <small>best RT</small>
            </div>
            <div>
              <span>30 ft</span>
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
                  <th>30 ft</th>
                  {showReactionSummary && <th>Reaction</th>}
                  {showSpeedSummary && <th>Top speed</th>}
                  {showSpeedSummary && <th>Avg speed</th>}
                  {showCadenceSummary && <th>Top cadence</th>}
                  {showCadenceSummary && <th>Avg cadence</th>}
                  {showPowerSummary && <th>Top watts</th>}
                  {showPowerSummary && <th>Avg watts</th>}
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
                    <td>{formatFinishTime(summary.finishTimeMs)}</td>
                    <td>{formatSplitTime(summary.thirtyFootTimeMs)}</td>
                    {showReactionSummary && <td>{formatReactionTime(reactionTimesByPlayer[summary.playerId])}</td>}
                    {showSpeedSummary && <td>{formatNullableSpeed(summary.topSpeedKph, speedUnit)}</td>}
                    {showSpeedSummary && <td>{formatNullableSpeed(summary.averageSpeedKph, speedUnit)}</td>}
                    {showCadenceSummary && <td>{formatNullableMetric(summary.topCadence, 'RPM')}</td>}
                    {showCadenceSummary && <td>{formatNullableMetric(summary.averageCadence, 'RPM')}</td>}
                    {showPowerSummary && <td>{formatNullableMetric(summary.topWatts, 'W')}</td>}
                    {showPowerSummary && <td>{formatNullableMetric(summary.averageWatts, 'W')}</td>}
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
                        <span className="table-metric">
                          <small>Max power</small>
                          <strong>{formatNullableMetric(stats?.topWatts ?? null, 'W')}</strong>
                        </span>
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
            </div>
            <Trophy size={18} />
          </div>

          <div className="leaderboard-tabs">
            {(Object.keys(ghostLeaderboardLabels) as GhostLeaderboardMetric[]).map((metric) => (
              <button
                className={ghostLeaderboardMetric === metric ? 'selected' : ''}
                type="button"
                onClick={() => setGhostLeaderboardMetric(metric)}
                key={metric}
              >
                {ghostLeaderboardLabels[metric]}
              </button>
            ))}
          </div>

          <div className="ghost-summary-row">
            <span>{selectedGhostCount} selected to race</span>
            <button type="button" onClick={onGhostClear} disabled={selectedGhostCount === 0}>
              Clear
            </button>
          </div>

          {rankedGhosts.length === 0 ? (
            <small className="ghost-group-empty">
              Complete a live Wattbike race on this track to create the first ranked ghost.
            </small>
          ) : (
            <div className="ghost-picker">
              <div className="ghost-group">
                <span>Top 3 — {ghostLeaderboardLabels[ghostLeaderboardMetric]}</span>
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

              {selectedGhosts.length > 0 && (
                <div className="ghost-group">
                  <span>Selected ghost performance</span>
                  {selectedGhosts.map(renderSelectedGhostPerformance)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
