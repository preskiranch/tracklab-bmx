import type { PlayerSlot } from '../types';
import type { OwnedClub } from './clubConnect';
import type { ClubOwnerTrainingCoordinatorEntry } from './clubOwnerTrainingCoordinator';
import {
  createHeartRateStudioInvitation,
  revokeHeartRateStudioInvitation,
  stopHeartRateStudioBlock,
  type HeartRateStudioBlockStatus,
  type HeartRateStudioInvitation,
} from './heartRateCloud';

type StudioHeartRateAnchor = Readonly<{
  sessionId: string;
  activityType: 'monitor-sprint' | 'bmx-race' | 'straight-sprint' | 'get-pulled' | 'explore';
}>;

type StudioHeartRateOwnerAction = Readonly<{ phase: 'inviting' | 'error'; detail?: string }>;
type StudioHeartRateInvitationSecret = Readonly<{
  invitationId: string;
  inviteCode: string;
  claimUrl: string;
}>;
type UpdateActions = (
  updater: (current: Record<string, StudioHeartRateOwnerAction>) => Record<string, StudioHeartRateOwnerAction>,
) => void;
type UpdateInvitations = (
  updater: (current: HeartRateStudioInvitation[]) => HeartRateStudioInvitation[],
) => void;
type UpdateBlocks = (
  updater: (current: HeartRateStudioBlockStatus[]) => HeartRateStudioBlockStatus[],
) => void;

export type StudioHeartRateAnchorContext = Readonly<{
  appMode: string;
  monitorSessionId?: string;
  group: ClubOwnerTrainingCoordinatorEntry | null;
  preparation: Readonly<{
    phase: string;
    sessionId: string | null;
    failureStage?: string;
  }>;
}>;

export function resolveStudioHeartRateAnchor(
  player: PlayerSlot,
  context: StudioHeartRateAnchorContext,
): StudioHeartRateAnchor | null {
  if (context.appMode === 'monitor' && context.monitorSessionId) {
    return { sessionId: context.monitorSessionId, activityType: 'monitor-sprint' };
  }
  const prepared = context.preparation.phase !== 'idle'
    && context.preparation.phase !== 'authorizing'
    && context.preparation.failureStage !== 'prepare';
  const group = context.group;
  return prepared
    && group
    && group.request.sessionId === context.preparation.sessionId
    && group.riders.some((rider) => rider.playerId === player.id
      && rider.studioRiderId === player.riderId
      && rider.bikeDeviceId === player.deviceId)
    ? { sessionId: group.request.sessionId, activityType: group.request.activityType }
    : null;
}

