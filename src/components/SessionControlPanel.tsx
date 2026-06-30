import type { ChangeEvent } from 'react';
import {
  Activity,
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
import type {
  IntervalMode,
  MappingEditMode,
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
  mappingMode: boolean;
  mappingEditMode: MappingEditMode;
  draftPointCount: number;
  draftZoneCount: number;
  hasSavedMapping: boolean;
  mappingRestSeconds: number;
  onSessionModeChange: (mode: SessionMode) => void;
  onIntervalModeChange: (mode: IntervalMode) => void;
  onManualZoneToggle: (zoneId: string) => void;
  onMetricToggle: (metric: MetricKey) => void;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onEarthAngleChange: (angle: number) => void;
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
  earthAngle,
  raceState,
  activeBikeCount,
  mappingMode,
  mappingEditMode,
  draftPointCount,
  draftZoneCount,
  hasSavedMapping,
  mappingRestSeconds,
  onSessionModeChange,
  onIntervalModeChange,
  onManualZoneToggle,
  onMetricToggle,
  onSpeedUnitChange,
  onEarthAngleChange,
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
  const canStart = raceState !== 'racing' && activeBikeCount > 0;
  const canSaveMapping = draftPointCount >= 2;
  const undoLabel = mappingEditMode === 'zones' ? 'Undo zone' : 'Undo path';
  const canUndoMapping = mappingEditMode === 'zones' ? draftZoneCount > 1 : draftPointCount > 0;
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
          <div className="segmented-control compact" aria-label="Mapping edit mode">
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

        <div className="mapping-status-row three">
          <span>{draftPointCount} route pt{draftPointCount === 1 ? '' : 's'}</span>
          <span>{draftZoneCount} sprint zone{draftZoneCount === 1 ? '' : 's'}</span>
          <span>{hasSavedMapping ? 'Saved locally' : 'No saved map'}</span>
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
