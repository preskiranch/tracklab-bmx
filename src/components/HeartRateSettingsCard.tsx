import { HeartPulse, Pause, Play, RotateCcw, ShieldCheck, Square, Watch } from 'lucide-react';
import type { HeartRateMeasurement } from '../types';
import type {
  HeartRateReadingState,
} from '../hooks/useHeartRate';
import type {
  NativeHeartRateAvailability,
  NativeHeartRateRelaySnapshot,
  NativeHeartRateStatus,
} from '../lib/nativeHeartRate';
import { HeartRateMetric } from './HeartRateMetric';
import {
  trackLabTestFlightUrl,
  watchAppInstallInstructions,
  watchAppNeedsInstall,
} from './watchAppInstall';
import './HeartRateSettingsCard.css';

type HeartRateSettingsCardProps = {
  availability: NativeHeartRateAvailability | null;
  status: NativeHeartRateStatus | null;
  readingState: HeartRateReadingState;
  latest: HeartRateMeasurement | null;
  relayState?: NativeHeartRateRelaySnapshot | null;
  busy?: boolean;
  message?: string;
  showWorkoutActions?: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onRetry: () => void;
  studioSharing?: {
    clubName: string;
    liveConsent: boolean;
    sessionConsent: boolean;
    onLiveConsentChange: (enabled: boolean) => void;
    onSessionConsentChange: (enabled: boolean) => void;
  };
};

function stateLabel(readingState: HeartRateReadingState) {
  if (readingState === 'live') return 'Live from Apple Watch';
  if (readingState === 'paused') return 'Workout paused';
  if (readingState === 'connecting') return 'Connecting to Apple Watch';
  if (readingState === 'stale') return 'Reading interrupted';
  if (readingState === 'missing') return 'Waiting for a heart-rate reading';
  if (readingState === 'error') return 'Apple Watch needs attention';
  if (readingState === 'unavailable') return 'Unavailable on this device';
  if (readingState === 'checking') return 'Checking Apple Watch';
  return 'Ready to start';
}

