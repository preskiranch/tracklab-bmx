import { describe, expect, it } from 'vitest';
import type { HeartRatePairing } from '../../src/lib/heartRateCloud';
import type { NativeHeartRateRelaySnapshot } from '../../src/lib/nativeHeartRate';
import { reconcileHeartRateRelayAccount } from '../../src/lib/heartRateRelayRecovery';

function pairing(overrides: Partial<HeartRatePairing> = {}): HeartRatePairing {
  return {
    id: 'pair-1',
    sessionId: 'session-1',
    activityType: 'explore',
    relayScope: 'session',
    riderId: 'account:rider-1',
    playerId: 1,
    clubId: null,
    studioRiderId: null,
    claimedAt: 1_000,
    expiresAt: 100_000,
    liveStudioConsent: false,
    sessionStudioConsent: false,
    revokedAt: null,
    ...overrides,
  };
}

function relayState(overrides: Partial<NativeHeartRateRelaySnapshot> = {}): NativeHeartRateRelaySnapshot {
  return {
    version: 5,
    configured: true,
    syncing: false,
    clearing: false,
    queuedSessionIds: [],
    queuedCount: 0,
    pendingSampleCount: 1,
    droppedSampleCount: 0,
    sessionId: 'session-1',
    scope: 'personal-session',
    sessions: [{
      sessionId: 'session-1',
      scope: 'personal-session',
      state: 'active',
      finalized: false,
      pendingSampleCount: 1,
      droppedSampleCount: 0,
      streamCreated: true,
    }],
    ...overrides,
  };
}

describe('heart-rate relay account recovery', () => {
  it('hydrates the exact current-account pairing, active session, and consent', () => {
    const current = pairing({ liveStudioConsent: true, sessionStudioConsent: true });
    const result = reconcileHeartRateRelayAccount({
      accountId: 'rider-1',
      pairings: [current, pairing({ id: 'foreign', riderId: 'account:rider-2' })],
      relayState: relayState(),
      now: 20_000,
    });

    expect(result.activeSessionId).toBe('session-1');
    expect(result.activePairing).toBe(current);
    expect(result.pairingIdsBySession).toContainEqual(['session-1', 'pair-1']);
    expect(result.knownPairingIds).toEqual(['pair-1']);
    expect(result.orphanActiveSessionIds).toEqual([]);
  });

  it('recovers an account block only from the distinct native account-block scope', () => {
    const accountBlock = pairing({
      id: 'account-pair-1',
      sessionId: 'account-block:session-1',
      activityType: 'training-block',
      relayScope: 'account-block',
      playerId: null,
    });
    const nativeAccountBlock = relayState({
      sessionId: accountBlock.sessionId,
      scope: 'account-block',
      sessions: [{
        sessionId: accountBlock.sessionId,
        scope: 'account-block',
        state: 'active',
        finalized: false,
        pendingSampleCount: 1,
        droppedSampleCount: 0,
        streamCreated: true,
      }],
    });

    const recovered = reconcileHeartRateRelayAccount({
      accountId: 'rider-1',
      pairings: [accountBlock],
      relayState: nativeAccountBlock,
      now: 20_000,
    });
    expect(recovered.activeSessionId).toBe(accountBlock.sessionId);
    expect(recovered.activePairing).toBe(accountBlock);
    expect(recovered.orphanActiveSessionIds).toEqual([]);

    const mismatched = reconcileHeartRateRelayAccount({
      accountId: 'rider-1',
      pairings: [accountBlock],
      relayState: {
        ...nativeAccountBlock,
        scope: 'studio-block',
        sessions: nativeAccountBlock.sessions.map((session) => ({
          ...session,
          scope: 'studio-block' as const,
        })),
      },
      now: 20_000,
    });
    expect(mismatched.activeSessionId).toBeNull();
    expect(mismatched.activePairing).toBeNull();
    expect(mismatched.orphanActiveSessionIds).toEqual([accountBlock.sessionId]);
  });

  it('never hydrates a revoked, stopped, expired, foreign, or scope-mismatched relay', () => {
    const unsafePairings = [
      pairing({ id: 'expired', expiresAt: 19_999 }),
      pairing({ id: 'revoked', revokedAt: 10_000 }),
      pairing({ id: 'stopped', studioBlockStoppedAt: 10_000 }),
      pairing({ id: 'foreign', riderId: 'account:rider-2' }),
      pairing({ id: 'scope', relayScope: 'studio-block' }),
    ];
    const result = reconcileHeartRateRelayAccount({
      accountId: 'rider-1', pairings: unsafePairings, relayState: relayState(), now: 20_000,
    });

    expect(result.activeSessionId).toBeNull();
    expect(result.activePairing).toBeNull();
    expect(result.orphanActiveSessionIds).toEqual(['session-1']);
  });

  it('leaves a finalized foreign queue durable while excluding it from the current account', () => {
    const result = reconcileHeartRateRelayAccount({
      accountId: 'rider-2',
      pairings: [],
      relayState: relayState({
        configured: false,
        sessionId: undefined,
        scope: undefined,
        queuedSessionIds: ['session-1'],
        queuedCount: 1,
        sessions: [{
          sessionId: 'session-1', scope: 'personal-session', state: 'queued', finalized: true,
          pendingSampleCount: 2, droppedSampleCount: 0, streamCreated: true,
        }],
      }),
      now: 20_000,
    });

    expect(result.orphanActiveSessionIds).toEqual([]);
    expect(result.foreignQueuedSessionCount).toBe(1);
    expect(result.knownPairingIds).toEqual([]);
  });
});
