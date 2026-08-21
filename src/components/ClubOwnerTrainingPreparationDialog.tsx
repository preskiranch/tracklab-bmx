import { AlertTriangle, Check, HeartPulse, LoaderCircle, Play, ShieldCheck, X } from 'lucide-react';
import type { PlayerSlot } from '../types';
import type { HeartRateStudioBlockStatus, HeartRateStudioInvitation } from '../lib/heartRateCloud';
import type { StudioHeartRateBlockPhase } from './StudioHeartRateBlockCard';
import './ClubOwnerTrainingPreparationDialog.css';

export type ClubOwnerTrainingPreparationPhase = 'authorizing' | 'ready' | 'activating' | 'error';

export type ClubOwnerTrainingPreparationRider = Readonly<{
  playerId: PlayerSlot['id'];
  riderName: string;
  bikeLabel?: string;
  heartRatePhase: StudioHeartRateBlockPhase;
  watchConnectLabel?: string;
}>;

export type ClubOwnerTrainingPreparationDialogProps = Readonly<{
  activityLabel: string;
  phase: ClubOwnerTrainingPreparationPhase;
  detail: string;
  playerIds?: readonly PlayerSlot['id'][];
  players?: readonly PlayerSlot[];
  clubId?: string;
  heartRateActionsByRider?: Readonly<Record<string, Readonly<{ phase: 'inviting' | 'error' }>>>;
  heartRateBlocks?: readonly HeartRateStudioBlockStatus[];
  heartRateInvitations?: readonly HeartRateStudioInvitation[];
  now?: number;
  riders?: readonly ClubOwnerTrainingPreparationRider[];
  watchConnectMode?: boolean;
  watchConnectStatusByRider?: Readonly<Record<string, string>>;
  onHeartRateOpen: (playerId: PlayerSlot['id']) => void;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  retryLabel?: string;
}>;

const heartRateLabels: Record<StudioHeartRateBlockPhase, string> = {
  disconnected: 'Optional',
  inviting: 'Creating invite',
  'waiting-athlete': 'Waiting for athlete',
  'waiting-watch': 'Waiting for Watch',
  'watch-ready': 'Watch ready',
  error: 'Needs attention',
};

export function ClubOwnerTrainingPreparationDialog({
  activityLabel,
  phase,
  detail,
  playerIds = [],
  players = [],
  clubId,
  heartRateActionsByRider = {},
  heartRateBlocks = [],
  heartRateInvitations = [],
  now = Date.now(),
  riders: suppliedRiders,
  watchConnectMode = false,
  watchConnectStatusByRider = {},
  onHeartRateOpen,
  onStart,
  onCancel,
  onRetry,
  retryLabel = 'Retry preparation',
}: ClubOwnerTrainingPreparationDialogProps) {
  const riders = suppliedRiders ?? playerIds.flatMap((playerId) => {
    const player = players.find((candidate) => candidate.id === playerId);
    if (!player?.riderId || !clubId) return [];
    const action = heartRateActionsByRider[player.riderId];
    const block = heartRateBlocks
      .filter((candidate) => candidate.clubId === clubId
        && candidate.studioRiderId === player.riderId
        && !['ended', 'expired', 'stopped'].includes(candidate.state))
      .sort((left, right) => (
        (right.blockExpiresAt ?? right.pairCodeExpiresAt ?? right.invitationExpiresAt)
        - (left.blockExpiresAt ?? left.pairCodeExpiresAt ?? left.invitationExpiresAt)
      ))[0];
    const invitation = heartRateInvitations.some((candidate) => candidate.clubId === clubId
      && candidate.studioRiderId === player.riderId
      && candidate.claimedAt == null
      && candidate.revokedAt == null
      && candidate.expiresAt > now);
    const heartRatePhase: StudioHeartRateBlockPhase = action?.phase
      ?? (block?.state === 'watch-ready'
        ? 'watch-ready'
        : block?.state === 'waiting-watch'
          ? 'waiting-watch'
          : block?.state === 'waiting-athlete' || invitation
            ? 'waiting-athlete'
            : 'disconnected');
    return [{
      playerId,
      riderName: player.name,
      ...(player.deviceLabel ? { bikeLabel: player.deviceLabel } : {}),
      heartRatePhase,
      ...(watchConnectStatusByRider[player.riderId]
        ? { watchConnectLabel: watchConnectStatusByRider[player.riderId] }
        : {}),
    }];
  });
  const ready = phase === 'ready';
  const allWatchesReady = riders.length > 0 && riders.every((rider) => (
    watchConnectMode
      ? rider.watchConnectLabel?.startsWith('Connected ·')
      : rider.heartRatePhase === 'watch-ready'
  ));
  const PhaseIcon = phase === 'error' ? AlertTriangle : ready ? Check : LoaderCircle;
  return (
    <div className="club-training-prep-backdrop" role="presentation">
      <section
        aria-busy={phase === 'authorizing' || phase === 'activating' || undefined}
        aria-describedby="club-training-prep-detail"
        aria-label={`${activityLabel} club athlete preparation`}
        aria-modal="true"
        className="club-training-prep-dialog"
        role="dialog"
      >
        <header>
          <span className="club-training-prep-icon"><ShieldCheck aria-hidden="true" size={22} /></span>
          <div>
            <small>Secure club athlete history</small>
            <h2>{activityLabel} preparation</h2>
          </div>
          <span className={`club-training-prep-status ${phase}`}>
            <PhaseIcon aria-hidden="true" className={phase === 'authorizing' || phase === 'activating' ? 'spin' : undefined} size={15} />
            {phase === 'authorizing' ? 'Reserving riders' : phase === 'activating' ? 'Starting' : phase === 'error' ? 'Needs attention' : 'Riders locked'}
          </span>
        </header>

        <p id="club-training-prep-detail" role={phase === 'error' ? 'alert' : 'status'}>{detail}</p>

        {riders.length > 0 && (
          <ul aria-label="Reserved club riders">
            {riders.map((rider) => (
              <li key={rider.playerId}>
                <span><strong>{rider.riderName}</strong><small>{rider.bikeLabel ?? `Player ${rider.playerId}`}</small></span>
                {watchConnectMode ? (
                  <span className="club-training-prep-status">
                    <HeartPulse aria-hidden="true" size={15} />
                    {rider.watchConnectLabel ?? 'Set up on paired iPhone'}
                  </span>
                ) : (
                  <button
                    disabled={!ready}
                    onClick={() => onHeartRateOpen(rider.playerId)}
                    type="button"
                  >
                    <HeartPulse aria-hidden="true" size={15} /> {heartRateLabels[rider.heartRatePhase]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {ready && (
          <p className="club-training-prep-watch-note">
            {watchConnectMode
              ? 'Apple Watch is optional. Athletes use Watch Connect once on their paired iPhone; the four-hour connection follows them across bikes and programs.'
              : 'Apple Watch is optional. Connect an athlete now, wait for “Watch ready,” or explicitly continue without Watch. Their race metrics still save either way.'}
          </p>
        )}

        <div className="club-training-prep-actions">
          {phase === 'error' ? (
            <button className="primary" onClick={onRetry} type="button">{retryLabel}</button>
          ) : (
            <button className="primary" disabled={!ready} onClick={onStart} type="button">
              <Play aria-hidden="true" size={16} /> {allWatchesReady ? `Start ${activityLabel}` : 'Continue without Apple Watch'}
            </button>
          )}
          <button onClick={onCancel} type="button"><X aria-hidden="true" size={16} /> Cancel preparation</button>
        </div>
      </section>
    </div>
  );
}

export default ClubOwnerTrainingPreparationDialog;
