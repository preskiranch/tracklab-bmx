import { Activity, Gauge, ListFilter, Trophy, Zap } from 'lucide-react';
import { formatDistanceRangeMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  LeaderboardMetric,
  MetricKey,
  PlayerSlot,
  RiderState,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';

type AnalyticsPanelProps = {
  track: TrackRecord;
  players: PlayerSlot[];
  riders: RiderState[];
  samplesByDevice: Map<number, BikeSample>;
  selectedMetrics: MetricKey[];
  leaderboardMetric: LeaderboardMetric;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  activeZones: TrackZone[];
  onLeaderboardMetricChange: (metric: LeaderboardMetric) => void;
};

const metricMeta: Record<MetricKey, { label: string; unit: string; icon: typeof Activity }> = {
  cadence: { label: 'Cadence', unit: 'RPM', icon: Activity },
  speed: { label: 'Speed', unit: '', icon: Gauge },
  power: { label: 'Power', unit: 'W', icon: Zap },
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
) {
  const multiplier = zoneMultiplier(zone);

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

export function AnalyticsPanel({
  track,
  players,
  riders,
  samplesByDevice,
  selectedMetrics,
  leaderboardMetric,
  speedUnit,
  distanceUnit,
  activeZones,
  onLeaderboardMetricChange,
}: AnalyticsPanelProps) {
  const zonesToDisplay = activeZones.length > 0
    ? activeZones
    : track.routeStatus === 'user-mapped'
      ? track.zones
      : [];

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

                    return (
                      <td key={player.id}>
                        {selectedMetrics.map((metric) => (
                          <span className="table-metric" key={metric}>
                            {metricMeta[metric].label}: {metricValue(metric, zone, sample, rider, speedUnit)}
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
