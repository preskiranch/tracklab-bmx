import { Zap } from 'lucide-react';
import { raceLengthMeters } from '../data';
import { surfaceOffsetPx, trackFeatures } from '../game/trackProfile';
import { formatSpeedFromMps, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, RaceState, RiderState, SpeedUnit } from '../types';

type RaceTrackProps = {
  players: PlayerSlot[];
  riders: RiderState[];
  samplesByDevice: Map<number, BikeSample>;
  raceState: RaceState;
  speedUnit: SpeedUnit;
};

function formatTime(ms: number | null) {
  if (ms == null) {
    return '--.--';
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

function buildSurfacePath() {
  const points = Array.from({ length: 97 }, (_, index) => {
    const x = (index / 96) * 100;
    const distance = (x / 100) * raceLengthMeters;
    const y = 48 + surfaceOffsetPx(distance) * 0.78;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return {
    line: `M ${points.join(' L ')}`,
    fill: `M 0,70 L ${points.join(' L ')} L 100,70 Z`,
  };
}

const terrainPath = buildSurfacePath();

export function RaceTrack({ players, riders, samplesByDevice, raceState, speedUnit }: RaceTrackProps) {
  const laneTop = (index: number) => {
    if (players.length <= 1) {
      return '42%';
    }

    return `${16 + index * (66 / (players.length - 1))}%`;
  };

  return (
    <main className="race-panel">
      <div className="race-toolbar">
        <div>
          <h2>{raceState === 'ready' ? 'Ready Grid' : raceState === 'racing' ? 'Race Live' : 'Final Results'}</h2>
          <p>{players.length} active rider{players.length === 1 ? '' : 's'}. The surface map controls takeoff, landing, and wheel contact.</p>
        </div>
        <div className="track-meter">
          <span>0m</span>
          <div aria-hidden="true" />
          <span>{raceLengthMeters}m</span>
        </div>
      </div>

      <div className="track-stage" aria-label="Wattbike BMX race track">
        <div className="parallax gym-backdrop" />
        <div className="finish-line" aria-hidden="true" />

        {players.length === 0 && (
          <div className="track-empty">
            No connected Wattbikes. Pedal a bike until it appears in the pairing rail.
          </div>
        )}

        {players.map((player, index) => {
          const rider = riders.find((item) => item.playerId === player.id);
          const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
          const progress = rider ? rider.distance / raceLengthMeters : 0;
          const left = `clamp(0px, calc(${Math.min(0.965, progress) * 100}% - 48px), calc(100% - 118px))`;
          const online = Boolean(sample && Date.now() - sample.at < 2400);
          const compression = rider?.landingCompression ?? 0;
          const surfaceOffset = rider ? surfaceOffsetPx(rider.distance) : 0;
          const scaleX = 1 + compression * 0.045;
          const scaleY = 1 - compression * 0.075;
          const pedalRotation = `${Math.round((rider?.pedalPhase ?? 0) * 360)}deg`;

          return (
            <div className="lane" style={{ top: laneTop(index) }} key={player.id}>
              <svg className="lane-surface" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
                <path className="terrain-fill" d={terrainPath.fill} />
                <path className="terrain-line" d={terrainPath.line} />
                {trackFeatures.map((feature) => (
                  <line
                    className="terrain-lip"
                    x1={(feature.crest * 100).toFixed(2)}
                    x2={(feature.crest * 100).toFixed(2)}
                    y1="25"
                    y2="55"
                    key={feature.id}
                  />
                ))}
              </svg>
              <div className="lane-label" style={{ '--player-color': player.accent } as React.CSSProperties}>
                <strong>P{player.id}</strong>
                <span>{online ? `${sample?.watts ?? 0}W` : 'Idle'}</span>
              </div>
              <div
                className={`rider rider-${player.colorName} rider-${rider?.phase ?? 'pedaling'}`}
                style={{
                  left,
                  transform: `translateY(${-12 + surfaceOffset - (rider?.air ?? 0)}px) rotate(${rider?.pitch ?? 0}deg) scale(${scaleX}, ${scaleY})`,
                  '--player-color': player.accent,
                  '--pedal-rotation': pedalRotation,
                  '--speed-opacity': `${Math.min(1, (rider?.velocity ?? 0) / 12)}`,
                } as React.CSSProperties}
                aria-label={`${player.name} rider`}
              >
                <span className="speed-streak" />
                <span className="pedal-indicator" />
                <span className="boost-ring" data-active={(rider?.boost ?? 0) > 0.4} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="telemetry-grid">
        {players.map((player) => {
          const rider = riders.find((item) => item.playerId === player.id);
          const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
          const online = Boolean(sample && Date.now() - sample.at < 2400);

          return (
            <section className="telemetry-card" style={{ '--player-color': player.accent } as React.CSSProperties} key={player.id}>
              <div className="telemetry-title">
                <span>P{player.id}</span>
                <strong>{rider ? `#${rider.rank}` : '#-'}</strong>
              </div>
              <dl>
                <div>
                  <dt>Watts</dt>
                  <dd>{online ? sample?.watts : 0}</dd>
                </div>
                <div>
                  <dt>Cadence</dt>
                  <dd>{online ? sample?.cadence ?? '-' : '-'}</dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd>{rider ? formatSpeedFromMps(rider.velocity, speedUnit) : '0.0'}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>{rider?.finishedAt ? formatTime(rider.finishedAt) : rider?.phase ?? 'idle'}</dd>
                </div>
              </dl>
              <p className="speed-unit-label">{speedUnitLabel(speedUnit)}</p>
              <div className="boost-meter" aria-label={`${player.name} boost`}>
                <Zap size={14} />
                <span>
                  <i style={{ width: `${Math.round((rider?.boost ?? 0) * 100)}%` }} />
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
