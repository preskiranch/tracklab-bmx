import { useEffect, useRef, useState } from 'react';
import { Activity, Bike, Gauge, RadioTower, Signal, Zap } from 'lucide-react';
import { liveBikeTimeoutMs } from '../data';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, SpeedUnit } from '../types';

type MonitorViewProps = {
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
};

type MonitorMetrics = {
  live: boolean;
  watts: number;
  cadence: number;
  speedKph: number;
};

type MonitorSprintDraft = {
  deviceId: number;
  startedAt: number;
  lastActiveAt: number;
  peakWatts: number;
  peakCadence: number;
  rpmAtPowerPeak: number;
  sampleCount: number;
};

type MonitorSprintResult = MonitorSprintDraft & {
  endedAt: number | null;
  status: 'capturing' | 'complete';
};

function formatAge(sample: BikeSample | undefined, now = Date.now()) {
  if (!sample) {
    return 'No data';
  }

  const seconds = Math.max(0, Math.round((now - sample.at) / 1000));
  return seconds <= 1 ? 'Live now' : `${seconds}s ago`;
}

function metricIsFresh(sample: BikeSample | undefined, metricAt: number | undefined, now = Date.now()) {
  if (!sample) {
    return false;
  }

  return now - (metricAt ?? sample.at) <= liveBikeTimeoutMs;
}

function monitorMetrics(sample: BikeSample | undefined, now = Date.now()): MonitorMetrics {
  const wattsFresh = metricIsFresh(sample, sample?.wattsAt, now);
  const cadenceFresh = metricIsFresh(sample, sample?.cadenceAt, now);
  const speedFresh = metricIsFresh(sample, sample?.speedAt, now);
  const watts = wattsFresh ? sample?.watts ?? 0 : 0;
  const cadence = cadenceFresh ? sample?.cadence ?? 0 : 0;
  const rawSpeedKph = speedFresh ? sample?.speedKph ?? 0 : 0;
  const idleNoise = watts <= 10 && cadence <= 15 && rawSpeedKph <= 5;

  return {
    live: metricIsFresh(sample, sample?.at),
    watts: idleNoise ? 0 : watts,
    cadence: idleNoise ? 0 : cadence,
    speedKph: idleNoise ? 0 : rawSpeedKph,
  };
}

function isSprintActive(metrics: MonitorMetrics) {
  return metrics.watts > 10 || metrics.cadence > 18 || metrics.speedKph > 2;
}

function resultFromDraft(draft: MonitorSprintDraft, status: MonitorSprintResult['status'], endedAt: number | null): MonitorSprintResult {
  return {
    ...draft,
    endedAt,
    status,
  };
}

function sprintDurationSeconds(result: MonitorSprintResult, now: number) {
  const end = result.endedAt ?? now;
  return Math.max(0, (end - result.startedAt) / 1000);
}

