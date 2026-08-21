import {
  AlertTriangle,
  Check,
  CloudUpload,
  Copy,
  ExternalLink,
  HeartPulse,
  LoaderCircle,
  Play,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Square,
  Watch,
} from 'lucide-react';
import './HeartRateAccountBlockCard.css';

export type HeartRateAccountBlockPhase =
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'phone-ready'
  | 'waiting-watch'
  | 'live'
  | 'queued'
  | 'error';

export type HeartRateAccountBlockState = Readonly<{
  phase: HeartRateAccountBlockPhase;
  /**
   * Optional display-only context. URLs, bearer values, invite codes, and
   * opaque credentials are redacted again before rendering.
   */
  displayDetail?: string;
}>;

export type HeartRateAccountBlockCardProps = Readonly<{
  state: HeartRateAccountBlockState;
  disabled?: boolean;
  onStartOnIPhone?: () => void;
  onCopyIPhoneHandoff?: () => void;
  onShareIPhoneHandoff?: () => void;
  onOpenIPhoneHandoff?: () => void;
  onStop?: () => void;
  onRetry?: () => void;
}>;

const presentation = {
  unavailable: {
    label: 'Unavailable here',
    detail: 'Apple Watch heart rate is unavailable on this device. Continue on the paired iPhone.',
    Icon: AlertTriangle,
  },
  idle: {
    label: 'Ready to connect',
    detail: 'No account-owned Apple Watch workout is active yet.',
    Icon: HeartPulse,
  },
  starting: {
    label: 'Starting',
    detail: 'TrackLab is asking the paired Apple Watch to begin the account-owned cycling workout.',
    Icon: LoaderCircle,
  },
  'phone-ready': {
    label: 'iPhone ready',
    detail: 'The paired iPhone is ready. Confirm the TrackLab workout on Apple Watch.',
    Icon: Smartphone,
  },
  'waiting-watch': {
    label: 'Waiting for Apple Watch',
    detail: 'The iPhone is connected; TrackLab is waiting for the first fresh Watch sample.',
    Icon: Watch,
  },
  live: {
    label: 'Apple Watch live',
    detail: 'Fresh heart rate is available for private, exact TrackLab session windows.',
    Icon: Check,
  },
  queued: {
    label: 'Private sync queued',
    detail: 'The completed heart-rate block is queued on this iPhone for private cloud sync.',
    Icon: CloudUpload,
  },
  error: {
    label: 'Connection needs attention',
    detail: 'TrackLab could not finish the Apple Watch connection. Retry on the paired iPhone.',
    Icon: AlertTriangle,
  },
} satisfies Record<HeartRateAccountBlockPhase, {
  label: string;
  detail: string;
  Icon: typeof HeartPulse;
}>;

const privateValuePattern = /\b[a-zA-Z0-9_-]{32,}\b/gu;
const privateAssignmentPattern = /\b(?:bearer|token|secret|invite(?:\s*code)?|pair(?:ing)?\s*code|ingest(?:\s*token)?)\s*[:=]\s*\S+/giu;
const urlPattern = /\b(?:https?:\/\/|tracklab:\/\/|www\.)\S+/giu;

export function sanitizeHeartRateAccountBlockDisplayStatus(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .replace(urlPattern, '[private link]')
    .replace(privateAssignmentPattern, '[private credential]')
    .replace(privateValuePattern, '[private value]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 220);
}

export function HeartRateAccountBlockCard({
  state,
  disabled = false,
  onStartOnIPhone,
  onCopyIPhoneHandoff,
  onShareIPhoneHandoff,
  onOpenIPhoneHandoff,
  onStop,
  onRetry,
}: HeartRateAccountBlockCardProps) {
  const current = presentation[state.phase];
  const StatusIcon = current.Icon;
  const busy = state.phase === 'starting';
  const displayDetail = sanitizeHeartRateAccountBlockDisplayStatus(state.displayDetail) || current.detail;
  const handoffAvailable = ['unavailable', 'idle', 'phone-ready', 'waiting-watch', 'error'].includes(state.phase);
  const stopAvailable = ['starting', 'phone-ready', 'waiting-watch', 'live'].includes(state.phase);
  const retryAvailable = state.phase === 'unavailable' || state.phase === 'error';

  return (
    <section
      aria-busy={busy || undefined}
      aria-label="Private Apple Watch heart-rate block"
      className={`heart-rate-account-block ${state.phase}`}
    >
      <header>
        <span className="heart-rate-account-block-icon"><HeartPulse aria-hidden="true" size={21} /></span>
        <div>
          <span className="eyebrow">Your Apple Watch · private account block</span>
          <h3>Heart rate on every signed-in device</h3>
        </div>
        <span className={`heart-rate-account-block-status ${state.phase}`}>
          <StatusIcon aria-hidden="true" className={busy ? 'spin' : undefined} size={15} />
          {current.label}
        </span>
      </header>

      <div
        aria-live="polite"
        className="heart-rate-account-block-message"
        role={state.phase === 'error' || state.phase === 'unavailable' ? 'alert' : 'status'}
      >
        <p>{displayDetail}</p>
        {state.phase === 'queued' && (
          <small>Keep the TrackLab iPhone app installed and signed in until this status says Synced.</small>
        )}
      </div>

      <ol className="heart-rate-account-block-flow" aria-label="How private Apple Watch heart rate works">
        <li>
          <Smartphone aria-hidden="true" size={17} />
          <span>Start the account-owned Watch workout on its paired iPhone.</span>
        </li>
        <li>
          <Watch aria-hidden="true" size={17} />
          <span>Keep the iPhone and Apple Watch connected during training.</span>
        </li>
        <li>
          <ShieldCheck aria-hidden="true" size={17} />
          <span>Every device signed in to this TrackLab account—including iPad—can privately attach each exact session window.</span>
        </li>
      </ol>

      <div className="heart-rate-account-block-actions">
        {state.phase === 'idle' && onStartOnIPhone && (
          <button className="primary" disabled={disabled} onClick={onStartOnIPhone} type="button">
            <Play aria-hidden="true" size={16} /> Start on this iPhone
          </button>
        )}
        {handoffAvailable && onCopyIPhoneHandoff && (
          <button disabled={disabled || busy} onClick={onCopyIPhoneHandoff} type="button">
            <Copy aria-hidden="true" size={16} /> Copy iPhone handoff
          </button>
        )}
        {handoffAvailable && onShareIPhoneHandoff && (
          <button disabled={disabled || busy} onClick={onShareIPhoneHandoff} type="button">
            <Share2 aria-hidden="true" size={16} /> Share iPhone handoff
          </button>
        )}
        {handoffAvailable && onOpenIPhoneHandoff && (
          <button disabled={disabled || busy} onClick={onOpenIPhoneHandoff} type="button">
            <ExternalLink aria-hidden="true" size={16} /> Open iPhone handoff
          </button>
        )}
        {stopAvailable && onStop && (
          <button disabled={disabled} onClick={onStop} type="button">
            <Square aria-hidden="true" size={15} /> Stop
          </button>
        )}
        {retryAvailable && onRetry && (
          <button className="primary" disabled={disabled} onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={16} /> Retry
          </button>
        )}
      </div>

      <div className="heart-rate-account-block-privacy">
        <ShieldCheck aria-hidden="true" size={17} />
        <p>
          Raw heart-rate samples stay private to the athlete’s account. Clubs and Friends receive no live heart rate, summaries, or raw samples from this account block.
        </p>
      </div>
    </section>
  );
}

export default HeartRateAccountBlockCard;
