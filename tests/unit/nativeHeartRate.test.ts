import { describe, expect, it, vi } from 'vitest';
import {
  createNativeHeartRateClient,
  nativeHeartRatePluginName,
  normalizeNativeHeartRateRelaySnapshot,
  normalizeNativeHeartRateStatus,
  normalizeNativeWatchConnectIdentity,
  normalizeNativeWatchConnectState,
  type NativeHeartRatePlugin,
  type NativeWatchConnectStart,
} from '../../src/lib/nativeHeartRate';

function fakeCapacitor(available: boolean) {
  return {
    getPlatform: () => available ? 'ios' : 'web',
    isNativePlatform: () => available,
    isPluginAvailable: (name: string) => available && name === nativeHeartRatePluginName,
  };
}

function fakePlugin() {
  const listeners = new Map<string, (event: never) => void>();
  const configureRelay = vi.fn(async ({ sessionId, scope }: { sessionId: string; scope: string }) => ({
    configured: true,
    sessionId,
    scope,
  }));
  const pauseRelay = vi.fn(async () => ({ configured: true, sessionId: 'session-1' }));
  const resumeRelay = vi.fn(async () => ({ configured: true, sessionId: 'session-1' }));
  const finalizeRelay = vi.fn(async () => ({ configured: false }));
  const clearRelay = vi.fn(async () => ({ configured: false }));
  const clearAllRelays = vi.fn(async () => ({ configured: false, queuedCount: 0 }));
  const getRelayState = vi.fn(async () => ({
    version: 5,
    configured: true,
    syncing: false,
    clearing: false,
    queuedSessionIds: ['session-finished'],
    queuedCount: 1,
    pendingSampleCount: 3,
    droppedSampleCount: 0,
    sessionId: 'session-active',
    scope: 'studio-block',
    sessions: [
      {
        sessionId: 'session-active',
        scope: 'studio-block',
        state: 'active',
        finalized: false,
        pendingSampleCount: 1,
        droppedSampleCount: 0,
        streamCreated: true,
      },
      {
        sessionId: 'session-finished',
        scope: 'personal-session',
        state: 'queued',
        finalized: true,
        pendingSampleCount: 2,
        droppedSampleCount: 0,
        streamCreated: true,
      },
    ],
  }));
  const getWatchConnectIdentity = vi.fn(async () => ({
    version: 1 as const,
    installId: `wci_${'a'.repeat(64)}`,
  }));
  const getWatchConnectState = vi.fn(async () => ({
    version: 1 as const,
    state: 'connected' as const,
    scope: 'studio' as const,
    connectionId: 'connection-1',
    sessionId: 'watch-connect:connection-1',
    connectedUntil: Date.now() + 60_000,
    remainingMs: 60_000,
    requiresUserStart: false,
    workoutReady: true,
    relayConfigured: true,
  }));
  const startWatchConnect = vi.fn(async ({
    pairingId,
    connectionId,
    relaySessionId,
    scope,
    expiresAt,
  }: {
    pairingId: string;
    connectionId: string;
    relaySessionId: string;
    scope: 'personal' | 'studio';
    expiresAt: number;
  }) => ({
    version: 1 as const,
    state: 'connected' as const,
    scope,
    connectionId,
    sessionId: relaySessionId,
    connectedUntil: expiresAt,
    remainingMs: Math.max(0, expiresAt - Date.now()),
    requiresUserStart: false,
    workoutReady: true,
    relayConfigured: true,
  }));
  const stopWatchConnect = vi.fn(async () => ({
    version: 1 as const,
    state: 'disconnecting' as const,
    scope: 'studio' as const,
    connectionId: 'connection-1',
    sessionId: 'watch-connect:connection-1',
    connectedUntil: Date.now() + 60_000,
    remainingMs: 60_000,
    requiresUserStart: false,
    workoutReady: true,
    relayConfigured: true,
  }));
  const plugin = {
    getAvailability: vi.fn(async () => ({
      version: 1 as const,
      supported: true,
      platform: 'iphone' as const,
      paired: true,
      watchAppInstalled: true,
      healthDataAvailable: true,
      minimumIOS: '17.0' as const,
      minimumWatchOS: '10.0' as const,
    })),
    getState: vi.fn(async () => ({
      version: 1 as const,
      state: 'idle' as const,
      sessionId: null,
      at: 10_000,
    })),
    startWorkout: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      version: 1 as const,
      state: 'active' as const,
      sessionId,
      at: 10_001,
    })),
    pauseWorkout: vi.fn(async () => ({
      version: 1 as const, state: 'paused' as const, sessionId: 'session-1', at: 10_002,
    })),
    resumeWorkout: vi.fn(async () => ({
      version: 1 as const, state: 'active' as const, sessionId: 'session-1', at: 10_003,
    })),
    endWorkout: vi.fn(async () => ({
      version: 1 as const, state: 'ended' as const, sessionId: 'session-1', at: 10_004,
      relay: {
        handled: true,
        configured: true,
        sessionId: 'session-1',
        scope: 'studio-block' as const,
        queued: true,
      },
    })),
    configureRelay,
    pauseRelay,
    resumeRelay,
    finalizeRelay,
    clearRelay,
    clearAllRelays,
    getRelayState,
    getWatchConnectIdentity,
    getWatchConnectState,
    startWatchConnect,
    stopWatchConnect,
    addListener: vi.fn(async (eventName: string, listener: (event: never) => void) => {
      listeners.set(eventName, listener);
      return { remove: async () => { listeners.delete(eventName); } };
    }),
  } as unknown as NativeHeartRatePlugin;
  return {
    plugin,
    listeners,
    configureRelay,
    pauseRelay,
    resumeRelay,
    finalizeRelay,
    clearRelay,
    clearAllRelays,
    getRelayState,
    getWatchConnectIdentity,
    getWatchConnectState,
    startWatchConnect,
    stopWatchConnect,
  };
}

