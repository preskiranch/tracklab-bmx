import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  activeWatchConnectTarget,
  defaultWatchConnectClubId,
  runWatchConnectKeyedSingleFlight,
  watchConnectAccountBoundarySealKey,
  watchConnectAccountRequestIsCurrent,
  watchConnectCanRetryCloudConnection,
  watchConnectCoordinatorRequestIsCurrent,
  watchConnectLegacyHeartRateIsBusy,
  watchConnectNativeCapability,
  watchConnectNativeResultFromState,
  watchConnectNeedsCredentialRecovery,
  watchConnectSuppressesLegacyRelay,
  watchConnectStudioConsentForStart,
  unavailableWatchConnectDetail,
  watchConnectReadOnlyObserver,
  watchConnectHeartRateForConnection,
} from '../../src/components/WatchConnectCoordinator';

describe('WatchConnectCoordinator native adapter', () => {
  it('seals one unmatched native identity only once across disconnecting phases', async () => {
    const foreignNative = {
      version: 1 as const,
      state: 'connected' as const,
      scope: 'personal' as const,
      connectionId: 'connection-earlier',
      sessionId: 'watch-connect:connection-earlier',
      connectedUntil: 14_400_100,
      remainingMs: 14_400_000,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    };
    const input = {
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [],
      native: foreignNative,
    };
    const connectedKey = watchConnectAccountBoundarySealKey(input);
    const syncingKey = watchConnectAccountBoundarySealKey({
      ...input,
      native: {
        ...foreignNative,
        state: 'syncing' as const,
        remainingMs: 0,
        workoutReady: false,
      },
    });
    expect(connectedKey).toBeTruthy();
    expect(syncingKey).toBe(connectedKey);

    const flights = new Map<string, Promise<string>>();
    let release = (_value: string) => undefined;
    let calls = 0;
    const first = runWatchConnectKeyedSingleFlight(flights, connectedKey!, () => {
      calls += 1;
      return new Promise<string>((resolve) => { release = resolve; });
    }, true);
    const duplicate = runWatchConnectKeyedSingleFlight(flights, syncingKey!, async () => {
      calls += 1;
      return 'duplicate';
    }, true);
    expect(duplicate).toBe(first);
    expect(calls).toBe(1);
    release('sealed');
    await expect(first).resolves.toBe('sealed');
    await expect(runWatchConnectKeyedSingleFlight(flights, connectedKey!, async () => {
      calls += 1;
      return 'late duplicate';
    }, true)).resolves.toBe('sealed');
    expect(calls).toBe(1);
  });

  it('allows an explicit boundary-seal retry after failure and a new identity after success', async () => {
    const flights = new Map<string, Promise<string>>();
    await expect(runWatchConnectKeyedSingleFlight(
      flights,
      'account-one:earlier-one',
      async () => { throw new Error('temporary cleanup failure'); },
      true,
    )).rejects.toThrow('temporary cleanup failure');
    expect(flights.size).toBe(0);
    await expect(runWatchConnectKeyedSingleFlight(
      flights,
      'account-one:earlier-one',
      async () => 'retried',
      true,
    )).resolves.toBe('retried');
    await expect(runWatchConnectKeyedSingleFlight(
      flights,
      'account-two:earlier-two',
      async () => 'new account sealed',
      true,
    )).resolves.toBe('new account sealed');
  });

  it('fences stale coordinator completions by both account and generation', () => {
    expect(watchConnectCoordinatorRequestIsCurrent('account-one', 'account-one', 4, 4)).toBe(true);
    expect(watchConnectCoordinatorRequestIsCurrent('account-one', 'account-two', 4, 4)).toBe(false);
    expect(watchConnectCoordinatorRequestIsCurrent('account-one', 'account-one', 4, 5)).toBe(false);
  });

  it('does not seal before hydration or when native matches current cloud state', () => {
    const connectedAt = Date.now();
    const native = {
      version: 1 as const,
      state: 'connected' as const,
      scope: 'personal' as const,
      connectionId: 'connection-current',
      sessionId: 'watch-connect:connection-current',
      connectedUntil: connectedAt + 14_400_000,
      remainingMs: 14_400_000,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    };
    const connection = {
      id: native.connectionId,
      enrollmentId: 'enrollment-current',
      scope: 'personal' as const,
      clubId: null,
      studioRiderId: null,
      state: 'connected' as const,
      connectedAt,
      connectedUntil: native.connectedUntil,
      remainingMs: native.remainingMs,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    expect(watchConnectAccountBoundarySealKey({
      accountId: 'account-current',
      hydratedAccountId: null,
      connections: [],
      native,
    })).toBeNull();
    expect(watchConnectAccountBoundarySealKey({
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [connection],
      native,
    })).toBeNull();
  });

  it('seals unmatched error and reconnect identities but keeps exact same-account history', () => {
    const connectedAt = Date.now();
    const native = {
      version: 1 as const,
      state: 'error' as const,
      scope: 'personal' as const,
      connectionId: 'connection-earlier',
      sessionId: 'watch-connect:connection-earlier',
      connectedUntil: connectedAt + 14_400_000,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: true,
      reason: 'Watch Connect must reconnect before recording more heart rate.',
    };
    const input = {
      accountId: 'account-current',
      hydratedAccountId: 'account-current',
      connections: [],
      native,
    };
    expect(watchConnectAccountBoundarySealKey(input)).toBeTruthy();
    expect(watchConnectAccountBoundarySealKey({
      ...input,
      native: { ...native, state: 'reconnect' as const, relayConfigured: false },
    })).toBeTruthy();

    const exactHistorical = {
      id: native.connectionId,
      enrollmentId: 'enrollment-current',
      scope: native.scope,
      clubId: null,
      studioRiderId: null,
      state: 'expired' as const,
      connectedAt,
      connectedUntil: native.connectedUntil,
      remainingMs: 0,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    expect(watchConnectAccountBoundarySealKey({
      ...input,
      connections: [exactHistorical],
    })).toBeNull();
  });

  it('keeps the App suppression callback stable so ordinary rerenders do not restart 15-second polling', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(appSource).toMatch(/const handleLegacyRelaySuppressionChange = useCallback\([\s\S]*?\}, \[\]\);/);
    expect(appSource).toContain('onLegacyRelaySuppressionChange={handleLegacyRelaySuppressionChange}');
    expect(appSource).not.toMatch(/onLegacyRelaySuppressionChange=\{\(suppressed\)/);
  });

  it('uses the exact nested Watch Connect connection, session, and deadline', () => {
    expect(watchConnectNativeResultFromState({
      version: 1,
      state: 'connected',
      scope: 'personal',
      connectionId: 'connection-1',
      sessionId: 'watch-connect:connection-1',
      connectedUntil: 200,
      remainingMs: 100,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    })).toEqual({
      state: 'connected',
      scope: 'personal',
      connectionId: 'connection-1',
      sessionId: 'watch-connect:connection-1',
      connectedUntil: 200,
      remainingMs: 100,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    });
  });

  it('keeps inactive native state disconnected', () => {
    expect(watchConnectNativeResultFromState({
      version: 1,
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    })).toEqual(expect.objectContaining({
      state: 'inactive',
      connectionId: null,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    }));
  });

  it('keeps legacy UI for builds without native Watch Connect methods', () => {
    expect(watchConnectNativeCapability({
      version: 1,
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
      reason: 'Install the latest TrackLab build to use Watch Connect.',
    })).toBe(false);
    expect(watchConnectNativeCapability({
      version: 1,
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
      reason: 'Watch Connect status could not be checked. Not implemented on ios.',
    })).toBe(false);
    expect(watchConnectNativeCapability({
      version: 1,
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
      reason: 'Apple Watch heart rate requires a newer TrackLab app build with the native heart-rate bridge.',
    })).toBe(false);
  });

  it('shows the native iPhone setup reason instead of a misleading device handoff', () => {
    expect(unavailableWatchConnectDetail({
      version: 1,
      supported: false,
      platform: 'iphone',
      paired: true,
      watchAppInstalled: false,
      healthDataAvailable: true,
      minimumIOS: '17.0',
      minimumWatchOS: '10.0',
      reason: 'Install the TrackLab BMX companion app on Apple Watch.',
    })).toBe('Install the TrackLab BMX companion app on Apple Watch.');
    expect(unavailableWatchConnectDetail({
      version: 1,
      supported: false,
      platform: 'ipad',
      paired: false,
      watchAppInstalled: false,
      healthDataAvailable: true,
      minimumIOS: '17.0',
      minimumWatchOS: '10.0',
    })).toBe('Open TrackLab on the paired iPhone and press Watch Connect.');
  });

  it('treats iPad and web as read-only cloud observers, never as Watch controllers', () => {
    expect(watchConnectReadOnlyObserver({
      version: 1,
      supported: false,
      platform: 'ipad',
      paired: false,
      watchAppInstalled: false,
      healthDataAvailable: true,
      minimumIOS: '17.0',
      minimumWatchOS: '10.0',
    })).toBe(true);
    expect(watchConnectReadOnlyObserver({
      version: 1,
      supported: true,
      platform: 'iphone',
      paired: true,
      watchAppInstalled: true,
      healthDataAvailable: true,
      minimumIOS: '17.0',
      minimumWatchOS: '10.0',
    })).toBe(false);
  });

  it('selects the active cloud connection scope for a secondary device', () => {
    const enrollment = {
      id: 'studio-enrollment',
      scope: 'studio' as const,
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      state: 'trusted' as const,
      liveStudioConsent: true,
      sessionStudioConsent: true,
      createdAt: 10,
      updatedAt: 10,
    };
    const connection = {
      id: 'studio-connection',
      enrollmentId: enrollment.id,
      scope: 'studio' as const,
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      state: 'connected' as const,
      connectedAt: 100,
      connectedUntil: 20_000,
      remainingMs: 19_900,
      liveStudioConsent: true,
      sessionStudioConsent: true,
    };
    expect(activeWatchConnectTarget({
      enrollments: [enrollment],
      connections: [connection],
    }, 1_000)).toEqual(connection);
    expect(activeWatchConnectTarget({
      enrollments: [enrollment],
      connections: [connection],
    }, 21_000)).toBeNull();
  });

  it('never carries a fresh BPM across Watch Connect session boundaries', () => {
    const connection = {
      id: 'connection-current',
      enrollmentId: 'enrollment-one',
      scope: 'personal' as const,
      clubId: null,
      studioRiderId: null,
      state: 'connected' as const,
      connectedAt: 100,
      connectedUntil: 20_000,
      remainingMs: 19_900,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    const reading = {
      streamId: 'stream-one',
      sessionId: 'watch-connect:connection-previous',
      relayScope: 'account-block' as const,
      riderId: 'account:one',
      playerId: null,
      bpm: 160,
      recordedAt: 1_000,
      activeElapsedMs: 500,
    };
    expect(watchConnectHeartRateForConnection(reading, connection)).toBeNull();
    expect(watchConnectHeartRateForConnection({
      ...reading,
      sessionId: 'watch-connect:connection-current',
    }, connection)?.bpm).toBe(160);
  });

  it('refreshes paired/install availability when native WCSession activation completes', () => {
    const hookSource = readFileSync(new URL('../../src/hooks/useHeartRate.ts', import.meta.url), 'utf8');
    const nativeSource = readFileSync(
      new URL('../../ios/App/App/HeartRateCoordinator.swift', import.meta.url),
      'utf8',
    );
    expect(nativeSource).toMatch(/activationDidComplete[\s\S]*?activationState == \.activated[\s\S]*?notifyObservers/);
    expect(hookSource).toMatch(/addStatusListener[\s\S]*?client\.getAvailability\(\)[\s\S]*?setAvailability/);
  });

  it('auto-selects one athlete studio and asks when there are multiple choices', () => {
    const sole = [{ clubId: 'club-one', clubName: 'One Studio' }];
    const multiple = [...sole, { clubId: 'club-two', clubName: 'Two Studio' }];
    expect(defaultWatchConnectClubId({ contexts: sole })).toBe('club-one');
    expect(defaultWatchConnectClubId({ contexts: sole, preferPersonal: true })).toBeNull();
    expect(defaultWatchConnectClubId({
      contexts: multiple,
      preferredClubId: 'club-two',
      preferPersonal: true,
    })).toBeNull();
    expect(defaultWatchConnectClubId({ contexts: multiple })).toBeNull();
    expect(defaultWatchConnectClubId({
      contexts: multiple,
      preferredClubId: 'club-two',
    })).toBe('club-two');
  });

  it('uses saved studio consent after reload instead of asking again', () => {
    expect(watchConnectStudioConsentForStart({
      id: 'enrollment-studio',
      scope: 'studio',
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      state: 'trusted',
      liveStudioConsent: true,
      sessionStudioConsent: true,
      createdAt: 10,
      updatedAt: 10,
    }, false, false)).toEqual({ live: true, session: true });
  });

  it('recovers a reload-lost token once, but never duplicates a normal in-flight start', () => {
    const enrollment = {
      id: 'enrollment-one',
      scope: 'personal' as const,
      clubId: null,
      studioRiderId: null,
      state: 'trusted' as const,
      liveStudioConsent: false,
      sessionStudioConsent: false,
      createdAt: 10,
      updatedAt: 10,
    };
    const connection = {
      id: 'connection-one',
      enrollmentId: enrollment.id,
      scope: 'personal' as const,
      clubId: null,
      studioRiderId: null,
      state: 'connecting' as const,
      connectedAt: 100,
      connectedUntil: 14_400_100,
      remainingMs: 14_400_000,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    const native = {
      version: 1 as const,
      state: 'connecting' as const,
      scope: 'personal' as const,
      connectionId: connection.id,
      sessionId: `watch-connect:${connection.id}`,
      connectedUntil: connection.connectedUntil,
      remainingMs: connection.remainingMs,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: false,
    };
    const input = {
      accountId: 'account-one',
      hydratedAccountId: 'account-one',
      enrollment,
      connection,
      native,
      now: 200,
    };
    expect(watchConnectNeedsCredentialRecovery({ ...input, inFlight: false })).toBe(true);
    expect(watchConnectNeedsCredentialRecovery({
      ...input,
      inFlight: false,
      native: { ...native, workoutReady: false, requiresUserStart: true },
    })).toBe(true);
    expect(watchConnectNeedsCredentialRecovery({ ...input, inFlight: true })).toBe(false);
    expect(watchConnectNeedsCredentialRecovery({
      ...input,
      inFlight: false,
      native: { ...native, relayConfigured: true },
    })).toBe(false);
  });

  it('offers one safe retry when cloud is connecting but native did not prepare', () => {
    const connection = {
      id: 'connection-one',
      enrollmentId: 'enrollment-one',
      scope: 'personal' as const,
      clubId: null,
      studioRiderId: null,
      state: 'connecting' as const,
      connectedAt: 100,
      connectedUntil: 14_400_100,
      remainingMs: 14_400_000,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    const input = {
      accountId: 'account-one',
      hydratedAccountId: 'account-one',
      connection,
    };
    expect(watchConnectCanRetryCloudConnection({ ...input, native: null })).toBe(true);
    expect(watchConnectCanRetryCloudConnection({
      ...input,
      native: {
        version: 1,
        state: 'inactive',
        scope: null,
        connectionId: null,
        sessionId: null,
        connectedUntil: null,
        remainingMs: 0,
        requiresUserStart: true,
        workoutReady: false,
        relayConfigured: false,
      },
    })).toBe(true);
    expect(watchConnectCanRetryCloudConnection({
      ...input,
      native: {
        version: 1,
        state: 'connected',
        scope: 'studio',
        connectionId: 'foreign',
        sessionId: 'watch-connect:foreign',
        connectedUntil: connection.connectedUntil,
        remainingMs: connection.remainingMs,
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      },
    })).toBe(false);
  });

  it('ignores a cloud response that belongs to the previous signed-in account', () => {
    expect(watchConnectAccountRequestIsCurrent('account-old', 'account-new')).toBe(false);
    expect(watchConnectAccountRequestIsCurrent('account-new', 'account-new')).toBe(true);
  });

  it('suppresses legacy relays for any trusted account enrollment across scope changes', () => {
    const snapshot = {
      enrollments: [{
        id: 'studio-enrollment',
        scope: 'studio' as const,
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        state: 'trusted' as const,
        liveStudioConsent: false,
        sessionStudioConsent: true,
        createdAt: 10,
        updatedAt: 10,
      }],
      connections: [],
    };
    expect(watchConnectSuppressesLegacyRelay({
      accountId: 'account-one',
      hydratedAccountId: 'account-one',
      capable: true,
      snapshot,
      native: null,
    })).toBe(true);
    expect(watchConnectSuppressesLegacyRelay({
      accountId: 'account-one',
      hydratedAccountId: null,
      capable: null,
      snapshot: { enrollments: [], connections: [] },
      native: null,
    })).toBe(true);
  });

  it('blocks setup before server writes while a legacy Watch session is active or queued', () => {
    expect(watchConnectLegacyHeartRateIsBusy({
      version: 1,
      state: 'active',
      sessionId: 'legacy-account-block',
      at: 10,
    }, null)).toBe(true);
    expect(watchConnectLegacyHeartRateIsBusy(null, {
      version: 1,
      configured: false,
      syncing: true,
      clearing: false,
      queuedSessionIds: ['legacy-studio-block'],
      queuedCount: 1,
      pendingSampleCount: 1,
      droppedSampleCount: 0,
      sessions: [{
        sessionId: 'legacy-studio-block',
        scope: 'studio-block',
        state: 'syncing',
        finalized: true,
        pendingSampleCount: 1,
        droppedSampleCount: 0,
        streamCreated: true,
      }],
    })).toBe(true);
    expect(watchConnectLegacyHeartRateIsBusy({
      version: 1,
      state: 'active',
      sessionId: 'watch-connect:current',
      at: 10,
    }, null)).toBe(false);
  });
});
