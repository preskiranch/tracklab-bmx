import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  Bike,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Download,
  ExternalLink,
  HeartPulse,
  Link2,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Timer,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AccountProfile,
  DistanceUnit,
  SpeedUnit,
  StudioRider,
  TrainingSession,
} from '../types';
import {
  claimClubInvite,
  clearClubInviteFromUrl,
  clubInviteTokenFromUrl,
  clubInviteUrl,
  createClubInvite,
  loadClubConnect,
  revokeClubMember,
  type ClubConnectState,
} from '../lib/clubConnect';
import {
  downloadTrainingSession,
  loadTrainingHistory,
  trainingSessionZoneResults,
  type TrainingHistoryResponse,
} from '../lib/trainingHistory';
import { deleteAuthAccount, type AuthUser } from '../lib/auth';
import { nativeInAppPurchases } from '../lib/nativeInAppPurchases';
import { subscribeToAuthenticatedEventStream } from '../lib/authenticatedEventStream';
import {
  loadClubHeartRateSummaryHistory,
  type ClubHeartRateHistoryItem,
  type PrivateHeartRateAttachmentStatus,
  type HeartRateStream,
} from '../lib/heartRateCloud';
import {
  loadPrivateTrainingHeartRateDay,
  privateTrainingHeartRatePlaceholder,
  privateTrainingHeartRateTarget,
  type PrivateTrainingHeartRateBySession,
  type PrivateTrainingHeartRateProjection,
  type PrivateTrainingHeartRateTarget,
} from '../lib/privateTrainingHeartRate';
import {
  formatDistanceMeters,
  formatExploreDistanceMeters,
} from '../units';
import { RiderAvatar, RiderPhotoEditor } from './RiderAvatar';
import { TrainingResultsSpreadsheet } from './TrainingResultsSpreadsheet';
import { TrainingTrackZoneReview } from './TrainingTrackZoneReview';
import './AccountProfileView.css';

type AccountProfileViewProps = {
  name: string;
  email: string;
  membershipLabel: string;
  profile: AccountProfile;
  studioRiders: StudioRider[];
  historyRevision: number;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  onPhotoChange: (photoUrl: string | undefined) => void;
  onClubProfileComplete: (user: AuthUser, profile: AccountProfile) => void;
};

const emptyHistory: TrainingHistoryResponse = {
  sessions: [],
  totals: { sessions: 0, bmxRaces: 0, straightSprints: 0, exploreRides: 0, getPulledTests: 0, monitorSprints: 0, distanceMeters: 0, durationMs: 0 },
};
const emptyClubState: ClubConnectState = {
  canManageClub: false,
  ownedClub: null,
  memberships: [],
};

type PrivateHeartRateCacheEntry = Readonly<{
  revisionKey: string;
  projections: readonly PrivateTrainingHeartRateProjection[];
}>;

type PrivateHeartRateLoadEntry = Readonly<{
  target: PrivateTrainingHeartRateTarget;
  revisionKey: string;
}>;

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(date: Date) {
  return {
    from: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    to: new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1,
  };
}

function monthDays(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: count }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index + 1)),
  ];
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function formatProfileHistoryDistance(meters: number, distanceUnit: DistanceUnit) {
  const longDistanceUnit = distanceUnit === 'm' ? 'km' : 'mi';
  const longDistanceThresholdMeters = distanceUnit === 'm' ? 100 : 160.9344;
  return meters >= longDistanceThresholdMeters
    ? formatExploreDistanceMeters(meters, longDistanceUnit)
    : formatDistanceMeters(meters, distanceUnit);
}

export function formatProfileExploreDistance(meters: number, distanceUnit: DistanceUnit) {
  return formatExploreDistanceMeters(meters, distanceUnit === 'm' ? 'km' : 'mi');
}

export function profileSplitDistanceLabel(distanceUnit: DistanceUnit) {
  return formatDistanceMeters(30 * 0.3048, distanceUnit);
}

export function displayedProfileSessionTitle(session: TrainingSession, distanceUnit: DistanceUnit) {
  if (session.activityType !== 'straight-sprint' || distanceUnit === 'ft') return session.title;
  const details = session.details as { sprintDistanceFeet?: number };
  const sprintDistanceFeet = Number(details.sprintDistanceFeet);
  if (!Number.isFinite(sprintDistanceFeet) || sprintDistanceFeet <= 0) return session.title;
  return session.title.replace(
    /[\d,]+\s*ft\b/i,
    formatDistanceMeters(sprintDistanceFeet * 0.3048, distanceUnit),
  );
}

export function formatProfileRecordedDistance(
  meters: number | null | undefined,
  distanceUnit: DistanceUnit,
) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  const value = distanceUnit === 'm' ? meters : meters * 3.28084;
  return `${value.toFixed(2)} ${distanceUnit}`;
}

export function formatProfileRecordedDistanceRange(
  startMeters: number | null | undefined,
  endMeters: number | null | undefined,
  distanceUnit: DistanceUnit,
) {
  if (
    startMeters == null
    || endMeters == null
    || !Number.isFinite(startMeters)
    || !Number.isFinite(endMeters)
  ) return '—';
  const multiplier = distanceUnit === 'm' ? 1 : 3.28084;
  return `${(startMeters * multiplier).toFixed(2)}–${(endMeters * multiplier).toFixed(2)} ${distanceUnit}`;
}

export function formatProfileRaceTime(value: number | null | undefined, precision: 2 | 3) {
  return value != null && Number.isFinite(value) ? `${(value / 1_000).toFixed(precision)}s` : '—';
}

export function privateHeartRateSessionId(session: TrainingSession) {
  return privateTrainingHeartRateTarget(session)?.canonicalSessionId ?? null;
}

export type ClubHeartRateHistoryTarget = Readonly<{
  clubId: string;
  clubName: string;
  sessionId: string;
  studioRiderId: string;
}>;

