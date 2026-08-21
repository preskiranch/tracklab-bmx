import type { UseHeartRateResult } from '../hooks/useHeartRate';
import type { PlayerSlot } from '../types';
import type { ClubTrainingSelection } from './trainingHistory';
import {
  claimHeartRatePairing,
  createHeartRatePairing,
  revokeHeartRatePairing,
  type HeartRateActivityType,
} from './heartRateCloud';

type ValueRef<T> = { current: T };

export type PersonalHeartRateStartInput = Readonly<{
  sessionId: string;
  activityType: HeartRateActivityType;
  riderId: string | undefined;
  playerId: PlayerSlot['id'];
  startedAt: number;
  accountId: string | null;
  accountHydration: Readonly<{ accountId: string; promise: Promise<boolean> }> | null;
  accountBlockCoversSessions: boolean;
  accountBlockCoveredSessionIds: Set<string>;
  clubTrainingSelection: ClubTrainingSelection | null;
  studioConsent: Readonly<{ live: boolean; session: boolean }>;
  heartRate: Pick<UseHeartRateResult, 'availability' | 'status' | 'configureRelay' | 'clearRelay'>;
  activeSessionRef: ValueRef<string | null>;
  activePairingRef: ValueRef<string | null>;
  pairingIdsBySession: Map<string, string>;
  knownPairingIds: Set<string>;
  cancelledSessionIds: Set<string>;
  finalizedSessionIds: Set<string>;
  baseUrl: string;
  onMessage: (message: string) => void;
}>;

