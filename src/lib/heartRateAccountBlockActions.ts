import {
  claimHeartRatePairing,
  createHeartRateAccountBlock,
  recoverHeartRateAccountBlockHandoff,
  stopHeartRateAccountBlock,
  type HeartRateAccountBlockStatus,
} from './heartRateCloud';
import {
  connectHeartRateAccountBlock,
  heartRateAccountBlockHandoffHref,
  HeartRateAccountBlockConnectError,
} from './heartRateAccountBlock';
import type {
  NativeHeartRateRelaySnapshot,
  NativeHeartRateRelayState,
  NativeHeartRateStatus,
} from './nativeHeartRate';

export type HeartRateAccountBlockSecret = Readonly<{
  pairCode: string;
  pairingId: string | null;
  blockId: string | null;
  handoffHref: string | null;
}>;

export async function prepareHeartRateAccountBlockHandoff({
  currentHref,
  waitingBlock,
  requestId,
}: {
  currentHref: string;
  waitingBlock: HeartRateAccountBlockStatus | null;
  requestId: string;
}) {
  const recoverableBlock = (
    waitingBlock
    && waitingBlock.claimedAt == null
    && waitingBlock.stopRequestedAt == null
    && waitingBlock.state === 'waiting-watch'
    && waitingBlock.pairCodeExpiresAt > Date.now()
  ) ? waitingBlock : null;
  const recovered = recoverableBlock
    ? await recoverHeartRateAccountBlockHandoff(recoverableBlock.pairingId)
    : null;
  const created = recovered ? null : await createHeartRateAccountBlock(requestId);
  const block = recovered?.block ?? created!.block;
  const pairCode = recovered?.pairCode ?? created!.pairCode;
  const handoffHref = heartRateAccountBlockHandoffHref(currentHref, pairCode);
  if (!handoffHref) throw new Error('TrackLab could not create a private iPhone handoff.');
  return {
    block,
    secret: {
      pairCode,
      pairingId: block.pairingId,
      blockId: block.blockId,
      handoffHref,
    } satisfies HeartRateAccountBlockSecret,
  };
}

export async function connectHeartRateAccountBlockOnIPhone({
  accountId,
  secret,
  currentWorkout,
  baseUrl,
  startWorkout,
  resumeWorkout,
  endWorkout,
  configureRelay,
  clearRelay,
}: {
  accountId: string;
  secret: HeartRateAccountBlockSecret;
  currentWorkout: NativeHeartRateStatus | null;
  baseUrl: string;
  startWorkout: (sessionId: string) => Promise<NativeHeartRateStatus>;
  resumeWorkout: () => Promise<NativeHeartRateStatus>;
  endWorkout: () => Promise<NativeHeartRateStatus>;
  configureRelay: (configuration: Parameters<typeof connectHeartRateAccountBlock>[0]['configureRelay'] extends (
    configuration: infer Configuration
  ) => unknown ? Configuration : never) => Promise<NativeHeartRateRelayState>;
  clearRelay: (target: { sessionId: string }) => Promise<NativeHeartRateRelayState>;
}) {
  try {
    const nativeClient = await import('./nativeHeartRate').then(({ nativeHeartRate }) => nativeHeartRate);
    return await connectHeartRateAccountBlock({
      accountId,
      pairCode: secret.pairCode,
      expectedPairingId: secret.pairingId,
      expectedBlockId: secret.blockId,
      currentWorkout,
      baseUrl,
      claim: claimHeartRatePairing,
      startWorkout,
      resumeWorkout,
      getWorkoutState: nativeClient.getState,
      addWorkoutStatusListener: nativeClient.addStatusListener,
      configureRelay,
    });
  } catch (error) {
    const failed = error instanceof HeartRateAccountBlockConnectError ? error : null;
    if (failed?.relayConfigured && failed.blockId) {
      await clearRelay({ sessionId: failed.blockId }).catch(() => undefined);
    }
    if (failed?.workoutStarted) await endWorkout().catch(() => undefined);
    if (failed?.pairingId) {
      const stopped = await stopHeartRateAccountBlock(failed.pairingId).catch(() => null);
      if (stopped?.draining) {
        await stopHeartRateAccountBlock(failed.pairingId).catch(() => null);
      }
    }
    throw error;
  }
}

export async function copyHeartRateAccountBlockHandoff(handoffHref: string | null) {
  if (!handoffHref) throw new Error('TrackLab could not create a private iPhone handoff.');
  if (!navigator.clipboard?.writeText) {
    throw new Error('Copy is unavailable here. Use Share on this device instead.');
  }
  await navigator.clipboard.writeText(handoffHref);
}

export async function shareHeartRateAccountBlockHandoff(handoffHref: string | null) {
  if (!handoffHref || !navigator.share) {
    throw new Error('Share is unavailable here. Copy the private iPhone handoff instead.');
  }
  await navigator.share({
    title: 'TrackLab private Apple Watch handoff',
    text: 'Open this private handoff on the paired iPhone while signed in to the same TrackLab account.',
    url: handoffHref,
  });
}

export async function stopHeartRateAccountBlockAction({
  block,
  fallbackPairingId,
  fallbackBlockId,
  relayState,
  workoutStatus,
  observedRelay,
  endNativeWorkout,
  serverAlreadyRequested,
  endWorkout,
}: {
  block: HeartRateAccountBlockStatus | null;
  fallbackPairingId: string | null;
  fallbackBlockId: string | null;
  relayState: NativeHeartRateRelaySnapshot | null;
  workoutStatus: NativeHeartRateStatus | null;
  observedRelay: boolean;
  endNativeWorkout: boolean;
  serverAlreadyRequested: boolean;
  endWorkout: () => Promise<NativeHeartRateStatus>;
}) {
  const localRelay = relayState?.sessions.find((session) => (
    session.scope === 'account-block'
    && (!block || session.sessionId === block.blockId)
  )) ?? null;
  const pairingId = block?.pairingId ?? fallbackPairingId;
  const blockId = block?.blockId ?? localRelay?.sessionId ?? fallbackBlockId;
  if (!pairingId || !blockId) {
    throw new Error('TrackLab could not identify the private account block to stop. Refresh and retry.');
  }
  const workoutMatches = workoutStatus?.sessionId === `watch-account-block:${pairingId}`;
  const localRelayObserved = observedRelay || Boolean(localRelay);
  if (
    endNativeWorkout
    && workoutMatches
    && workoutStatus
    && !['idle', 'ended', 'unavailable'].includes(workoutStatus.state)
  ) {
    const ended = await endWorkout();
    if (ended.state === 'error' || ended.state === 'unavailable') {
      throw new Error(ended.message || 'Apple Watch could not end the account-owned workout.');
    }
  }
  const stopped = serverAlreadyRequested && block
    ? { block, draining: true }
    : await stopHeartRateAccountBlock(pairingId);
  return { ...stopped, pairingId, blockId, localRelayObserved };
}