export function activeOwnerStudioHeartRateInvitation(
  invitations: readonly HeartRateStudioInvitation[],
  clubId: string,
  studioRiderId: string,
  now = Date.now(),
) {
  return invitations
    .filter((invitation) => invitation.clubId === clubId
      && invitation.studioRiderId === studioRiderId
      && invitation.relayScope === 'studio-block'
      && invitation.revokedAt == null
      && invitation.claimedAt == null
      && invitation.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

export function activeOwnerStudioHeartRateBlock(
  blocks: readonly HeartRateStudioBlockStatus[],
  clubId: string,
  studioRiderId: string,
) {
  return blocks
    .filter((block) => block.clubId === clubId
      && block.studioRiderId === studioRiderId
      && block.relayScope === 'studio-block'
      && !['ended', 'expired', 'stopped'].includes(block.state))
    .sort((left, right) => (
      (right.blockExpiresAt ?? right.pairCodeExpiresAt ?? right.invitationExpiresAt)
      - (left.blockExpiresAt ?? left.pairCodeExpiresAt ?? left.invitationExpiresAt)
    ))[0] ?? null;
}

function setOwnerAction(updateActions: UpdateActions, studioRiderId: string, state: StudioHeartRateOwnerAction | null) {
  updateActions((current) => {
    const next = { ...current };
    if (state) next[studioRiderId] = state;
    else delete next[studioRiderId];
    return next;
  });
}

export async function copyOwnerStudioHeartRateInvitation(input: Readonly<{
  studioRiderId: string;
  invitationSecrets: ReadonlyMap<string, StudioHeartRateInvitationSecret>;
  updateActions: UpdateActions;
}>) {
  const secret = input.invitationSecrets.get(input.studioRiderId);
  if (!secret || !navigator.clipboard?.writeText) {
    setOwnerAction(input.updateActions, input.studioRiderId, {
      phase: 'error',
      detail: 'This one-use link is no longer held on this iPad. Cancel setup and create a new invitation.',
    });
    return false;
  }
  try {
    await navigator.clipboard.writeText(secret.claimUrl);
    setOwnerAction(input.updateActions, input.studioRiderId, null);
    return true;
  } catch {
    setOwnerAction(input.updateActions, input.studioRiderId, {
      phase: 'error',
      detail: 'The iPhone invitation could not be copied. Retry or share it.',
    });
    return false;
  }
}

export async function shareOwnerStudioHeartRateInvitation(input: Readonly<{
  studioRiderId: string;
  invitationSecrets: ReadonlyMap<string, StudioHeartRateInvitationSecret>;
  updateActions: UpdateActions;
}>) {
  const secret = input.invitationSecrets.get(input.studioRiderId);
  if (!secret) {
    setOwnerAction(input.updateActions, input.studioRiderId, {
      phase: 'error',
      detail: 'This one-use link is no longer held on this iPad. Cancel setup and create a new invitation.',
    });
    return false;
  }
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'TrackLab Apple Watch studio invitation',
        text: 'Open this private TrackLab invitation on the athlete’s paired iPhone.',
        url: secret.claimUrl,
      });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(secret.claimUrl);
    } else {
      throw new Error('Sharing is unavailable on this device.');
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    setOwnerAction(input.updateActions, input.studioRiderId, {
      phase: 'error',
      detail: error instanceof Error ? error.message : 'The iPhone invitation could not be shared.',
    });
    return false;
  }
}

