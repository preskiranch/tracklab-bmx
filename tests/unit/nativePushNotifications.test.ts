import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createNativePushClient,
  disableNativePushDelivery,
  nativePushDeliveryCleanupTimeoutMs,
  nativePushInstallationPluginName,
  nativePushRequestTimeoutMs,
  normalizeNativePushDeviceToken,
  normalizeNativePushInstallation,
  normalizeNativePushPreferences,
  normalizeNativePushRoute,
  unregisterAndClearDeliveredSocialNotifications,
  type NativePushInstallationPlugin,
} from '../../src/lib/nativePushNotifications';
import {
  clearNativePushDeliveredSocialBoundary,
  cleanupNativePushBoundary,
  logoutThenClearNativePushDeliveredSocialNotifications,
  nativePushForegroundCopy,
  pushRequestIsCurrent,
  rememberNativePushNotification,
  resolveNativePushAccountBoundary,
  startNativePushAccountSetup,
} from '../../src/components/NativeNotificationsCoordinator';

const installation = {
  version: 1 as const,
  installationId: '8ad02b22-4526-4b02-b4aa-1ca1700cda51',
  credential: 'A'.repeat(43),
  environment: 'sandbox' as const,
  appBuild: '12',
  osVersion: '26.0.1',
};
const preferences = {
  liveAudio: true,
  friendRequests: false,
  friendConnections: true,
  trackShares: false,
};
const token = 'ab'.repeat(32);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function detector(available = true) {
  return {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => available
      && (name === 'PushNotifications' || name === nativePushInstallationPluginName),
  };
}

function nativePlugin(): NativePushInstallationPlugin {
  return {
    getInstallation: vi.fn(async () => installation),
    openSettings: vi.fn(async () => undefined),
    clearDeliveredSocialNotifications: vi.fn(async () => ({ removed: 0 })),
  };
}

function pushPlugin() {
  return {
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ receive: 'prompt' as const })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' as const })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  } as never;
}

