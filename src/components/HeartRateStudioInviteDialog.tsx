import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  HeartPulse,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import type { NativeHeartRatePlatform } from '../lib/nativeHeartRate';
import {
  HeartRateStudioInviteError,
  claimHeartRateStudioInvitation,
  claimHeartRateStudioPairCode,
  heartRateStudioInviteHandoffHref,
  heartRateStudioInviteUrlDisposition,
  loadHeartRateStudioInvitationPreview,
  normalizeHeartRateStudioInviteCode,
  type HeartRatePairingClaim,
  type HeartRatePairing,
  type HeartRateRelayActivityType,
  type HeartRateStudioInvitationPreview,
  type HeartRateStudioInviteUrlDisposition,
  type HeartRateStudioPairCodeClaim,
  type HeartRateStudioRelayClaim,
} from '../lib/heartRateCloud';
import './HeartRateStudioInviteDialog.css';

export type HeartRateStudioInviteDialogProps = Readonly<{
  authenticated: boolean;
  currentHref?: string;
  inviteCode: string;
  onClose: (urlDisposition: HeartRateStudioInviteUrlDisposition) => void;
  onConfigureNativeRelay: (claim: HeartRateStudioRelayClaim) => Promise<void> | void;
  onRequestSignIn: () => void;
  open: boolean;
  platform: NativeHeartRatePlatform;
  preview?: HeartRateStudioInvitationPreview | null;
  loadPreview?: (inviteCode: string) => Promise<HeartRateStudioInvitationPreview>;
  claimInvitation?: typeof claimHeartRateStudioInvitation;
  claimPairCode?: typeof claimHeartRateStudioPairCode;
}>;

type DialogPhase = 'idle' | 'loading' | 'ready' | 'claiming' | 'error';
type RetryAction = 'preview' | 'connect' | null;

const studioHeartRateActivityLabels = {
  'bmx-race': 'BMX Race Intervals',
  'straight-sprint': 'Straight Sprint',
  explore: 'Explore the World',
  'get-pulled': 'Get Pulled',
  'monitor-sprint': 'Monitor',
  'training-block': 'Studio training block',
} satisfies Record<HeartRateRelayActivityType, string>;

/** Returns display-only copy and never reflects an unknown server value into the UI. */
export function studioHeartRateActivityLabel(activityType: unknown) {
  if (typeof activityType !== 'string') return 'Studio training';
  return studioHeartRateActivityLabels[
    activityType as keyof typeof studioHeartRateActivityLabels
  ] ?? 'Studio training';
}

function pairingsMatch(expected: HeartRatePairing, actual: HeartRatePairingClaim['pairing']) {
  return expected.id === actual.id
    && expected.sessionId === actual.sessionId
    && expected.activityType === actual.activityType
    && expected.relayScope === actual.relayScope
    && expected.riderId === actual.riderId
    && expected.playerId === actual.playerId;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'TrackLab could not connect this Apple Watch yet.';
}

/**
 * Athlete-side studio handoff. Credentials live only in refs long enough to
 * configure the native relay; they are never rendered, persisted, or logged.
 */
