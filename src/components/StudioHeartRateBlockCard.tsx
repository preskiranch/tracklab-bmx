import {
  AlertTriangle,
  Check,
  Copy,
  HeartPulse,
  Link2,
  LoaderCircle,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Unplug,
  X,
} from 'lucide-react';
import './StudioHeartRateBlockCard.css';

export type StudioHeartRateBlockPhase =
  | 'disconnected'
  | 'inviting'
  | 'waiting-athlete'
  | 'waiting-watch'
  | 'watch-ready'
  | 'error';

export type StudioHeartRateBlockState = Readonly<{
  phase: StudioHeartRateBlockPhase;
  /** Safe display text only. Never pass invitation links, codes, or credentials. */
  detail?: string;
  liveBpmSharing?: boolean;
}>;

export type StudioHeartRateBlockCardProps = Readonly<{
  riderName: string;
  bikeLabel?: string;
  state: StudioHeartRateBlockState;
  disabled?: boolean;
  onCreateInvitation?: () => void;
  onCopyInvitation?: () => void;
  onShareInvitation?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}>;

const phasePresentation = {
  disconnected: {
    label: 'Not connected',
    detail: 'Create one private invitation before this athlete begins studio training.',
    Icon: Unplug,
  },
  inviting: {
    label: 'Creating invitation',
    detail: 'Securing this athlete, bike, and studio training block…',
    Icon: LoaderCircle,
  },
  'waiting-athlete': {
    label: 'Waiting for athlete',
    detail: 'The athlete must accept on the iPhone paired with their Apple Watch.',
    Icon: Smartphone,
  },
  'waiting-watch': {
    label: 'Waiting for Apple Watch',
    detail: 'The athlete accepted. Start TrackLab on their paired iPhone and Apple Watch.',
    Icon: LoaderCircle,
  },
  'watch-ready': {
    label: 'Apple Watch ready',
    detail: 'Supported studio modes can use this continuous, athlete-approved Watch block.',
    Icon: Check,
  },
  error: {
    label: 'Connection needs attention',
    detail: 'Apple Watch setup did not finish. Retry or cancel this setup.',
    Icon: AlertTriangle,
  },
} satisfies Record<StudioHeartRateBlockPhase, {
  label: string;
  detail: string;
  Icon: typeof HeartPulse;
}>;

/**
 * Owner-facing presentation only. Invitation URLs and all one-use credentials
 * remain in the parent coordinator; this card can only request copy/share work.
 */
export function StudioHeartRateBlockCard({
  riderName,
  bikeLabel,
  state,
  disabled = false,
  onCreateInvitation,
  onCopyInvitation,
  onShareInvitation,
  onCancel,
  onRetry,
}: StudioHeartRateBlockCardProps) {
  const presentation = phasePresentation[state.phase];
  const StatusIcon = presentation.Icon;
  const busy = state.phase === 'inviting';
  const detail = state.detail?.trim() || presentation.detail;

  return (
    <section
      aria-busy={busy || undefined}
      aria-label={`${riderName} Apple Watch studio connection`}
      className={`studio-heart-rate-block ${state.phase}`}
    >
      <header>
        <span className="studio-heart-rate-block-icon"><HeartPulse aria-hidden="true" size={20} /></span>
        <div>
          <span className="eyebrow">Apple Watch · studio training</span>
          <h3>{riderName}</h3>
          {bikeLabel && <small>{bikeLabel}</small>}
        </div>
        <span className={`studio-heart-rate-block-status ${state.phase}`}>
          <StatusIcon aria-hidden="true" className={busy ? 'spin' : undefined} size={15} />
          {presentation.label}
        </span>
      </header>

      <div
        aria-live="polite"
        className="studio-heart-rate-block-message"
        role={state.phase === 'error' ? 'alert' : 'status'}
      >
        <p>{detail}</p>
        {state.phase === 'watch-ready' && (
          <small>
            {state.liveBpmSharing
              ? 'Live BPM sharing is on for this block.'
              : 'Live BPM sharing is off. Saved studio summaries require the athlete’s explicit consent.'}
          </small>
        )}
      </div>

      <div className="studio-heart-rate-block-actions">
        {state.phase === 'disconnected' && onCreateInvitation && (
          <button className="primary" disabled={disabled} onClick={onCreateInvitation} type="button">
            <Link2 aria-hidden="true" size={16} /> Connect Apple Watch
          </button>
        )}
        {state.phase === 'waiting-athlete' && onCopyInvitation && (
          <button className="primary" disabled={disabled} onClick={onCopyInvitation} type="button">
            <Copy aria-hidden="true" size={16} /> Copy iPhone invite
          </button>
        )}
        {state.phase === 'waiting-athlete' && onShareInvitation && (
          <button disabled={disabled} onClick={onShareInvitation} type="button">
            <Share2 aria-hidden="true" size={16} /> Share invite
          </button>
        )}
        {state.phase === 'error' && onRetry && (
          <button className="primary" disabled={disabled} onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={16} /> Retry
          </button>
        )}
        {state.phase !== 'disconnected' && onCancel && (
          <button disabled={disabled} onClick={onCancel} type="button">
            {state.phase === 'watch-ready' || state.phase === 'waiting-watch'
              ? <><Unplug aria-hidden="true" size={16} /> Stop studio sharing</>
              : <><X aria-hidden="true" size={16} /> Cancel setup</>}
          </button>
        )}
      </div>

      <div className="studio-heart-rate-block-privacy">
        <ShieldCheck aria-hidden="true" size={16} />
        <p>
          The athlete approves this once on their paired iPhone. TrackLab attaches only exact active session and pedal-zone windows. Raw idle and private samples stay athlete-owned. Friends—including the default Club and Founder friendships—get no heart-rate access. The studio receives saved summaries only with explicit athlete consent.
        </p>
      </div>
      {(state.phase === 'watch-ready' || state.phase === 'waiting-watch') && onCancel && (
        <small className="studio-heart-rate-block-stop-note">
          Stopping removes this studio’s live and saved-summary access. It does not stop the athlete’s Apple Watch workout or delete athlete-owned raw heart-rate history.
        </small>
      )}
    </section>
  );
}

export default StudioHeartRateBlockCard;
