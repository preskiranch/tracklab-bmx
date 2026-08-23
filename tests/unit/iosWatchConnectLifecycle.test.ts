import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('native Watch Connect lifecycle safeguards', () => {
  it('accepts only bounded local clock skew while persisting the authoritative four-hour start', () => {
    const plugin = source('ios/App/App/HeartRatePlugin.swift');
    const session = source('ios/App/App/WatchConnectSession.swift');

    expect(session).toContain('static let maximumClockSkewMilliseconds: Int64 = 5 * 1_000');
    expect(plugin).toMatch(
      /connectedUntil <= observedAt[\s\S]*maximumDurationMilliseconds[\s\S]*maximumClockSkewMilliseconds/,
    );
    expect(plugin).toMatch(
      /let connectedAt = connectedUntil[\s\S]*- WatchConnectSessionManager\.maximumDurationMilliseconds/,
    );
    expect(session).toContain('var relayStartedAt: Int64?');
    expect(session).toMatch(
      /relayStartedAt: effectiveRelayStartedAt,[\s\S]*connectedAt: connectedAt,[\s\S]*connectedUntil: connectedUntil/,
    );
    expect(session).toMatch(
      /let remaining = min\([\s\S]*maximumDurationMilliseconds,[\s\S]*session\.connectedUntil - Self\.nowMilliseconds\(\)/,
    );
    expect(session).toMatch(
      /private func expireLocked[\s\S]*let localNow = Self\.nowMilliseconds\(\)[\s\S]*min\(localNow, session\.connectedUntil\)/,
    );
    expect(session).toMatch(
      /func handleWatchEndedEvent[\s\S]*let relayStartedAt = session\.relayStartedAt[\s\S]*min\(Int64\(rawEndedAt\.rounded\(\)\), session\.connectedUntil, localNow\)/,
    );
    expect(session).toContain('sessionId: session.workoutSessionId');
  });

  it('never renders a terminal or stale Watch heart rate', () => {
    const manager = source('ios/App/TrackLabWatch/WatchWorkoutManager.swift');
    const view = source('ios/App/TrackLabWatch/WatchWorkoutView.swift');

    expect(manager).toContain('@Published private(set) var heartRateMeasuredAt: Date?');
    expect(manager).toContain('static let displayedHeartRateFreshnessSeconds: TimeInterval = 15');
    expect(manager).toMatch(
      /func displayedHeartRateBpm[\s\S]*\[\.active, \.paused\]\.contains\(state\)[\s\S]*age <= Self\.displayedHeartRateFreshnessSeconds/,
    );
    expect(manager).toMatch(
      /if \[\.idle, \.authorizing, \.ended, \.error\]\.contains\(state\)[\s\S]*self\.clearDisplayedHeartRate\(\)/,
    );
    expect(manager).toMatch(
      /self\.heartRateBpm = bpm[\s\S]*self\.heartRateMeasuredAt = measuredAt/,
    );
    expect(view).toContain('TimelineView(.periodic(from: .now, by: 1))');
    expect(view).toContain('workout.displayedHeartRateBpm(at: now)');
    expect(view).not.toContain('if let bpm = workout.heartRateBpm');
  });

  it('cancels launch generations exactly once and quarantines late mirrored workouts', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    const plugin = source('ios/App/App/HeartRatePlugin.swift');
    const manager = source('ios/App/TrackLabWatch/WatchWorkoutManager.swift');

    expect(coordinator).toContain('private var launchInFlight: WorkoutLaunchRequest?');
    expect(coordinator).toContain('guard self.launchInFlight === launch');
    expect(coordinator).toMatch(
      /func finish\(_ result:[\s\S]*guard let completion else \{ return \}[\s\S]*self\.completion = nil[\s\S]*completion\(result\)/,
    );
    expect(coordinator).toMatch(
      /func cancelWorkoutLaunchAndStop[\s\S]*launchInFlight = nil[\s\S]*watchLaunchCancelled/,
    );
    expect(plugin).toMatch(
      /func clearAllRelays[\s\S]*workoutSessionIdForCancellation\(\)[\s\S]*disconnect\([\s\S]*cancelWorkoutLaunchAndStop/,
    );
    expect(coordinator).toMatch(
      /requiresSessionIdentity: expectedSessionId\.hasPrefix\("watch-connect:"\)/,
    );
    expect(coordinator).toMatch(
      /if !identityVerified \{[\s\S]*onState\(\.connecting, "Verifying this Apple Watch connection…"\)/,
    );
    expect(coordinator).toMatch(
      /if let receivedSessionId = sample\.sessionId,[\s\S]*receivedSessionId != sessionId \{[\s\S]*quarantine\(\)[\s\S]*onIdentityMismatch\(\)/,
    );
    expect(coordinator).toMatch(
      /activeGeneration == generation,[\s\S]*mirroredHandlerToken == handlerToken/,
    );
    expect(manager).toContain('sessionId: watchConnectWorkoutSessionId');
    expect(manager).toMatch(
      /func start\(with configuration:[\s\S]*applyWatchConnectContext\([\s\S]*receivedApplicationContext[\s\S]*let fallback = Date/,
    );
    expect(manager).toContain('session != nil && ![.ended, .error].contains(state)');
  });

  it('tombstones stopped Watch contexts so later legacy workouts stay untagged', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const manager = source('ios/App/TrackLabWatch/WatchWorkoutManager.swift');

    expect(session).toContain('private static let contextVersion = 1');
    expect(session).toContain('private static let clearContextAction = "clear"');
    expect(session).toContain('var contextId: String?');
    expect(session).toMatch(
      /func disconnect[\s\S]*sendWatchClearContextLocked\(for: session\)/,
    );
    expect(session).toMatch(
      /func clearSessionForAccountBoundary[\s\S]*sendWatchClearContextLocked\(for: session\)/,
    );
    expect(session).toMatch(
      /private func expireLocked[\s\S]*sendWatchClearContextLocked\(for: session\)/,
    );
    expect(session).toMatch(
      /"action": Self\.clearContextAction,[\s\S]*"contextId": session\.contextId/,
    );
    expect(manager).toContain('private let maximumWatchConnectTombstones = 16');
    expect(manager).toMatch(
      /if action == watchConnectClearAction[\s\S]*rememberWatchConnectTombstone[\s\S]*clearWatchConnectDeadline\(\)/,
    );
    expect(manager.indexOf('rememberWatchConnectTombstone(', manager.indexOf('if action == watchConnectClearAction')))
      .toBeLessThan(manager.indexOf('watchConnectContextMatchesCurrent(', manager.indexOf('if action == watchConnectClearAction')));
    expect(manager.indexOf('watchConnectContextIsTombstoned(', manager.indexOf('guard action == watchConnectConnectAction')))
      .toBeLessThan(manager.indexOf('setWatchConnectDeadline(', manager.indexOf('guard action == watchConnectConnectAction')));
    expect(manager).toMatch(
      /if rawVersion == nil[\s\S]*guard hasLiveSession, matchesCurrent else[\s\S]*clearWatchConnectDeadline\(\)/,
    );
    expect(manager).toMatch(
      /if deadline <= Date\(\)[\s\S]*rememberWatchConnectTombstone[\s\S]*return[\s\S]*let hasMismatchedIdentity/,
    );
    expect(manager).toMatch(
      /watchConnectContextIsTombstoned[\s\S]*if let contextId[\s\S]*\$0\.contextId == contextId/,
    );
    expect(manager).toMatch(
      /guard watchConnectContextMatchesCurrent\([\s\S]*\) else \{ return \}[\s\S]*clearWatchConnectDeadline\(\)[\s\S]*return/,
    );
    expect(manager).toContain('sessionId: watchConnectWorkoutSessionId');
    expect(manager).toMatch(
      /private func clearWatchConnectDeadline[\s\S]*watchConnectWorkoutSessionId = nil[\s\S]*watchConnectContextId = nil/,
    );
    expect(coordinatorLegacyNilReadinessContract()).toBe(true);
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    expect(coordinator).toMatch(
      /if let receivedSessionId = sample\.sessionId,[\s\S]*receivedSessionId != sessionId \{[\s\S]*if requiresSessionIdentity \{[\s\S]*quarantine\(\)[\s\S]*onIdentityMismatch\(\)[\s\S]*\}[\s\S]*return/,
    );
  });
});

function coordinatorLegacyNilReadinessContract() {
  const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
  return coordinator.includes('self.identityVerified = sessionId == nil')
    && /if sample\.sessionId == nil, let sessionId[\s\S]*onSample\(HeartRateWireSample\(/.test(coordinator);
}