export function clubHeartRateHistoryTarget(session: TrainingSession): ClubHeartRateHistoryTarget | null {
  if (session.club?.role !== 'owner') return null;
  const projectedPrefix = `club-owner:${session.club.id}:${session.club.studioRiderId}:`;
  const sessionId = session.id.startsWith(projectedPrefix)
    ? session.id.slice(projectedPrefix.length)
    : session.id;
  return sessionId ? {
    clubId: session.club.id,
    clubName: session.club.name,
    sessionId,
    studioRiderId: session.club.studioRiderId,
  } : null;
}

type HeartRateHistorySummaryStream =
  | PrivateTrainingHeartRateProjection
  | ClubHeartRateHistoryItem;

function isPrivateTrainingHeartRateProjection(
  stream: HeartRateHistorySummaryStream,
): stream is PrivateTrainingHeartRateProjection {
  return 'access' in stream && stream.access === 'athlete-private';
}

function heartRateHistoryStreamPending(stream: HeartRateHistorySummaryStream) {
  return isPrivateTrainingHeartRateProjection(stream)
    ? stream.state === 'loading' || stream.state === 'syncing'
    : stream.finalizedAt == null;
}

function heartRateMetric(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? `${Math.round(value)} BPM` : '—';
}

function heartRateCoverage(summary: HeartRateStream['summary']) {
  if (!summary) return 'Not available';
  const percentage = Number.isInteger(summary.coveragePercent)
    ? summary.coveragePercent.toFixed(0)
    : summary.coveragePercent.toFixed(1);
  return `${summary.sampleCount.toLocaleString()} ${summary.sampleCount === 1 ? 'sample' : 'samples'} · ${percentage}% · ${formatDuration(summary.coverageMs)} measured`;
}

function activeClockLabel(value: number) {
  const seconds = Math.max(0, value) / 1_000;
  return seconds < 60
    ? `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`
    : formatDuration(value);
}

export type PrivateHeartRateHistoryState = 'loading' | 'ready' | 'error';
export const privateHeartRateSyncPollLimit = 20;

export function privateHeartRateSyncPollDelay(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= privateHeartRateSyncPollLimit) return null;
  return Math.min(10_000, 2_000 + attempt * 1_000);
}

export function privateHeartRateCacheRevisionKey(
  historyRevision: number,
  sessionUpdatedAt: number,
  retryRevision: number,
) {
  return `${historyRevision}:${sessionUpdatedAt}:${retryRevision}`;
}

export function privateHeartRateCacheNeedsLoad(
  cachedRevisionKey: string | null | undefined,
  cachedProjections: readonly Pick<PrivateTrainingHeartRateProjection, 'state'>[],
  revisionKey: string,
) {
  return cachedRevisionKey !== revisionKey || cachedProjections.some((projection) => (
    projection.state === 'loading'
    || projection.state === 'syncing'
    || projection.state === 'error'
  ));
}

