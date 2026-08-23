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
      /private func expireLocked[\s\S]*clampedFinalizationTimeLocked\([\s\S]*proposed: Self\.nowMilliseconds\(\)/,
    );
    expect(session).toMatch(
      /func handleWatchEndedEvent[\s\S]*clampedFinalizationTimeLocked\([\s\S]*proposed: Int64\(rawEndedAt\.rounded\(\)\)/,
    );
    expect(session).toMatch(
      /private func clampedFinalizationTimeLocked[\s\S]*let localNow = Self\.nowMilliseconds\(\)[\s\S]*let relayStartedAt = session\.relayStartedAt[\s\S]*min\(proposed, session\.connectedUntil, localNow\)/,
    );
    expect(session).toMatch(
      /finalizeLocked\([\s\S]*workoutSessionId: session\.workoutSessionId[\s\S]*HeartRateCoordinator\.shared\.endWorkout\([\s\S]*sessionId: workoutSessionId/,
    );
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
      /if !identityVerified \{[\s\S]*onState\(\.connecting, "Verifying this Apple Watch connection…", date\)/,
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

  it('keeps the exact four-hour Watch workout alive across a mirrored transport reconnect', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');

    expect(coordinator).toMatch(
      /func workoutSession\([\s\S]*didDisconnectFromRemoteDeviceWithError[\s\S]*guard markInvalidatedIfNeeded\(\) else \{ return \}[\s\S]*onDisconnect\(error\?\.localizedDescription\)/,
    );
    const disconnectHandler = coordinator.slice(
      coordinator.indexOf('didDisconnectFromRemoteDeviceWithError'),
    );
    expect(disconnectHandler.slice(0, disconnectHandler.indexOf('\n    }\n}'))).not.toContain(
      'stopActivity',
    );
    expect(coordinator).toMatch(
      /private func handleMirroredDisconnect[\s\S]*activeSessionId == expectedSessionId[\s\S]*activeGeneration == generation[\s\S]*mirroredHandlerToken == handlerToken[\s\S]*\[\.launching, \.connecting, \.active, \.paused\]\.contains/,
    );
    expect(coordinator).toMatch(
      /private func handleMirroredDisconnect[\s\S]*detachInvalidTransport\(\)[\s\S]*mirroredWorkoutHandler = nil[\s\S]*mirroredHandlerToken = nil[\s\S]*shouldAwaitMirroredReconnect[\s\S]*updateStatus\(\.connecting,[\s\S]*manageRelayLifecycle: false\)/,
    );
    expect(coordinator).toMatch(
      /func detachInvalidTransport\(\)[\s\S]*markInvalidatedIfNeeded\(\)[\s\S]*\n    }/,
    );
    expect(coordinator).toMatch(
      /func quarantine\(\)[\s\S]*guard markInvalidatedIfNeeded\(\) else \{ return \}[\s\S]*session\.stopActivity/,
    );
    const session = source('ios/App/App/WatchConnectSession.swift');
    expect(session).toMatch(
      /func shouldAwaitMirroredReconnect[\s\S]*session\.workoutSessionId == workoutSessionId[\s\S]*session\.connectedUntil > Self\.nowMilliseconds\(\)[\s\S]*\[\.connecting, \.connected\]\.contains\(session\.phase\)/,
    );
    expect(coordinator).toMatch(
      /private func acceptMirroredWorkout[\s\S]*expectedSessionId\.hasPrefix\("watch-connect:"\)[\s\S]*shouldAwaitMirroredReconnect[\s\S]*session\.stopActivity/,
    );
    expect(session).toMatch(
      /case \.active, \.paused:[\s\S]*guard \[\.connecting, \.connected\]\.contains\(session\.phase\) else \{ return \}/,
    );
    expect(session).toMatch(
      /case \.launching, \.connecting:[\s\S]*guard \[\.connecting, \.connected\]\.contains\(session\.phase\) else \{ return \}/,
    );
  });

  it('reports a legacy mirror disconnect instead of retaining an active status without a handler', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    const handler = coordinator.slice(
      coordinator.indexOf('private func handleMirroredDisconnect'),
      coordinator.indexOf('private func completeUnavailable'),
    );
    const legacyStart = handler.indexOf('if !expectedSessionId.hasPrefix("watch-connect:")');
    const watchConnectGuard = handler.indexOf(
      'guard WatchConnectSessionManager.shared.shouldAwaitMirroredReconnect',
    );
    const legacyBranch = handler.slice(legacyStart, watchConnectGuard);
    const watchConnectBranch = handler.slice(watchConnectGuard);

    expect(legacyStart).toBeGreaterThan(handler.indexOf('mirroredHandlerToken = nil'));
    expect(watchConnectGuard).toBeGreaterThan(legacyStart);
    expect(legacyBranch).toContain(
      'self.updateStatus(.error, message: message, manageRelayLifecycle: false)',
    );
    expect(legacyBranch).toMatch(/updateStatus\(\.error,[\s\S]*return/);
    expect(watchConnectBranch).toContain(
      'self.updateStatus(.connecting, message: message, manageRelayLifecycle: false)',
    );
    expect(handler).toMatch(
      /activeSessionId == expectedSessionId,[\s\S]*activeGeneration == generation,[\s\S]*mirroredHandlerToken == handlerToken/,
    );

    const accept = coordinator.slice(
      coordinator.indexOf('private func acceptMirroredWorkout'),
      coordinator.indexOf('private func receive('),
    );
    expect(accept).toMatch(
      /expectedSessionId\.hasPrefix\("watch-connect:"\),[\s\S]*shouldAwaitMirroredReconnect[\s\S]*session\.stopActivity/,
    );
    expect(accept.indexOf('let handlerToken = UUID()')).toBeGreaterThan(
      accept.indexOf('expectedSessionId.hasPrefix("watch-connect:")'),
    );
  });

  it('accepts a replacement mirror before queued disconnect cleanup but rejects a live duplicate', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    const accept = coordinator.slice(
      coordinator.indexOf('private func acceptMirroredWorkout'),
      coordinator.indexOf('private func receive('),
    );
    const existing = accept.slice(
      accept.indexOf('if let existingHandler = mirroredWorkoutHandler'),
      accept.indexOf('let handlerToken = UUID()'),
    );
    const invalidated = existing.slice(
      existing.indexOf('if existingHandler.isInvalidated'),
      existing.indexOf('} else {'),
    );
    const liveDuplicate = existing.slice(existing.indexOf('} else {'));

    expect(coordinator).toMatch(
      /var isInvalidated: Bool \{[\s\S]*invalidationLock\.lock\(\)[\s\S]*defer \{ invalidationLock\.unlock\(\) \}[\s\S]*return identityRejected/,
    );
    expect(coordinator).toMatch(
      /didDisconnectFromRemoteDeviceWithError[\s\S]*markInvalidatedIfNeeded\(\)[\s\S]*onDisconnect/,
    );
    expect(invalidated).toContain('mirroredWorkoutHandler = nil');
    expect(invalidated).toContain('mirroredHandlerToken = nil');
    expect(invalidated).not.toContain('stopActivity');
    expect(liveDuplicate).toContain('session.stopActivity(with: Date())');
    expect(liveDuplicate).toContain('return');
  });

  it('accepts an exact Watch end after mirrored ending or ended wins the ordering race', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');

    const observe = session.slice(
      session.indexOf('func observeWorkoutStatus'),
      session.indexOf('func observeRelayState'),
    );
    const endingBranch = observe.slice(
      observe.indexOf('case .ending:'),
      observe.indexOf('case .ended:'),
    );
    const endedBranch = observe.slice(
      observe.indexOf('case .ended:'),
      observe.indexOf('case .error, .unavailable:'),
    );
    expect(endingBranch).toContain('.error');
    expect(endingBranch).toMatch(
      /session\.terminalFinalization == nil[\s\S]*beginTerminalFinalizationLocked\([\s\S]*return[\s\S]*session\.phase = \.disconnecting/,
    );
    expect(endedBranch).toContain('.error');
    expect(endedBranch).toMatch(
      /session\.terminalFinalization == nil[\s\S]*status\.at\.timeIntervalSince1970[\s\S]*beginTerminalFinalizationLocked\([\s\S]*return[\s\S]*session\.phase = \.syncing/,
    );
    expect(endingBranch).toContain('status.at.timeIntervalSince1970');
    expect(coordinator).toMatch(
      /didChangeTo toState:[\s\S]*date: Date[\s\S]*onState\(mapped\.0, mapped\.1, date\)/,
    );
    expect(coordinator).toMatch(
      /onState: \{ \[weak self\] state, message, transitionDate in[\s\S]*updateMirroredStatus\([\s\S]*at: transitionDate/,
    );
    expect(coordinator).toMatch(
      /private func updateMirroredStatus[\s\S]*at transitionDate: Date[\s\S]*updateStatus\(state, message: message, at: transitionDate\)/,
    );
    expect(coordinator).toMatch(
      /private func updateStatus[\s\S]*at transitionDate: Date = Date\(\)[\s\S]*TrackLabHeartRateStatus\([\s\S]*at: transitionDate/,
    );
    expect(coordinator).toMatch(
      /case \.active:[\s\S]*resume\(at: transitionDate\)[\s\S]*case \.paused:[\s\S]*pause\(at: transitionDate\)/,
    );
    expect(coordinator).toContain('private var pendingLiveTransitionDate: Date?');
    expect(coordinator).toMatch(
      /if \[\.active, \.paused\]\.contains\(mapped\.0\)[\s\S]*pendingLiveState = mapped\.0[\s\S]*pendingLiveTransitionDate = date/,
    );
    expect(coordinator).toMatch(
      /let transitionDate = pendingLiveTransitionDate[\s\S]*Date\(timeIntervalSince1970: sample\.measuredAt \/ 1_000\)[\s\S]*onState\([\s\S]*transitionDate/,
    );
    const endedHandler = session.slice(
      session.indexOf('func handleWatchEndedEvent'),
      session.indexOf('func clearSessionForAccountBoundary'),
    );
    expect(endedHandler).toMatch(
      /session\.connectionId == connectionId,[\s\S]*session\.workoutSessionId == workoutSessionId,[\s\S]*session\.contextId == eventContextId/,
    );
    expect(endedHandler).toMatch(
      /\.disconnecting,[\s\S]*\.syncing,[\s\S]*\.reconnect,[\s\S]*!self\.expirationInFlight/,
    );
    expect(endedHandler).toMatch(
      /if let terminal = session\.terminalFinalization[\s\S]*terminal\.contextId == eventContextId,[\s\S]*!terminal\.completed[\s\S]*resumeTerminalFinalizationLocked\(\)/,
    );
    expect(endedHandler).toMatch(
      /clampedFinalizationTimeLocked\([\s\S]*beginTerminalFinalizationLocked\(/,
    );

    const begin = session.slice(
      session.indexOf('private func beginTerminalFinalizationLocked'),
      session.indexOf('private func resumeTerminalFinalizationLocked'),
    );
    const latch = begin.indexOf('session.terminalFinalization =');
    const persist = begin.indexOf('persistLocked()');
    const clear = begin.indexOf('sendWatchClearContextOnceLocked(for: session)');
    const publish = begin.indexOf('publishLocked()');
    const finalize = begin.indexOf('finalizeLocked(');
    expect(latch).toBeGreaterThanOrEqual(0);
    expect(latch).toBeLessThan(persist);
    expect(persist).toBeLessThan(clear);
    expect(clear).toBeLessThan(publish);
    expect(publish).toBeLessThan(finalize);
  });

  it('latches a delayed HealthKit transition time once so a later duplicate cannot inflate it', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    const session = source('ios/App/App/WatchConnectSession.swift');
    const transitionAt = 1_720_000_060_000;
    const deliveredAt = transitionAt + 45 * 60 * 1_000;
    const relayStartedAt = transitionAt - 60_000;
    const connectedUntil = relayStartedAt + 4 * 60 * 60 * 1_000;
    const clamp = (proposed: number) =>
      Math.max(relayStartedAt, Math.min(proposed, connectedUntil, deliveredAt));

    expect(clamp(transitionAt)).toBe(transitionAt);
    expect(clamp(transitionAt)).not.toBe(deliveredAt);
    expect(coordinator).toMatch(
      /didChangeTo toState:[\s\S]*date: Date[\s\S]*onState\(mapped\.0, mapped\.1, date\)/,
    );

    const observe = session.slice(
      session.indexOf('func observeWorkoutStatus'),
      session.indexOf('func observeRelayState'),
    );
    expect(observe.match(/status\.at\.timeIntervalSince1970/g)).toHaveLength(2);

    const terminal = session.slice(
      session.indexOf('private struct TrackLabWatchConnectTerminalFinalization'),
      session.indexOf('extension Notification.Name'),
    );
    expect(terminal).toContain('let endedAt: Int64');

    const endedHandler = session.slice(
      session.indexOf('func handleWatchEndedEvent'),
      session.indexOf('func clearSessionForAccountBoundary'),
    );
    expect(endedHandler).toMatch(
      /if let terminal = session\.terminalFinalization[\s\S]*!terminal\.completed[\s\S]*resumeTerminalFinalizationLocked\(\)[\s\S]*return/,
    );
    const resume = session.slice(
      session.indexOf('private func resumeTerminalFinalizationLocked'),
      session.indexOf('private func finalizeLocked('),
    );
    expect(resume).toContain('endedAt: terminal.endedAt');
  });

  it('rejects hostile sample timestamps before Date or Int64 conversion', () => {
    const coordinator = source('ios/App/App/HeartRateCoordinator.swift');
    const handler = coordinator.slice(
      coordinator.indexOf('didReceiveDataFromRemoteWorkoutSession'),
      coordinator.indexOf('didDisconnectFromRemoteDeviceWithError'),
    );
    const guardEnd = handler.indexOf('sample.measuredAt <= maximumMeasuredAt');
    const dateConversion = handler.indexOf(
      'Date(timeIntervalSince1970: sample.measuredAt / 1_000)',
    );

    expect(Number.isFinite(Number.MAX_VALUE)).toBe(true);
    expect(Number.MAX_VALUE).toBeGreaterThan(Date.now() + 60_000);
    expect(handler).toContain(
      'let maximumMeasuredAt = Date().timeIntervalSince1970 * 1_000 + 60_000',
    );
    expect(handler).toMatch(
      /sample\.measuredAt\.isFinite,[\s\S]*sample\.measuredAt >= 0,[\s\S]*sample\.measuredAt <= maximumMeasuredAt/,
    );
    expect(guardEnd).toBeGreaterThanOrEqual(0);
    expect(guardEnd).toBeLessThan(dateConversion);
  });

  it('rejects an out-of-range Watch-ended timestamp before Int64 conversion', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const endedHandler = session.slice(
      session.indexOf('func handleWatchEndedEvent'),
      session.indexOf('func clearSessionForAccountBoundary'),
    );
    const bound = endedHandler.indexOf('rawEndedAt <= maximumEndedAt');
    const conversion = endedHandler.indexOf('Int64(rawEndedAt.rounded())');
    const roundedInt64OverflowAsDouble = 2 ** 63;

    expect(roundedInt64OverflowAsDouble).toBeGreaterThan(Date.now() + 5_000);
    expect(endedHandler).toMatch(
      /let maximumEndedAt = Double\([\s\S]*nowMilliseconds\(\) \+ Self\.maximumClockSkewMilliseconds[\s\S]*rawEndedAt\.isFinite,[\s\S]*rawEndedAt >= 0,[\s\S]*rawEndedAt <= maximumEndedAt/,
    );
    expect(bound).toBeGreaterThanOrEqual(0);
    expect(bound).toBeLessThan(conversion);
    expect(endedHandler).not.toContain('rawEndedAt <= Double(Int64.max)');
  });

  it('bounds every externally sourced relay epoch before integer conversion', () => {
    const relay = source('ios/App/App/HeartRateRelay.swift');
    const epoch = relay.slice(
      relay.indexOf('private static func epochMilliseconds'),
      relay.indexOf('private static func nowMilliseconds'),
    );
    const roundedInt64OverflowAsDouble = 2 ** 63;

    expect(roundedInt64OverflowAsDouble).toBeGreaterThan(Date.now() + 60_000);
    expect(epoch).toMatch(
      /let maximumAccepted = Double\(nowMilliseconds\(\) \+ 60_000\)[\s\S]*value\.isFinite,[\s\S]*value >= 0,[\s\S]*value <= maximumAccepted[\s\S]*Int64\(value\.rounded\(\)\)/,
    );
    expect(epoch).not.toContain('Double(Int64.max)');
    expect(relay).toMatch(
      /func configure\([\s\S]*epochMilliseconds\(startedAt\)/,
    );
    expect(relay).toMatch(/func enqueue[\s\S]*epochMilliseconds\(sample\.measuredAt\)/);
    expect(relay).toMatch(/func pauseRelay\([\s\S]*epochMilliseconds\(at\)/);
    expect(relay).toMatch(/func resumeRelay\([\s\S]*epochMilliseconds\(at\)/);
    expect(relay).toMatch(
      /func finalize\([\s\S]*epochMilliseconds\(endedAt\)/,
    );
    expect(relay).toMatch(
      /func pause\(at date:[\s\S]*epochMilliseconds\([\s\S]*date\.timeIntervalSince1970[\s\S]*at: clockAt/,
    );
    expect(relay).toMatch(
      /func resume\(at date:[\s\S]*epochMilliseconds\([\s\S]*date\.timeIntervalSince1970[\s\S]*at: clockAt/,
    );
    expect(relay).toMatch(
      /func finalizeContinuousBlockAtWorkoutEnd[\s\S]*epochMilliseconds\([\s\S]*date\.timeIntervalSince1970/,
    );
  });

  it('keeps terminal ownership exact, durable, idempotent, and non-resurrecting', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');

    expect(session).toContain(
      'var terminalFinalization: TrackLabWatchConnectTerminalFinalization?',
    );
    expect(session).toMatch(
      /if isSameConnection,[\s\S]*existing\.terminalFinalization != nil[\s\S]*\.disconnecting, \.syncing, \.reconnect[\s\S]*resumeTerminalFinalizationLocked\(\)/,
    );
    expect(session).toMatch(
      /func recoverAtLaunch[\s\S]*if let terminal = session\.terminalFinalization[\s\S]*recoveryAttemptedTerminalContextId != terminal\.contextId[\s\S]*resumeTerminalFinalizationLocked\(\)[\s\S]*return[\s\S]*sendWatchContextLocked\(\)/,
    );
    expect(session).toMatch(
      /private func resumeTerminalFinalizationLocked[\s\S]*sendWatchClearContextOnceLocked[\s\S]*guard !terminal\.completed,[\s\S]*!expirationInFlight[\s\S]*finalizeLocked\(/,
    );
    expect(session).toMatch(
      /func disconnect[\s\S]*if let terminal = session\.terminalFinalization[\s\S]*!terminal\.completed[\s\S]*resumeTerminalFinalizationLocked\(\)[\s\S]*beginTerminalFinalizationLocked\(/,
    );
    expect(session).toMatch(
      /private func expireLocked[\s\S]*session\.terminalFinalization == nil[\s\S]*beginTerminalFinalizationLocked\(/,
    );
    expect(session).toMatch(
      /func observeRelayState[\s\S]*relay\["finalized"\] as\? Bool == true[\s\S]*session\.terminalFinalization == nil[\s\S]*beginTerminalFinalizationLocked\([\s\S]*return[\s\S]*session\.phase = \.syncing/,
    );

    const finalize = session.slice(
      session.indexOf('private func finalizeLocked('),
      session.indexOf('private func ownsTerminalFinalization'),
    );
    expect(finalize).toMatch(
      /current\.contextId == contextId,[\s\S]*current\.connectionId == connectionId,[\s\S]*current\.relaySessionId == relaySessionId,[\s\S]*current\.workoutSessionId == workoutSessionId/,
    );
    expect(finalize).toMatch(
      /terminal\.contextId == contextId,[\s\S]*terminal\.endedAt == endedAt,[\s\S]*!terminal\.completed/,
    );
    const success = finalize.slice(
      finalize.indexOf('case .success:'),
      finalize.indexOf('case .failure(let error):'),
    );
    const failure = finalize.slice(finalize.indexOf('case .failure(let error):'));
    expect(success).toContain('terminal.completed = true');
    expect(failure).not.toContain('terminal.completed = true');
    expect(failure).toContain('current.phase = .error');
    expect(session).toMatch(
      /private func resumeTerminalFinalizationLocked[\s\S]*guard !terminal\.completed,[\s\S]*!expirationInFlight/,
    );
    expect(finalize.indexOf('ownsTerminalFinalization(')).toBeLessThan(
      finalize.indexOf('HeartRateCoordinator.shared.endWorkout('),
    );
  });

  it('migrates Build 10 terminal and ambiguous error fixtures before launch recovery can republish connect', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const build10TerminalFixture = {
      version: 3,
      phase: 'syncing',
      scope: 'personal',
      connectionId: 'connection-build10',
      pairingId: 'pairing-build10',
      relaySessionId: 'watch-connect:connection-build10',
      workoutSessionId: 'watch-connect:connection-build10',
      contextId: 'context-build10',
      relayStartedAt: 1_000,
      connectedAt: 1_000,
      connectedUntil: 14_401_000,
      workoutReady: true,
      watchLaunchAccepted: true,
      relayConfigured: true,
      reason: null,
    };
    const build10AmbiguousErrorFixture = {
      ...build10TerminalFixture,
      phase: 'error',
      reason: 'Relay finalization failed before the upgrade',
    };

    expect(build10TerminalFixture.version).toBe(3);
    expect(build10TerminalFixture).not.toHaveProperty('terminalFinalization');
    expect(['disconnecting', 'syncing', 'reconnect']).toContain(build10TerminalFixture.phase);
    expect(build10AmbiguousErrorFixture.version).toBe(3);
    expect(build10AmbiguousErrorFixture).not.toHaveProperty('terminalFinalization');
    expect(build10AmbiguousErrorFixture.phase).toBe('error');
    expect(session).toContain('static let currentVersion = 4');
    expect(session).toContain('static let build10Version = 3');

    const load = session.slice(
      session.indexOf('private static func loadSession'),
      session.indexOf('private static func migrateBuild10Session'),
    );
    expect(load).toMatch(
      /session\.version == TrackLabWatchConnectPersistedSession\.build10Version[\s\S]*migrateBuild10Session\(&session\)[\s\S]*defaults\.set\(migratedData/,
    );
    expect(load).toMatch(
      /let terminalPhases:[\s\S]*\.disconnecting,[\s\S]*\.syncing,[\s\S]*\.reconnect/,
    );
    expect(load).toMatch(
      /terminalPhases\.contains\(session\.phase\)[\s\S]*session\.terminalFinalization != nil/,
    );

    const migrate = session.slice(
      session.indexOf('private static func migrateBuild10Session'),
      session.indexOf('private static func nowMilliseconds'),
    );
    expect(migrate).toMatch(/case \.connecting, \.connected:[\s\S]*return true/);
    expect(migrate).toMatch(
      /case \.disconnecting, \.syncing, \.reconnect, \.error:[\s\S]*guard let contextId[\s\S]*terminalFinalization = TrackLabWatchConnectTerminalFinalization/,
    );
    expect(migrate).toMatch(
      /endedAt: max\([\s\S]*relayStartedAt,[\s\S]*min\(localNow, session\.connectedUntil\)[\s\S]*completed: false/,
    );
    expect(migrate).toContain('session.phase = .disconnecting');

    const recover = session.slice(
      session.indexOf('func recoverAtLaunch'),
      session.indexOf('func observeWorkoutStatus'),
    );
    expect(recover.indexOf('if let terminal = session.terminalFinalization')).toBeLessThan(
      recover.indexOf('self.sendWatchContextLocked()'),
    );
    expect(recover).toMatch(
      /if let terminal = session\.terminalFinalization[\s\S]*resumeTerminalFinalizationLocked\(\)[\s\S]*return[\s\S]*self\.sendWatchContextLocked\(\)/,
    );
  });

  it('coalesces concurrent terminal duplicates and permits failure then exact retry to success', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const endedHandler = session.slice(
      session.indexOf('func handleWatchEndedEvent'),
      session.indexOf('func clearSessionForAccountBoundary'),
    );
    const begin = session.slice(
      session.indexOf('private func beginTerminalFinalizationLocked'),
      session.indexOf('private func resumeTerminalFinalizationLocked'),
    );
    const resume = session.slice(
      session.indexOf('private func resumeTerminalFinalizationLocked'),
      session.indexOf('private func finalizeLocked('),
    );
    const finalize = session.slice(
      session.indexOf('private func finalizeLocked('),
      session.indexOf('private func ownsTerminalFinalization'),
    );

    expect(begin.indexOf('expirationInFlight = true')).toBeLessThan(
      begin.indexOf('finalizeLocked('),
    );
    expect(endedHandler.indexOf('!self.expirationInFlight')).toBeLessThan(
      endedHandler.indexOf('if let terminal = session.terminalFinalization'),
    );
    expect(resume).toMatch(
      /guard !terminal\.completed,[\s\S]*!expirationInFlight[\s\S]*expirationInFlight = true[\s\S]*finalizeLocked\(/,
    );
    expect(finalize).toMatch(
      /self\.expirationInFlight = false[\s\S]*case \.success:[\s\S]*terminal\.completed = true[\s\S]*case \.failure\(let error\):[\s\S]*current\.phase = \.error/,
    );
    expect(endedHandler).toMatch(
      /if let terminal = session\.terminalFinalization[\s\S]*!terminal\.completed[\s\S]*resumeTerminalFinalizationLocked\(\)/,
    );
  });

  it('tombstones stopped Watch contexts so later legacy workouts stay untagged', () => {
    const session = source('ios/App/App/WatchConnectSession.swift');
    const manager = source('ios/App/TrackLabWatch/WatchWorkoutManager.swift');

    expect(session).toContain('private static let contextVersion = 1');
    expect(session).toContain('private static let clearContextAction = "clear"');
    expect(session).toContain('var contextId: String?');
    expect(session).toMatch(
      /func disconnect[\s\S]*beginTerminalFinalizationLocked\(/,
    );
    expect(session).toMatch(
      /func clearSessionForAccountBoundary[\s\S]*sendWatchClearContextOnceLocked\(for: session\)/,
    );
    expect(session).toMatch(
      /private func expireLocked[\s\S]*beginTerminalFinalizationLocked\([\s\S]*private func beginTerminalFinalizationLocked[\s\S]*sendWatchClearContextOnceLocked\(for: session\)/,
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