export function HeartRateSettingsCard({
  availability,
  status,
  readingState,
  latest,
  relayState = null,
  busy = false,
  message = '',
  showWorkoutActions = true,
  onStart,
  onPause,
  onResume,
  onEnd,
  onRetry,
  studioSharing,
}: HeartRateSettingsCardProps) {
  const active = status?.state === 'active';
  const paused = status?.state === 'paused';
  const canStart = availability?.supported === true
    && !active
    && !paused
    && status?.state !== 'launching'
    && status?.state !== 'connecting'
    && status?.state !== 'ending';
  const showWatchInstall = showWorkoutActions && watchAppNeedsInstall(availability);
  const detail = message.trim()
    || status?.message
    || availability?.reason
    || (availability?.platform === 'ipad'
      ? 'Apple Watch connects through its paired iPhone. Use the TrackLab iPhone app to relay heart rate to this iPad.'
      : 'Start one indoor-cycling workout for your TrackLab training block. Individual races and rides are recorded as private segments inside it.');

  return (
    <section className="heart-rate-settings-card" aria-labelledby="heart-rate-settings-heading">
      <header>
        <div>
          <span className="eyebrow">{showWorkoutActions ? 'Optional sensor' : 'Connection details'}</span>
          <h2 id="heart-rate-settings-heading">{showWorkoutActions ? 'Apple Watch heart rate' : 'Watch status'}</h2>
        </div>
        <HeartPulse size={24} />
      </header>

      <div className="heart-rate-settings-body">
        <HeartRateMetric
          bpm={latest?.bpm}
          recordedAt={latest?.recordedAt}
          label="Apple Watch heart rate"
        />
        <div className="heart-rate-settings-state" role="status" aria-live="polite">
          <strong>{stateLabel(readingState)}</strong>
          <span>{detail}</span>
          {availability?.supported && (
            <small>
              Paired Watch {availability.paired ? 'detected' : 'not detected'} · Watch app {availability.watchAppInstalled ? 'installed' : 'not installed'}
            </small>
          )}
        </div>
      </div>

      {showWorkoutActions && <div className="heart-rate-settings-actions">
        {showWatchInstall && (
          <a
            aria-label="Install TrackLab BMX on Apple Watch with TestFlight"
            className="primary"
            href={trackLabTestFlightUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Watch aria-hidden="true" size={17} /> Install Watch App
          </a>
        )}
        {canStart && (
          <button className="primary" type="button" disabled={busy} onClick={onStart}>
            <Play size={17} /> Start Watch workout
          </button>
        )}
        {active && (
          <button type="button" disabled={busy} onClick={onPause}>
            <Pause size={17} /> Pause Watch workout
          </button>
        )}
        {paused && (
          <button className="primary" type="button" disabled={busy} onClick={onResume}>
            <Play size={17} /> Resume Watch workout
          </button>
        )}
        {(active || paused) && (
          <button className="danger" type="button" disabled={busy} onClick={onEnd}>
            <Square size={16} /> End and save to Apple Health
          </button>
        )}
        {(readingState === 'error' || readingState === 'unavailable') && (
          <button type="button" disabled={busy} onClick={onRetry}>
            <RotateCcw size={16} /> Check again
          </button>
        )}
        {showWatchInstall && (
          <small className="heart-rate-settings-install-help">
            {watchAppInstallInstructions}
          </small>
        )}
      </div>}

      {relayState && (relayState.configured || relayState.queuedCount > 0 || relayState.reason === 'synced') && (
        <div
          className={`heart-rate-relay-summary ${relayState.droppedSampleCount > 0 ? 'warning' : ''}`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {relayState.clearing
              ? 'Clearing private relay data…'
              : relayState.syncing
                ? 'Syncing heart rate to TrackLab Cloud…'
                : relayState.queuedCount > 0
                  ? `${relayState.queuedCount} completed ${relayState.queuedCount === 1 ? 'session' : 'sessions'} waiting to sync`
                  : relayState.reason === 'synced'
                    ? 'Heart rate synced to TrackLab Cloud'
                    : 'Private cloud relay ready'}
          </strong>
          <span>
            {relayState.pendingSampleCount > 0
              ? `${relayState.pendingSampleCount} encrypted ${relayState.pendingSampleCount === 1 ? 'sample is' : 'samples are'} still on this iPhone.`
              : 'No heart-rate samples are waiting on this iPhone.'}
            {relayState.droppedSampleCount > 0
              ? ` ${relayState.droppedSampleCount} ${relayState.droppedSampleCount === 1 ? 'sample was' : 'samples were'} dropped; check the session coverage before relying on its average.`
              : ''}
          </span>
        </div>
      )}

      <div className="heart-rate-settings-privacy">
        <ShieldCheck size={18} />
        <p>
          Heart rate is private to your TrackLab account by default. Friends—including the automatic Club and Founder friendships—cannot see it. Live studio sharing requires a separate choice for that training session, and training still works normally without Apple Watch.
        </p>
      </div>

      {studioSharing && (
        <fieldset className="heart-rate-studio-consent">
          <legend>Optional sharing for this training session</legend>
          <p>
            These choices apply only while training at {studioSharing.clubName}. They do not change Friends access and can be left off.
          </p>
          <label>
            <input
              type="checkbox"
              checked={studioSharing.liveConsent}
              onChange={(event) => studioSharing.onLiveConsentChange(event.currentTarget.checked)}
            />
            <span><strong>Share live BPM</strong><small>Lets the studio monitor show a fresh reading during this session.</small></span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={studioSharing.sessionConsent}
              onChange={(event) => studioSharing.onSessionConsentChange(event.currentTarget.checked)}
            />
            <span><strong>Share the session summary</strong><small>Lets the club see min, average, peak, coverage, and pedal-zone summaries—not raw samples.</small></span>
          </label>
        </fieldset>
      )}
    </section>
  );
}

export default HeartRateSettingsCard;
