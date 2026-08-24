import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WatchConnectIndicator } from '../../src/components/WatchConnectIndicator';
import type { HeartRateLiveEvent } from '../../src/lib/heartRateCloud';
import type { NativeWatchConnectState } from '../../src/lib/nativeHeartRate';
import type { WatchConnectConnection, WatchConnectEnrollment } from '../../src/lib/watchConnect';
import {
  resolveWatchConnectIndicatorState,
  watchConnectLiveEventIsFresh,
} from '../../src/lib/watchConnectIndicator';

const now = 1_000_000;
const accountId = 'athlete-one';
const enrollment: WatchConnectEnrollment = {
  id: 'enrollment-one',
  scope: 'personal',
  clubId: null,
  studioRiderId: null,
  state: 'trusted',
  liveStudioConsent: false,
  sessionStudioConsent: false,
  createdAt: now - 60_000,
  updatedAt: now - 60_000,
};
const connection: WatchConnectConnection = {
  id: 'connection-one',
  enrollmentId: enrollment.id,
  scope: 'personal',
  clubId: null,
  studioRiderId: null,
  state: 'connected',
  connectedAt: now - 60_000,
  connectedUntil: now + 14_400_000,
  remainingMs: 14_400_000,
  liveStudioConsent: false,
  sessionStudioConsent: false,
};
const native: NativeWatchConnectState = {
  version: 1,
  state: 'connected',
  scope: connection.scope,
  connectionId: connection.id,
  sessionId: `watch-connect:${connection.id}`,
  connectedUntil: connection.connectedUntil,
  remainingMs: connection.remainingMs,
  requiresUserStart: false,
  workoutReady: true,
  relayConfigured: true,
};
const event: HeartRateLiveEvent = {
  streamId: 'stream-one',
  sessionId: `watch-connect:${connection.id}`,
  relayScope: 'account-block',
  riderId: `account:${accountId}`,
  playerId: null,
  bpm: 151,
  recordedAt: now - 500,
  receivedAt: now - 100,
  freshUntil: now + 9_500,
  activeElapsedMs: 20_000,
};

function resolve(overrides: Partial<Parameters<typeof resolveWatchConnectIndicatorState>[0]> = {}) {
  return resolveWatchConnectIndicatorState({
    accountId,
    hydratedAccountId: accountId,
    capable: true,
    enrollment,
    connection,
    native,
    readOnlyObserver: false,
    event,
    now,
    ...overrides,
  });
}

