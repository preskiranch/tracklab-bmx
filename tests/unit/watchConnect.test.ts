import { describe, expect, it } from 'vitest';
import {
  formatWatchConnectTimeRemaining,
  planWatchConnectStart,
  resolveWatchConnectViewState,
  watchConnectForStudioRider,
  watchConnectSessionDurationMs,
  watchConnectStatusLabel,
  type WatchConnectConnection,
  type WatchConnectEnrollment,
} from '../../src/lib/watchConnect';

const now = Date.UTC(2026, 7, 21, 8, 0, 0);

const enrollment: WatchConnectEnrollment = {
  id: 'enrollment-athlete-1',
  scope: 'studio',
  clubId: 'club-preski',
  studioRiderId: 'rider-athlete-1',
  state: 'trusted',
  liveStudioConsent: true,
  sessionStudioConsent: true,
  createdAt: now - 10_000,
  updatedAt: now - 10_000,
};

function connection(overrides: Partial<WatchConnectConnection> = {}): WatchConnectConnection {
  return {
    id: 'connection-athlete-1',
    enrollmentId: enrollment.id,
    scope: 'studio',
    clubId: 'club-preski',
    studioRiderId: 'rider-athlete-1',
    state: 'connected',
    connectedAt: now,
    connectedUntil: now + watchConnectSessionDurationMs,
    remainingMs: watchConnectSessionDurationMs,
    liveStudioConsent: true,
    sessionStudioConsent: true,
    ...overrides,
  };
}

describe('Watch Connect state', () => {
  it('uses one clear label and shows the four-hour countdown', () => {
    const view = resolveWatchConnectViewState({
      enrollment,
      connection: connection({ connectedUntil: now + ((3 * 60 + 42) * 60_000) }),
      now,
    });

    expect(view.phase).toBe('connected');
    expect(watchConnectStatusLabel(view)).toBe('Connected · 3h 42m left');
    expect(formatWatchConnectTimeRemaining(watchConnectSessionDurationMs)).toBe('4h 0m left');
  });

  it('reuses an active connection and starts a fresh session after expiry without enrollment', () => {
    expect(planWatchConnectStart({ enrollment, connection: connection(), now })).toEqual({
      action: 'reuse',
      enrollmentId: enrollment.id,
      connectionId: 'connection-athlete-1',
    });

    const fiveHoursLater = now + 5 * 60 * 60_000;
    expect(planWatchConnectStart({ enrollment, connection: connection(), now: fiveHoursLater })).toEqual({
      action: 'connect',
      enrollmentId: enrollment.id,
      connectionId: null,
    });
    expect(resolveWatchConnectViewState({
      enrollment,
      connection: connection(),
      now: fiveHoursLater,
    }).phase).toBe('ended');
  });

  it('offers Watch Connect after natural expiry while the private old outbox keeps syncing', () => {
    const expired = connection();
    const fiveHoursLater = now + 5 * 60 * 60_000;
    const syncingOldSession = {
      state: 'syncing' as const,
      scope: 'studio' as const,
      connectionId: expired.id,
      sessionId: `watch-connect:${expired.id}`,
      connectedUntil: expired.connectedUntil,
      remainingMs: 0,
      requiresUserStart: false,
    };
    const view = resolveWatchConnectViewState({
      enrollment,
      connection: expired,
      nativeState: syncingOldSession,
      requiresNativeMatch: true,
      now: fiveHoursLater,
    });
    expect(view.phase).toBe('ended');
    expect(watchConnectStatusLabel(view)).toBe('Session ended');
    expect(view.detail).toContain('syncing privately');
    expect(planWatchConnectStart({ enrollment, connection: expired, now: fiveHoursLater }).action)
      .toBe('connect');

    expect(resolveWatchConnectViewState({
      enrollment,
      connection: { ...expired, state: 'stopped' },
      nativeState: syncingOldSession,
      now,
    }).phase).toBe('ended');
  });

  it('enrolls only on first use', () => {
    expect(planWatchConnectStart({ enrollment: null, connection: null, now })).toEqual({
      action: 'enroll-and-connect',
      enrollmentId: null,
      connectionId: null,
    });
    expect(resolveWatchConnectViewState({ enrollment: null, connection: null, now }).phase)
      .toBe('connect');
  });

  it('recognizes only the selected claimed athlete profile, regardless of bike changes', () => {
    const athleteConnection = connection();
    const anotherAthlete = connection({
      id: 'connection-athlete-2',
      enrollmentId: 'enrollment-athlete-2',
      studioRiderId: 'rider-athlete-2',
    });
    const sessions = [anotherAthlete, athleteConnection];

    expect(watchConnectForStudioRider('club-preski', 'rider-athlete-1', sessions, now)?.id)
      .toBe(athleteConnection.id);
    expect(watchConnectForStudioRider('club-preski', 'rider-athlete-2', sessions, now)?.id)
      .toBe(anotherAthlete.id);
    expect(watchConnectForStudioRider('club-preski', 'display-name-only', sessions, now)).toBeNull();
    expect(watchConnectForStudioRider('wrong-club', 'rider-athlete-1', sessions, now)).toBeNull();
    // No bike identifier participates in recognition, so Wattbike reconnects
    // cannot invalidate the athlete-owned session.
    expect(Object.keys(athleteConnection)).not.toContain('bikeId');
  });

  it('keeps connecting and syncing labels intentionally simple', () => {
    const connecting = resolveWatchConnectViewState({
      enrollment,
      connection: null,
      busy: true,
      now,
    });
    const syncing = resolveWatchConnectViewState({
      enrollment,
      connection: connection(),
      nativeState: {
        state: 'syncing',
        connectionId: 'connection-athlete-1',
        connectedUntil: now + watchConnectSessionDurationMs,
        remainingMs: watchConnectSessionDurationMs,
        requiresUserStart: false,
      },
      now,
    });

    expect(watchConnectStatusLabel(connecting)).toBe('Connecting…');
    expect(watchConnectStatusLabel(syncing)).toBe('Syncing…');
  });

  it('does not label an iPhone connected when native belongs to another account', () => {
    const view = resolveWatchConnectViewState({
      enrollment,
      connection: connection(),
      requiresNativeMatch: true,
      nativeState: {
        state: 'connected',
        scope: 'studio',
        connectionId: 'foreign-connection',
        sessionId: 'watch-connect:foreign-connection',
        connectedUntil: now + watchConnectSessionDurationMs,
        remainingMs: watchConnectSessionDurationMs,
        requiresUserStart: false,
      },
      now,
    });

    expect(view.phase).toBe('ended');
    expect(watchConnectStatusLabel(view)).toBe('Session ended');
  });

  it('stays Connecting while Watch is active and cloud stream confirmation is pending', () => {
    const waiting = connection({ state: 'connecting' });
    const view = resolveWatchConnectViewState({
      enrollment,
      connection: waiting,
      requiresNativeMatch: true,
      nativeState: {
        state: 'connected',
        scope: 'studio',
        connectionId: waiting.id,
        sessionId: `watch-connect:${waiting.id}`,
        connectedUntil: waiting.connectedUntil,
        remainingMs: waiting.remainingMs,
        requiresUserStart: false,
      },
      now,
    });
    expect(view.phase).toBe('connecting');
    expect(view.detail).toBe('Watch is recording; waiting for sync.');
    expect(watchConnectStatusLabel(view)).toBe('Connecting…');
  });
});
