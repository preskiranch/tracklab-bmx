import { describe, expect, it, vi } from 'vitest';
import {
  runWatchConnectSingleFlight,
  startWatchConnectAction,
  stopWatchConnectAction,
  stopWatchConnectForAccountBoundary,
  updateWatchConnectStudioConsentAction,
  WatchConnectStartError,
  type WatchConnectActionDependencies,
} from '../../src/lib/watchConnectActions';
import { watchConnectSessionDurationMs, type WatchConnectConnection, type WatchConnectEnrollment } from '../../src/lib/watchConnect';
import { watchConnectStudioConsentForStart } from '../../src/components/WatchConnectCoordinator';

const now = Date.UTC(2026, 7, 21, 8, 0, 0);
const installId = `wci_${'b'.repeat(64)}`;
const enrollment: WatchConnectEnrollment = {
  id: 'enrollment-1',
  scope: 'personal',
  clubId: null,
  studioRiderId: null,
  state: 'trusted',
  liveStudioConsent: false,
  sessionStudioConsent: false,
  createdAt: now,
  updatedAt: now,
};
const connection: WatchConnectConnection = {
  id: 'connection-1',
  enrollmentId: enrollment.id,
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

function dependencies(overrides: Partial<WatchConnectActionDependencies> = {}): WatchConnectActionDependencies {
  return {
    getIdentity: vi.fn(async () => ({ version: 1, installId })),
    getNativeState: vi.fn(async () => ({
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    })),
    enroll: vi.fn(async () => ({ enrollment, replayed: true })),
    createConnection: vi.fn(async () => ({
      connection,
      credentials: {
        connectionId: connection.id,
        pairingId: 'pairing-1',
        relaySessionId: `watch-connect:${connection.id}`,
        ingestToken: 'private-ingest-token',
        expiresAt: connection.connectedUntil,
      },
      replayed: true,
    })),
    startNative: vi.fn(async () => ({
      state: 'connected',
      scope: 'personal',
      connectionId: connection.id,
      sessionId: `watch-connect:${connection.id}`,
      connectedUntil: connection.connectedUntil,
      remainingMs: watchConnectSessionDurationMs,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    })),
    stopNative: vi.fn(async () => ({
      state: 'reconnect',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    })),
    disconnectConnection: vi.fn(async () => ({ ...connection, state: 'stopped', remainingMs: 0 })),
    ...overrides,
  };
}

describe('Watch Connect actions', () => {
  it('shares one in-flight operation across same-tick presses', async () => {
    const holder = { current: null as Promise<string> | null };
    let release!: (value: string) => void;
    const action = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));

    const first = runWatchConnectSingleFlight(holder, action);
    const second = runWatchConnectSingleFlight(holder, action);
    expect(first).toBe(second);
    expect(action).toHaveBeenCalledOnce();
    release('connected');
    await expect(first).resolves.toBe('connected');
    await Promise.resolve();
    expect(holder.current).toBeNull();
  });

  it('performs enrollment, server connection, and native start from one press', async () => {
    const deps = dependencies();
    const result = await startWatchConnectAction({
      scope: 'personal',
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-123456789',
      connectionRequestId: 'watch-connect-session-123456789',
    }, deps);
    expect(result).toMatchObject({ enrollment, connection, pairingId: 'pairing-1' });
    expect(JSON.stringify(result)).not.toContain('private-ingest-token');

    expect(deps.enroll).toHaveBeenCalledWith(expect.objectContaining({ installId, scope: 'personal' }));
    expect(deps.startNative).toHaveBeenCalledWith({
      baseUrl: 'https://tracklab.example',
      connectionId: connection.id,
      pairingId: 'pairing-1',
      relaySessionId: `watch-connect:${connection.id}`,
      ingestToken: 'private-ingest-token',
      expiresAt: connection.connectedUntil,
      scope: 'personal',
    });
  });

  it('publishes the credential-free server identity before native can emit connecting', async () => {
    const order: string[] = [];
    const onConnectionCreated = vi.fn((prepared) => {
      order.push('server-created');
      expect(prepared).toEqual({ enrollment, connection, pairingId: 'pairing-1' });
      expect(JSON.stringify(prepared)).not.toContain('private-ingest-token');
    });
    const startNative = vi.fn(async () => {
      order.push('native-start');
      return {
        state: 'connected' as const,
        scope: 'personal' as const,
        connectionId: connection.id,
        sessionId: `watch-connect:${connection.id}`,
        connectedUntil: connection.connectedUntil,
        remainingMs: watchConnectSessionDurationMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      };
    });

    await startWatchConnectAction({
      scope: 'personal',
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-ordering',
      connectionRequestId: 'watch-connect-session-ordering',
    }, dependencies({ onConnectionCreated, startNative }));

    expect(order).toEqual(['server-created', 'native-start']);
    expect(onConnectionCreated).toHaveBeenCalledOnce();
  });

  it('does first studio setup once, then reconnects after reload and five hours with saved consent', async () => {
    const studioEnrollment: WatchConnectEnrollment = {
      ...enrollment,
      id: 'enrollment-studio',
      scope: 'studio',
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    };
    const firstConnection: WatchConnectConnection = {
      ...connection,
      id: 'connection-studio-first',
      enrollmentId: studioEnrollment.id,
      scope: 'studio',
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      state: 'connecting',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    };
    const fiveHoursLater = now + 5 * 60 * 60_000;
    const secondConnection: WatchConnectConnection = {
      ...firstConnection,
      id: 'connection-studio-second',
      connectedAt: fiveHoursLater,
      connectedUntil: fiveHoursLater + watchConnectSessionDurationMs,
    };
    const enroll = vi.fn(async () => ({ enrollment: studioEnrollment, replayed: false }));
    const result = (studioConnection: WatchConnectConnection) => ({
      connection: studioConnection,
      credentials: {
        connectionId: studioConnection.id,
        pairingId: `pairing-${studioConnection.id}`,
        relaySessionId: `watch-connect:${studioConnection.id}`,
        ingestToken: `token-${studioConnection.id}`,
        expiresAt: studioConnection.connectedUntil,
      },
      replayed: false,
    });
    const createConnection = vi.fn()
      .mockResolvedValueOnce(result(firstConnection))
      .mockResolvedValueOnce(result(secondConnection));
    const startNative = vi.fn(async (
      input: Parameters<WatchConnectActionDependencies['startNative']>[0],
    ) => ({
      state: 'connected' as const,
      scope: input.scope,
      connectionId: input.connectionId,
      sessionId: input.relaySessionId,
      connectedUntil: input.expiresAt,
      remainingMs: watchConnectSessionDurationMs,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    }));
    const deps = dependencies({ enroll, createConnection, startNative });

    await startWatchConnectAction({
      scope: 'studio',
      clubId: 'club-one',
      baseUrl: 'https://tracklab.example',
      liveStudioConsent: true,
      sessionStudioConsent: true,
      enrollmentRequestId: 'watch-connect-enroll-first-studio',
      connectionRequestId: 'watch-connect-session-first-studio',
    }, deps);
    const saved = watchConnectStudioConsentForStart(studioEnrollment, false, false);
    await startWatchConnectAction({
      scope: 'studio',
      clubId: 'club-one',
      baseUrl: 'https://tracklab.example',
      existingEnrollment: studioEnrollment,
      liveStudioConsent: saved.live,
      sessionStudioConsent: saved.session,
      enrollmentRequestId: 'watch-connect-enroll-reload-studio',
      connectionRequestId: 'watch-connect-session-five-hours',
    }, deps);

    expect(enroll).toHaveBeenCalledOnce();
    expect(createConnection).toHaveBeenCalledTimes(2);
    expect(startNative).toHaveBeenLastCalledWith(expect.objectContaining({
      connectionId: secondConnection.id,
      scope: 'studio',
    }));
  });

  it('requires summary consent for first studio setup while leaving live BPM optional', async () => {
    const deps = dependencies();
    await expect(startWatchConnectAction({
      scope: 'studio',
      clubId: 'club-1',
      baseUrl: 'https://tracklab.example',
      liveStudioConsent: false,
      sessionStudioConsent: false,
      enrollmentRequestId: 'watch-connect-enroll-123456789',
      connectionRequestId: 'watch-connect-session-123456789',
    }, deps)).rejects.toThrow('Approve Training summaries');
    expect(deps.getIdentity).not.toHaveBeenCalled();
  });

  it('turns Live BPM on for the exact remembered studio through enrollment refresh', async () => {
    const saved: WatchConnectEnrollment = {
      ...enrollment,
      id: 'enrollment-studio-consent',
      scope: 'studio',
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      liveStudioConsent: false,
      sessionStudioConsent: true,
    };
    const refreshed = {
      ...saved,
      liveStudioConsent: true,
      updatedAt: now + 1,
    };
    const enroll = vi.fn(async () => ({ enrollment: refreshed, replayed: false }));

    await expect(updateWatchConnectStudioConsentAction({
      enrollment: saved,
      liveStudioConsent: true,
      enrollmentRequestId: 'watch-connect-consent-123456789',
    }, {
      getIdentity: async () => ({ version: 1, installId }),
      enroll,
    })).resolves.toEqual(refreshed);

    expect(enroll).toHaveBeenCalledWith({
      requestId: 'watch-connect-consent-123456789',
      installId,
      scope: 'studio',
      clubId: 'club-one',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    });
  });

  it('rejects consent refreshes that change the claimed studio athlete identity', async () => {
    const saved: WatchConnectEnrollment = {
      ...enrollment,
      id: 'enrollment-studio-consent',
      scope: 'studio',
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      sessionStudioConsent: true,
    };
    await expect(updateWatchConnectStudioConsentAction({
      enrollment: saved,
      liveStudioConsent: true,
      enrollmentRequestId: 'watch-connect-consent-123456789',
    }, {
      getIdentity: async () => ({ version: 1, installId }),
      enroll: async () => ({
        enrollment: {
          ...saved,
          studioRiderId: 'rider-two',
          liveStudioConsent: true,
        },
        replayed: false,
      }),
    })).rejects.toThrow('could not confirm');
  });

  it('stops studio visibility while finalized native samples keep syncing privately', async () => {
    const disconnectConnection = vi.fn(async () => ({ ...connection, state: 'stopped' as const }));
    const deps = dependencies({
      disconnectConnection,
      stopNative: vi.fn(async () => ({
        state: 'syncing',
        scope: 'personal',
        connectionId: connection.id,
        sessionId: `watch-connect:${connection.id}`,
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: false,
        relayConfigured: true,
      })),
    });

    await expect(stopWatchConnectAction(connection, deps)).resolves.toEqual({
      pendingSync: true,
      connection: { ...connection, state: 'stopped' },
    });
    expect(disconnectConnection).toHaveBeenCalledWith(connection.id);
  });

  it('does not stop server visibility when native finalization was not queued', async () => {
    const disconnectConnection = vi.fn();
    const deps = dependencies({
      disconnectConnection,
      stopNative: vi.fn(async () => ({
        state: 'error',
        scope: 'personal',
        connectionId: connection.id,
        sessionId: `watch-connect:${connection.id}`,
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
        reason: 'Watch could not finish safely.',
      })),
    });
    await expect(stopWatchConnectAction(connection, deps)).rejects.toThrow('finish safely');
    expect(disconnectConnection).not.toHaveBeenCalled();
  });

  it('recovers after an ambiguous create response without persisting credentials', async () => {
    const createConnection = vi.fn()
      .mockRejectedValueOnce(new Error('Network connection was lost.'))
      .mockResolvedValueOnce({
        connection,
        credentials: {
          connectionId: connection.id,
          pairingId: 'pairing-1',
          relaySessionId: `watch-connect:${connection.id}`,
          ingestToken: 'fresh-private-ingest-token',
          expiresAt: connection.connectedUntil,
        },
        replayed: true,
      });
    const deps = dependencies({ createConnection });
    const input = {
      scope: 'personal' as const,
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-ambiguous-1',
      connectionRequestId: 'watch-connect-session-ambiguous-1',
    };

    const failed = await startWatchConnectAction(input, deps).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(WatchConnectStartError);
    expect((failed as WatchConnectStartError).reuseRequestIds).toBe(true);
    const recovered = await startWatchConnectAction(input, deps);

    expect(createConnection).toHaveBeenCalledTimes(2);
    expect(recovered.connection.id).toBe(connection.id);
    expect(recovered).not.toHaveProperty('credentials');
    expect(JSON.stringify(recovered)).not.toContain('ingest-token');
  });

  it('rolls back a server connection when native Watch start fails', async () => {
    const disconnectConnection = vi.fn(async () => ({
      ...connection,
      state: 'stopped' as const,
      remainingMs: 0,
    }));
    const stopNative = vi.fn(async () => ({
      state: 'reconnect' as const,
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    }));
    const deps = dependencies({
      disconnectConnection,
      stopNative,
      startNative: vi.fn(async () => ({
        state: 'error',
        scope: 'personal',
        connectionId: connection.id,
        sessionId: `watch-connect:${connection.id}`,
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: true,
        workoutReady: false,
        relayConfigured: false,
        reason: 'Apple Watch did not confirm the workout.',
      })),
    });

    const failed = await startWatchConnectAction({
      scope: 'personal',
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-rollback-1',
      connectionRequestId: 'watch-connect-session-rollback-1',
    }, deps).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(WatchConnectStartError);
    expect((failed as WatchConnectStartError).message).toContain('did not confirm');
    expect((failed as WatchConnectStartError).reuseRequestIds).toBe(false);
    expect(stopNative).toHaveBeenCalledOnce();
    expect(disconnectConnection).toHaveBeenCalledWith(connection.id);
  });

  it('does not stop a foreign native session while rolling back', async () => {
    const disconnectConnection = vi.fn(async () => ({ ...connection, state: 'stopped' as const }));
    const stopNative = vi.fn();
    const deps = dependencies({
      disconnectConnection,
      stopNative,
      startNative: vi.fn(async () => ({
        state: 'connected',
        scope: 'personal',
        connectionId: 'foreign-connection',
        sessionId: 'watch-connect:foreign-connection',
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      })),
    });

    await expect(startWatchConnectAction({
      scope: 'personal',
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-foreign-1',
      connectionRequestId: 'watch-connect-session-foreign-1',
    }, deps)).rejects.toThrow('could not start');
    expect(stopNative).not.toHaveBeenCalled();
    expect(disconnectConnection).toHaveBeenCalledWith(connection.id);
  });

  it('rejects and rolls back a native session with the wrong scope or relay session', async () => {
    const disconnectConnection = vi.fn(async () => ({ ...connection, state: 'stopped' as const }));
    const deps = dependencies({
      disconnectConnection,
      startNative: vi.fn(async () => ({
        state: 'connected',
        scope: 'studio',
        connectionId: connection.id,
        sessionId: 'watch-connect:wrong-session',
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      })),
    });
    await expect(startWatchConnectAction({
      scope: 'personal',
      baseUrl: 'https://tracklab.example',
      enrollmentRequestId: 'watch-connect-enroll-scope-mismatch',
      connectionRequestId: 'watch-connect-session-scope-mismatch',
    }, deps)).rejects.toThrow('could not start');
    expect(disconnectConnection).toHaveBeenCalledWith(connection.id);
  });

  it('finalizes native before hiding the exact account connection at sign-out', async () => {
    const calls: string[] = [];
    await stopWatchConnectForAccountBoundary({
      getNativeState: async () => ({
        state: 'connected',
        scope: 'personal',
        connectionId: connection.id,
        sessionId: `watch-connect:${connection.id}`,
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      }),
      loadCloud: async () => ({ enrollments: [enrollment], connections: [connection] }),
      stopNative: async () => {
        calls.push('native-stop');
        return {
          state: 'disconnecting',
          scope: 'personal',
          connectionId: connection.id,
          sessionId: `watch-connect:${connection.id}`,
          connectedUntil: connection.connectedUntil,
          remainingMs: connection.remainingMs,
          requiresUserStart: false,
          workoutReady: false,
          relayConfigured: true,
        };
      },
      disconnectConnection: async () => {
        calls.push('server-stop');
        return { ...connection, state: 'stopped', remainingMs: 0 };
      },
    });
    expect(calls).toEqual(['native-stop', 'server-stop']);
  });
});