export function PrivateHeartRateHistoryPanel({
  state,
  streams,
  attachmentStatus = 'not-recorded',
  error = '',
  onRetry,
  sharingLabel,
}: {
  state: PrivateHeartRateHistoryState;
  streams: readonly HeartRateHistorySummaryStream[];
  attachmentStatus?: PrivateHeartRateAttachmentStatus;
  error?: string;
  onRetry?: () => void;
  sharingLabel?: string;
}) {
  return (
    <section className={`private-heart-rate-history ${state}`} aria-label={sharingLabel ? 'Consented Apple Watch heart-rate summary' : 'Private Apple Watch heart-rate history'}>
      <header>
        <span className="private-heart-rate-title"><HeartPulse size={16} /> {sharingLabel ? 'Consented Apple Watch summary' : 'Private Apple Watch heart rate'}</span>
        <span className="private-heart-rate-owner"><ShieldCheck size={13} /> {sharingLabel || 'Only you'}</span>
      </header>

      {state === 'loading' ? (
        <p className="private-heart-rate-message" role="status">
          {sharingLabel ? 'Loading rider-consented heart-rate summary…' : 'Loading private heart-rate history…'}
        </p>
      ) : state === 'error' ? (
        <div className="private-heart-rate-message error" role="alert">
          <span>{sharingLabel ? 'Consented heart-rate summary' : 'Private heart-rate history'} is temporarily unavailable{error ? `: ${error}` : '.'}</span>
          {onRetry && <button type="button" onClick={onRetry}><RefreshCw size={13} /> Try again</button>}
        </div>
      ) : streams.length === 0 ? (
        <div className="private-heart-rate-message" role={attachmentStatus === 'syncing' ? 'status' : undefined}>
          <span>{sharingLabel
            ? 'The rider did not share an Apple Watch summary for this club session.'
            : attachmentStatus === 'syncing'
              ? 'Apple Watch heart-rate data is still syncing for this session.'
              : 'No Apple Watch heart-rate data was saved for this session.'}</span>
          {!sharingLabel && (attachmentStatus === 'syncing' || attachmentStatus === 'not-recorded') && onRetry && (
            <button type="button" onClick={onRetry}><RefreshCw size={13} /> Check again</button>
          )}
        </div>
      ) : (
        <div className="private-heart-rate-streams">
          {streams.map((stream, index) => (
            <div
              className="private-heart-rate-stream"
              key={isPrivateTrainingHeartRateProjection(stream)
                ? `${stream.displayedSessionId}:${stream.playerId ?? 'single'}:${index}`
                : stream.id}
            >
              {streams.length > 1 && <strong className="private-heart-rate-segment">Watch segment {index + 1}</strong>}
              {stream.summary && stream.summary.sampleCount > 0 ? (
                <dl className="private-heart-rate-metrics">
                  <div><dt>Minimum</dt><dd>{heartRateMetric(stream.summary.minimumBpm)}</dd></div>
                  <div><dt>Average</dt><dd>{heartRateMetric(stream.summary.averageBpm)}</dd></div>
                  <div><dt>Peak</dt><dd>{heartRateMetric(stream.summary.peakBpm)}</dd></div>
                  <div className="coverage"><dt>Sample coverage</dt><dd>{heartRateCoverage(stream.summary)}</dd></div>
                </dl>
              ) : (
                <div className="private-heart-rate-message">
                  <span>{heartRateHistoryStreamPending(stream)
                    ? 'Apple Watch data is still syncing for this session.'
                    : 'No valid Apple Watch samples were recorded for this session.'}</span>
                  {heartRateHistoryStreamPending(stream) && onRetry && (
                    <button type="button" onClick={onRetry}><RefreshCw size={13} /> Check again</button>
                  )}
                </div>
              )}

              {stream.zoneSummaries.some((zone) => zone.summary.sampleCount > 0) && (
                <div className="private-heart-rate-zones">
                  <strong>Heart rate by pedal zone</strong>
                  {stream.zoneSummaries.filter((zone) => zone.summary.sampleCount > 0).map((zone) => (
                    <article key={`${isPrivateTrainingHeartRateProjection(stream)
                      ? stream.displayedSessionId
                      : stream.id}:${zone.zoneId}:${zone.startElapsedMs}:${zone.endElapsedMs}`}>
                      <div>
                        <strong>{zone.zoneName || zone.zoneId}</strong>
                        <small>{activeClockLabel(zone.startElapsedMs)}–{activeClockLabel(zone.endElapsedMs)} active time</small>
                      </div>
                      <span>Avg {heartRateMetric(zone.summary.averageBpm)} · Peak {heartRateMetric(zone.summary.peakBpm)}</span>
                      <small>{heartRateCoverage(zone.summary)}</small>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <small className="private-heart-rate-separation">
        {sharingLabel
          ? 'Summary only · raw heart-rate samples are unavailable to the club and excluded from downloads'
          : 'Owner-only health data · kept separate from club history and generic JSON/CSV downloads'}
      </small>
    </section>
  );
}

function PrivateHeartRateHistoryForSession({
  session,
  privateProjections,
  onRetryPrivate,
}: {
  session: TrainingSession;
  privateProjections?: readonly PrivateTrainingHeartRateProjection[];
  onRetryPrivate?: () => void;
}) {
  const privateTarget = useMemo(() => privateTrainingHeartRateTarget(session), [session]);
  const clubTarget = useMemo(() => clubHeartRateHistoryTarget(session), [session]);
  const [state, setState] = useState<PrivateHeartRateHistoryState>('loading');
  const [streams, setStreams] = useState<readonly HeartRateHistorySummaryStream[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState<PrivateHeartRateAttachmentStatus>('not-recorded');
  const [error, setError] = useState('');
  const [retryRevision, setRetryRevision] = useState(0);
  const syncPollCountRef = useRef(0);
  const loadTargetRef = useRef('');

  useEffect(() => {
    if (!clubTarget) return undefined;
    let cancelled = false;
    let syncTimer: number | null = null;
    const loadTarget = `club:${clubTarget.clubId}:${clubTarget.studioRiderId}:${clubTarget.sessionId}`;
    if (loadTargetRef.current !== loadTarget) {
      loadTargetRef.current = loadTarget;
      syncPollCountRef.current = 0;
      setStreams([]);
      setAttachmentStatus('not-recorded');
      setState('loading');
    } else {
      // Background sync checks retain the current truthful content instead of
      // flashing the whole result card back to a loading state.
      setState((current) => current === 'error' ? 'loading' : current);
    }
    setError('');
    const request = loadClubHeartRateSummaryHistory(
      clubTarget.clubId,
      clubTarget.sessionId,
      clubTarget.studioRiderId,
    ).then((items) => ({
      items,
      status: 'saved' as const,
    }));
    void request
      .then((next) => {
        if (cancelled) return;
        setStreams(next.items);
        setAttachmentStatus(next.status);
        setState('ready');
        syncPollCountRef.current = 0;
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setStreams([]);
        setAttachmentStatus('not-recorded');
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setState('error');
      });
    return () => {
      cancelled = true;
      if (syncTimer != null) window.clearTimeout(syncTimer);
    };
  }, [clubTarget, retryRevision]);

  if (privateTarget) {
    const projections = privateProjections ?? [
      privateTrainingHeartRatePlaceholder(privateTarget, 'loading'),
    ];
    const privateState = projections.some((projection) => projection.state === 'loading')
      ? 'loading'
      : projections.some((projection) => projection.state === 'error')
        ? 'error'
        : 'ready';
    const privateAttachmentStatus: PrivateHeartRateAttachmentStatus =
      projections.some((projection) => projection.state === 'loading' || projection.state === 'syncing')
        ? 'syncing'
        : projections.some((projection) => projection.state === 'saved')
          ? 'saved'
          : 'not-recorded';
    const visibleProjections = projections.filter((projection) => (
      projection.state === 'saved'
      || (projection.state === 'syncing' && (
        projection.summary != null || projection.zoneSummaries.length > 0
      ))
    ));
    return (
      <PrivateHeartRateHistoryPanel
        state={privateState}
        streams={visibleProjections}
        attachmentStatus={privateAttachmentStatus}
        onRetry={onRetryPrivate}
      />
    );
  }
  if (!clubTarget) return null;
  return (
    <PrivateHeartRateHistoryPanel
      state={state}
      streams={streams}
      attachmentStatus={attachmentStatus}
      error={error}
      sharingLabel={clubTarget ? `Shared with ${clubTarget.clubName} by rider consent` : undefined}
      onRetry={() => {
        syncPollCountRef.current = 0;
        setRetryRevision((revision) => revision + 1);
      }}
    />
  );
}

function editableAccountName(value: string) {
  const match = value.trim().match(/^(.+?)\s*\(([^()]+)\)$/u);
  return {
    fullName: (match?.[1] ?? value).trim(),
    nickname: (match?.[2] ?? '').trim(),
  };
}

function completedAccountName(fullName: string, nickname: string) {
  const cleanName = fullName.trim().replace(/\s+/g, ' ');
  const cleanNickname = nickname.trim().replace(/[()"“”]/g, '').replace(/\s+/g, ' ');
  return cleanNickname ? `${cleanName} (${cleanNickname})` : cleanName;
}

export const appleSubscriptionManagementUrl = 'https://apps.apple.com/account/subscriptions';

export function accountDeletionReady({
  password,
  confirmation,
  acknowledged,
}: {
  password: string;
  confirmation: string;
  acknowledged: boolean;
}) {
  return password.length > 0 && confirmation === 'DELETE' && acknowledged;
}

export function AccountDeletionPanel({
  email,
  onAccountDeleted,
}: {
  email: string;
  onAccountDeleted?: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<'idle' | 'deleting' | 'error'>('idle');
  const [deletionMessage, setDeletionMessage] = useState('');
  const nativeSubscriptionManagement = nativeInAppPurchases.isAvailable();
  const ready = accountDeletionReady({ password, confirmation, acknowledged });

  const reset = useCallback(() => {
    setExpanded(false);
    setPassword('');
    setConfirmation('');
    setAcknowledged(false);
    setDeletionStatus('idle');
    setDeletionMessage('');
  }, []);

  const openNativeSubscriptionManagement = useCallback(async () => {
    setDeletionMessage('Opening Apple subscription management…');
    try {
      await nativeInAppPurchases.manageSubscriptions();
      setDeletionMessage('Apple subscription management opened.');
    } catch (error) {
      setDeletionMessage(error instanceof Error
        ? error.message
        : 'Apple subscription management could not open.');
    }
  }, []);

  const submitDeletion = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || deletionStatus === 'deleting') return;
    setDeletionStatus('deleting');
    setDeletionMessage('Permanently deleting your TrackLab account…');
    try {
      await deleteAuthAccount(password, 'DELETE');
      setDeletionMessage('Your TrackLab account was deleted.');
      if (onAccountDeleted) {
        await onAccountDeleted();
      } else if (typeof window !== 'undefined') {
        window.location.replace('/');
      }
    } catch (error) {
      setDeletionStatus('error');
      setDeletionMessage(error instanceof Error ? error.message : 'Your account could not be deleted.');
    }
  }, [deletionStatus, onAccountDeleted, password, ready]);

  return (
    <section className="account-deletion-panel" aria-labelledby="account-controls-title">
      <div className="account-deletion-summary">
        <div>
          <span className="eyebrow">Account controls</span>
          <h2 id="account-controls-title">Manage or delete your account</h2>
          <p>Signed in as {email}</p>
        </div>
        <div className="account-deletion-summary-actions">
          {nativeSubscriptionManagement ? (
            <button
              type="button"
              className="account-manage-subscription"
              onClick={() => { void openNativeSubscriptionManagement(); }}
            >
              Manage Apple Subscription
            </button>
          ) : (
            <a
              className="account-manage-subscription"
              href={appleSubscriptionManagementUrl}
              target="_blank"
              rel="noreferrer"
            >
              Manage Apple Subscription <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            className="account-delete-open"
            aria-controls="account-delete-confirmation"
            aria-expanded={expanded}
            onClick={() => {
              if (expanded) reset();
              else setExpanded(true);
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> Delete Account
          </button>
        </div>
      </div>
      {!expanded && deletionMessage && (
        <p className="account-deletion-message" role="status">{deletionMessage}</p>
      )}

      <form
        id="account-delete-confirmation"
        className="account-delete-confirmation"
        hidden={!expanded}
        onSubmit={(event) => { void submitDeletion(event); }}
      >
        <div className="account-delete-warning">
          <ShieldAlert size={24} aria-hidden="true" />
          <div>
            <strong>This permanently deletes your TrackLab account and data.</strong>
            <p>
              Your profile, saved training history, private heart-rate records, friendships, and club data tied to this
              account will no longer be available. This cannot be undone.
            </p>
          </div>
        </div>
        <p className="account-delete-subscription-warning">
          <strong>Deleting TrackLab does not cancel an Apple subscription.</strong> If you do not want Apple billing to
          renew, use <strong>Manage Apple Subscription</strong> above and cancel it before deleting. Apple, not TrackLab,
          controls that billing. TrackLab deletes your account identifier and personal data, but retains a one-way,
          pseudonymous Apple transaction-lineage proof with no email or name. If the same Apple Account still has an
          active subscription, you can create a new TrackLab account and deliberately choose <strong>Restore Purchases</strong>{' '}
          in the iOS app to reattach it after Apple verifies the signed transaction. Cancellation is recommended first if
          you do not want renewal, but it is not required to delete your account.
        </p>
        <label>
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            disabled={deletionStatus === 'deleting'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>Type DELETE to confirm</span>
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            disabled={deletionStatus === 'deleting'}
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <label className="account-delete-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={deletionStatus === 'deleting'}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            I understand that Apple billing continues unless I cancel it, and restoring it to a new TrackLab account
            requires the same Apple Account, an active subscription, and a deliberate Restore Purchases request.
          </span>
        </label>
        <div className="account-delete-actions">
          <button type="button" disabled={deletionStatus === 'deleting'} onClick={reset}>Keep My Account</button>
          <button className="danger" type="submit" disabled={!ready || deletionStatus === 'deleting'}>
            <Trash2 size={16} aria-hidden="true" />
            {deletionStatus === 'deleting' ? 'Deleting Account…' : 'Permanently Delete Account'}
          </button>
        </div>
        {deletionMessage && (
          <p
            className={`account-deletion-message ${deletionStatus}`}
            role={deletionStatus === 'error' ? 'alert' : 'status'}
          >
            {deletionMessage}
          </p>
        )}
      </form>
    </section>
  );
}

export function AccountProfileView({
  name,
  email,
  membershipLabel,
  profile,
  studioRiders,
  historyRevision,
  speedUnit,
  distanceUnit,
  onPhotoChange,
  onClubProfileComplete,
}: AccountProfileViewProps) {
  const initialAccountName = useMemo(() => editableAccountName(name), [name]);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(Date.now()));
  const [history, setHistory] = useState<TrainingHistoryResponse>(emptyHistory);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('Loading your training history…');
  const [clubState, setClubState] = useState<ClubConnectState>(emptyClubState);
  const [clubStatus, setClubStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [clubMessage, setClubMessage] = useState('Loading Club Connect…');
  const [clubInviteToken, setClubInviteToken] = useState(clubInviteTokenFromUrl);
  const [clubFullNameDraft, setClubFullNameDraft] = useState(initialAccountName.fullName);
  const [clubNicknameDraft, setClubNicknameDraft] = useState(initialAccountName.nickname);
  const [clubPhotoDraft, setClubPhotoDraft] = useState(profile.photoUrl);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [clubBusyId, setClubBusyId] = useState<string | null>(null);
  const [spreadsheetExportMessage, setSpreadsheetExportMessage] = useState('');
  const [privateHeartRateCache, setPrivateHeartRateCache] = useState<ReadonlyMap<string, PrivateHeartRateCacheEntry>>(
    () => new Map(),
  );
  const [privateHeartRateRetryRevision, setPrivateHeartRateRetryRevision] = useState(0);
  const historyRequestRef = useRef(0);
  const spreadsheetExportPendingRef = useRef(false);
  const privateHeartRateCacheRef = useRef<ReadonlyMap<string, PrivateHeartRateCacheEntry>>(new Map());

  const commitPrivateHeartRateCache = useCallback((
    updates: ReadonlyMap<string, PrivateHeartRateCacheEntry>,
  ) => {
    setPrivateHeartRateCache((current) => {
      const next = new Map(current);
      updates.forEach((entry, displayedSessionId) => next.set(displayedSessionId, entry));
      privateHeartRateCacheRef.current = next;
      return next;
    });
  }, []);

  const loadHistory = useCallback((showLoading: boolean) => {
    const range = monthRange(month);
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    if (showLoading) {
      setStatus('loading');
      setMessage('Loading your training history…');
    }
    void loadTrainingHistory(range.from, range.to)
      .then((next) => {
        if (historyRequestRef.current !== requestId) return;
        setHistory(next);
        setStatus('ready');
        setMessage(next.sessions.length > 0 ? '' : 'No saved training sessions in this month yet.');
      })
      .catch((error: Error) => {
        if (historyRequestRef.current !== requestId) return;
        setStatus('error');
        setMessage(`Training history is temporarily unavailable. ${error.message}`);
      });
  }, [month]);

  const refresh = useCallback(() => loadHistory(true), [loadHistory]);
  const refreshQuietly = useCallback(() => loadHistory(false), [loadHistory]);

  useEffect(() => refresh(), [historyRevision, refresh]);

  useEffect(() => {
    return subscribeToAuthenticatedEventStream('/api/training-sessions/stream', {
      onEvent: (event) => {
        if (event.type === 'training-history-updated') refreshQuietly();
      },
    });
  }, [refreshQuietly]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshQuietly();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const fallback = window.setInterval(refreshWhenVisible, 10_000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(fallback);
    };
  }, [refreshQuietly]);

  const refreshClub = useCallback(() => {
    setClubStatus('loading');
    void loadClubConnect()
      .then((state) => {
        setClubState(state);
        setClubStatus('ready');
        setClubMessage('');
      })
      .catch((error: Error) => {
        setClubStatus('error');
        setClubMessage(`Club Connect is temporarily unavailable. ${error.message}`);
      });
  }, []);

  useEffect(() => refreshClub(), [refreshClub]);

  const memberByRiderId = useMemo(() => new Map(
    (clubState.ownedClub?.members ?? []).map((member) => [member.studioRiderId, member]),
  ), [clubState.ownedClub?.members]);
  const visibleStudioRiders = useMemo(
    () => studioRiders.filter((rider) => !rider.deletedAt).sort((left, right) => left.name.localeCompare(right.name)),
    [studioRiders],
  );
  const effectiveMembershipLabel = clubState.memberships.length > 0
    ? 'Club Athlete / free studio data access'
    : membershipLabel;

  const copyInvitation = useCallback((link: string) => {
    void navigator.clipboard?.writeText(link).then(() => {
      setClubMessage('Private invitation copied. Send it only to this athlete or their parent/guardian.');
    }).catch(() => {
      window.prompt('Copy this private Club Connect invitation:', link);
    });
  }, []);

  const inviteRider = useCallback((rider: StudioRider) => {
    if (!clubState.canManageClub) {
      setClubMessage('Only the TrackLab club owner can invite studio athletes.');
      return;
    }
    setClubBusyId(rider.id);
    setClubMessage(`Creating a private invitation for ${rider.name}…`);
    void createClubInvite(rider.id)
      .then((invite) => {
        const link = clubInviteUrl(invite.token);
        setInviteLinks((current) => ({ ...current, [rider.id]: link }));
        copyInvitation(link);
        refreshClub();
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, [clubState.canManageClub, copyInvitation, refreshClub]);

  const acceptInvitation = useCallback(() => {
    if (!clubInviteToken) return;
    const fullName = clubFullNameDraft.trim().replace(/\s+/g, ' ');
    if (!fullName) {
      setClubMessage('Enter the athlete’s full name before connecting the studio record.');
      return;
    }
    setClubBusyId('claim');
    setClubMessage('Saving your Club Athlete profile and connecting your studio history…');
    void claimClubInvite(clubInviteToken, {
      fullName,
      nickname: clubNicknameDraft,
      photoUrl: clubPhotoDraft,
    })
      .then((result) => {
        setClubState(result);
        onClubProfileComplete(result.user, result.accountProfile);
        setClubInviteToken('');
        clearClubInviteFromUrl();
        setClubMessage('Profile complete. Your studio training history is now available in this calendar.');
        refresh();
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, [clubFullNameDraft, clubInviteToken, clubNicknameDraft, clubPhotoDraft, onClubProfileComplete, refresh]);

  const disconnectRider = useCallback((rider: StudioRider) => {
    if (!clubState.canManageClub) {
      setClubMessage('Only the TrackLab club owner can manage studio access.');
      return;
    }
    if (!window.confirm(`Remove ${rider.name}'s access to this studio record? Their TrackLab account will remain active.`)) return;
    setClubBusyId(rider.id);
    void revokeClubMember(rider.id)
      .then((state) => {
        setClubState(state);
        setInviteLinks((current) => {
          const next = { ...current };
          delete next[rider.id];
          return next;
        });
        setClubMessage(`${rider.name}'s club access was removed. Studio records were not deleted.`);
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, [clubState.canManageClub]);

  const sessionsByDay = useMemo(() => {
    const grouped = new Map<string, TrainingSession[]>();
    history.sessions.forEach((session) => {
      const key = localDateKey(session.startedAt);
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    });
    return grouped;
  }, [history.sessions]);
  const selectedSessions = useMemo(
    () => [...(sessionsByDay.get(selectedDate) ?? [])]
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)),
    [selectedDate, sessionsByDay],
  );
  const selectedPrivateHeartRateEntries = useMemo<readonly PrivateHeartRateLoadEntry[]>(
    () => selectedSessions.flatMap((session) => {
      const target = privateTrainingHeartRateTarget(session);
      return target ? [{
        target,
        revisionKey: privateHeartRateCacheRevisionKey(
          historyRevision,
          session.updatedAt,
          privateHeartRateRetryRevision,
        ),
      }] : [];
    }),
    [historyRevision, privateHeartRateRetryRevision, selectedSessions],
  );
  const selectedPrivateHeartRateSignature = useMemo(
    () => selectedPrivateHeartRateEntries.map(({ target, revisionKey }) => (
      `${target.displayedSessionId}:${target.canonicalSessionId}:${target.activityType}:${revisionKey}`
    )).join('|'),
    [selectedPrivateHeartRateEntries],
  );
  const privateHeartRateBySession = useMemo<PrivateTrainingHeartRateBySession>(() => {
    const selected = new Map<string, readonly PrivateTrainingHeartRateProjection[]>();
    selectedPrivateHeartRateEntries.forEach(({ target, revisionKey }) => {
      const cached = privateHeartRateCache.get(target.displayedSessionId);
      selected.set(
        target.displayedSessionId,
        cached?.revisionKey === revisionKey
          ? cached.projections
          : [privateTrainingHeartRatePlaceholder(target, 'loading')],
      );
    });
    return selected;
  }, [privateHeartRateCache, selectedPrivateHeartRateEntries]);
  const privateHeartRateExportPending = [...privateHeartRateBySession.values()].some((projections) => (
    projections.some((projection) => projection.state === 'loading' || projection.state === 'syncing')
  ));

  useEffect(() => {
    if (selectedPrivateHeartRateEntries.length === 0) return undefined;
    const controller = new AbortController();
    let syncTimer: number | null = null;
    const initialEntries = selectedPrivateHeartRateEntries.filter(({ target, revisionKey }) => {
      const cached = privateHeartRateCacheRef.current.get(target.displayedSessionId);
      return privateHeartRateCacheNeedsLoad(
        cached?.revisionKey,
        cached?.projections ?? [],
        revisionKey,
      );
    });
    const loadingUpdates = new Map<string, PrivateHeartRateCacheEntry>();
    initialEntries.forEach(({ target, revisionKey }) => {
      const cached = privateHeartRateCacheRef.current.get(target.displayedSessionId);
      if (cached?.revisionKey === revisionKey) return;
      loadingUpdates.set(target.displayedSessionId, {
        revisionKey,
        projections: [privateTrainingHeartRatePlaceholder(target, 'loading')],
      });
    });
    if (loadingUpdates.size > 0) commitPrivateHeartRateCache(loadingUpdates);

    const loadWave = async (entries: readonly PrivateHeartRateLoadEntry[], pollAttempt: number) => {
      if (entries.length === 0 || controller.signal.aborted) return;
      try {
        const loaded = await loadPrivateTrainingHeartRateDay(
          entries.map((entry) => entry.target),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const updates = new Map<string, PrivateHeartRateCacheEntry>();
        entries.forEach(({ target, revisionKey }) => {
          const projections = loaded.get(target.displayedSessionId) ?? [
            privateTrainingHeartRatePlaceholder(target, 'error'),
          ];
          updates.set(target.displayedSessionId, { revisionKey, projections });
        });
        commitPrivateHeartRateCache(updates);
        const syncing = entries.filter(({ target }) => (
          loaded.get(target.displayedSessionId)?.some((projection) => projection.state === 'syncing')
        ));
        const delayMs = syncing.length > 0 ? privateHeartRateSyncPollDelay(pollAttempt) : null;
        if (delayMs != null) {
          syncTimer = window.setTimeout(() => {
            void loadWave(syncing, pollAttempt + 1);
          }, delayMs);
        }
      } catch {
        // Aborted day/account changes intentionally leave no late state writes.
      }
    };
    void loadWave(initialEntries, 0);
    return () => {
      controller.abort();
      if (syncTimer != null) window.clearTimeout(syncTimer);
    };
  }, [
    commitPrivateHeartRateCache,
    privateHeartRateRetryRevision,
    selectedPrivateHeartRateEntries,
    selectedPrivateHeartRateSignature,
  ]);
  const selectedDateLabel = useMemo(
    () => new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    [selectedDate],
  );
  const days = monthDays(month);

  const changeMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(localDateKey(next.getTime()));
  };

  const exportSelectedDay = useCallback(() => {
    if (spreadsheetExportPendingRef.current || selectedSessions.length === 0) return;
    spreadsheetExportPendingRef.current = true;
    setSpreadsheetExportMessage('Preparing your Numbers / Excel workbook…');
    void import('../lib/trainingSpreadsheetExport')
      .then(({ downloadTrainingDaySpreadsheet }) => (
        downloadTrainingDaySpreadsheet(selectedSessions, selectedDate)
      ))
      .then(() => setSpreadsheetExportMessage('Workbook downloaded. Open the .xlsx file in Numbers or Excel.'))
      .catch((error: unknown) => {
        setSpreadsheetExportMessage(`Workbook export failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        spreadsheetExportPendingRef.current = false;
      });
  }, [selectedDate, selectedSessions]);

  const exportSelectedDayPrivate = useCallback(() => {
    if (
      spreadsheetExportPendingRef.current
      || selectedSessions.length === 0
      || selectedPrivateHeartRateEntries.length === 0
      || privateHeartRateExportPending
    ) return;
    spreadsheetExportPendingRef.current = true;
    setSpreadsheetExportMessage('Preparing your private Apple Watch workbook…');
    void import('../lib/trainingSpreadsheetExport')
      .then(({ downloadPrivateTrainingDaySpreadsheet }) => (
        downloadPrivateTrainingDaySpreadsheet(
          selectedSessions,
          selectedDate,
          privateHeartRateBySession,
        )
      ))
      .then(() => setSpreadsheetExportMessage(
        'Private Apple Watch workbook downloaded. It includes owner-only health data.',
      ))
      .catch((error: unknown) => {
        setSpreadsheetExportMessage(`Private workbook export failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        spreadsheetExportPendingRef.current = false;
      });
  }, [
    privateHeartRateBySession,
    privateHeartRateExportPending,
    selectedDate,
    selectedPrivateHeartRateEntries.length,
    selectedSessions,
  ]);

  const retrySelectedPrivateHeartRate = useCallback(() => {
    setPrivateHeartRateRetryRevision((revision) => revision + 1);
  }, []);

  const renderTrainingSessionDetail = useCallback((session: TrainingSession) => (
    <div className="training-session-detail-content">
      {trainingSessionZoneResults(session).length > 0 && (
        <TrainingTrackZoneReview
          session={session}
          speedUnit={speedUnit}
          distanceUnit={distanceUnit}
          privateHeartRateProjections={privateHeartRateBySession.get(session.id)}
        />
      )}
      <PrivateHeartRateHistoryForSession
        session={session}
        privateProjections={privateHeartRateBySession.get(session.id)}
        onRetryPrivate={retrySelectedPrivateHeartRate}
      />
      <div className="training-session-downloads">
        <span>Session files exclude Apple Watch health data.</span>
        <button type="button" onClick={() => downloadTrainingSession(session, 'json')}><Download size={15} /> JSON</button>
        <button type="button" onClick={() => downloadTrainingSession(session, 'csv')}><Download size={15} /> CSV</button>
      </div>
    </div>
  ), [distanceUnit, privateHeartRateBySession, retrySelectedPrivateHeartRate, speedUnit]);

  return (
    <div className="account-profile-view">
      <section className="account-profile-hero">
        <div className="account-profile-identity">
          <RiderAvatar name={name} photoUrl={profile.photoUrl} accent="#7ade36" />
          <div>
            <span className="eyebrow">My TrackLab profile</span>
            <h1>{name}</h1>
            <p>{email}</p>
            <b>{effectiveMembershipLabel}</b>
          </div>
        </div>
        <RiderPhotoEditor
          name={name}
          photoUrl={profile.photoUrl}
          onPhotoChange={onPhotoChange}
        />
        <p className="account-profile-photo-note">
          This is your account rider photo. It follows your profile across devices and is available in race entry, rider cards, results, and saved sessions.
        </p>
      </section>

      <AccountDeletionPanel email={email} />

      {(clubInviteToken
        || clubState.memberships.length > 0
        || (clubState.canManageClub && visibleStudioRiders.length > 0)) && (
        <section className="club-connect-panel" aria-label="Club Connect">
          <header>
            <div className="club-connect-title">
              <span className="club-connect-icon"><Link2 size={21} /></span>
              <div><span className="eyebrow">Club Connect</span><h2>Studio data, one athlete at a time</h2></div>
            </div>
            <span className="club-connect-security"><ShieldCheck size={16} /> Private claims</span>
          </header>

          {clubInviteToken && (
            <div className="club-profile-setup">
              <div className="club-profile-setup-copy">
                <strong>Complete your Club Athlete profile</strong>
                <p>Add the name and photo you want displayed throughout TrackLab. This will not change or disconnect your studio records.</p>
              </div>
              <div className="club-profile-setup-form">
                <RiderPhotoEditor
                  name={completedAccountName(clubFullNameDraft, clubNicknameDraft) || 'Club athlete'}
                  photoUrl={clubPhotoDraft}
                  disabled={clubBusyId === 'claim'}
                  onPhotoChange={setClubPhotoDraft}
                />
                <div className="club-profile-fields">
                  <label>
                    <span>Full name</span>
                    <input
                      autoComplete="name"
                      disabled={clubBusyId === 'claim'}
                      maxLength={64}
                      onChange={(event) => setClubFullNameDraft(event.target.value)}
                      placeholder="First and last name"
                      value={clubFullNameDraft}
                    />
                  </label>
                  <label>
                    <span>Nickname <small>optional</small></span>
                    <input
                      disabled={clubBusyId === 'claim'}
                      maxLength={28}
                      onChange={(event) => setClubNicknameDraft(event.target.value)}
                      placeholder="The Machine"
                      value={clubNicknameDraft}
                    />
                  </label>
                  <p>Race display: <strong>{completedAccountName(clubFullNameDraft, clubNicknameDraft) || 'Enter your name'}</strong></p>
                </div>
              </div>
              <button className="club-profile-complete" type="button" disabled={clubBusyId === 'claim' || !clubFullNameDraft.trim()} onClick={acceptInvitation}>
                <UserPlus size={17} /> {clubBusyId === 'claim' ? 'Connecting…' : 'Complete profile and connect'}
              </button>
            </div>
          )}

          {clubState.memberships.map((membership) => (
            <div className="club-athlete-access" key={`${membership.clubId}:${membership.studioRiderId}`}>
              <ShieldCheck size={21} />
              <div>
                <strong>Connected to {membership.clubName}</strong>
                <p>
                  Studio rider: {membership.riderName}. Viewing and downloading your studio data is free. Choosing
                  “Training at {membership.clubName}” shares the saved session with the club and lets you use one
                  available bike seat from the club membership. The owner may optionally open Club Live Monitor to
                  view your program, live status, progress, track or destination, cadence, speed, and current live
                  watts. While you are actively sharing a Club Live session, the owner can also view a temporary,
                  read-only image of the visible TrackLab activity screen. Screen sharing does not capture your device
                  camera, microphone, taps, notifications, other apps, or content outside TrackLab. Frames expire and
                  are deleted when Club Live sharing ends. Watts stay out of public leaderboards, shared ghosts,
                  multiplayer displays, and shared exports; saved power history remains in your own rider record. Club
                  access ends when you leave club training.
                </p>
              </div>
              <span>Club Athlete</span>
            </div>
          ))}

          {clubState.canManageClub && visibleStudioRiders.length > 0 && (
            <div className="club-owner-roster">
              <div className="club-owner-intro">
                <div><strong>{clubState.ownedClub?.name ?? name}</strong><p>Invite each athlete privately. A claim grants only that rider's records—not the rest of your studio roster.</p></div>
                <small>Personal Wattbike pairing at home still requires Racer membership.</small>
              </div>
              <div className="club-roster-list">
                {visibleStudioRiders.map((rider) => {
                  const member = memberByRiderId.get(rider.id);
                  const inviteLink = inviteLinks[rider.id];
                  const claimed = member?.status === 'claimed';
                  return (
                    <article key={rider.id}>
                      <RiderAvatar name={rider.name} photoUrl={rider.photoUrl} />
                      <div className="club-roster-name"><strong>{rider.name}</strong><small>{claimed ? `Connected${member.athleteName ? ` to ${member.athleteName}` : ''}` : inviteLink ? 'Invitation ready' : 'Not claimed'}</small></div>
                      <div className="club-roster-actions">
                        {inviteLink && !claimed && <button type="button" onClick={() => copyInvitation(inviteLink)}><Copy size={15} /> Copy link</button>}
                        {!claimed && <button className="primary" type="button" disabled={clubBusyId === rider.id} onClick={() => inviteRider(rider)}><UserPlus size={15} /> {inviteLink ? 'New link' : 'Invite'}</button>}
                        {claimed && <button className="danger" type="button" disabled={clubBusyId === rider.id} onClick={() => disconnectRider(rider)}><X size={15} /> Remove access</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
          {(clubMessage || clubStatus === 'loading') && <p className={`club-connect-message ${clubStatus}`}>{clubMessage || 'Loading Club Connect…'}</p>}
        </section>
      )}

      <section className="account-profile-summary" aria-label="Monthly training totals">
        <article><Activity size={20} /><span><b>{history.totals.sessions}</b><small>Sessions this month</small></span></article>
        <article><Bike size={20} /><span><b>{history.totals.bmxRaces}</b><small>BMX races</small></span></article>
        <article><Timer size={20} /><span><b>{history.totals.straightSprints}</b><small>Straight sprints</small></span></article>
        <article><Activity size={20} /><span><b>{history.totals.monitorSprints}</b><small>Monitor sprints</small></span></article>
        <article><Activity size={20} /><span><b>{history.totals.getPulledTests}</b><small>Get Pulled tests</small></span></article>
        <article><Compass size={20} /><span><b>{formatProfileHistoryDistance(history.totals.distanceMeters, distanceUnit)}</b><small>Total distance</small></span></article>
      </section>

      <div className="account-training-layout">
        <section className="training-calendar" aria-label="Training calendar">
          <header>
            <div><CalendarDays size={20} /><span><strong>Training calendar</strong><small>Select a day to review every activity.</small></span></div>
            <div className="training-calendar-controls">
              <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
              <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
              <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
              <button type="button" aria-label="Refresh training history" onClick={refresh}><RefreshCw size={16} /></button>
            </div>
          </header>
          <div className="training-calendar-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="training-calendar-grid">
            {days.map((day, index) => {
              if (!day) return <span className="training-calendar-empty" key={`empty-${index}`} />;
              const key = localDateKey(day.getTime());
              const count = sessionsByDay.get(key)?.length ?? 0;
              return (
                <button
                  className={`${key === selectedDate ? 'selected' : ''}${count > 0 ? ' has-sessions' : ''}`}
                  type="button"
                  aria-pressed={key === selectedDate}
                  aria-label={`${day.toLocaleDateString()}, ${count} training sessions`}
                  onClick={() => setSelectedDate(key)}
                  key={key}
                >
                  <b>{day.getDate()}</b>
                  {count > 0 && <span>{count}</span>}
                </button>
              );
            })}
          </div>
          {status !== 'ready' || message ? <p className={`training-history-message ${status}`}>{message}</p> : null}
        </section>

        <TrainingResultsSpreadsheet
          sessions={selectedSessions}
          dateLabel={selectedDateLabel}
          speedUnit={speedUnit}
          distanceUnit={distanceUnit}
          privateHeartRateBySession={privateHeartRateBySession}
          onExportWorkbook={exportSelectedDay}
          onExportPrivateWorkbook={selectedPrivateHeartRateEntries.length > 0
            ? exportSelectedDayPrivate
            : undefined}
          privateExportDisabled={privateHeartRateExportPending}
          renderSessionDetail={renderTrainingSessionDetail}
        />
        {spreadsheetExportMessage && (
          <p className="training-spreadsheet-export-status" role="status">{spreadsheetExportMessage}</p>
        )}
      </div>
      <small className="account-history-sync-note">Calendar month: {monthKey(month)} · Live cloud sync is active. The standard Numbers / Excel workbook and generic JSON/CSV files remain non-health records. The separately labeled private workbook includes only your authorized Apple Watch summaries; club views stay summary-only and require rider consent.</small>
    </div>
  );
}
