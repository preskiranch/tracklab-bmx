import {
  Check,
  HeartPulse,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Watch,
} from 'lucide-react';
import {
  watchConnectStatusLabel,
  type WatchConnectViewState,
} from '../lib/watchConnect';
import {
  trackLabTestFlightUrl,
  watchAppInstallInstructions,
} from './watchAppInstall';
import './WatchConnectCard.css';

export type WatchConnectCardProps = Readonly<{
  athleteName: string;
  state: WatchConnectViewState;
  context?: 'personal' | 'studio';
  studioName?: string;
  enrolled?: boolean;
  liveStudioConsent?: boolean;
  sessionStudioConsent?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onConnect?: () => void;
  onCheckAgain?: () => void;
  onDisconnect?: () => void;
  onForgetWatch?: () => void;
  onLiveStudioConsentChange?: (enabled: boolean) => void;
  onSessionStudioConsentChange?: (enabled: boolean) => void;
  targetOptions?: readonly Readonly<{ value: string; label: string }>[];
  targetValue?: string;
  targetDisabled?: boolean;
  onTargetChange?: (value: string) => void;
  retryWhileConnecting?: boolean;
  showWatchInstall?: boolean;
}>;

export function WatchConnectCard({
  athleteName,
  state,
  context = 'personal',
  studioName,
  enrolled = false,
  liveStudioConsent = false,
  sessionStudioConsent = false,
  busy = false,
  disabled = false,
  onConnect,
  onCheckAgain,
  onDisconnect,
  onForgetWatch,
  onLiveStudioConsentChange,
  onSessionStudioConsentChange,
  targetOptions,
  targetValue = 'personal',
  targetDisabled = false,
  onTargetChange,
  retryWhileConnecting = false,
  showWatchInstall = false,
}: WatchConnectCardProps) {
  const connecting = state.phase === 'connecting';
  const syncing = state.phase === 'syncing';
  const connected = state.phase === 'connected';
  const StatusIcon = connected
    ? Check
    : connecting || syncing
      ? LoaderCircle
      : state.phase === 'ended'
        ? RefreshCw
        : Watch;
  const actionLabel = 'Watch Connect';
  const showConnect = Boolean(onConnect) && (
    state.phase === 'connect' || state.phase === 'ended' || (connecting && retryWhileConnecting)
  );
  const showDisconnect = connected && onDisconnect;
  const savedSummaryConsentRequired = context === 'studio' && !enrolled && !sessionStudioConsent;
  const identity = athleteName.trim() || 'This athlete';
  const studio = studioName?.trim() || 'this studio';

  return (
    <section
      aria-busy={connecting || syncing || busy || undefined}
      aria-label={`${identity} Watch Connect`}
      className={`watch-connect-card ${state.phase}`}
      tabIndex={-1}
    >
      <header>
        <span className="watch-connect-card-icon"><HeartPulse aria-hidden="true" size={21} /></span>
        <div>
          <span className="eyebrow">Apple Watch</span>
          <h3>Watch Connect</h3>
          <small>{identity}</small>
        </div>
        <span className={`watch-connect-card-status ${state.phase}`}>
          <StatusIcon
            aria-hidden="true"
            className={connecting || syncing ? 'spin' : undefined}
            size={15}
          />
          {watchConnectStatusLabel(state)}
        </span>
      </header>

      {targetOptions && targetOptions.length > 1 && onTargetChange && (
        <fieldset className="watch-connect-card-consent">
          <legend>Use with</legend>
          <select
            aria-label="Use Watch Connect with"
            disabled={targetDisabled}
            onChange={(event) => onTargetChange(event.currentTarget.value)}
            value={targetValue}
          >
            {targetOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </fieldset>
      )}

      <div className="watch-connect-card-message" role="status" aria-live="polite">
        <strong>{connected ? 'Ready all session' : state.detail}</strong>
        {connected && <span>{state.detail}</span>}
        <small>
          {enrolled
            ? 'This Watch is remembered. When four hours ends, press Watch Connect—setup will not repeat.'
            : 'First time only: approve Apple Health and let TrackLab remember this Watch.'}
        </small>
      </div>

      {context === 'studio' && !enrolled && (
        <fieldset className="watch-connect-card-consent">
          <legend>Share with {studio}</legend>
          <label>
            <input
              checked={sessionStudioConsent}
              onChange={(event) => onSessionStudioConsentChange?.(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              <strong>Training summaries</strong>
              <small>Required. Share minimum, average, peak, and coverage—not raw heart-rate samples.</small>
            </span>
          </label>
          <label>
            <input
              checked={liveStudioConsent}
              onChange={(event) => onLiveStudioConsentChange?.(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              <strong>Live BPM</strong>
              <small>Show a current reading on the studio screen while this athlete is training.</small>
            </span>
          </label>
        </fieldset>
      )}

      <div className="watch-connect-card-actions">
        {!showConnect && showWatchInstall && (
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
        {showConnect && (
          <button
            className="primary"
            disabled={disabled || busy || savedSummaryConsentRequired}
            onClick={onConnect}
            type="button"
          >
            {state.phase === 'ended'
              ? <RefreshCw aria-hidden="true" size={17} />
              : <Watch aria-hidden="true" size={17} />}
            {actionLabel}
          </button>
        )}
        {!showConnect && onCheckAgain && !connecting && !syncing && (
          <button disabled={disabled || busy} onClick={onCheckAgain} type="button">
            <RefreshCw aria-hidden="true" size={17} /> Check again
          </button>
        )}
        {(connecting || syncing) && !(connecting && showConnect) && (
          <button aria-disabled="true" disabled type="button">
            <LoaderCircle aria-hidden="true" className="spin" size={17} />
            {connecting ? 'Connecting…' : 'Syncing…'}
          </button>
        )}
        {showDisconnect && (
          <button disabled={disabled || busy} onClick={onDisconnect} type="button">
            <Unplug aria-hidden="true" size={17} /> Disconnect
          </button>
        )}
      </div>

      {showWatchInstall && (
        <small className="watch-connect-card-install-help">
          {watchAppInstallInstructions}
        </small>
      )}

      {savedSummaryConsentRequired && (
        <small className="watch-connect-card-required" role="status">
          Approve Training summaries to use Watch Connect with this studio.
        </small>
      )}

      <div className="watch-connect-card-privacy">
        <ShieldCheck aria-hidden="true" size={17} />
        <p>
          The connection belongs only to {identity}’s claimed profile—not a bike or tablet. Raw and idle heart rate stay private. Disconnecting or reconnecting a Wattbike does not end this four-hour Watch session.
        </p>
      </div>
      {enrolled && onForgetWatch && (
        <button
          className="watch-connect-card-forget"
          disabled={disabled || busy || connecting || syncing}
          onClick={onForgetWatch}
          type="button"
        >
          Forget Watch
        </button>
      )}
    </section>
  );
}

export default WatchConnectCard;
