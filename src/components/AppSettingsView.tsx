import { Cloud, Gauge, MapPinned, RotateCcw, Ruler, Smartphone } from 'lucide-react';
import type { DistanceUnit, SpeedUnit } from '../types';
import {
  formatDistanceMeters,
  formatExploreDistanceMeters,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import './AppSettingsView.css';
import type { ReactNode } from 'react';

type AppSettingsViewProps = {
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  regionalSpeedUnit: SpeedUnit;
  regionalDistanceUnit: DistanceUnit;
  regionCode: string | null;
  cloudStatus: 'loading' | 'online' | 'offline';
  cloudMessage: string;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onDistanceUnitChange: (unit: DistanceUnit) => void;
  onUseRegionalDefaults: () => void;
  heartRatePanel?: ReactNode;
};

function regionName(regionCode: string | null) {
  if (!regionCode) return 'your device region';
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(regionCode) ?? regionCode;
  } catch {
    return regionCode;
  }
}

export function AppSettingsView({
  speedUnit,
  distanceUnit,
  regionalSpeedUnit,
  regionalDistanceUnit,
  regionCode,
  cloudStatus,
  cloudMessage,
  onSpeedUnitChange,
  onDistanceUnitChange,
  onUseRegionalDefaults,
  heartRatePanel,
}: AppSettingsViewProps) {
  const region = regionName(regionCode);
  const regionalSpeedLabel = regionalSpeedUnit === 'mph' ? 'MPH' : 'KPH';
  const regionalDistanceLabel = regionalDistanceUnit === 'ft' ? 'Feet' : 'Meters';
  const longDistanceUnit = distanceUnit === 'ft' ? 'mi' : 'km';
  const syncTitle = cloudStatus === 'online'
    ? 'Saved to your profile'
    : cloudStatus === 'loading'
      ? 'Syncing your profile'
      : 'Saved on this device';
  const syncDetail = cloudMessage.trim() || (cloudStatus === 'online'
    ? 'Your defaults follow your TrackLab account across phones, tablets, and studio computers.'
    : cloudStatus === 'loading'
      ? 'Your latest choice is already saved on this device while cloud sync finishes.'
      : 'Cloud sync will retry automatically when your profile is online.');

  return (
    <div className="app-settings-view">
      <section className="app-settings-intro">
        <span className="eyebrow">Settings</span>
        <h1>Display &amp; units</h1>
        <p>Choose how TrackLab presents speed and distance. These choices never change the original recorded data.</p>
        <div className={`app-settings-sync ${cloudStatus}`} role="status" aria-live="polite">
          {cloudStatus === 'offline' ? <Smartphone size={18} /> : <Cloud size={18} />}
          <span>
            <strong>{syncTitle}</strong>
            <small>{syncDetail}</small>
          </span>
        </div>
      </section>

      <section className="app-settings-card" aria-labelledby="unit-settings-heading">
        <header>
          <div>
            <span className="eyebrow">Preferred units</span>
            <h2 id="unit-settings-heading">Speed and distance</h2>
          </div>
          <MapPinned size={22} />
        </header>

        <div className="app-settings-choice">
          <div className="app-settings-choice-copy">
            <Gauge size={21} />
            <span><strong>Speed</strong><small>Used in races, live monitoring, results, and history.</small></span>
          </div>
          <div className="segmented-control" role="group" aria-label="Default speed unit">
            <button
              className={speedUnit === 'mph' ? 'selected' : ''}
              type="button"
              aria-pressed={speedUnit === 'mph'}
              onClick={() => onSpeedUnitChange('mph')}
            >
              <b>MPH</b><span>Miles per hour</span>
            </button>
            <button
              className={speedUnit === 'kph' ? 'selected' : ''}
              type="button"
              aria-pressed={speedUnit === 'kph'}
              onClick={() => onSpeedUnitChange('kph')}
            >
              <b>KPH</b><span>Kilometers per hour</span>
            </button>
          </div>
        </div>

        <div className="app-settings-choice">
          <div className="app-settings-choice-copy">
            <Ruler size={21} />
            <span><strong>Distance</strong><small>Feet or meters for tracks and zones; miles or kilometers for longer Explore rides.</small></span>
          </div>
          <div className="segmented-control" role="group" aria-label="Default distance unit">
            <button
              className={distanceUnit === 'ft' ? 'selected' : ''}
              type="button"
              aria-pressed={distanceUnit === 'ft'}
              onClick={() => onDistanceUnitChange('ft')}
            >
              <b>Feet</b><span>ft / miles</span>
            </button>
            <button
              className={distanceUnit === 'm' ? 'selected' : ''}
              type="button"
              aria-pressed={distanceUnit === 'm'}
              onClick={() => onDistanceUnitChange('m')}
            >
              <b>Meters</b><span>m / kilometers</span>
            </button>
          </div>
        </div>

        <div className="app-settings-preview" aria-label="Unit preview">
          <span><small>Speed</small><strong>{formatSpeedFromKph(45, speedUnit)} {speedUnitLabel(speedUnit)}</strong></span>
          <span><small>Track</small><strong>{formatDistanceMeters(100, distanceUnit)}</strong></span>
          <span><small>Explore ride</small><strong>{formatExploreDistanceMeters(5_000, longDistanceUnit)}</strong></span>
        </div>

        <div className="app-settings-region">
          <span>First-time recommendation for <strong>{region}</strong>: {regionalSpeedLabel} + {regionalDistanceLabel}.</span>
          <button type="button" onClick={onUseRegionalDefaults}>
            <RotateCcw size={16} /> Use regional recommendation
          </button>
        </div>
      </section>
      {heartRatePanel}
    </div>
  );
}
