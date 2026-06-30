import type { ChangeEvent } from 'react';
import {
  Activity,
  Bike,
  Compass,
  Download,
  Flag,
  Gauge,
  MapPinned,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Timer,
  Trash2,
  Undo2,
  Upload,
  Zap,
} from 'lucide-react';
import { formatDistanceMeters, formatDistanceRangeMeters } from '../units';
import type {
  DistanceUnit,
  IntervalMode,
  MappingEditMode,
  MetricKey,
  RaceState,
  SessionMode,
  SpeedUnit,
  StartCadenceMode,
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
  distanceUnit: DistanceUnit;
  earthAngle: number;
  earthHeading: number;
  raceState: RaceState;
  activeBikeCount: number;
  demoMode: boolean;
  demoBikeCount: number;
  demoVariableCount: number;
  mappingMode: boolean;
  mappingEditMode: MappingEditMode;
  draftPointCount: number;
  draftZoneCount: number;
  draftLengthMeters: number;
  hasSavedMapping: boolean;
  mappingRestSeconds: number;
  startCadenceMode: StartCadenceMode;
  countdownSeconds: number;
  startGateActive: boolean;
  startGateLabel: string;
  startGateDetail: string;
  onSessionModeChange: (mode: SessionMode) => void;
  onIntervalModeChange: (mode: IntervalMode) => void;
  onManualZoneToggle: (zoneId: string) => void;
  onMetricToggle: (metric: MetricKey) => void;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onDistanceUnitChange: (unit: DistanceUnit) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onDemoModeChange: (enabled: boolean) => void;
  onDemoBikeCountChange: (count: number) => void;
  onStartCadenceModeChange: (mode: StartCadenceMode) => void;
  onCountdownSecondsChange: (seconds: number) => void;
  onMappingModeChange: (enabled: boolean) => void;
  onMappingEditModeChange: (mode: MappingEditMode) => void;
  onMappingRestSecondsChange: (seconds: number) => void;
  onMappingUndoPoint: () => void;
  onMappingClearDraft: () => void;
  onMappingSave: () => void;
  onMappingRemove: () => void;
  onMappingExport: () => void;
  onMappingImport: (file: File) => void;
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
  distanceUnit,
  earthAngle,
  earthHeading,
  raceState,
  activeBikeCount,
  demoMode,
  demoBikeCount,
  demoVariableCount,
  mappingMode,
  mappingEditMode,
  draftPointCount,
  draftZoneCount,
  draftLengthMeters,
  hasSavedMapping,
  mappingRestSeconds,
  startCadenceMode,
  countdownSeconds,
  startGateActive,
  startGateLabel,
  startGateDetail,
  onSessionModeChange,
  onIntervalModeChange,
  onManualZoneToggle,
  onMetricToggle,
  onSpeedUnitChange,
  onDistanceUnitChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onDemoModeChange,
  onDemoBikeCountChange,
  onStartCadenceModeChange,
  onCountdownSecondsChange,
  onMappingModeChange,
  onMappingEditModeChange,
  onMappingRestSecondsChange,
  onMappingUndoPoint,
  onMappingClearDraft,
  onMappingSave,
  onMappingRemove,
  onMappingExport,
  onMappingImport,
  onStart,
  onReset,
}: SessionControlPanelProps) {
  const hasMappedRoute = track.routeStatus === 'user-mapped';
  const canStart = !startGateActive && raceState !== 'racing' && activeBikeCount > 0 && hasMappedRoute;
  const canSaveMapping = draftPointCount >= 2;
  const undoLabel = mappingEditMode === 'zones' ? 'Undo zone' : 'Undo path';
  const canUndoMapping = mappingEditMode === 'zones' ? draftZoneCount > 1 : draftPointCount > 0;
  const availableZones = hasMappedRoute ? track.zones : [];
  const visibleTrackDistance = draftPointCount > 1 ? draftLengthMeters : hasMappedRoute ? track.lengthMeters : null;
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onMappingImport(file);
    }

    event.target.value = '';
  };

  return (
    <aside className="control-panel">
      <section className="panel-section mapping-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Track Mapping</span>
            <h3>Trace route</h3>
          </div>
          <MapPinned size={18} />
        </div>

        <div className="segmented-control compact" aria-label="Mapping mode">
          <button
            className={!mappingMode ? 'selected' : ''}
            type="button"
            onClick={() => onMappingModeChange(false)}
          >
            View
          </button>
          <button
            className={mappingMode ? 'selected' : ''}
            type="button"
            onClick={() => onMappingModeChange(true)}
          >
            Edit map
          </button>
        </div>

        {mappingMode && (
          <div className="segmented-control compact three-way" aria-label="Mapping edit mode">
            <button
              className={mappingEditMode === 'navigate' ? 'selected' : ''}
              type="button"
              onClick={() => onMappingEditModeChange('navigate')}
            >
              Move map
            </button>
            <button
              className={mappingEditMode === 'draw' ? 'selected' : ''}
              type="button"
              onClick={() => onMappingEditModeChange('draw')}
            >
              Draw path
            </button>
            <button
              className={mappingEditMode === 'zones' ? 'selected' : ''}
              type="button"
              onClick={() => onMappingEditModeChange('zones')}
            >
              Add zones
            </button>
          </div>
        )}

        <div className="mapping-status-row four">
          <span>{draftPointCount} route pt{draftPointCount === 1 ? '' : 's'}</span>
          <span>{draftZoneCount} sprint zone{draftZoneCount === 1 ? '' : 's'}</span>
          <span>{visibleTrackDistance == null ? 'No distance' : formatDistanceMeters(visibleTrackDistance, distanceUnit)}</span>
          <span>{hasSavedMapping ? 'Saved locally' : 'No saved map'}</span>
        </div>

        <div className="segmented-control compact" aria-label="Distance unit">
          <button
            className={distanceUnit === 'ft' ? 'selected' : ''}
            type="button"
            onClick={() => onDistanceUnitChange('ft')}
          >
            Feet
          </button>
          <button
            className={distanceUnit === 'm' ? 'selected' : ''}
            type="button"
            onClick={() => onDistanceUnitChange('m')}
          >
            Meters
          </button>
        </div>

        {mappingMode && (
          <>
            <label className="number-field">
              <span>Rest gap</span>
              <input
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={mappingRestSeconds}
                onChange={(event) => onMappingRestSecondsChange(Number(event.target.value))}
              />
              <small>sec</small>
            </label>

            <div className="mapping-actions">
              <button type="button" onClick={onMappingUndoPoint} disabled={!canUndoMapping}>
                <Undo2 size={15} />
                {undoLabel}
              </button>
              <button type="button" onClick={onMappingClearDraft} disabled={draftPointCount === 0}>
                <Trash2 size={15} />
                Clear
              </button>
              <button type="button" onClick={onMappingSave} disabled={!canSaveMapping}>
                <Save size={15} />
                Save
              </button>
            </div>
          </>
        )}

        <div className="mapping-actions">
          <button type="button" onClick={onMappingExport} disabled={!hasSavedMapping}>
            <Download size={15} />
            Export
          </button>
          <label className="file-button">
            <Upload size={15} />
            Import
            <input type="file" accept="application/json" onChange={handleImportChange} />
          </label>
          <button type="button" onClick={onMappingRemove} disabled={!hasSavedMapping}>
            <Trash2 size={15} />
            Remove
          </button>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Input Mode</span>
            <h3>Bike source</h3>
          </div>
          <Bike size={18} />
        </div>

        <div className="segmented-control compact" aria-label="Bike source">
          <button
            className={!demoMode ? 'selected' : ''}
            type="button"
            onClick={() => onDemoModeChange(false)}
          >
            Wattbike
          </button>
          <button
            className={demoMode ? 'selected' : ''}
            type="button"
            onClick={() => onDemoModeChange(true)}
          >
            Demo
          </button>
        </div>

        {demoMode && (
          <>
            <div className="demo-mode-row">
              <span>Riders</span>
              <strong>{demoBikeCount} / 4</strong>
              <small>{demoVariableCount} race variables</small>
            </div>
            <div className="segmented-control compact four-way" aria-label="Demo rider count">
              {[1, 2, 3, 4].map((count) => (
                <button
                  className={demoBikeCount === count ? 'selected' : ''}
                  type="button"
                  onClick={() => onDemoBikeCountChange(count)}
                  key={count}
                >
                  {count}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

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
                {availableZones.map((zone) => (
                  <button
                    className={manualZoneIds.includes(zone.id) ? 'selected' : ''}
                    type="button"
                    onClick={() => onManualZoneToggle(zone.id)}
                    key={zone.id}
                  >
                    <span>{zone.name}</span>
                    <small>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</small>
                  </button>
                ))}
                {availableZones.length === 0 && <span className="empty-inline">No mapped sprint zones</span>}
              </div>
            )}
          </>
        )}

        <div className="active-zone-list">
          {activeZones.length > 0 ? activeZones.map((zone) => (
            <span className={`zone-chip ${zone.type}`} key={zone.id}>
              {zone.name}
            </span>
          )) : <span className="empty-inline">No mapped sprint zones</span>}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Start Gate</span>
            <h3>Cadence</h3>
          </div>
          <Timer size={18} />
        </div>

        <div className="segmented-control compact" aria-label="Start cadence mode">
          <button
            className={startCadenceMode === 'countdown' ? 'selected' : ''}
            type="button"
            onClick={() => onStartCadenceModeChange('countdown')}
          >
            Countdown
          </button>
          <button
            className={startCadenceMode === 'uci' ? 'selected' : ''}
            type="button"
            onClick={() => onStartCadenceModeChange('uci')}
          >
            UCI
          </button>
        </div>

        {startCadenceMode === 'countdown' && (
          <div className="segmented-control compact four-way" aria-label="Countdown seconds">
            {[3, 4, 5, 6].map((seconds) => (
              <button
                className={countdownSeconds === seconds ? 'selected' : ''}
                type="button"
                onClick={() => onCountdownSecondsChange(seconds)}
                key={seconds}
              >
                {seconds}s
              </button>
            ))}
          </div>
        )}

        {startGateActive && (
          <div className="start-gate-status">
            <strong>{startGateLabel}</strong>
            <span>{startGateDetail}</span>
          </div>
        )}
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
            <h3>Earth camera</h3>
          </div>
          <span className="angle-value">{earthAngle} deg / {earthHeading} deg</span>
        </div>
        <label className="camera-slider">
          <span>Tilt</span>
          <input
            className="angle-slider"
            type="range"
            min="0"
            max="67"
            value={earthAngle}
            onChange={(event) => onEarthAngleChange(Number(event.target.value))}
          />
        </label>
        <label className="camera-slider">
          <span><Compass size={14} /> Heading</span>
          <input
            className="angle-slider"
            type="range"
            min="0"
            max="359"
            value={earthHeading}
            onChange={(event) => onEarthHeadingChange(Number(event.target.value))}
          />
        </label>

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
          {!hasMappedRoute
            ? 'Map Track First'
            : activeBikeCount === 0
              ? (demoMode ? 'Choose Riders' : 'No Bikes Connected')
              : startGateActive
                ? startGateLabel || 'Gate Sequence'
              : raceState === 'finished'
                ? 'Race Again'
                : raceState === 'racing'
                  ? 'Racing'
                  : demoMode ? 'Start Demo Race' : 'Start Session'}
        </button>
        <button className="action-button secondary" type="button" onClick={onReset}>
          <RotateCcw size={18} />
          Reset
        </button>
      </section>
    </aside>
  );
}
