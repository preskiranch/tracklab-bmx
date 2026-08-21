import type { HeartRatePairing } from './heartRateCloud';
import type {
  NativeHeartRateRelayScope,
  NativeHeartRateRelaySnapshot,
  NativeHeartRateRelaySessionState,
} from './nativeHeartRate';

export type HeartRateRelayAccountReconciliation = Readonly<{
  activePairing: HeartRatePairing | null;
  activeSessionId: string | null;
  pairingIdsBySession: readonly (readonly [sessionId: string, pairingId: string])[];
  knownPairingIds: readonly string[];
  orphanActiveSessionIds: readonly string[];
  foreignQueuedSessionCount: number;
}>;

function nativeScopeForPairing(pairing: HeartRatePairing): NativeHeartRateRelayScope {
  if (pairing.relayScope === 'studio-block') return 'studio-block';
  if (pairing.relayScope === 'account-block') return 'account-block';
  return 'personal-session';
}

function pairingMatchesNativeSession(
  pairing: HeartRatePairing,
  session: NativeHeartRateRelaySessionState,
) {
  return pairing.sessionId === session.sessionId
    && nativeScopeForPairing(pairing) === session.scope;
}

/**
 * Rebuilds only the account-owned JS pointers that are safe to associate with
 * the native credential queue. The queue itself remains native and durable.
 */
export function reconcileHeartRateRelayAccount({
  accountId,
  pairings,
  relayState,
  now = Date.now(),
}: {
  accountId: string;
  pairings: readonly HeartRatePairing[];
  relayState: NativeHeartRateRelaySnapshot | null;
  now?: number;
}): HeartRateRelayAccountReconciliation {
  const riderId = `account:${accountId}`;
  const ownedPairings = pairings.filter((pairing) => (
    pairing.riderId === riderId && pairing.revokedAt == null
  ));
  const validPairings = ownedPairings
    .filter((pairing) => (
      pairing.claimedAt != null
      && pairing.expiresAt > now
      && pairing.studioBlockStoppedAt == null
    ))
    .sort((left, right) => (
      right.expiresAt - left.expiresAt
      || (right.claimedAt ?? 0) - (left.claimedAt ?? 0)
      || right.id.localeCompare(left.id)
    ));
  const validPairingBySession = new Map<string, HeartRatePairing>();
  validPairings.forEach((pairing) => {
    if (!validPairingBySession.has(pairing.sessionId)) {
      validPairingBySession.set(pairing.sessionId, pairing);
    }
  });

  const nativeSessions = relayState?.sessions ?? [];
  const activeNativeSessions = nativeSessions.filter((session) => !session.finalized);
  const matchedActiveSessions = activeNativeSessions.filter((session) => {
    const pairing = validPairingBySession.get(session.sessionId);
    return pairing ? pairingMatchesNativeSession(pairing, session) : false;
  });
  const preferredActiveSession = matchedActiveSessions.find((session) => (
    session.sessionId === relayState?.sessionId
  )) ?? matchedActiveSessions.find((session) => session.state === 'active')
    ?? matchedActiveSessions[0]
    ?? null;
  const activePairing = preferredActiveSession
    ? validPairingBySession.get(preferredActiveSession.sessionId) ?? null
    : null;

  return {
    activePairing,
    activeSessionId: preferredActiveSession?.sessionId ?? null,
    pairingIdsBySession: [...validPairingBySession].map(([sessionId, pairing]) => (
      [sessionId, pairing.id] as const
    )),
    knownPairingIds: [...new Set(ownedPairings.map((pairing) => pairing.id))],
    orphanActiveSessionIds: activeNativeSessions
      .filter((session) => !validPairings.some((pairing) => pairingMatchesNativeSession(pairing, session)))
      .map((session) => session.sessionId),
    // A finalized queue carries its own account-bound ingest credential and can
    // safely finish uploading. It must not be re-labelled as the new account.
    foreignQueuedSessionCount: nativeSessions.filter((session) => (
      session.finalized
      && !ownedPairings.some((pairing) => pairingMatchesNativeSession(pairing, session))
    )).length,
  };
}
