import type { CSSProperties } from 'react';
import { Activity, Download, Gauge, ListFilter, Timer, Trophy, Zap } from 'lucide-react';
import { formatDistanceRangeMeters, formatReactionTime, formatSpeedFromKph, speedUnitLabel } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  LeaderboardMetric,
  MetricKey,
  PlayerSlot,
  RaceCapture,
  RaceSummaryEntry,
  ReactionTimesByPlayer,
  RiderState,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';

type AnalyticsPanelProps = {
  track: TrackRecord;
  players: PlayerSlot[];
  riders: RiderState[];
  raceSummary: RaceSummaryEntry[];
  samplesByDevice: Map<number, BikeSample>;
  selectedMetrics: MetricKey[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  leaderboardMetric: LeaderboardMetric;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  activeZones: TrackZone[];
  raceCapture: RaceCapture | null;
  onRaceCaptureJsonExport: () => void;
  onRaceCaptureCsvExport: () => void;
  onLeaderboardMetricChange: (metric: LeaderboardMetric) => void;
};

const metricMeta: Record<MetricKey, { label: string; unit: string; icon: typeof Activity }> = {
  cadence: { label: 'Cadence', unit: 'RPM', icon: Activity },
  speed: { label: 'Speed', unit: '', icon: Gauge },
  power: { label: 'Power', unit: 'W', icon: Zap },
  reaction: { label: 'Reaction', unit: 'RT', icon: Timer },
};

const leaderboardLabels: Record<LeaderboardMetric, string> = {
  rpm: 'Best RPM',
  speed: 'Top Speed',
  watts: 'Most Watts',
};

function sampleForPlayer(player: PlayerSlot, samplesByDevice: Map<number, BikeSample>) {
  return player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
}

function zoneMultiplier(zone: TrackZone) {
  if (zone.type === 'pedal') {
    return 1.04;
  }

  if (zone.type === 'technical') {
    return 0.92;
  }

  return 0.78;
}

function metricValue(
  metric: MetricKey,
  zone: TrackZone,
  sample: BikeSample | undefined,
  rider: RiderState | undefined,
  speedUnit: SpeedUnit,
  reactionTimeMs: number | null | undefined,
) {
  const multiplier = zoneMultiplier(zone);

  if (metric === 'reaction') {
    return formatReactionTime(reactionTimeMs);
  }

  if (metric === 'cadence') {
    const value = Math.round((sample?.cadence ?? 0) * multiplier);
    return value > 0 ? `${value} RPM` : '--';
  }

  if (metric === 'power') {
    const value = Math.round((sample?.watts ?? rider?.lastWatts ?? 0) * multiplier);
    return value > 0 ? `${value} W` : '--';
  }

  if (!sample?.speedKph) {
    return '--';
  }

  const adjustedKph = sample.speedKph * multiplier;
  return `${formatSpeedFromKph(adjustedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
}

function leaderboardValue(value: number, metric: LeaderboardMetric, speedUnit: SpeedUnit) {
  if (metric === 'speed') {
    const speed = speedUnit === 'mph' ? value : value / 0.621371;
    return `${speed.toFixed(1)} ${speedUnitLabel(speedUnit)}`;
  }

  return `${Math.round(value)} ${metric === 'rpm' ? 'RPM' : 'W'}`;
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

export function AnalyticsPanel({
  track,
  players,
  riders,
  raceSummary,
  samplesByDevice,
  selectedMetrics,
  reactionTimesByPlayer,
  leaderboardMetric,
  speedUnit,
  distanceUnit,
  activeZones,
  raceCapture,
  onRaceCaptureJsonExport,
  onRaceCaptureCsvExport,
  onLeaderboardMetricChange,
}: AnalyticsPanelProps) {
  const zonesToDisplay = activeZones.length > 0
    ? activeZones
    : track.routeStatus === 'user-mapped'
      ? track.zones
      : [];
  const showSpeedSummary = selectedMetrics.includes('speed');
  const showCadenceSummary = selectedMetrics.includes('cadence');
  const showPowerSummary = selectedMetrics.includes('power');
  const showReactionSummary = selectedMetrics.includes('reaction');

  return (
    <section className="analytics-panel">
      <div className="analytics-header">
        <div>
          <div className="eyebrow">
            <ListFilter size={14} />
            Zone-based summary
          </div>
          <h2>Post-race analysis</h2>
          <p>Zone averages and peak outputs by rider.</p>
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

          <div className="race-summary-table-wrap">
            <table className="race-summary-table">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Rider</th>
                  <th>Finish</th>
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
                {players.map((player) => <th key={player.id}>P{player.id}</th>)}
              </tr>
            </thead>
            <tbody>
              {zonesToDisplay.length > 0 ? zonesToDisplay.map((zone) => (
                <tr key={zone.id}>
                  <td>
                    <strong>{zone.name}</strong>
                    <span>{zone.type}</span>
                  </td>
                  <td>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</td>
                  {players.map((player) => {
                    const sample = sampleForPlayer(player, samplesByDevice);
                    const rider = riders.find((item) => item.playerId === player.id);
                    const reactionTime = reactionTimesByPlayer[player.id];

                    return (
                      <td key={player.id}>
                        {selectedMetrics.map((metric) => (
                          <span className="table-metric" key={metric}>
                            {metricMeta[metric].label}: {metricValue(metric, zone, sample, rider, speedUnit, reactionTime)}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              )) : (
                <tr>
                  <td colSpan={Math.max(2, players.length + 2)}>No mapped sprint zones</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="leaderboard-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Leaderboard</span>
              <h3>{track.name}</h3>
            </div>
            <Trophy size={18} />
          </div>

          <div className="leaderboard-tabs">
            {(Object.keys(leaderboardLabels) as LeaderboardMetric[]).map((metric) => (
              <button
                className={leaderboardMetric === metric ? 'selected' : ''}
                type="button"
                onClick={() => onLeaderboardMetricChange(metric)}
                key={metric}
              >
                {leaderboardLabels[metric]}
              </button>
            ))}
          </div>

          <div className="leaderboard-list">
            {track.leaderboards[leaderboardMetric].map((entry, index) => (
              <div className="leaderboard-row" key={`${entry.rider}-${entry.date}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{entry.rider}</strong>
                  <span>{entry.date}</span>
                </div>
                <strong>{leaderboardValue(entry.value, leaderboardMetric, speedUnit)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
