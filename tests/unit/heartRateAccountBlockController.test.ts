import { describe, expect, it, vi } from 'vitest';
import type { HeartRatePairingClaim } from '../../src/lib/heartRateCloud';
import type { NativeHeartRateStatus } from '../../src/lib/nativeHeartRate';
import {
  connectHeartRateAccountBlock,
  heartRateAccountBlockHandoffHref,
  HeartRateAccountBlockConnectError,
  parseHeartRateAccountBlockHandoffHref,
  removeHeartRateAccountBlockHandoffHref,
} from '../../src/lib/heartRateAccountBlock';

const claim: HeartRatePairingClaim = {
  ingestToken: 'private-ingest-value',
  ingestExpiresAt: 50_000,
  pairing: {
    id: 'account-pairing-1',
    sessionId: 'account-block-1',
    activityType: 'training-block',
    relayScope: 'account-block',
    riderId: 'account:athlete-1',
    playerId: null,
  },
};

function workout(
  state: NativeHeartRateStatus['state'],
  sessionId: string | null = null,
): NativeHeartRateStatus {
  return { version: 1, state, sessionId, at: 1_000 };
}

describe('private account heart-rate handoff controller', () => {
  it('uses a same-origin fragment and never places the one-use code in the HTTP query', () => {
    const href = heartRateAccountBlockHandoffHref(
      'https://tracklab-bmx.onrender.com/settings?room=private#old=value',
      'abcd-efgh',
    );

    expect(href).toBe('https://tracklab-bmx.onrender.com/#heartRateAccountBlock=ABCD-EFGH');
    expect(new URL(href).search).toBe('');
    expect(parseHeartRateAccountBlockHandoffHref(
      href,
      'https://tracklab-bmx.onrender.com',
    )).toEqual({ present: true, pairCode: 'ABCD-EFGH' });
    expect(parseHeartRateAccountBlockHandoffHref(
      href,
      'https://evil.example',
    )).toEqual({ present: false, pairCode: '' });
    expect(parseHeartRateAccountBlockHandoffHref(
      'https://tracklab-bmx.onrender.com/?heartRateAccountBlock=ABCD-EFGH',
      'https://tracklab-bmx.onrender.com',
    )).toEqual({ present: false, pairCode: '' });
    expect(removeHeartRateAccountBlockHandoffHref(
      'https://tracklab-bmx.onrender.com/?room=one#heartRateAccountBlock=ABCD-EFGH&section=settings',
    )).toBe('/?room=one#section=settings');
  });

  it('claims with the signed-in account, starts the exact Watch workout, then configures account-block relay', async () => {
    const calls: string[] = [];
    const result = await connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      expectedPairingId: claim.pairing.id,
      expectedBlockId: claim.pairing.sessionId,
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => {
        calls.push('claim');
        return claim;
      }),
      startWorkout: vi.fn(async (sessionId) => {
        calls.push(`start:${sessionId}`);
        return workout('active', sessionId);
      }),
      resumeWorkout: vi.fn(async () => workout('active')),
      configureRelay: vi.fn(async (configuration) => {
        calls.push(`relay:${configuration.scope}:${configuration.sessionId}`);
        expect(configuration.ingestToken).toBe(claim.ingestToken);
        return {
          configured: true,
          scope: 'account-block',
          sessionId: configuration.sessionId,
        };
      }),
      now: () => 2_000,
    });

    expect(calls).toEqual([
      'claim',
      'start:watch-account-block:account-pairing-1',
      'relay:account-block:account-block-1',
    ]);
    expect(result).toEqual({
      pairingId: 'account-pairing-1',
      blockId: 'account-block-1',
      workoutSessionId: 'watch-account-block:account-pairing-1',
      workoutStarted: true,
    });
  });

  it('waits for the exact native connecting-to-active transition before configuring relay', async () => {
    let statusListener: ((status: NativeHeartRateStatus) => void) | null = null;
    const remove = vi.fn(async () => undefined);
    const configureRelay = vi.fn(async () => ({
      configured: true,
      scope: 'account-block' as const,
      sessionId: 'account-block-1',
    }));
    const connecting = workout('connecting', 'watch-account-block:account-pairing-1');

    const pending = connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => connecting),
      resumeWorkout: vi.fn(async () => workout('active')),
      getWorkoutState: vi.fn(async () => connecting),
      addWorkoutStatusListener: vi.fn(async (listener) => {
        statusListener = listener;
        return { remove };
      }),
      configureRelay,
    });

    await vi.waitFor(() => expect(statusListener).not.toBeNull());
    expect(configureRelay).not.toHaveBeenCalled();
    statusListener?.(workout('active', 'watch-account-block:account-pairing-1'));

    await expect(pending).resolves.toMatchObject({ workoutStarted: true });
    expect(configureRelay).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('refreshes authoritative native state after subscribing so an active transition is not missed', async () => {
    const remove = vi.fn(async () => undefined);
    const configureRelay = vi.fn(async () => ({
      configured: true,
      scope: 'account-block' as const,
      sessionId: 'account-block-1',
    }));
    const sessionId = 'watch-account-block:account-pairing-1';

    await expect(connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => workout('connecting', sessionId)),
      resumeWorkout: vi.fn(async () => workout('active', sessionId)),
      getWorkoutState: vi.fn(async () => workout('active', sessionId)),
      addWorkoutStatusListener: vi.fn(async () => ({ remove })),
      configureRelay,
    })).resolves.toMatchObject({ workoutStarted: true });

    expect(configureRelay).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('rejects when authoritative native state reports a different active session', async () => {
    const remove = vi.fn(async () => undefined);
    const configureRelay = vi.fn(async () => ({ configured: true }));

    await expect(connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => workout(
        'connecting',
        'watch-account-block:account-pairing-1',
      )),
      resumeWorkout: vi.fn(async () => workout('active')),
      getWorkoutState: vi.fn(async () => workout('active', 'watch-studio-block:other')),
      addWorkoutStatusListener: vi.fn(async () => ({ remove })),
      configureRelay,
    })).rejects.toThrow('different Apple Watch workout became active');

    expect(configureRelay).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('bounds and cancels a connecting Watch wait without configuring relay', async () => {
    vi.useFakeTimers();
    const remove = vi.fn(async () => undefined);
    const configureRelay = vi.fn(async () => ({ configured: true }));
    const connecting = workout('connecting', 'watch-account-block:account-pairing-1');
    const abort = new AbortController();

    const timedOut = connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => connecting),
      resumeWorkout: vi.fn(async () => workout('active')),
      getWorkoutState: vi.fn(async () => connecting),
      addWorkoutStatusListener: vi.fn(async () => ({ remove })),
      configureRelay,
      workoutReadyTimeoutMs: 250,
    });
    const timedOutExpectation = expect(timedOut).rejects.toThrow('did not become active in time');
    await vi.advanceTimersByTimeAsync(250);
    await timedOutExpectation;

    const cancelled = connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => connecting),
      resumeWorkout: vi.fn(async () => workout('active')),
      getWorkoutState: vi.fn(async () => connecting),
      addWorkoutStatusListener: vi.fn(async () => ({ remove })),
      configureRelay,
      signal: abort.signal,
    });
    const cancelledExpectation = expect(cancelled).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await cancelledExpectation;
    expect(configureRelay).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('resumes the exact paused account workout without starting another workout', async () => {
    const startWorkout = vi.fn(async () => workout('active'));
    const resumeWorkout = vi.fn(async () => workout(
      'active',
      'watch-account-block:account-pairing-1',
    ));

    await connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('paused', 'watch-account-block:account-pairing-1'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout,
      resumeWorkout,
      configureRelay: vi.fn(async () => ({
        configured: true,
        scope: 'account-block',
        sessionId: 'account-block-1',
      })),
    });

    expect(startWorkout).not.toHaveBeenCalled();
    expect(resumeWorkout).toHaveBeenCalledOnce();
  });

  it('rejects the wrong account before touching Apple Watch or native relay', async () => {
    const startWorkout = vi.fn(async () => workout('active'));
    const configureRelay = vi.fn(async () => ({ configured: true }));

    await expect(connectHeartRateAccountBlock({
      accountId: 'different-athlete',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('idle'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout,
      resumeWorkout: vi.fn(async () => workout('active')),
      configureRelay,
    })).rejects.toMatchObject({
      name: 'HeartRateAccountBlockConnectError',
      pairingId: 'account-pairing-1',
      workoutStarted: false,
      relayConfigured: false,
    } satisfies Partial<HeartRateAccountBlockConnectError>);
    expect(startWorkout).not.toHaveBeenCalled();
    expect(configureRelay).not.toHaveBeenCalled();
  });

  it('will not replace a different active Apple Watch workout', async () => {
    await expect(connectHeartRateAccountBlock({
      accountId: 'athlete-1',
      pairCode: 'ABCD-EFGH',
      currentWorkout: workout('active', 'watch-studio-block:another-pairing'),
      baseUrl: 'https://tracklab-bmx.onrender.com',
      claim: vi.fn(async () => claim),
      startWorkout: vi.fn(async () => workout('active')),
      resumeWorkout: vi.fn(async () => workout('active')),
      configureRelay: vi.fn(async () => ({ configured: true })),
    })).rejects.toThrow('End the current Apple Watch workout');
  });
});