export async function startPersonalHeartRateSession(input: PersonalHeartRateStartInput) {
  const accountRiderId = input.accountId ? `account:${input.accountId}` : null;
  if (!input.accountId || !accountRiderId || input.riderId !== accountRiderId) return false;
  if (
    !input.accountHydration
    || input.accountHydration.accountId !== input.accountId
    || !(await input.accountHydration.promise)
  ) {
    input.onMessage('This session will continue without cloud heart rate because TrackLab could not verify the Apple Watch relay for this account.');
    return false;
  }
  if (input.accountBlockCoversSessions) {
    input.accountBlockCoveredSessionIds.add(input.sessionId);
    return true;
  }
  if (
    input.heartRate.availability?.supported !== true
    || (input.heartRate.status?.state !== 'active' && input.heartRate.status?.state !== 'paused')
  ) return false;
  if (input.activeSessionRef.current === input.sessionId) return true;
  if (input.activeSessionRef.current != null) {
    input.onMessage('Finish or cancel the current TrackLab heart-rate session before starting another.');
    return false;
  }

  let pairingId: string | null = null;
  try {
    const { pairing, pairCode } = await createHeartRatePairing({
      sessionId: input.sessionId,
      activityType: input.activityType,
      riderId: accountRiderId,
      playerId: input.playerId,
      ...(input.clubTrainingSelection ? {
        clubSession: input.clubTrainingSelection,
        liveStudioConsent: input.studioConsent.live,
        sessionStudioConsent: input.studioConsent.session,
      } : {}),
    });
    pairingId = pairing.id;
    input.pairingIdsBySession.set(input.sessionId, pairing.id);
    input.knownPairingIds.add(pairing.id);
    if (input.cancelledSessionIds.has(input.sessionId)) {
      throw new Error('This TrackLab heart-rate session was cancelled.');
    }
    const claim = await claimHeartRatePairing(pairCode);
    if (input.cancelledSessionIds.has(input.sessionId)) {
      throw new Error('This TrackLab heart-rate session was cancelled.');
    }
    const relay = await input.heartRate.configureRelay({
      baseUrl: input.baseUrl,
      ingestToken: claim.ingestToken,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
    });
    if (!relay.configured) throw new Error(relay.reason || 'The native heart-rate relay could not start.');
    if (input.cancelledSessionIds.has(input.sessionId)) {
      await input.heartRate.clearRelay({ sessionId: input.sessionId }).catch(() => undefined);
      throw new Error('This TrackLab heart-rate session was cancelled.');
    }
    input.activeSessionRef.current = input.sessionId;
    input.activePairingRef.current = pairing.id;
    input.finalizedSessionIds.delete(input.sessionId);
    input.onMessage('Heart rate is recording privately with this TrackLab session.');
    return true;
  } catch (error) {
    if (pairingId) await revokeHeartRatePairing(pairingId).catch(() => undefined);
    input.pairingIdsBySession.delete(input.sessionId);
    if (pairingId) input.knownPairingIds.delete(pairingId);
    if (!input.cancelledSessionIds.has(input.sessionId)) {
      input.onMessage(`The session will continue without cloud heart rate. ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

export type PersonalHeartRateFinalizeInput = Readonly<{
  sessionId: string;
  endedAt: number;
  activeDurationMs: number;
  zones?: Array<{
    zoneId: string;
    zoneName?: string;
    startElapsedMs: number;
    endElapsedMs: number;
  }>;
  pendingStart: Promise<boolean> | null;
  heartRate: Pick<UseHeartRateResult, 'finalizeRelay'>;
  activeSessionRef: ValueRef<string | null>;
  activePairingRef: ValueRef<string | null>;
  pairingIdsBySession: Map<string, string>;
  cancelledSessionIds: Set<string>;
  finalizedSessionIds: Set<string>;
  onStudioConsentReset: () => void;
  onMessage: (message: string) => void;
}>;

export async function finalizePersonalHeartRateSession(input: PersonalHeartRateFinalizeInput) {
  if (input.pendingStart) await input.pendingStart.catch(() => false);
  if (
    input.activeSessionRef.current !== input.sessionId
    || input.cancelledSessionIds.has(input.sessionId)
    || input.finalizedSessionIds.has(input.sessionId)
  ) return 'not-recording' as const;
  input.finalizedSessionIds.add(input.sessionId);
  try {
    const relay = await input.heartRate.finalizeRelay({
      sessionId: input.sessionId,
      endedAt: input.endedAt,
      activeDurationMs: input.activeDurationMs,
      zones: input.zones,
    });
    if (!relay.configured) throw new Error(relay.reason || 'The native heart-rate relay could not queue this session.');
    input.activeSessionRef.current = null;
    input.activePairingRef.current = null;
    input.pairingIdsBySession.delete(input.sessionId);
    input.onStudioConsentReset();
    input.onMessage('Heart rate captured and queued for private TrackLab Cloud sync.');
    return 'queued' as const;
  } catch (error) {
    input.finalizedSessionIds.delete(input.sessionId);
    input.onMessage(`Heart rate is waiting to sync. ${error instanceof Error ? error.message : String(error)}`);
    return 'waiting' as const;
  }
}

export async function clearPersonalHeartRateSession(input: Readonly<{
  sessionId: string;
  pendingStart: Promise<boolean> | null;
  heartRate: Pick<UseHeartRateResult, 'clearRelay'>;
  activeSessionRef: ValueRef<string | null>;
  activePairingRef: ValueRef<string | null>;
  pairingIdsBySession: Map<string, string>;
  knownPairingIds: Set<string>;
  cancelledSessionIds: Set<string>;
  finalizedSessionIds: Set<string>;
  onStudioConsentReset: () => void;
}>) {
  if (input.pendingStart) await input.pendingStart.catch(() => false);
  const pairingId = input.pairingIdsBySession.get(input.sessionId)
    ?? (input.activeSessionRef.current === input.sessionId ? input.activePairingRef.current : null);
  await input.heartRate.clearRelay({ sessionId: input.sessionId }).catch(() => undefined);
  if (pairingId) {
    await revokeHeartRatePairing(pairingId).catch(() => undefined);
    input.knownPairingIds.delete(pairingId);
  }
  input.pairingIdsBySession.delete(input.sessionId);
  if (input.activeSessionRef.current === input.sessionId) {
    input.activeSessionRef.current = null;
    input.activePairingRef.current = null;
  }
  input.finalizedSessionIds.delete(input.sessionId);
  input.cancelledSessionIds.delete(input.sessionId);
  input.onStudioConsentReset();
}