describe('native push adapter', () => {
  it('strictly normalizes Keychain identity, token, preferences, and minimal routes', () => {
    expect(normalizeNativePushInstallation(installation)).toEqual(installation);
    expect(normalizeNativePushInstallation({ ...installation, credential: 'A'.repeat(42) })).toBeNull();
    expect(normalizeNativePushInstallation({ ...installation, environment: 'production-ish' })).toBeNull();
    expect(normalizeNativePushDeviceToken(`<${token.toUpperCase()}>`)).toBe(token);
    expect(normalizeNativePushDeviceToken('token-that-is-not-hex')).toBe('');
    expect(normalizeNativePushPreferences({ preferences })).toEqual(preferences);
    expect(normalizeNativePushPreferences({ preferences: { ...preferences, trackShares: 'yes' } })).toBeNull();

    const route = {
      v: 1,
      kind: 'live_audio_invite',
      notificationId: '0b8a3c8b-39de-41a9-b65d-200100000001',
      route: 'friends',
    };
    expect(normalizeNativePushRoute(route)).toEqual(route);
    expect(normalizeNativePushRoute({ ...route, route: 'room', roomId: 'private' })).toBeNull();
    expect(normalizeNativePushRoute({ ...route, kind: 'message', body: 'private' })).toBeNull();
  });

  it('uses the frozen credential contract without echoing secrets into URLs', async () => {
    const native = nativePlugin();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      if (path === '/api/push/preferences' && !init?.method) return response({ preferences });
      if (path === '/api/push/preferences' && init?.method === 'PATCH') {
        return response({ preferences: { ...preferences, liveAudio: false } });
      }
      if (path.includes('/api/push/installations/') && init?.method === 'PUT') {
        return response({ installation: {
          id: installation.installationId,
          environment: installation.environment,
          permissionStatus: 'granted',
          registeredAt: '2026-08-25T12:00:00.000Z',
          lastSeenAt: '2026-08-25T12:00:00.000Z',
        } });
      }
      if (path.includes('/api/push/installations/') && init?.method === 'DELETE') {
        return response({ removed: true });
      }
      return response({ error: 'unexpected' }, 500);
    });
    const client = createNativePushClient({
      capacitor: detector(),
      native,
      push: pushPlugin(),
      fetcher,
    });

    await expect(client.loadPreferences()).resolves.toEqual(preferences);
    await expect(client.savePreferences({ liveAudio: false })).resolves.toEqual({
      ...preferences,
      liveAudio: false,
    });
    await expect(client.bindInstallation(installation, token)).resolves.toBeUndefined();
    await expect(client.removeInstallation(installation)).resolves.toBeUndefined();
    await expect(client.clearDeliveredSocialNotifications()).resolves.toBeUndefined();
    expect(native.clearDeliveredSocialNotifications).toHaveBeenCalledOnce();

    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(String(put?.[0])).toBe(`/api/push/installations/${installation.installationId}`);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      credential: installation.credential,
      deviceToken: token,
      environment: 'sandbox',
      permissionStatus: 'granted',
      protocolVersion: 1,
      appBuild: '12',
      osVersion: '26.0.1',
    });
    expect(String(put?.[0])).not.toContain(installation.credential);
    expect(String(put?.[0])).not.toContain(token);
    const deletion = fetcher.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ credential: installation.credential });
  });

  it('feature-detects old shells and never asks permission from a check', async () => {
    const push = pushPlugin() as any;
    const client = createNativePushClient({
      capacitor: detector(false),
      native: nativePlugin(),
      push,
      fetcher: vi.fn(),
    });
    expect(client.isNativeIos()).toBe(true);
    expect(client.isAvailable()).toBe(false);
    await expect(client.checkPermission()).rejects.toThrow('build 12');
    expect(push.requestPermissions).not.toHaveBeenCalled();
  });

  it('unregisters and drains retained actions in Club Tablet mode', async () => {
    const received = vi.fn(async () => ({ remove: vi.fn(async () => undefined) }));
    const actions = vi.fn(async () => ({ remove: vi.fn(async () => undefined) }));
    const unregister = vi.fn(async () => undefined);
    const clearDeliveredSocialNotifications = vi.fn(async () => undefined);
    await disableNativePushDelivery({
      isAvailable: () => true,
      addReceivedListener: received,
      addActionListener: actions,
      unregister,
      clearDeliveredSocialNotifications,
    } as any);
    expect(received).toHaveBeenCalledOnce();
    expect(actions).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(clearDeliveredSocialNotifications).toHaveBeenCalledOnce();
    expect(unregister.mock.invocationCallOrder[0])
      .toBeLessThan(clearDeliveredSocialNotifications.mock.invocationCallOrder[0]);
  });

  it('does not let a blackholed retained-action listener block kiosk cleanup', async () => {
    vi.useFakeTimers();
    try {
      const unregister = vi.fn(async () => undefined);
      const clearDeliveredSocialNotifications = vi.fn(async () => undefined);
      const cleanup = disableNativePushDelivery({
        isAvailable: () => true,
        addReceivedListener: vi.fn(() => new Promise(() => undefined)),
        addActionListener: vi.fn(() => new Promise(() => undefined)),
        unregister,
        clearDeliveredSocialNotifications,
      } as any);
      await vi.advanceTimersByTimeAsync(150);
      await expect(cleanup).resolves.toBeUndefined();
      expect(unregister).toHaveBeenCalledOnce();
      expect(clearDeliveredSocialNotifications).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid native Notification Center cleanup response', async () => {
    const native = nativePlugin();
    vi.mocked(native.clearDeliveredSocialNotifications).mockResolvedValue({ removed: -1 });
    const client = createNativePushClient({
      capacitor: detector(),
      native,
      push: pushPlugin(),
      fetcher: vi.fn(),
    });
    await expect(client.clearDeliveredSocialNotifications()).rejects.toThrow('invalid response');
  });

  it('bounds a blackholed unregister but still performs cold-safe selective cleanup', async () => {
    vi.useFakeTimers();
    try {
      const clearDeliveredSocialNotifications = vi.fn(async () => undefined);
      const cleanup = unregisterAndClearDeliveredSocialNotifications({
        unregister: vi.fn(() => new Promise<void>(() => undefined)),
        clearDeliveredSocialNotifications,
      }, 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(cleanup).resolves.toBe(false);
      expect(clearDeliveredSocialNotifications).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a blackholed selective cleanup after unregister', async () => {
    vi.useFakeTimers();
    try {
      const cleanup = unregisterAndClearDeliveredSocialNotifications({
        unregister: vi.fn(async () => undefined),
        clearDeliveredSocialNotifications: vi.fn(() => new Promise<void>(() => undefined)),
      }, nativePushDeliveryCleanupTimeoutMs);
      await vi.advanceTimersByTimeAsync(nativePushDeliveryCleanupTimeoutMs);
      await expect(cleanup).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a blackholed API request at the bounded client deadline', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null = null;
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      });
      const client = createNativePushClient({
        capacitor: detector(),
        native: nativePlugin(),
        push: pushPlugin(),
        fetcher,
      });
      const binding = client.bindInstallation(installation, token);
      const rejected = expect(binding).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(nativePushRequestTimeoutMs);
      await rejected;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('native push account and duplicate fences', () => {
  it('re-clears delivered social pushes only after authoritative logout resolves', async () => {
    const order: string[] = [];
    const logout = vi.fn(async () => { order.push('server logout'); });
    const cleanup = vi.fn(async () => { order.push('social push cleanup'); });
    await logoutThenClearNativePushDeliveredSocialNotifications(logout, cleanup);
    expect(order).toEqual(['server logout', 'social push cleanup']);

    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const signOutStart = appSource.indexOf('const handleSignOut = useCallback(async () =>');
    const localSignOut = appSource.indexOf('setAuthUser(null);', signOutStart);
    const signOutSource = appSource.slice(signOutStart, localSignOut);
    expect(signOutSource).toContain(
      'logoutThenClearNativePushDeliveredSocialNotifications(logoutAuthUser)',
    );
  });

  it('does not run the post-logout cleanup when authoritative logout fails', async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(logoutThenClearNativePushDeliveredSocialNotifications(
      vi.fn(async () => { throw new Error('logout failed'); }),
      cleanup,
    )).rejects.toThrow('logout failed');
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('bounds post-logout selective cleanup without invoking Recovery cleanup', async () => {
    vi.useFakeTimers();
    try {
      const client = {
        isAvailable: () => true,
        clearDeliveredSocialNotifications: vi.fn(() => new Promise<void>(() => undefined)),
      };
      const cleanup = clearNativePushDeliveredSocialBoundary(client, 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(cleanup).resolves.toBe(false);
      expect(client.clearDeliveredSocialNotifications).toHaveBeenCalledOnce();

      const source = readFileSync(
        new URL('../../src/components/NativeNotificationsCoordinator.tsx', import.meta.url),
        'utf8',
      );
      const start = source.indexOf('export async function clearNativePushDeliveredSocialBoundary');
      const end = source.indexOf('export async function logoutThenClearNativePushDeliveredSocialNotifications');
      expect(source.slice(start, end)).not.toContain('Recovery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects stale account generations and isolates action/foreground dedupe sets', () => {
    expect(pushRequestIsCurrent('account-a', 'account-a', 4, 4)).toBe(true);
    expect(pushRequestIsCurrent('account-a', 'account-b', 4, 4)).toBe(false);
    expect(pushRequestIsCurrent('account-a', 'account-a', 3, 4)).toBe(false);

    const foreground = new Set<string>();
    const actions = new Set<string>();
    expect(rememberNativePushNotification(foreground, 'notification-1')).toBe(true);
    expect(rememberNativePushNotification(foreground, 'notification-1')).toBe(false);
    expect(rememberNativePushNotification(actions, 'notification-1')).toBe(true);
  });

  it('holds a cold action through loading, then assigns it to the exact personal account', () => {
    expect(resolveNativePushAccountBoundary('loading', null, false)).toBeUndefined();
    expect(resolveNativePushAccountBoundary('signed-in', 'account-a', false)).toBe('account-a');
    expect(resolveNativePushAccountBoundary('signed-out', null, false)).toBeNull();
    expect(resolveNativePushAccountBoundary('signed-in', 'account-a', true)).toBeNull();
  });

  it('shows generic foreground friend activity without duplicating the live-audio card', () => {
    expect(nativePushForegroundCopy('friend_request')).toEqual({
      title: 'New friend request',
      detail: 'Open Friends to review the request.',
    });
    expect(nativePushForegroundCopy('friend_connection')?.title).toBe('New friend connection');
    expect(nativePushForegroundCopy('track_share')?.title).toBe('A friend shared a track');
    expect(nativePushForegroundCopy('live_audio_invite')).toBeNull();
  });

  it('makes the installation available even when preferences fail, so a retry token can bind', async () => {
    const bindInstallation = vi.fn(async () => undefined);
    const setup = await startNativePushAccountSetup({
      getInstallation: vi.fn(async () => installation),
      loadPreferences: vi.fn(async () => { throw new Error('temporary preferences failure'); }),
    });
    await bindInstallation(setup.installation, token);
    expect(bindInstallation).toHaveBeenCalledWith(installation, token);
    await expect(setup.preferences).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: 'temporary preferences failure' }),
    });
  });

  it('never lets an unresolved registration flight block account cleanup forever', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<void>(() => undefined);
      const cancelRequests = vi.fn();
      const cleanup = cleanupNativePushBoundary({
        cancelRequests,
        removeInstallation: vi.fn(() => never),
        unregister: vi.fn(() => never),
        clearDeliveredSocialNotifications: vi.fn(async () => undefined),
      }, installation, [never], 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(cleanup).resolves.toBe(false);
      expect(cancelRequests).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still unregisters native delivery when the post-enrollment server DELETE is unauthorized', async () => {
    const unregister = vi.fn(async () => undefined);
    const clearDeliveredSocialNotifications = vi.fn(async () => undefined);
    await expect(cleanupNativePushBoundary({
      cancelRequests: vi.fn(),
      removeInstallation: vi.fn(async () => { throw new Error('401 signed out'); }),
      unregister,
      clearDeliveredSocialNotifications,
    }, installation, [], 25)).resolves.toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(clearDeliveredSocialNotifications).toHaveBeenCalledOnce();
    expect(unregister.mock.invocationCallOrder[0])
      .toBeLessThan(clearDeliveredSocialNotifications.mock.invocationCallOrder[0]);
  });

  it('keeps bounded dedupe history and never autojoins or starts the microphone', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 150; index += 1) {
      rememberNativePushNotification(seen, `notification-${index}`);
    }
    expect(seen.size).toBe(128);
    expect(seen.has('notification-0')).toBe(false);
    expect(seen.has('notification-149')).toBe(true);

    const source = readFileSync(
      new URL('../../src/components/NativeNotificationsCoordinator.tsx', import.meta.url),
      'utf8',
    );
    const hydration = source.slice(source.indexOf('const configure = async'), source.indexOf('const enable = useCallback'));
    expect(hydration).not.toContain('requestPermission(');
    expect(hydration).not.toContain('joinRoom');
    expect(hydration).not.toContain('voice.start');
    expect(source).toContain('onFriendsActivity(opened);');
    expect(source).toContain('foregroundNotice.accountId === accountId');
    expect(source).toContain('>View Friends</button>');
    expect(source).toContain('>Dismiss</button>');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Choose which friend activity can alert this personal TrackLab account.');
    expect(source).not.toContain('when the app is not open');
    expect(source.indexOf('if (requestedAccountId === undefined) return undefined;'))
      .toBeLessThan(source.indexOf('client.addActionListener'));
  });
});
