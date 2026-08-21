import type { PlayerSlot } from '../types';
import type { StudioHeartRateAnchorContext } from '../lib/studioHeartRateOwnerActions';
import { resolveStudioHeartRateAnchor } from '../lib/studioHeartRateOwnerActions';
import type { HeartRateStudioBlockStatus, HeartRateStudioInvitation } from '../lib/heartRateCloud';
import { StudioHeartRateBlockCard, type StudioHeartRateBlockState } from './StudioHeartRateBlockCard';

type StudioHeartRateOverlayAction = Readonly<{
  phase: 'inviting' | 'error';
  detail?: string;
}>;

export type StudioHeartRateBlockOverlayProps = Readonly<{
  player: PlayerSlot;
  action: StudioHeartRateOverlayAction | null;
  clubId: string;
  blocks: readonly HeartRateStudioBlockStatus[];
  invitations: readonly HeartRateStudioInvitation[];
  now: number;
  anchorContext: StudioHeartRateAnchorContext;
  invitationSecretAvailable: boolean;
  onClose: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onCreate: () => void;
  onRetry: () => void;
  onShare: () => void;
}>;

export function StudioHeartRateBlockOverlay({
  player,
  action,
  clubId,
  blocks,
  invitations,
  now,
  anchorContext,
  invitationSecretAvailable,
  onClose,
  onCancel,
  onCopy,
  onCreate,
  onRetry,
  onShare,
}: StudioHeartRateBlockOverlayProps) {
  const blockState = blocks
    .filter((block) => block.clubId === clubId
      && block.studioRiderId === player.riderId
      && !['ended', 'expired', 'stopped'].includes(block.state))
    .sort((left, right) => (
      (right.blockExpiresAt ?? right.pairCodeExpiresAt ?? right.invitationExpiresAt)
      - (left.blockExpiresAt ?? left.pairCodeExpiresAt ?? left.invitationExpiresAt)
    ))[0]?.state ?? null;
  const invitationActive = invitations.some((invitation) => invitation.clubId === clubId
    && invitation.studioRiderId === player.riderId
    && invitation.claimedAt == null
    && invitation.revokedAt == null
    && invitation.expiresAt > now);
  const reservationReady = Boolean(resolveStudioHeartRateAnchor(player, anchorContext));
  const state: StudioHeartRateBlockState = action
    ?? (blockState === 'watch-ready'
      ? {
        phase: 'watch-ready',
        detail: 'A fresh Apple Watch sample reached TrackLab. Supported studio modes now use only their exact authorized training windows.',
      }
      : blockState === 'waiting-watch'
        ? {
          phase: 'waiting-watch',
          detail: 'The athlete accepted. Start the TrackLab workout on their paired iPhone and Apple Watch to finish connecting.',
        }
        : blockState === 'waiting-athlete' || invitationActive
          ? {
            phase: 'waiting-athlete',
            detail: invitationSecretAvailable
              ? 'Send this private invitation to the athlete’s paired iPhone. It expires if they do not accept it in time.'
              : 'An invitation is active, but its one-use link is no longer held on this iPad. Cancel setup to create a replacement.',
          }
          : {
            phase: 'disconnected',
            detail: reservationReady
              ? 'Connect once for this training block; each supported studio session will use only its exact active window.'
              : 'TrackLab is securing this rider and Wattbike. Connect becomes available when the pre-pedal reservation is ready.',
          });
  const cancellable = invitationActive || blockState != null;

  return (
    <div
      className="studio-heart-rate-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <div
        aria-label={`${player.name} Apple Watch studio setup`}
        aria-modal="true"
        className="studio-heart-rate-overlay-dialog"
        role="dialog"
      >
        <button
          aria-label="Close Apple Watch studio setup"
          className="studio-heart-rate-overlay-close"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
        <StudioHeartRateBlockCard
          bikeLabel={player.deviceLabel}
          disabled={action?.phase === 'inviting' || (state.phase === 'disconnected' && !reservationReady)}
          onCancel={cancellable ? onCancel : undefined}
          onCopyInvitation={invitationSecretAvailable ? onCopy : undefined}
          onCreateInvitation={state.phase === 'disconnected' ? onCreate : undefined}
          onRetry={state.phase === 'error' ? onRetry : undefined}
          onShareInvitation={invitationSecretAvailable ? onShare : undefined}
          riderName={player.name}
          state={state}
        />
      </div>
    </div>
  );
}

export default StudioHeartRateBlockOverlay;
