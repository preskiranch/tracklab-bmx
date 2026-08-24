import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WatchConnectCard } from '../../src/components/WatchConnectCard';
import {
  watchConnectHeartRateForConnection,
  watchConnectReadOnlyObserver,
} from '../../src/components/WatchConnectCoordinator';
import {
  defaultHeartRateFreshnessMs,
} from '../../src/lib/heartRate';
import {
  heartRateLiveMaximumFutureSkewMs,
  mergeLiveHeartRateEvent,
  type HeartRateLiveEvent,
} from '../../src/lib/heartRateCloud';
import {
  resolveWatchConnectViewState,
  type WatchConnectConnection,
  type WatchConnectEnrollment,
} from '../../src/lib/watchConnect';

const now = 1_000_000;

function liveReading(overrides: Partial<HeartRateLiveEvent> = {}): HeartRateLiveEvent {
  return {
    streamId: 'stream-personal',
    sessionId: 'watch-connect:connection-personal',
    relayScope: 'account-block',
    riderId: 'account:athlete-one',
    playerId: null,
    bpm: 164,
    recordedAt: now - 500,
    receivedAt: now - 100,
    freshUntil: now + 15_000,
    activeElapsedMs: 24_000,
    ...overrides,
  };
}

function sourceBlock(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `missing source marker: ${marker}`).toBeGreaterThanOrEqual(0);
  const openingBrace = source.indexOf('{', markerIndex);
  expect(openingBrace, `missing opening brace after: ${marker}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  throw new Error(`Unclosed source block after: ${marker}`);
}

describe('iPad Watch relay regression boundaries', () => {
  it('merges only fresh, ordered readings for the exact signed-in account', () => {
    const initial = mergeLiveHeartRateEvent({}, liveReading(), {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    expect(initial['account:athlete-one']?.bpm).toBe(164);

    const foreignAccount = mergeLiveHeartRateEvent(initial, liveReading({
      riderId: 'account:athlete-two',
      bpm: 201,
      receivedAt: now,
    }), {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    expect(foreignAccount).toBe(initial);

    const oldSensorReading = mergeLiveHeartRateEvent(initial, liveReading({
      bpm: 202,
      recordedAt: now - defaultHeartRateFreshnessMs - 1,
      receivedAt: now,
    }), {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    expect(oldSensorReading).toBe(initial);

    const futureSensorReading = mergeLiveHeartRateEvent(initial, liveReading({
      bpm: 203,
      recordedAt: now + heartRateLiveMaximumFutureSkewMs + 1,
      receivedAt: now,
    }), {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    expect(futureSensorReading).toBe(initial);

    const outOfOrderDelivery = mergeLiveHeartRateEvent(initial, liveReading({
      bpm: 204,
      recordedAt: now - 200,
      receivedAt: now - 200,
    }), {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    expect(outOfOrderDelivery).toBe(initial);
  });

  it('keeps iPad and desktop sign-out read-only while the paired iPhone owns cleanup', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const signOut = sourceBlock(appSource, 'const handleSignOut = useCallback(async () =>');
    const writerExpression = signOut.slice(
      signOut.indexOf('const ownsNativeHeartRateWriter'),
      signOut.indexOf('const unsyncedHeartRate'),
    );
    expect(writerExpression).toContain("heartRate.availability?.platform === 'iphone'");
    expect(writerExpression).toContain('heartRate.availability == null');
    expect(writerExpression).not.toContain("platform === 'ipad'");
    expect(writerExpression).not.toContain("platform === 'other'");
  });

  it('relays one exact-account iPhone sample to an iPad observer, then rejects foreign and stale data', () => {
    const enrollment: WatchConnectEnrollment = {
      id: 'enrollment-personal',
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
      id: 'connection-personal',
      enrollmentId: enrollment.id,
      scope: 'personal',
      clubId: null,
      studioRiderId: null,
      state: 'connected',
      connectedAt: now - 60_000,
      connectedUntil: now + 4 * 60 * 60 * 1_000,
      remainingMs: 4 * 60 * 60 * 1_000,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    const iPadAvailability = {
      version: 1 as const,
      supported: false,
      platform: 'ipad' as const,
      paired: false,
      watchAppInstalled: false,
      healthDataAvailable: true,
      minimumIOS: '17.0' as const,
      minimumWatchOS: '10.0' as const,
    };
    const state = resolveWatchConnectViewState({
      enrollment,
      connection,
      nativeState: null,
      requiresNativeMatch: false,
      now,
    });

    expect(watchConnectReadOnlyObserver(iPadAvailability)).toBe(true);
    expect(state.phase).toBe('connected');

    // Model the paired iPhone's account-scoped cloud event before the iPad
    // consumes it. Both the account fence and four-hour connection fence must
    // match before the observer card may render a BPM.
    const iPhoneCloudSample = liveReading();
    const cloudReadings = mergeLiveHeartRateEvent({}, iPhoneCloudSample, {
      expectedRiderId: 'account:athlete-one',
      now,
    });
    const observerReading = watchConnectHeartRateForConnection(
      cloudReadings['account:athlete-one'] ?? null,
      connection,
    );
    expect(observerReading?.bpm).toBe(164);
    expect(mergeLiveHeartRateEvent(cloudReadings, liveReading({
      riderId: 'account:athlete-two',
      bpm: 201,
      receivedAt: now,
    }), {
      expectedRiderId: 'account:athlete-one',
      now,
    })).toBe(cloudReadings);

    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Athlete One',
      state,
      enrolled: true,
      observer: true,
      latestHeartRate: observerReading,
      now,
    }));
    expect(markup).toContain('Connected · 4h 0m left');
    expect(markup).toContain('164 beats per minute');
    expect(markup).toContain('Live through iPhone');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('Install Watch App');

    const staleMarkup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Athlete One',
      state,
      enrolled: true,
      observer: true,
      latestHeartRate: observerReading,
      now: now + defaultHeartRateFreshnessMs + 1,
    }));
    expect(staleMarkup).toContain('Signal interrupted');
    expect(staleMarkup).not.toContain('164 beats per minute');
  });

  it('keeps the complete exact event in player readings and gates account-wide revoke to the writer role', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const playerReadings = appSource.slice(
      appSource.indexOf('const heartRateByPlayer = useMemo'),
      appSource.indexOf('const cloudProfileKey', appSource.indexOf('const heartRateByPlayer = useMemo')),
    );
    expect(playerReadings).toMatch(
      /nativeReading\.recordedAt >= cloudReading\.recordedAt/,
    );
    expect(playerReadings).toContain('player.riderId === accountHeartRateRiderId');
    expect(playerReadings).toContain('heartRate.latest?.sessionId === heartRate.status?.sessionId');
    expect(playerReadings).toContain('if (latest) next[player.id] = latest');
    expect(playerReadings).not.toContain('next[player.id] = {');

    const signOut = sourceBlock(appSource, 'const handleSignOut = useCallback(async () =>');
    expect(signOut).toContain("heartRate.availability?.platform === 'iphone'");
    expect(signOut).toContain('heartRate.availability == null');
    const writerCleanup = sourceBlock(signOut, 'if (ownsNativeHeartRateWriter)');
    expect(writerCleanup).toContain('loadHeartRatePairings()');
    expect(writerCleanup).toContain('stopWatchConnectForAccountBoundary({');
    expect(writerCleanup).toContain('heartRate.clearAllRelays()');
    expect(writerCleanup).toContain('revokeHeartRatePairing(pairingId)');
    expect(signOut.match(/revokeHeartRatePairing\(/g)).toHaveLength(1);
    expect(writerCleanup.match(/revokeHeartRatePairing\(/g)).toHaveLength(1);
  });

  it('routes the same exact-rider live map to every training HUD and keeps kiosk reads scoped', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const getPulledStart = appSource.lastIndexOf(") : appMode === 'get-pulled'");
    const exploreStart = appSource.lastIndexOf(") : appMode === 'explore'");
    const monitorStart = appSource.lastIndexOf(") : appMode === 'monitor'");
    const diagnosticsStart = appSource.lastIndexOf(") : appMode === 'diagnostics'");
    const getPulled = appSource.slice(getPulledStart, exploreStart);
    const explore = appSource.slice(exploreStart, monitorStart);
    const monitor = appSource.slice(monitorStart, diagnosticsStart);
    const raceAndSprint = appSource.slice(
      appSource.indexOf('<EarthTrackView'),
      appSource.indexOf('earthAngle={earthAngle}', appSource.indexOf('<EarthTrackView')),
    );
    expect(getPulled).toContain('heartRateByPlayer');
    expect(explore).toContain('heartRateByPlayer');
    expect(monitor).toContain('heartRateByPlayer={heartRateByPlayer}');
    expect(raceAndSprint).toContain('heartRateByPlayer={heartRateByPlayer}');
    expect(raceAndSprint).toContain("appMode === 'straight-sprint'");

    const runtimeSource = readFileSync(
      new URL('../../src/components/ClubTabletRuntime.tsx', import.meta.url),
      'utf8',
    );
    expect(runtimeSource).toContain('loadLatestStudioTabletHeartRate(');
    expect(runtimeSource).toContain('session.sessionToken');
    expect(runtimeSource).toContain('expectedRiderId');
    expect(runtimeSource).toContain('onHeartRateReading(null)');
    expect(runtimeSource).not.toContain('subscribeToHeartRateLive');
  });
});
