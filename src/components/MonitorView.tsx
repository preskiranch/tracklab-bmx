import { Activity, Bike, Gauge, RadioTower, Signal, Zap } from 'lucide-react';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, SpeedUnit } from '../types';

type MonitorViewProps = {
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
};

function formatAge(sample: BikeSample | undefined) {
  if (!sample) {
    return 'No data';
  }

  const seconds = Math.max(0, Math.round((Date.now() - sample.at) / 1000));
  return seconds <= 1 ? 'Live now' : `${seconds}s ago`;
}

export function MonitorView({ players, samplesByDevice, speedUnit }: MonitorViewProps) {
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

            return (
              <section
                className="monitor-card"
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
                    {sample ? `${Math.round(sample.signal * 100)}%` : 'Waiting'}
                  </span>
                </div>

                <div className="monitor-primary">
                  <div>
                    <Zap size={24} />
                    <span>{sample?.watts ?? 0}</span>
                    <small>watts</small>
                  </div>
                  <div>
                    <Activity size={24} />
                    <span>{sample?.cadence ?? '--'}</span>
                    <small>rpm</small>
                  </div>
                </div>

                <div className="monitor-secondary">
                  <div>
                    <Gauge size={18} />
                    <span>{formatSpeedFromKph(sample?.speedKph, speedUnit)}</span>
                    <small>{speedUnitLabel(speedUnit)}</small>
                  </div>
                  <div>
                    <RadioTower size={18} />
                    <span>{sample?.source.toUpperCase() ?? '--'}</span>
                    <small>{formatAge(sample)}</small>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
