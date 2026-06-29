import { Activity, Flag, Gauge, Play, Radio, RotateCcw } from 'lucide-react';
import type { AppMode, BridgeMode, RaceState, SpeedUnit } from '../types';

type TopBarProps = {
  connection: 'connecting' | 'open' | 'closed' | 'error';
  mode: BridgeMode | 'unknown';
  raceState: RaceState;
  status: string;
  appMode: AppMode;
  activeBikeCount: number;
  speedUnit: SpeedUnit;
  onModeChange: (mode: AppMode) => void;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onStart: () => void;
  onReset: () => void;
};

export function TopBar({
  connection,
  mode,
  raceState,
  status,
  appMode,
  activeBikeCount,
  speedUnit,
  onModeChange,
  onSpeedUnitChange,
  onStart,
  onReset,
}: TopBarProps) {
  const statusLabel = connection === 'open' ? `${mode.toUpperCase()} bridge online` : 'Bridge offline';
  const canStart = appMode === 'race' && raceState !== 'racing' && activeBikeCount > 0;

  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Radio size={20} strokeWidth={2.5} />
        </div>
        <div>
          <h1>Wattbike BMX Race</h1>
          <p>{statusLabel}</p>
        </div>
      </div>

      <div className="bridge-message" title={status}>
        <span className={`connection-dot ${connection}`} />
        <span>{activeBikeCount} live bike{activeBikeCount === 1 ? '' : 's'} / {status}</span>
      </div>

      <div className="mode-toggle" aria-label="View mode">
        <button
          className={appMode === 'race' ? 'selected' : ''}
          type="button"
          onClick={() => onModeChange('race')}
        >
          <Activity size={16} />
          <span>Race</span>
        </button>
        <button
          className={appMode === 'monitor' ? 'selected' : ''}
          type="button"
          onClick={() => onModeChange('monitor')}
        >
          <Gauge size={16} />
          <span>Monitor</span>
        </button>
      </div>

      <div className="unit-toggle" aria-label="Speed unit">
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

      {appMode === 'race' ? (
        <div className="race-actions">
          <button className="icon-button secondary" type="button" onClick={onReset} aria-label="Reset race">
            <RotateCcw size={18} />
            <span>Reset</span>
          </button>
          <button className="icon-button primary" type="button" onClick={onStart} disabled={!canStart}>
            {raceState === 'finished' ? <Flag size={18} /> : <Play size={18} />}
            <span>
              {activeBikeCount === 0
                ? 'No Bikes'
                : raceState === 'finished'
                  ? 'Race Again'
                  : raceState === 'racing'
                    ? 'Racing'
                    : 'Start Race'}
            </span>
          </button>
        </div>
      ) : (
        <div className="monitor-actions">
          <Gauge size={18} />
          <span>Monitor only</span>
        </div>
      )}
    </header>
  );
}
