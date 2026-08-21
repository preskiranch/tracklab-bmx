import { describe, expect, it } from 'vitest';
import { reconcileWatchConnectAccount } from '../../src/lib/watchConnectReconciliation';
import { watchConnectSessionDurationMs, type WatchConnectConnection } from '../../src/lib/watchConnect';
import type { NativeWatchConnectState } from '../../src/lib/nativeHeartRate';

const now = Date.UTC(2026, 7, 21, 8);
const connection: WatchConnectConnection = {
  id: 'connection-current',
  enrollmentId: 'enrollment-current',
  scope: 'personal',
  clubId: null,
  studioRiderId: null,
  state: 'connected',
  connectedAt: now,
  connectedUntil: now + watchConnectSessionDurationMs,
  remainingMs: watchConnectSessionDurationMs,
  liveStudioConsent: false,
  sessionStudioConsent: false,
};
const native: NativeWatchConnectState = {
  version: 1,
  state: 'connected',
  scope: 'personal',
  connectionId: connection.id,
  sessionId: `watch-connect:${connection.id}`,
  connectedUntil: connection.connectedUntil,
  remainingMs: connection.remainingMs,
  requiresUserStart: false,
  workoutReady: true,
  relayConfigured: true,
};

describe('Watch Connect account reconciliation', () => {
  it('never stops a valid session during reload before cloud hydration', () => {
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: null,
      connections: [],
      native,
      now,
    })).toBe('waiting-for-account');
  });

  it('matches only exact current-account connection, session, and deadline', () => {
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [connection],
      native,
      now,
    })).toBe('matched');
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [connection],
      native: { ...native, sessionId: 'watch-connect:foreign' },
      now,
    })).toBe('foreign-native-session');
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [connection],
      native: { ...native, scope: 'studio' },
      now,
    })).toBe('foreign-native-session');
  });

  it('classifies a previous-account native connection only after hydration', () => {
    expect(reconcileWatchConnectAccount({
      accountId: 'account-new',
      hydratedAccountId: 'account-new',
      connections: [],
      native,
      now,
    })).toBe('foreign-native-session');
  });

  it('requests native start when a hydrated cloud connection survived a pre-prepare crash', () => {
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [{ ...connection, state: 'connecting' }],
      native: null,
      now,
    })).toBe('native-start-required');
  });

  it('keeps an exact expired-session outbox attached while a fresh connection starts', () => {
    const fiveHoursLater = now + 5 * 60 * 60_000;
    const expired = { ...connection, state: 'expired' as const, remainingMs: 0 };
    const fresh = {
      ...connection,
      id: 'connection-fresh',
      state: 'connecting' as const,
      connectedAt: fiveHoursLater,
      connectedUntil: fiveHoursLater + watchConnectSessionDurationMs,
    };
    expect(reconcileWatchConnectAccount({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [expired, fresh],
      native: {
        ...native,
        state: 'syncing',
        remainingMs: 0,
        workoutReady: false,
        relayConfigured: true,
      },
      now: fiveHoursLater,
    })).toBe('matched');
  });
});