describe('global Watch Connect indicator', () => {
  it('calls BPM live only for an exact fresh account/session and paired-iPhone identity', () => {
    expect(resolve()).toMatchObject({ phase: 'live', label: 'Watch live' });
    expect(resolve({ native: { ...native, connectionId: 'foreign' } })).toMatchObject({
      phase: 'disconnected',
      label: 'Watch disconnected',
    });
    expect(resolve({ event: { ...event, riderId: 'account:athlete-two' } })).toMatchObject({
      phase: 'connected',
    });
    expect(resolve({ event: { ...event, sessionId: 'watch-connect:foreign' } })).toMatchObject({
      phase: 'connected',
    });
  });

  it('lets a same-account iPad observe exact fresh cloud state without gaining native controls', () => {
    expect(resolve({ native: null, readOnlyObserver: true })).toMatchObject({
      phase: 'live',
      detail: 'Live through the paired iPhone.',
    });
    expect(watchConnectLiveEventIsFresh({
      accountId,
      connection,
      event: { ...event, recordedAt: now - 10_000, freshUntil: now },
      now,
    })).toBe(false);
  });

  it('keeps an exact active session connected while stale heart rate remains unusable', () => {
    const staleEvent = { ...event, recordedAt: now - 10_001, freshUntil: now - 1 };
    expect(resolve({ event: staleEvent })).toMatchObject({
      phase: 'connected',
      label: 'Watch connected',
      detail: 'Apple Watch is connected. Waiting for a fresh heart rate reading.',
    });
    expect(resolve({ native: null, readOnlyObserver: true, event: staleEvent })).toMatchObject({
      phase: 'connected',
      label: 'Watch connected',
      detail: 'Connected through the paired iPhone. Waiting for a fresh heart rate reading.',
    });
    expect(watchConnectLiveEventIsFresh({ accountId, connection, event: staleEvent, now }))
      .toBe(false);
    expect(resolve({
      connection: { ...connection, connectedUntil: now },
      native: { ...native, connectedUntil: now },
      event: null,
    })).toMatchObject({ phase: 'disconnected', label: 'Watch disconnected' });
    expect(resolve({ enrollment: { ...enrollment, state: 'revoked' }, event: null }))
      .toMatchObject({ phase: 'disconnected', label: 'Watch disconnected' });
    expect(resolve({ hydratedAccountId: 'athlete-two', event: null }))
      .toMatchObject({ phase: 'checking', label: 'Watch checking' });
  });

  it('lets exact fresh evidence override a cached connecting row on iPhone and iPad', () => {
    const cachedConnecting = { ...connection, state: 'connecting' as const };
    expect(resolve({ connection: cachedConnecting })).toMatchObject({ phase: 'live' });
    expect(resolve({
      connection: cachedConnecting,
      native: null,
      readOnlyObserver: true,
    })).toMatchObject({ phase: 'live' });
    expect(resolve({ connection: cachedConnecting, event: null })).toMatchObject({
      phase: 'connected',
      label: 'Watch connected',
    });
  });

  it('lets definitive native stop and error states beat the last fresh event', () => {
    expect(resolve({ native: { ...native, state: 'syncing', workoutReady: false } })).toMatchObject({
      phase: 'syncing',
      label: 'Watch syncing',
    });
    expect(resolve({
      connection: { ...connection, state: 'connecting' },
      native: { ...native, state: 'error', workoutReady: false },
    })).toMatchObject({ phase: 'disconnected', label: 'Watch disconnected' });
    expect(resolve({
      connection: { ...connection, state: 'connecting' },
      native: { ...native, state: 'reconnect', workoutReady: false, relayConfigured: false },
    })).toMatchObject({ phase: 'disconnected', label: 'Watch disconnected' });
    expect(resolve({
      connection: { ...connection, state: 'connecting' },
      native: {
        ...native,
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
    })).toMatchObject({ phase: 'disconnected', label: 'Watch disconnected' });
  });

  it('bounds native connecting after an established session so a frozen signal turns red', () => {
    const establishedReconnect: NativeWatchConnectState = {
      ...native,
      state: 'connecting',
    };
    expect(resolve({ native: establishedReconnect })).toMatchObject({
      phase: 'connecting',
      label: 'Watch reconnecting',
    });
    expect(resolve({
      native: establishedReconnect,
      event: { ...event, recordedAt: now - 10_001, freshUntil: now - 1 },
    })).toMatchObject({ phase: 'disconnected', label: 'Watch signal lost' });
    expect(resolve({ native: establishedReconnect, event: null })).toMatchObject({
      phase: 'disconnected',
      label: 'Watch signal lost',
    });

    const firstConnect: NativeWatchConnectState = {
      ...native,
      state: 'connecting',
      workoutReady: false,
    };
    expect(resolve({ native: firstConnect, event: null, busy: true })).toMatchObject({
      phase: 'connecting',
      label: 'Watch connecting',
    });
    expect(resolve({ native: firstConnect, event: null, busy: false })).toMatchObject({
      phase: 'disconnected',
      label: 'Watch signal lost',
    });
    expect(resolve({
      connection: { ...connection, connectedAt: now - 5_000 },
      native: firstConnect,
      event: null,
      busy: false,
    })).toMatchObject({ phase: 'connecting', label: 'Watch connecting' });
  });

  it('separates an active session awaiting heart rate from connection attempts and ended sessions', () => {
    const justConnected = { ...connection, connectedAt: now - 5_000 };
    expect(resolve({ connection: justConnected, event: null })).toMatchObject({
      phase: 'connected',
      label: 'Watch connected',
    });
    expect(resolve({ event: null })).toMatchObject({
      phase: 'connected',
      label: 'Watch connected',
    });
    expect(resolve({
      connection: { ...connection, state: 'connecting' },
      native: null,
      readOnlyObserver: true,
      event: null,
    })).toMatchObject({ phase: 'disconnected', label: 'Watch signal lost' });
    expect(resolve({ event: { ...event, recordedAt: now - 10_001, freshUntil: now - 1 } }))
      .toMatchObject({ phase: 'connected', label: 'Watch connected' });
    expect(resolve({ connection: { ...connection, state: 'stopped' } })).toMatchObject({
      phase: 'disconnected',
      label: 'Watch disconnected',
    });
  });

  it('renders visible, non-color status text, a cue, tooltip, and an accessible action', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectIndicator, {
      state: resolve(),
      onOpenSettings: vi.fn(),
    }));
    expect(markup).toContain('data-watch-connect-status="live"');
    expect(markup).toContain('Watch live');
    expect(markup).toContain('✓');
    expect(markup).toContain('Open Watch Connect settings');
    expect(markup).toContain('aria-live="polite"');

    const connectedMarkup = renderToStaticMarkup(createElement(WatchConnectIndicator, {
      state: resolve({ event: null }),
      onOpenSettings: vi.fn(),
    }));
    expect(connectedMarkup).toContain('data-watch-connect-status="connected"');
    expect(connectedMarkup).toContain('Watch connected');
    expect(connectedMarkup).toContain('Waiting for a fresh heart rate reading');
    expect(connectedMarkup).toContain('✓');
  });

  it('renders fullscreen status without a navigation action', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectIndicator, {
      state: resolve(),
    }));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('Open Watch Connect settings');
  });
});