export function HeartRateStudioInviteDialog({
  authenticated,
  currentHref,
  inviteCode,
  onClose,
  onConfigureNativeRelay,
  onRequestSignIn,
  open,
  platform,
  preview: providedPreview,
  loadPreview = loadHeartRateStudioInvitationPreview,
  claimInvitation = claimHeartRateStudioInvitation,
  claimPairCode = claimHeartRateStudioPairCode,
}: HeartRateStudioInviteDialogProps) {
  const normalizedInviteCode = normalizeHeartRateStudioInviteCode(inviteCode);
  const [preview, setPreview] = useState<HeartRateStudioInvitationPreview | null>(providedPreview ?? null);
  const [phase, setPhase] = useState<DialogPhase>('idle');
  const [message, setMessage] = useState('');
  const [errorDisposition, setErrorDisposition] = useState<HeartRateStudioInviteUrlDisposition>('preserve');
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [liveConsent, setLiveConsent] = useState(false);
  const [sessionConsent, setSessionConsent] = useState(false);
  const [studioBlockConsent, setStudioBlockConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestGenerationRef = useRef(0);
  const invitationConsumedRef = useRef(false);
  const pendingPairCodeClaimRef = useRef<HeartRateStudioPairCodeClaim | null>(null);
  const pendingRelayClaimRef = useRef<HeartRateStudioRelayClaim | null>(null);

  const cleanHandoffHref = useMemo(() => {
    const sourceHref = currentHref
      ?? (typeof window !== 'undefined' ? window.location.href : '');
    return heartRateStudioInviteHandoffHref(sourceHref, normalizedInviteCode);
  }, [currentHref, normalizedInviteCode]);

  const loadInvitationPreview = async () => {
    const generation = ++requestGenerationRef.current;
    setPhase('loading');
    setMessage('');
    setRetryAction(null);
    try {
      const loaded = providedPreview ?? await loadPreview(normalizedInviteCode);
      if (generation !== requestGenerationRef.current) return;
      setPreview(loaded);
      setPhase('ready');
    } catch (error) {
      if (generation !== requestGenerationRef.current) return;
      setMessage(errorMessage(error));
      setErrorDisposition(heartRateStudioInviteUrlDisposition(error));
      setRetryAction(heartRateStudioInviteUrlDisposition(error) === 'preserve' ? 'preview' : null);
      setPhase('error');
    }
  };

  useEffect(() => {
    requestGenerationRef.current += 1;
    invitationConsumedRef.current = false;
    pendingPairCodeClaimRef.current = null;
    pendingRelayClaimRef.current = null;
    setPreview(providedPreview ?? null);
    setMessage('');
    setErrorDisposition('preserve');
    setRetryAction(null);
    setLiveConsent(false);
    setSessionConsent(false);
    setStudioBlockConsent(false);
    setCopied(false);

    if (!open) {
      setPhase('idle');
      return;
    }
    if (!normalizedInviteCode) {
      setMessage('This studio heart-rate invitation link is invalid.');
      setErrorDisposition('remove');
      setPhase('error');
      return;
    }
    if (platform !== 'iphone' || !authenticated) {
      setPhase('idle');
      return;
    }
    void loadInvitationPreview();
    return () => {
      requestGenerationRef.current += 1;
    };
    // The injected loader is expected to be stable, just like the production helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, normalizedInviteCode, open, platform, providedPreview, loadPreview]);

  if (!open) return null;

  const busy = phase === 'loading' || phase === 'claiming';
  const handoffRequired = platform !== 'iphone';
  const studioBlock = preview?.relayScope === 'studio-block';

  const close = () => {
    const disposition = invitationConsumedRef.current ? 'remove' : errorDisposition;
    pendingPairCodeClaimRef.current = null;
    pendingRelayClaimRef.current = null;
    onClose(disposition);
  };

  const configureRelay = async () => {
    setPhase('claiming');
    setMessage('');
    setRetryAction(null);
    try {
      let relayClaim = pendingRelayClaimRef.current;
      if (!relayClaim) {
        let invitationClaim = pendingPairCodeClaimRef.current;
        if (!invitationClaim) {
          invitationClaim = await claimInvitation(normalizedInviteCode, {
            liveStudioConsent: liveConsent,
            sessionStudioConsent: studioBlock ? studioBlockConsent : sessionConsent,
            studioBlockConsent: studioBlock && studioBlockConsent,
          });
          invitationConsumedRef.current = true;
          pendingPairCodeClaimRef.current = invitationClaim;
        }
        const watchClaim = await claimPairCode(invitationClaim.pairCode);
        relayClaim = {
          pairing: invitationClaim.pairing,
          ingestToken: watchClaim.ingestToken,
          ingestExpiresAt: watchClaim.ingestExpiresAt,
        };
        if (!pairingsMatch(invitationClaim.pairing, watchClaim.pairing)) {
          pendingPairCodeClaimRef.current = null;
          throw new HeartRateStudioInviteError('TrackLab refused a mismatched Apple Watch pairing.', {
            urlDisposition: 'remove',
          });
        }
        pendingRelayClaimRef.current = relayClaim;
        pendingPairCodeClaimRef.current = null;
      }

      await onConfigureNativeRelay(relayClaim);
      pendingRelayClaimRef.current = null;
      setPhase('ready');
      onClose('remove');
    } catch (error) {
      const hasMemoryOnlyRelayCredential = pendingRelayClaimRef.current != null;
      const disposition = invitationConsumedRef.current
        ? 'remove'
        : heartRateStudioInviteUrlDisposition(error);
      setMessage(hasMemoryOnlyRelayCredential
        ? 'The invitation was accepted, but the iPhone could not finish connecting Apple Watch. Try again.'
        : errorMessage(error));
      setErrorDisposition(disposition);
      setRetryAction(
        pendingRelayClaimRef.current || pendingPairCodeClaimRef.current || disposition === 'preserve'
          ? 'connect'
          : null,
      );
      setPhase('error');
    }
  };

  const copyHandoffLink = async () => {
    if (!cleanHandoffHref || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setMessage('Open this invitation on the athlete’s paired iPhone to connect Apple Watch.');
      return;
    }
    try {
      await navigator.clipboard.writeText(cleanHandoffHref);
      setCopied(true);
      setMessage('iPhone handoff link copied.');
    } catch {
      setMessage('The link could not be copied. Open this invitation directly on the athlete’s paired iPhone.');
    }
  };

  const retry = () => {
    if (retryAction === 'preview') void loadInvitationPreview();
    if (retryAction === 'connect') void configureRelay();
  };

  return (
    <div className="heart-rate-studio-invite-backdrop" role="presentation">
      <section
        aria-busy={busy || undefined}
        aria-describedby="heart-rate-studio-invite-privacy"
        aria-labelledby="heart-rate-studio-invite-heading"
        aria-modal="true"
        className="heart-rate-studio-invite-dialog"
        role="dialog"
      >
        <header>
          <span className="heart-rate-studio-invite-icon"><HeartPulse aria-hidden="true" size={24} /></span>
          <div>
            <span className="eyebrow">Private Apple Watch connection</span>
            <h2 id="heart-rate-studio-invite-heading">Join this studio session</h2>
          </div>
          <button aria-label="Close heart-rate invitation" disabled={busy} onClick={close} type="button">
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        {handoffRequired ? (
          <div className="heart-rate-studio-handoff">
            <Smartphone aria-hidden="true" size={28} />
            <div>
              <strong>{platform === 'ipad' ? 'Continue on the athlete’s iPhone' : 'Open this link on iPhone'}</strong>
              <p>
                Apple Watch communicates through its paired iPhone, not directly with the studio iPad. Copy this secure invitation and open it in the signed-in athlete’s TrackLab iPhone app.
              </p>
            </div>
            <button className="primary" disabled={!cleanHandoffHref} onClick={() => void copyHandoffLink()} type="button">
              {copied ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
              {copied ? 'Link copied' : 'Copy iPhone handoff link'}
            </button>
          </div>
        ) : !authenticated ? (
          <div className="heart-rate-studio-auth">
            <strong>Sign in as the invited athlete</strong>
            <p>The invitation stays in this link while you sign in. It can only be claimed by the athlete assigned to the studio bike.</p>
            <button className="primary" onClick={onRequestSignIn} type="button">Sign in to continue</button>
          </div>
        ) : phase === 'loading' ? (
          <div className="heart-rate-studio-loading" role="status">
            <LoaderCircle aria-hidden="true" className="spin" size={24} />
            Checking this private studio invitation…
          </div>
        ) : preview && phase !== 'error' ? (
          <>
            <dl className="heart-rate-studio-preview">
              <div><dt>Studio</dt><dd>{preview.clubName}</dd></div>
              <div><dt>Athlete</dt><dd>{preview.riderName}</dd></div>
              <div><dt>Training mode</dt><dd>{studioHeartRateActivityLabel(preview.activityType)}</dd></div>
              {preview.playerId != null && <div><dt>Bike position</dt><dd>Bike {preview.playerId}</dd></div>}
            </dl>

            <fieldset className="heart-rate-studio-invite-consent" disabled={busy}>
              <legend>{studioBlock ? 'Apple Watch studio training permission' : 'Optional sharing for this session'}</legend>
              <p>
                {studioBlock
                  ? 'Permission is off by default. Connect once before training, then TrackLab can capture supported studio modes without another invitation.'
                  : 'Both choices are off by default. Friendship—including the default Club and Founder friendships—grants no health-data access.'}
              </p>
              {studioBlock && (
                <label>
                  <input
                    checked={studioBlockConsent}
                    onChange={(event) => setStudioBlockConsent(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>Record this studio training block and share saved studio summaries</strong>
                    <small>Required for this connection. Apple Watch can collect continuously for up to 12 hours, but TrackLab attaches only exact active session and pedal-zone windows. Raw idle and private samples stay athlete-owned.</small>
                  </span>
                </label>
              )}
              <label>
                <input
                  checked={liveConsent}
                  onChange={(event) => setLiveConsent(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span><strong>Share live BPM with the studio</strong><small>Shows only a fresh heart-rate reading on the studio monitor during {studioBlock ? 'this training block' : 'this session'}.</small></span>
              </label>
              {!studioBlock && (
                <label>
                  <input
                    checked={sessionConsent}
                    onChange={(event) => setSessionConsent(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span><strong>Share the session summary with the studio</strong><small>Only when selected, shares min, average, peak, coverage, and pedal-zone summaries—not raw samples.</small></span>
                </label>
              )}
            </fieldset>

            <button
              className="primary heart-rate-studio-connect"
              disabled={busy || (studioBlock && !studioBlockConsent)}
              onClick={() => void configureRelay()}
              type="button"
            >
              {busy && <LoaderCircle aria-hidden="true" className="spin" size={18} />}
              {busy
                ? 'Connecting Apple Watch…'
                : studioBlock ? 'Connect Apple Watch for this studio block' : 'Connect Apple Watch to this session'}
            </button>
          </>
        ) : phase === 'error' ? (
          <div className="heart-rate-studio-error" role="alert">
            <strong>{retryAction ? 'Connection needs another try' : 'This invitation cannot be used'}</strong>
            <p>{message}</p>
            <div>
              {retryAction && <button className="primary" onClick={retry} type="button">Try again</button>}
              <button onClick={close} type="button">
                {errorDisposition === 'remove' || invitationConsumedRef.current ? 'Close invitation' : 'Not now'}
              </button>
            </div>
          </div>
        ) : null}

        {message && phase !== 'error' && <p className="heart-rate-studio-message" role="status">{message}</p>}

        <div className="heart-rate-studio-privacy" id="heart-rate-studio-invite-privacy">
          <ShieldCheck aria-hidden="true" size={18} />
          <p>
            Raw idle and private heart-rate samples stay athlete-owned. Being Friends—including the default Club and Founder friendships—does not connect you to a studio or grant heart-rate access. A studio receives saved summaries only when you explicitly consent.
          </p>
        </div>
      </section>
    </div>
  );
}

export default HeartRateStudioInviteDialog;