export function MonitorView({ players, samplesByDevice, speedUnit }: MonitorViewProps) {
  const activeSprintsRef = useRef<Map<number, MonitorSprintDraft>>(new Map());
  const [sprintResults, setSprintResults] = useState<Record<number, MonitorSprintResult>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const connectedDevices = new Set(players
      .map((player) => player.deviceId)
      .filter((deviceId): deviceId is number => deviceId != null));
    const updates = new Map<number, MonitorSprintResult | null>();

    players.forEach((player) => {
      if (player.deviceId == null) {
        return;
      }

      const sample = samplesByDevice.get(player.deviceId);
      const metrics = monitorMetrics(sample, now);
      const active = isSprintActive(metrics);
      const existing = activeSprintsRef.current.get(player.deviceId);

      if (active) {
        const sampleAt = sample?.at ?? now;
        const previousPeakWatts = existing?.peakWatts ?? 0;
        const powerPeakChanged = metrics.watts >= previousPeakWatts;
        const peakWatts = Math.max(previousPeakWatts, metrics.watts);
        const nextDraft: MonitorSprintDraft = {
          deviceId: player.deviceId,
          startedAt: existing?.startedAt ?? sampleAt,
          lastActiveAt: sampleAt,
          peakWatts,
          peakCadence: Math.max(existing?.peakCadence ?? 0, metrics.cadence),
          rpmAtPowerPeak: powerPeakChanged ? metrics.cadence : existing?.rpmAtPowerPeak ?? metrics.cadence,
          sampleCount: (existing?.sampleCount ?? 0) + 1,
        };
        activeSprintsRef.current.set(player.deviceId, nextDraft);
        updates.set(player.deviceId, resultFromDraft(nextDraft, 'capturing', null));
        return;
      }

      if (existing) {
        const idleMs = now - existing.lastActiveAt;
        if (idleMs >= 1200 || !metrics.live) {
          activeSprintsRef.current.delete(player.deviceId);
          if (existing.sampleCount >= 2) {
            updates.set(player.deviceId, resultFromDraft(existing, 'complete', existing.lastActiveAt));
          } else {
            updates.set(player.deviceId, null);
          }
        } else {
          updates.set(player.deviceId, resultFromDraft(existing, 'capturing', null));
        }
      }
    });

    activeSprintsRef.current.forEach((draft, deviceId) => {
      if (!connectedDevices.has(deviceId)) {
        activeSprintsRef.current.delete(deviceId);
        updates.set(deviceId, resultFromDraft(draft, 'complete', draft.lastActiveAt));
      }
    });

    if (updates.size === 0) {
      return;
    }

    setSprintResults((current) => {
      let changed = false;
      const next = { ...current };
      updates.forEach((result, deviceId) => {
        if (!result) {
          if (next[deviceId]) {
            delete next[deviceId];
            changed = true;
          }
          return;
        }

        const currentResult = next[deviceId];
        if (
          !currentResult
          || currentResult.status !== result.status
          || currentResult.peakWatts !== result.peakWatts
          || currentResult.peakCadence !== result.peakCadence
          || currentResult.rpmAtPowerPeak !== result.rpmAtPowerPeak
          || currentResult.endedAt !== result.endedAt
        ) {
          next[deviceId] = result;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [now, players, samplesByDevice]);

  return (
    <main className="monitor-panel">
      <div className="monitor-header">
        <div>
          <h2>Monitor View</h2>
          <p>Large-format live readout for connected Wattbike Model B monitors.</p>
        </div>
        <div className="monitor-count">
          <Bike size={18} />
          <span>{players.length} connected</span>
        </div>
      </div>

      {players.length === 0 ? (
        <div className="monitor-empty">
          <RadioTower size={22} />
          <span>No live bikes detected yet.</span>
        </div>
      ) : (
        <div className="monitor-grid">
          {players.map((player) => {
            const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
            const metrics = monitorMetrics(sample, now);
            const sprintResult = player.deviceId == null ? undefined : sprintResults[player.deviceId];

            return (
              <section
                className={`monitor-card ${metrics.live ? 'live' : 'idle'}`}
                style={{ '--player-color': player.accent } as React.CSSProperties}
                key={player.id}
              >
                <div className="monitor-card-head">
                  <span className="player-chip" style={{ '--player-color': player.accent } as React.CSSProperties}>
                    P{player.id}
                  </span>
                  <div>
                    <h3>{player.name}</h3>
                    <p>{player.deviceId ? `Device ${player.deviceId}` : 'Unassigned'}</p>
                  </div>
                  <span className="monitor-live">
                    <Signal size={15} />
                    {metrics.live && sample ? `${Math.round(sample.signal * 100)}%` : 'Idle'}
                  </span>
                </div>

                <div className="monitor-primary">
                  <div>
                    <Zap size={24} />
                    <span>{metrics.watts}</span>
                    <small>watts</small>
                  </div>
                  <div>
                    <Activity size={24} />
                    <span>{metrics.cadence}</span>
                    <small>rpm</small>
                  </div>
                </div>

                <div className="monitor-secondary">
                  <div>
                    <Gauge size={18} />
                    <span>{formatSpeedFromKph(metrics.speedKph, speedUnit)}</span>
                    <small>{speedUnitLabel(speedUnit)}</small>
                  </div>
                  <div>
                    <RadioTower size={18} />
                    <span>{sample?.source.toUpperCase() ?? '--'}</span>
                    <small>{formatAge(sample, now)}</small>
                  </div>
                </div>

                <div className={`monitor-sprint-result ${sprintResult ? sprintResult.status : 'empty'}`}>
                  {sprintResult ? (
                    <>
                      <div className="monitor-sprint-head">
                        <strong>{sprintResult.status === 'capturing' ? 'Capturing sprint' : 'Last sprint result'}</strong>
                        <span>{sprintDurationSeconds(sprintResult, now).toFixed(1)}s</span>
                      </div>
                      <div className="monitor-sprint-grid">
                        <div>
                          <span>{sprintResult.peakWatts}</span>
                          <small>Power peak</small>
                        </div>
                        <div>
                          <span>{sprintResult.peakCadence}</span>
                          <small>Cadence pk</small>
                        </div>
                        <div>
                          <span>{sprintResult.rpmAtPowerPeak}</span>
                          <small>RPM @ peak</small>
                        </div>
                      </div>
                    </>
                  ) : (
                    <span>No completed sprint yet</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