describe('native Apple Watch heart-rate adapter', () => {
  it('feature-detects an old or web shell without throwing', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(false), plugin });

    expect(client.isPluginAvailable()).toBe(false);
    await expect(client.getAvailability()).resolves.toMatchObject({
      version: 1,
      supported: false,
      paired: false,
      watchAppInstalled: false,
      healthDataAvailable: false,
    });
    await expect(client.getState()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(client.addSampleListener(vi.fn())).resolves.toHaveProperty('remove');
  });

  it('preserves Apple Watch measuredAt while normalizing native sample events', async () => {
    const { plugin, listeners } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    const received = vi.fn();

    await client.addSampleListener(received);
    listeners.get('heartRateSample')?.({
      version: 1,
      sessionId: 'session-1',
      sequence: 7,
      bpm: 156,
      measuredAt: 20_000,
      receivedAt: 24_000,
      source: 'apple-watch',
    } as never);

    expect(received).toHaveBeenCalledWith({
      source: 'apple-watch',
      sessionId: 'session-1',
      sequence: 7,
      bpm: 156,
      recordedAt: 20_000,
      receivedAt: 24_000,
    });
  });

  it('normalizes workout actions and rejects an empty session nonfatally', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });

    await expect(client.startWorkout(' session-1 ')).resolves.toMatchObject({
      state: 'active', sessionId: 'session-1',
    });
    expect(plugin.startWorkout).toHaveBeenCalledWith({ sessionId: 'session-1' });
    await expect(client.startWorkout(' ')).resolves.toMatchObject({ state: 'error' });
    await expect(client.endWorkout()).resolves.toMatchObject({
      state: 'ended',
      relay: {
        handled: true,
        configured: true,
        sessionId: 'session-1',
        scope: 'studio-block',
        queued: true,
      },
    });
  });

  it('configures and finalizes the private background relay without returning its ingest token', async () => {
    const {
      plugin,
      configureRelay,
      pauseRelay,
      resumeRelay,
      finalizeRelay,
      clearRelay,
    } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    const configured = await client.configureRelay({
      baseUrl: 'https://tracklab-bmx.onrender.com/',
      ingestToken: 'private-one-time-token',
      sessionId: ' session-1 ',
      startedAt: 10_000.4,
      activeElapsedAtStartMs: 900.6,
    });

    expect(configured).toEqual({
      configured: true,
      sessionId: 'session-1',
      scope: 'personal-session',
    });
    expect(configured).not.toHaveProperty('ingestToken');
    expect(configureRelay).toHaveBeenCalledWith({
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-one-time-token',
      sessionId: 'session-1',
      scope: 'personal-session',
      startedAt: 10_000,
      activeElapsedAtStartMs: 901,
    });
    await expect(client.pauseRelay({ sessionId: ' session-1 ', at: 15_000.2, activeElapsedMs: 4_500.6 }))
      .resolves.toEqual({ configured: true, sessionId: 'session-1' });
    expect(pauseRelay).toHaveBeenCalledWith({ sessionId: 'session-1', at: 15_000, activeElapsedMs: 4_501 });
    await expect(client.resumeRelay({ sessionId: ' session-1 ', at: 16_000.2, activeElapsedMs: 4_500.6 }))
      .resolves.toEqual({ configured: true, sessionId: 'session-1' });
    expect(resumeRelay).toHaveBeenCalledWith({ sessionId: 'session-1', at: 16_000, activeElapsedMs: 4_501 });
    await expect(client.finalizeRelay({
      sessionId: ' session-1 ',
      endedAt: 20_000.2,
      activeDurationMs: 9_000.7,
      zones: [{
        zoneId: ' zone-1 ',
        zoneName: ' Zone 1 ',
        startElapsedMs: 0.2,
        endElapsedMs: 4_500.4,
      }],
    }))
      .resolves.toEqual({ configured: false });
    expect(finalizeRelay).toHaveBeenCalledWith({
      sessionId: 'session-1',
      endedAt: 20_000,
      activeDurationMs: 9_001,
      zones: [{
        zoneId: 'zone-1',
        zoneName: 'Zone 1',
        startElapsedMs: 0,
        endElapsedMs: 4_500,
      }],
    });
    const validFinalizeCalls = finalizeRelay.mock.calls.length;
    await expect(client.finalizeRelay({
      sessionId: 'session-1',
      endedAt: 20_000,
      activeDurationMs: 9_000,
      zones: [
        { zoneId: 'same', startElapsedMs: 0, endElapsedMs: 5_000 },
        { zoneId: 'same', startElapsedMs: 4_000, endElapsedMs: 8_000 },
      ],
    })).resolves.toMatchObject({ configured: false });
    expect(finalizeRelay).toHaveBeenCalledTimes(validFinalizeCalls);
    const maximumZones = Array.from({ length: 500 }, (_, index) => ({
      zoneId: `zone-${index}`,
      startElapsedMs: index * 10,
      endElapsedMs: (index + 1) * 10,
    }));
    await client.finalizeRelay({
      sessionId: 'session-1',
      endedAt: 20_000,
      activeDurationMs: 5_000,
      zones: maximumZones,
    });
    expect(finalizeRelay).toHaveBeenLastCalledWith(expect.objectContaining({
      zones: maximumZones,
    }));
    const maximumZoneCalls = finalizeRelay.mock.calls.length;
    await client.finalizeRelay({
      sessionId: 'session-1',
      endedAt: 20_000,
      activeDurationMs: 5_010,
      zones: [...maximumZones, {
        zoneId: 'zone-500',
        startElapsedMs: 5_000,
        endElapsedMs: 5_010,
      }],
    });
    expect(finalizeRelay).toHaveBeenCalledTimes(maximumZoneCalls);
    await expect(client.clearRelay({ sessionId: ' session-1 ' })).resolves.toEqual({ configured: false });
    expect(clearRelay).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(clearRelay).toHaveBeenCalledOnce();
  });

  it('preserves account blocks as a distinct continuous native relay scope', async () => {
    const { plugin, configureRelay } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });

    await expect(client.configureRelay({
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-account-block-token',
      sessionId: 'account-block:session-1',
      scope: 'account-block',
      startedAt: 10_000,
    })).resolves.toEqual({
      configured: true,
      sessionId: 'account-block:session-1',
      scope: 'account-block',
    });
    expect(configureRelay).toHaveBeenLastCalledWith({
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-account-block-token',
      sessionId: 'account-block:session-1',
      scope: 'account-block',
      startedAt: 10_000,
    });

    expect(normalizeNativeHeartRateStatus({
      version: 1,
      state: 'ended',
      sessionId: 'watch-block:account-1:workout-1',
      at: 20_000,
      relay: {
        handled: true,
        configured: true,
        sessionId: 'account-block:session-1',
        scope: 'account-block',
        queued: true,
      },
    })).toMatchObject({
      state: 'ended',
      relay: {
        handled: true,
        sessionId: 'account-block:session-1',
        scope: 'account-block',
        queued: true,
      },
    });

    expect(normalizeNativeHeartRateRelaySnapshot({
      version: 5,
      configured: false,
      syncing: false,
      clearing: false,
      queuedSessionIds: ['account-block:session-1'],
      queuedCount: 1,
      pendingSampleCount: 4,
      droppedSampleCount: 0,
      sessions: [{
        sessionId: 'account-block:session-1',
        scope: 'account-block',
        state: 'queued',
        finalized: true,
        pendingSampleCount: 4,
        droppedSampleCount: 0,
        streamCreated: true,
      }],
      reason: 'queued',
    })).toMatchObject({
      queuedSessionIds: ['account-block:session-1'],
      sessions: [{
        sessionId: 'account-block:session-1',
        scope: 'account-block',
        finalized: true,
      }],
    });
  });

  it('normalizes the durable multi-session relay queue and clears every credential at sign-out', async () => {
    const { plugin, listeners, clearAllRelays } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    const relayListener = vi.fn();

    await expect(client.getRelayState()).resolves.toMatchObject({
      version: 5,
      configured: true,
      scope: 'studio-block',
      queuedSessionIds: ['session-finished'],
      queuedCount: 1,
      pendingSampleCount: 3,
      sessions: [
        { sessionId: 'session-active', scope: 'studio-block', state: 'active', finalized: false },
        { sessionId: 'session-finished', scope: 'personal-session', state: 'queued', finalized: true },
      ],
    });
    await client.addRelayStatusListener(relayListener);
    listeners.get('heartRateRelayStatus')?.({
      ...(await plugin.getRelayState!()),
      reason: 'retryScheduled',
    } as never);
    expect(relayListener).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'retryScheduled',
      queuedCount: 1,
    }));
    await expect(client.clearAllRelays()).resolves.toEqual({ configured: false });
    expect(clearAllRelays).toHaveBeenCalledOnce();
  });

  it('starts a renewable four-hour Watch Connect session without exposing credentials in status', async () => {
    const {
      plugin,
      getWatchConnectIdentity,
      startWatchConnect,
      stopWatchConnect,
    } = fakePlugin();
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    const expiresAt = Date.now() + 4 * 60 * 60 * 1_000 - 1_000;

    await expect(client.getWatchConnectIdentity()).resolves.toEqual({
      version: 1,
      installId: `wci_${'a'.repeat(64)}`,
    });
    expect(getWatchConnectIdentity).toHaveBeenCalledOnce();
    const started = await client.startWatchConnect({
      scope: 'studio',
      connectionId: ' connection-1 ',
      pairingId: ' pairing-1 ',
      relaySessionId: ' watch-connect:connection-1 ',
      baseUrl: 'https://tracklab-bmx.onrender.com/',
      ingestToken: 'private-native-ingest-token',
      expiresAt,
    });
    expect(startWatchConnect).toHaveBeenCalledWith({
      scope: 'studio',
      connectionId: 'connection-1',
      pairingId: 'pairing-1',
      relaySessionId: 'watch-connect:connection-1',
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-native-ingest-token',
      expiresAt,
    });
    expect(started).toMatchObject({
      state: 'connected',
      scope: 'studio',
      connectedUntil: expiresAt,
      requiresUserStart: false,
    });
    expect(started).not.toHaveProperty('installId');
    expect(started).not.toHaveProperty('ingestToken');

    await expect(client.stopWatchConnect()).resolves.toMatchObject({
      state: 'disconnecting',
    });
    expect(stopWatchConnect).toHaveBeenCalledOnce();
  });

  it('does not resolve Watch Connect while native is still waiting for the mirrored workout', async () => {
    const { plugin } = fakePlugin();
    let releaseReady: (() => void) | undefined;
    plugin.startWatchConnect = vi.fn(async (options: NativeWatchConnectStart) => {
      await new Promise<void>((resolve) => { releaseReady = resolve; });
      return {
        version: 1 as const,
        state: 'connected' as const,
        scope: options.scope,
        connectionId: options.connectionId,
        sessionId: options.relaySessionId,
        connectedUntil: options.expiresAt,
        remainingMs: Math.max(0, options.expiresAt - Date.now()),
        requiresUserStart: false,
        workoutReady: true,
        relayConfigured: true,
      };
    });
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    let resolved = false;
    const pending = client.startWatchConnect({
      scope: 'studio',
      connectionId: 'connection-ready',
      pairingId: 'pairing-ready',
      relaySessionId: 'watch-connect:connection-ready',
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-native-ingest-token',
      expiresAt: Date.now() + 60_000,
    }).then((state) => {
      resolved = true;
      return state;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    releaseReady?.();
    await expect(pending).resolves.toMatchObject({ state: 'connected' });
  });

  it('surfaces a bounded native workout-readiness timeout without reporting Connected', async () => {
    const { plugin } = fakePlugin();
    plugin.startWatchConnect = vi.fn(async () => {
      throw new Error('Watch Connect timed out before the Apple Watch workout became active.');
    });
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    await expect(client.startWatchConnect({
      scope: 'personal',
      connectionId: 'connection-timeout',
      pairingId: 'pairing-timeout',
      relaySessionId: 'watch-connect:connection-timeout',
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-native-ingest-token',
      expiresAt: Date.now() + 60_000,
    })).resolves.toMatchObject({
      state: 'error',
      reason: 'Watch Connect timed out before the Apple Watch workout became active.',
    });
  });

  it('preserves the process-relaunch signal for an active workout awaiting refreshed relay credentials', () => {
    expect(normalizeNativeWatchConnectState({
      version: 1,
      state: 'connecting',
      scope: 'studio',
      connectionId: 'connection-recovered',
      sessionId: 'watch-connect:connection-recovered',
      connectedUntil: Date.now() + 60_000,
      remainingMs: 60_000,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: false,
    })).toMatchObject({
      state: 'connecting',
      connectionId: 'connection-recovered',
      workoutReady: true,
      relayConfigured: false,
    });
  });

  it('preserves the pre-launch process-relaunch signal that requires one real Watch Connect retry', () => {
    expect(normalizeNativeWatchConnectState({
      version: 1,
      state: 'connecting',
      scope: 'personal',
      connectionId: 'connection-prelaunch',
      sessionId: 'watch-connect:connection-prelaunch',
      connectedUntil: Date.now() + 60_000,
      remainingMs: 60_000,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    })).toMatchObject({
      state: 'connecting',
      connectionId: 'connection-prelaunch',
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    });
  });

  it('rejects install identity leakage from routine Watch Connect state and status events', () => {
    const routineState = {
      version: 1,
      state: 'connected',
      scope: 'studio',
      connectionId: 'connection-1',
      sessionId: 'watch-connect:connection-1',
      connectedUntil: 20_000,
      remainingMs: 10_000,
      requiresUserStart: false,
      workoutReady: true,
      relayConfigured: true,
    };
    expect(normalizeNativeWatchConnectState(routineState)).toEqual(routineState);
    expect(normalizeNativeWatchConnectState({
      ...routineState,
      installId: `wci_${'b'.repeat(64)}`,
    })).toBeNull();
    expect(normalizeNativeHeartRateStatus({
      version: 1,
      state: 'active',
      sessionId: 'watch-connect:pairing-1',
      at: 10_000,
      watchConnect: {
        ...routineState,
        installId: `wci_${'b'.repeat(64)}`,
      },
    })).toBeNull();
    expect(normalizeNativeWatchConnectIdentity({
      version: 1,
      installId: `wci_${'b'.repeat(64)}`,
    })).toEqual({ version: 1, installId: `wci_${'b'.repeat(64)}` });
  });

  it('classifies callable Capacitor proxies from an older iOS build as requiring the latest build', async () => {
    const { plugin } = fakePlugin();
    plugin.getWatchConnectState = vi.fn(async () => {
      throw new Error('TrackLabHeartRate.getWatchConnectState() is not implemented on ios');
    });
    plugin.startWatchConnect = vi.fn(async () => {
      throw new Error('TrackLabHeartRate.startWatchConnect() is not implemented on ios');
    });
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });
    await expect(client.getWatchConnectState()).resolves.toMatchObject({
      state: 'inactive',
      reason: 'Install the latest TrackLab build to use Watch Connect.',
    });
    await expect(client.startWatchConnect({
      scope: 'personal',
      connectionId: 'connection-old-build',
      pairingId: 'pairing-old-build',
      relaySessionId: 'watch-connect:connection-old-build',
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'private-native-ingest-token',
      expiresAt: Date.now() + 60_000,
    })).resolves.toMatchObject({
      state: 'inactive',
      reason: 'Install the latest TrackLab build to use Watch Connect.',
    });
  });

  it('keeps optional relay methods backward-compatible with a prior native build', async () => {
    const { plugin } = fakePlugin();
    delete plugin.configureRelay;
    delete plugin.pauseRelay;
    delete plugin.resumeRelay;
    delete plugin.finalizeRelay;
    delete plugin.clearRelay;
    delete plugin.clearAllRelays;
    delete plugin.getRelayState;
    const client = createNativeHeartRateClient({ capacitor: fakeCapacitor(true), plugin });

    await expect(client.configureRelay({
      baseUrl: 'https://tracklab-bmx.onrender.com',
      ingestToken: 'token',
      sessionId: 'session-1',
      startedAt: 10_000,
    })).resolves.toMatchObject({ configured: false });
    await expect(client.pauseRelay({ sessionId: 'session-1', at: 15_000, activeElapsedMs: 5_000 }))
      .resolves.toMatchObject({ configured: false });
    await expect(client.resumeRelay({ sessionId: 'session-1', at: 16_000, activeElapsedMs: 5_000 }))
      .resolves.toMatchObject({ configured: false });
    await expect(client.finalizeRelay({ sessionId: 'session-1', endedAt: 20_000, activeDurationMs: 10_000 }))
      .resolves.toMatchObject({ configured: false });
    await expect(client.clearRelay({ sessionId: 'session-1' })).resolves.toMatchObject({ configured: false });
    await expect(client.clearAllRelays()).resolves.toMatchObject({ configured: false });
    await expect(client.getRelayState()).resolves.toMatchObject({ configured: false, queuedCount: 0 });
  });
});
