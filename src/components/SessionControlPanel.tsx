import { Activity, Flag, Gauge, RotateCcw, SlidersHorizontal, Timer, Zap } from 'lucide-react';
import type {
  IntervalMode,
  MetricKey,
  RaceState,
  SessionMode,
  SpeedUnit,
  TrackRecord,
  TrackZone,
} from '../types';

type SessionControlPanelProps = {
  track: TrackRecord;
  sessionMode: SessionMode;
  intervalMode: IntervalMode;
  activeZones: TrackZone[];
  manualZoneIds: string[];
  selectedMetrics: MetricKey[];
  speedUnit: SpeedUnit;
  earthAngle: number;
  raceState: RaceState;
  activeBikeCount: number;
  onSessionModeChange: (mode: SessionMode) => void;
  onIntervalModeChange: (mode: IntervalMode) => void;
  onManualZoneToggle: (zoneId: string) => void;
  onMetricToggle: (metric: MetricKey) => void;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onEarthAngleChange: (angle: number) => void;
  onStart: () => void;
  onReset: () => void;
};

const metricOptions: Array<{ key: MetricKey; label: string; icon: typeof Activity }> = [
  { key: 'cadence', label: 'Cadence', icon: Activity },
  { key: 'speed', label: 'Speed', icon: Gauge },
  { key: 'power', label: 'Power', icon: Zap },
];

export function SessionControlPanel({
  track,
  sessionMode,
  intervalMode,
  activeZones,
  manualZoneIds,
  selectedMetrics,
  speedUnit,
  earthAngle,
  raceState,
  activeBikeCount,
  onSessionModeChange,
  onIntervalModeChange,
  onManualZoneToggle,
  onMetricToggle,
  onSpeedUnitChange,
  onEarthAngleChange,
  onStart,
  onReset,
}: SessionControlPanelProps) {
  const canStart = raceState !== 'racing' && activeBikeCount > 0;

  return (
    <aside className="control-panel">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Session Setup</span>
            <h3>Training mode</h3>
          </div>
          <Timer size={18} />
        </div>

        <div className="segmented-control" aria-label="Session mode">
          <button
            className={sessionMode === 'sprint' ? 'selected' : ''}
            type="button"
            onClick={() => onSessionModeChange('sprint')}
          >
            <Flag size={15} />
            Sprint
          </button>
          <button
            className={sessionMode === 'interval' ? 'selected' : ''}
            type="button"
            onClick={() => onSessionModeChange('interval')}
          >
            <Timer size={15} />
            Intervals
          </button>
        </div>

        {sessionMode === 'interval' && (
          <>
            <div className="segmented-control compact" aria-label="Interval zone mode">
              <button
                className={intervalMode === 'auto' ? 'selected' : ''}
                type="button"
                onClick={() => onIntervalModeChange('auto')}
              >
                Auto zones
              </button>
              <button
                className={intervalMode === 'manual' ? 'selected' : ''}
                type="button"
                onClick={() => onIntervalModeChange('manual')}
              >
                Manual
              </button>
            </div>

            {intervalMode === 'manual' && (
              <div className="zone-picker">
                {track.zones.map((zone) => (
                  <button
                    className={manualZoneIds.includes(zone.id) ? 'selected' : ''}
                    type="button"
                    onClick={() => onManualZoneToggle(zone.id)}
                    key={zone.id}
                  >
                    <span>{zone.name}</span>
                    <small>{zone.startMeter}-{zone.endMeter} m</small>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="active-zone-list">
          {activeZones.map((zone) => (
            <span className={`zone-chip ${zone.type}`} key={zone.id}>
              {zone.name}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Before Race</span>
            <h3>Post-race metrics</h3>
          </div>
          <SlidersHorizontal size={18} />
        </div>
        <div className="metric-picker">
          {metricOptions.map(({ key, label, icon: Icon }) => (
            <label className="metric-option" key={key}>
              <input
                type="checkbox"
                checked={selectedMetrics.includes(key)}
                onChange={() => onMetricToggle(key)}
              />
              <span><Icon size={16} /> {label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">View</span>
            <h3>Earth angle</h3>
          </div>
          <span className="angle-value">{earthAngle} deg</span>
        </div>
        <input
          className="angle-slider"
          type="range"
          min="20"
          max="68"
          value={earthAngle}
          onChange={(event) => onEarthAngleChange(Number(event.target.value))}
        />

        <div className="segmented-control compact" aria-label="Speed unit">
          <button
            className={speedUnit === 'kph' ? 'selected' : ''}
            type="button"
            onClick={() => onSpeedUnitChange('kph')}
          >
            KPH
          </button>
          <button
            className={speedUnit === 'mph' ? 'selected' : ''}
            type="button"
            onClick={() => onSpeedUnitChange('mph')}
          >
            MPH
          </button>
        </div>
      </section>

      <section className="panel-section start-panel">
        <button className="action-button primary" type="button" onClick={onStart} disabled={!canStart}>
          <Flag size={18} />
          {activeBikeCount === 0
            ? 'No Bikes Connected'
            : raceState === 'finished'
              ? 'Race Again'
              : raceState === 'racing'
                ? 'Racing'
                : 'Start Session'}
        </button>
        <button className="action-button secondary" type="button" onClick={onReset}>
          <RotateCcw size={18} />
          Reset
        </button>
      </section>
    </aside>
  );
}