export async function stopOwnerStudioHeartRateSharing(input: Readonly<{
  clubId: string;
  studioRiderId: string;
  invitations: readonly HeartRateStudioInvitation[];
  blocks: readonly HeartRateStudioBlockStatus[];
  busyRiderIds: Set<string>;
  stoppedInvitationIds: Set<string>;
  invitationSecrets: Map<string, StudioHeartRateInvitationSecret>;
  updateActions: UpdateActions;
  updateInvitations: UpdateInvitations;
  updateBlocks: UpdateBlocks;
}>) {
  const invitation = activeOwnerStudioHeartRateInvitation(
    input.invitations,
    input.clubId,
    input.studioRiderId,
  );
  const block = activeOwnerStudioHeartRateBlock(input.blocks, input.clubId, input.studioRiderId);
  if ((!invitation && !block) || input.busyRiderIds.has(input.studioRiderId)) return;
  input.busyRiderIds.add(input.studioRiderId);
  const stopSharing = Boolean(block && block.state !== 'waiting-athlete');
  setOwnerAction(input.updateActions, input.studioRiderId, {
    phase: 'inviting',
    detail: stopSharing
      ? 'Removing this studio’s live and saved-summary access…'
      : 'Cancelling this unused Apple Watch invitation…',
  });
  try {
    if (stopSharing && block) {
      const stopped = await stopHeartRateStudioBlock(block.invitationId);
      input.stoppedInvitationIds.add(stopped.invitationId);
      input.updateBlocks((current) => [
        stopped,
        ...current.filter((candidate) => candidate.invitationId !== stopped.invitationId),
      ]);
    } else if (invitation) {
      await revokeHeartRateStudioInvitation(invitation.id);
      input.stoppedInvitationIds.add(invitation.id);
      input.updateBlocks((current) => current.filter((candidate) => candidate.invitationId !== invitation.id));
    }
    input.invitationSecrets.delete(input.studioRiderId);
    const invitationId = block?.invitationId ?? invitation?.id;
    if (invitationId) {
      input.updateInvitations((current) => current.filter((candidate) => candidate.id !== invitationId));
    }
    setOwnerAction(input.updateActions, input.studioRiderId, null);
  } catch (error) {
    setOwnerAction(input.updateActions, input.studioRiderId, {
      phase: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    input.busyRiderIds.delete(input.studioRiderId);
  }
}

export function retryOwnerStudioHeartRateInvitation(input: Readonly<{
  clubId: string;
  player: PlayerSlot;
  invitations: readonly HeartRateStudioInvitation[];
  blocks: readonly HeartRateStudioBlockStatus[];
  updateActions: UpdateActions;
  onCreate: (player: PlayerSlot) => void;
}>) {
  const studioRiderId = input.player.riderId;
  if (!studioRiderId) return;
  const invitation = activeOwnerStudioHeartRateInvitation(input.invitations, input.clubId, studioRiderId);
  const block = activeOwnerStudioHeartRateBlock(input.blocks, input.clubId, studioRiderId);
  setOwnerAction(input.updateActions, studioRiderId, null);
  if (!invitation && !block) input.onCreate(input.player);
}

export async function createOwnerStudioHeartRateInvitation(input: Readonly<{
  club: OwnedClub;
  player: PlayerSlot;
  anchor?: StudioHeartRateAnchor | null;
  anchorContext?: StudioHeartRateAnchorContext;
  blocks: readonly HeartRateStudioBlockStatus[];
  invitations: readonly HeartRateStudioInvitation[];
  busyRiderIds: Set<string>;
  currentHref: string;
  buildFallbackClaimUrl: (currentHref: string, inviteCode: string) => string;
  invitationSecrets: Map<string, StudioHeartRateInvitationSecret>;
  updateActions: (
    updater: (current: Record<string, StudioHeartRateOwnerAction>) => Record<string, StudioHeartRateOwnerAction>,
  ) => void;
  updateInvitations: (
    updater: (current: HeartRateStudioInvitation[]) => HeartRateStudioInvitation[],
  ) => void;
}>) {
  const studioRiderId = input.player.riderId;
  if (!studioRiderId) return;
  const setAction = (state: StudioHeartRateOwnerAction | null) => input.updateActions((current) => {
    const next = { ...current };
    if (state) next[studioRiderId] = state;
    else delete next[studioRiderId];
    return next;
  });
  const member = input.club.members.find((candidate) => candidate.studioRiderId === studioRiderId);
  const anchor = input.anchor ?? (input.anchorContext
    ? resolveStudioHeartRateAnchor(input.player, input.anchorContext)
    : null);
  if (member?.status !== 'claimed' || !anchor) {
    setAction({
      phase: 'error',
      detail: member?.status !== 'claimed'
        ? 'This athlete must claim their TrackLab account before Apple Watch can connect.'
        : 'Wait for the secure studio training reservation to finish, then retry.',
    });
    return;
  }
  const now = Date.now();
  const existingInvitation = input.invitations.some((candidate) => (
    candidate.clubId === input.club.id
    && candidate.studioRiderId === studioRiderId
    && candidate.relayScope === 'studio-block'
    && candidate.claimedAt == null
    && candidate.revokedAt == null
    && candidate.expiresAt > now
  ));
  const existingBlock = input.blocks.some((candidate) => (
    candidate.clubId === input.club.id
    && candidate.studioRiderId === studioRiderId
    && candidate.relayScope === 'studio-block'
    && !['ended', 'expired', 'stopped'].includes(candidate.state)
  ));
  if (existingInvitation || existingBlock || input.busyRiderIds.has(studioRiderId)) return;
  input.busyRiderIds.add(studioRiderId);
  setAction({ phase: 'inviting' });
  try {
    const handoff = await createHeartRateStudioInvitation({
      sessionId: anchor.sessionId,
      activityType: anchor.activityType,
      relayScope: 'studio-block',
      studioRiderId,
      playerId: input.player.id,
    });
    const secret = {
      invitationId: handoff.invitation.id,
      inviteCode: handoff.inviteCode,
      claimUrl: handoff.claimUrl
        ?? input.buildFallbackClaimUrl(input.currentHref, handoff.inviteCode),
    };
    input.invitationSecrets.set(studioRiderId, secret);
    input.updateInvitations((current) => [
      handoff.invitation,
      ...current.filter((invitation) => invitation.id !== handoff.invitation.id),
    ]);
    setAction(null);
  } catch (error) {
    setAction({
      phase: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    input.busyRiderIds.delete(studioRiderId);
  }
}
