import Foundation
import Security
import WatchConnectivity

enum TrackLabWatchConnectPhase: String, Codable {
    case inactive
    case connecting
    case connected
    case syncing
    case reconnect
    case disconnecting
    case error
}

enum TrackLabWatchConnectScope: String, Codable {
    case personal
    case studio
}

private struct TrackLabWatchConnectPersistedSession: Codable {
    static let currentVersion = 4
    static let build10Version = 3

    var version = currentVersion
    var phase: TrackLabWatchConnectPhase
    var scope: TrackLabWatchConnectScope
    var connectionId: String
    var pairingId: String
    var relaySessionId: String
    var workoutSessionId: String
    /// Per-native-start generation used only to order WatchConnectivity
    /// connect/clear envelopes. It is not an account or relay credential.
    var contextId: String?
    /// Local relay start retained across retries. `connectedAt` is the
    /// authoritative server start derived from the exact four-hour deadline.
    var relayStartedAt: Int64?
    var connectedAt: Int64
    var connectedUntil: Int64
    var workoutReady: Bool
    var watchLaunchAccepted: Bool
    var relayConfigured: Bool
    var reason: String?
    /// Durable per-context latch for every terminal path. It is written before
    /// clearing the Watch context or asking the relay to finalize, so duplicate
    /// WatchConnectivity delivery and an app relaunch cannot finalize twice.
    var terminalFinalization: TrackLabWatchConnectTerminalFinalization?
}

private struct TrackLabWatchConnectTerminalFinalization: Codable {
    let contextId: String
    let endedAt: Int64
    var completed: Bool
}

extension Notification.Name {
    static let trackLabWatchConnectDidChange = Notification.Name(
        "com.preskilranch.tracklabbmx.watch-connect.did-change"
    )
}

/// Owns only the local four-hour Watch Connect lifecycle. The server remains
/// authoritative for athlete/studio enrollment and issues a fresh ingest
/// credential for every connection. No ingest credential is stored here.
final class WatchConnectSessionManager: @unchecked Sendable {
    static let shared = WatchConnectSessionManager()
    static let maximumDurationMilliseconds: Int64 = 4 * 60 * 60 * 1_000
    // Keep this inside the cloud relay's live-sample freshness window. It is
    // only intended to absorb request latency at the exact four-hour edge,
    // never to treat a materially incorrect device clock as authoritative.
    static let maximumClockSkewMilliseconds: Int64 = 5 * 1_000

    private static let persistedSessionKey = "TrackLabWatchConnectSessionV1"
    fileprivate static let installMarkerKey = "TrackLabWatchConnectInstallMarkerV1"
    private static let contextKind = "tracklab-watch-connect"
    private static let contextVersion = 1
    private static let connectContextAction = "connect"
    private static let clearContextAction = "clear"
    private static let endedEventKind = "tracklab-watch-connect-ended"

    private let queue = DispatchQueue(label: "com.preskilranch.tracklabbmx.watch-connect")
    private let defaults = UserDefaults.standard
    private let identityStore = WatchConnectIdentityStore()
    private var session: TrackLabWatchConnectPersistedSession?
    private var expiryTimer: DispatchSourceTimer?
    private var expirationInFlight = false
    /// `updateApplicationContext` is already durable. Avoid sending the same
    /// clear envelope twice in one process, while intentionally allowing one
    /// recovery resend after a relaunch that may have interrupted delivery.
    private var clearedTerminalContextId: String?
    /// `recoverAtLaunch` can be requested both during app setup and again when
    /// WatchConnectivity activates. Retry an interrupted terminal transaction
    /// at most once per process launch; explicit exact events can still retry.
    private var recoveryAttemptedTerminalContextId: String?

    private init() {
        session = Self.loadSession(from: defaults)
        if session?.contextId == nil {
            session?.contextId = UUID().uuidString
            persistLocked()
        }
    }

    func installIdentity() throws -> [String: Any] {
        [
            "version": 1,
            "installId": try identityStore.installId(defaults: defaults),
        ]
    }

    func stateDictionary() -> [String: Any] {
        queue.sync { stateDictionaryLocked(now: Self.nowMilliseconds()) }
    }

    @discardableResult
    func prepare(
        scope: TrackLabWatchConnectScope,
        connectionId: String,
        pairingId: String,
        relaySessionId: String,
        connectedAt: Int64,
        connectedUntil: Int64
    ) -> Int64 {
        queue.sync {
            let existing = self.session
            let isSameConnection = existing?.scope == scope
                && existing?.connectionId == connectionId
                && existing?.pairingId == pairingId
                && existing?.relaySessionId == relaySessionId
                && existing?.connectedUntil == connectedUntil
            let effectiveRelayStartedAt = isSameConnection
                ? existing?.relayStartedAt ?? existing?.connectedAt ?? connectedAt
                : min(connectedAt, Self.nowMilliseconds())
            if isSameConnection,
               let existing,
               (existing.terminalFinalization != nil
                || [.disconnecting, .syncing, .reconnect].contains(existing.phase)) {
                // Retrying the exact server connection must not mint a new
                // native generation or revive a workout whose mirrored end is
                // already being observed. Resume only an existing durable
                // terminal finalization; otherwise wait for its exact event.
                self.expiryTimer?.cancel()
                self.expiryTimer = nil
                self.session = existing
                if existing.terminalFinalization != nil {
                    self.resumeTerminalFinalizationLocked()
                } else {
                    self.publishLocked()
                }
                return effectiveRelayStartedAt
            }
            let recoveredWorkoutReady = isSameConnection
                && existing?.workoutReady == true
            let recoveredWatchLaunchAccepted = isSameConnection
                && existing?.watchLaunchAccepted == true
            let canReuseContext = isSameConnection
                && existing.map {
                    [.connecting, .connected, .error].contains($0.phase)
                } == true
            let contextId = canReuseContext
                ? existing?.contextId ?? UUID().uuidString
                : UUID().uuidString
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            self.expirationInFlight = false
            self.clearedTerminalContextId = nil
            self.recoveryAttemptedTerminalContextId = nil
            self.session = TrackLabWatchConnectPersistedSession(
                phase: .connecting,
                scope: scope,
                connectionId: connectionId,
                pairingId: pairingId,
                relaySessionId: relaySessionId,
                workoutSessionId: "watch-connect:\(pairingId)",
                contextId: contextId,
                relayStartedAt: effectiveRelayStartedAt,
                connectedAt: connectedAt,
                connectedUntil: connectedUntil,
                workoutReady: recoveredWorkoutReady,
                watchLaunchAccepted: recoveredWatchLaunchAccepted,
                relayConfigured: false,
                reason: nil,
                terminalFinalization: nil
            )
            self.persistLocked()
            self.publishLocked()
            self.sendWatchContextLocked()
            self.scheduleExpiryLocked()
            return effectiveRelayStartedAt
        }
    }

    /// Internal-only recovery identity. It is intentionally absent from the
    /// JavaScript state contract and is used solely to bind an incoming
    /// mirrored HealthKit workout to the persisted Watch Connect session.
    func recoverableWorkoutSessionId() -> String? {
        queue.sync {
            guard let session,
                  session.terminalFinalization == nil,
                  session.connectedUntil > Self.nowMilliseconds(),
                  [.connecting, .connected, .error].contains(session.phase) else { return nil }
            return session.workoutSessionId
        }
    }

    func markRelayConfigured() {
        queue.sync {
            guard var session = self.session,
                  session.terminalFinalization == nil,
                  [.connecting, .connected].contains(session.phase) else { return }
            session.workoutReady = true
            session.watchLaunchAccepted = true
            session.relayConfigured = true
            session.phase = .connected
            session.reason = nil
            self.session = session
            self.persistLocked()
            self.publishLocked()
        }
    }

    func markWatchLaunchAccepted(workoutSessionId: String) {
        queue.sync {
            guard var session = self.session,
                  session.terminalFinalization == nil,
                  session.workoutSessionId == workoutSessionId else { return }
            session.watchLaunchAccepted = true
            self.session = session
            self.persistLocked()
            self.publishLocked()
        }
    }

    func watchLaunchWasAccepted(workoutSessionId: String) -> Bool {
        queue.sync {
            guard let session,
                  session.terminalFinalization == nil,
                  session.workoutSessionId == workoutSessionId,
                  session.connectedUntil > Self.nowMilliseconds() else { return false }
            return session.watchLaunchAccepted || session.workoutReady
        }
    }

    /// A replacement mirrored HealthKit transport is accepted only while the
    /// same private Watch Connect generation is still live. An end, explicit
    /// disconnect, account boundary, or four-hour expiry must never be turned
    /// back into a connecting state by a delayed transport callback.
    func shouldAwaitMirroredReconnect(workoutSessionId: String) -> Bool {
        queue.sync {
            guard let session,
                  session.terminalFinalization == nil,
                  session.workoutSessionId == workoutSessionId,
                  session.connectedUntil > Self.nowMilliseconds(),
                  [.connecting, .connected].contains(session.phase) else { return false }
            return true
        }
    }

    /// Captures the private workout identity before a stop changes the public
    /// lifecycle phase. Callers use it only to cancel that exact generation;
    /// it is never exposed to JavaScript.
    func workoutSessionIdForCancellation() -> String? {
        queue.sync { session?.workoutSessionId }
    }

    func recoverAtLaunch() {
        queue.async {
            guard let session = self.session else { return }
            if let terminal = session.terminalFinalization {
                // The terminal latch may have been persisted immediately before
                // a crash. Never restore its connect context; resume only the
                // exact idempotent finalization and clear envelope.
                if self.recoveryAttemptedTerminalContextId != terminal.contextId {
                    self.recoveryAttemptedTerminalContextId = terminal.contextId
                    self.resumeTerminalFinalizationLocked()
                } else {
                    self.sendWatchClearContextOnceLocked(for: session)
                    self.publishLocked()
                }
                return
            }
            if session.connectedUntil <= Self.nowMilliseconds() {
                self.expireLocked(reason: "The four-hour Watch Connect session ended.")
                return
            }
            self.sendWatchContextLocked()
            self.scheduleExpiryLocked()
            self.publishLocked()
        }
    }

    func observeWorkoutStatus(_ status: TrackLabHeartRateStatus) {
        queue.sync {
            guard var session = self.session,
                  status.sessionId == session.workoutSessionId else { return }
            switch status.state {
            case .active, .paused:
                guard [.connecting, .connected].contains(session.phase) else { return }
                session.workoutReady = true
                session.watchLaunchAccepted = true
                session.phase = session.relayConfigured ? .connected : .connecting
                session.reason = nil
            case .launching, .connecting:
                guard [.connecting, .connected].contains(session.phase) else { return }
                session.phase = .connecting
            case .ending:
                guard [.connecting, .connected, .error, .disconnecting].contains(
                    session.phase
                ) else {
                    return
                }
                if session.terminalFinalization == nil {
                    let endedAt = self.clampedFinalizationTimeLocked(
                        proposed: Int64(
                            (status.at.timeIntervalSince1970 * 1_000).rounded()
                        ),
                        session: session
                    )
                    self.beginTerminalFinalizationLocked(
                        session: &session,
                        endedAt: endedAt,
                        reason: status.message
                    )
                    return
                }
                session.phase = .disconnecting
            case .ended:
                guard [.connecting, .connected, .error, .disconnecting].contains(
                    session.phase
                ) else {
                    return
                }
                if session.terminalFinalization == nil {
                    let endedAt = self.clampedFinalizationTimeLocked(
                        proposed: Int64(
                            (status.at.timeIntervalSince1970 * 1_000).rounded()
                        ),
                        session: session
                    )
                    self.beginTerminalFinalizationLocked(
                        session: &session,
                        endedAt: endedAt,
                        reason: nil
                    )
                    return
                }
                session.phase = .syncing
                session.reason = nil
            case .error, .unavailable:
                guard [.connecting, .connected].contains(session.phase) else { return }
                session.phase = .error
                session.reason = status.message ?? "Watch Connect could not continue."
            case .idle:
                return
            }
            self.session = session
            self.persistLocked()
            self.publishLocked()
        }
    }

    func observeRelayState(_ relayState: [String: Any]) {
        queue.sync {
            guard var session = self.session else { return }
            let sessions = relayState["sessions"] as? [[String: Any]] ?? []
            let relay = sessions.first { candidate in
                candidate["sessionId"] as? String == session.relaySessionId
            }
            if let relay {
                if relay["finalized"] as? Bool == true {
                    if session.terminalFinalization == nil {
                        let endedAt = self.clampedFinalizationTimeLocked(
                            proposed: Self.nowMilliseconds(),
                            session: session
                        )
                        self.beginTerminalFinalizationLocked(
                            session: &session,
                            endedAt: endedAt,
                            reason: nil
                        )
                        return
                    }
                    session.phase = .syncing
                    session.reason = nil
                }
            } else if session.phase == .syncing || session.phase == .disconnecting {
                session.phase = .reconnect
                session.reason = nil
                self.expiryTimer?.cancel()
                self.expiryTimer = nil
            } else if let reason = relayState["reason"] as? String,
                      ["credentialRejected", "requestRejected", "invalidState"].contains(reason) {
                session.phase = .error
                session.reason = "Watch Connect must reconnect before recording more heart rate."
            }
            self.session = session
            self.persistLocked()
            self.publishLocked()
        }
    }

    func fail(_ message: String) {
        queue.sync {
            guard var session = self.session else { return }
            session.phase = .error
            session.reason = message
            self.session = session
            self.persistLocked()
            self.publishLocked()
        }
    }

    func disconnect(reason: String? = nil) {
        queue.sync {
            guard var session = self.session else { return }
            if let terminal = session.terminalFinalization {
                guard terminal.contextId == session.contextId,
                      !terminal.completed,
                      !self.expirationInFlight else { return }
                self.resumeTerminalFinalizationLocked()
                return
            }
            guard [
                    .connecting,
                    .connected,
                    .error,
                    .disconnecting,
                    .syncing,
                    .reconnect,
                  ].contains(session.phase),
                  !self.expirationInFlight else { return }
            let endedAt = self.clampedFinalizationTimeLocked(
                proposed: Self.nowMilliseconds(),
                session: session
            )
            self.beginTerminalFinalizationLocked(
                session: &session,
                endedAt: endedAt,
                reason: reason
            )
        }
    }

    /// Completes a stop initiated on Apple Watch. The Watch queues this event
    /// through WatchConnectivity, so an unreachable iPhone can finalize the
    /// exact connection after it comes back without touching a later session.
    func handleWatchEndedEvent(_ event: [String: Any]) {
        queue.async {
            let maximumEndedAt = Double(
                Self.nowMilliseconds() + Self.maximumClockSkewMilliseconds
            )
            guard event["kind"] as? String == Self.endedEventKind,
                  let connectionId = event["connectionId"] as? String,
                  let workoutSessionId = event["workoutSessionId"] as? String,
                  let eventContextId = (event["contextId"] as? String).flatMap({
                      $0.isEmpty ? nil : $0
                  }),
                  let rawEndedAt = Self.doubleValue(event["endedAt"]),
                  rawEndedAt.isFinite,
                  rawEndedAt >= 0,
                  rawEndedAt <= maximumEndedAt,
                  var session = self.session,
                  session.connectionId == connectionId,
                  session.workoutSessionId == workoutSessionId,
                  session.contextId == eventContextId,
                  [
                    .connecting,
                    .connected,
                    .error,
                    .disconnecting,
                    .syncing,
                    .reconnect,
                  ].contains(session.phase),
                  !self.expirationInFlight else { return }
            if let terminal = session.terminalFinalization {
                guard terminal.contextId == eventContextId,
                      !terminal.completed else { return }
                self.resumeTerminalFinalizationLocked()
                return
            }
            let endedAt = self.clampedFinalizationTimeLocked(
                proposed: Int64(rawEndedAt.rounded()),
                session: session
            )
            self.beginTerminalFinalizationLocked(
                session: &session,
                endedAt: endedAt,
                reason: nil
            )
        }
    }

    /// Called at an account boundary after native relay credentials have been
    /// cleared. The public install identity may remain, but it cannot authorize
    /// another account and the previous connection can no longer appear live.
    func clearSessionForAccountBoundary() {
        queue.sync {
            if let session = self.session {
                self.sendWatchClearContextOnceLocked(for: session)
            }
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            self.expirationInFlight = false
            self.clearedTerminalContextId = nil
            self.recoveryAttemptedTerminalContextId = nil
            self.session = nil
            self.defaults.removeObject(forKey: Self.persistedSessionKey)
            self.publishLocked()
        }
    }

    func relaySessionIdAccepting(recordedAt: Int64) -> String? {
        queue.sync {
            guard let session,
                  session.terminalFinalization == nil,
                  [.connecting, .connected].contains(session.phase),
                  recordedAt <= session.connectedUntil else { return nil }
            return session.relaySessionId
        }
    }

    func connectedUntil(for relaySessionId: String) -> Int64? {
        queue.sync {
            guard let session,
                  session.terminalFinalization == nil,
                  session.relaySessionId == relaySessionId,
                  [.connecting, .connected].contains(session.phase) else { return nil }
            return session.connectedUntil
        }
    }

    private func scheduleExpiryLocked() {
        expiryTimer?.cancel()
        expiryTimer = nil
        guard let session,
              session.terminalFinalization == nil,
              [.connecting, .connected].contains(session.phase) else { return }
        let remaining = min(
            Self.maximumDurationMilliseconds,
            session.connectedUntil - Self.nowMilliseconds()
        )
        if remaining <= 0 {
            expireLocked(reason: "The four-hour Watch Connect session ended.")
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .milliseconds(Int(remaining)), leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            self?.expireLocked(reason: "The four-hour Watch Connect session ended.")
        }
        expiryTimer = timer
        timer.resume()
    }

    private func expireLocked(reason: String) {
        guard var session,
              session.terminalFinalization == nil,
              !expirationInFlight,
              [.connecting, .connected].contains(session.phase) else { return }
        let endedAt = clampedFinalizationTimeLocked(
            proposed: Self.nowMilliseconds(),
            session: session
        )
        beginTerminalFinalizationLocked(
            session: &session,
            endedAt: endedAt,
            reason: reason
        )
    }

    /// Claims terminal ownership for this exact native context. Persisting the
    /// latch is deliberately the first side effect: sendMessage and
    /// transferUserInfo can deliver the same Watch-ended envelope, and a crash
    /// can occur between any following operation.
    private func beginTerminalFinalizationLocked(
        session: inout TrackLabWatchConnectPersistedSession,
        endedAt: Int64,
        reason: String?
    ) {
        guard let contextId = session.contextId,
              session.terminalFinalization == nil,
              !expirationInFlight else { return }
        expirationInFlight = true
        expiryTimer?.cancel()
        expiryTimer = nil
        session.terminalFinalization = TrackLabWatchConnectTerminalFinalization(
            contextId: contextId,
            endedAt: endedAt,
            completed: false
        )
        session.phase = .disconnecting
        session.reason = reason
        self.session = session
        persistLocked()
        sendWatchClearContextOnceLocked(for: session)
        publishLocked()
        finalizeLocked(
            contextId: contextId,
            connectionId: session.connectionId,
            relaySessionId: session.relaySessionId,
            workoutSessionId: session.workoutSessionId,
            endedAt: endedAt
        )
    }

    /// Resumes only a persisted, unfinished terminal transaction. Health-rate
    /// relay finalization is idempotent, so this covers a crash after latching
    /// but before its callback without ever restoring the Watch connect context.
    private func resumeTerminalFinalizationLocked() {
        guard var session,
              let terminal = session.terminalFinalization,
              session.contextId == terminal.contextId else { return }
        expiryTimer?.cancel()
        expiryTimer = nil
        sendWatchClearContextOnceLocked(for: session)
        guard !terminal.completed,
              !expirationInFlight else {
            publishLocked()
            return
        }
        expirationInFlight = true
        session.phase = .disconnecting
        self.session = session
        persistLocked()
        publishLocked()
        finalizeLocked(
            contextId: terminal.contextId,
            connectionId: session.connectionId,
            relaySessionId: session.relaySessionId,
            workoutSessionId: session.workoutSessionId,
            endedAt: terminal.endedAt
        )
    }

    private func finalizeLocked(
        contextId: String,
        connectionId: String,
        relaySessionId: String,
        workoutSessionId: String,
        endedAt: Int64
    ) {
        HeartRateRelay.shared.finalizeWatchConnect(
            sessionId: relaySessionId,
            endedAt: endedAt
        ) { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard var current = self.session,
                      current.contextId == contextId,
                      current.connectionId == connectionId,
                      current.relaySessionId == relaySessionId,
                      current.workoutSessionId == workoutSessionId,
                      var terminal = current.terminalFinalization,
                      terminal.contextId == contextId,
                      terminal.endedAt == endedAt,
                      !terminal.completed else { return }
                self.expirationInFlight = false
                switch result {
                case .success:
                    terminal.completed = true
                    current.phase = .syncing
                case .failure(let error):
                    // Keep the durable terminal identity incomplete. A later
                    // exact Watch-ended event, explicit disconnect, or one
                    // bounded recovery attempt can safely retry the idempotent
                    // relay finalization without reviving live collection.
                    current.phase = .error
                    current.reason = error.localizedDescription
                }
                current.terminalFinalization = terminal
                self.session = current
                self.persistLocked()
                self.publishLocked()
                DispatchQueue.main.async {
                    guard self.ownsTerminalFinalization(
                        contextId: contextId,
                        connectionId: connectionId,
                        relaySessionId: relaySessionId,
                        workoutSessionId: workoutSessionId
                    ) else { return }
                    _ = HeartRateCoordinator.shared.endWorkout(
                        sessionId: workoutSessionId
                    )
                }
            }
        }
    }

    private func ownsTerminalFinalization(
        contextId: String,
        connectionId: String,
        relaySessionId: String,
        workoutSessionId: String
    ) -> Bool {
        queue.sync {
            guard let session,
                  session.contextId == contextId,
                  session.connectionId == connectionId,
                  session.relaySessionId == relaySessionId,
                  session.workoutSessionId == workoutSessionId,
                  session.terminalFinalization?.contextId == contextId else { return false }
            return true
        }
    }

    private func clampedFinalizationTimeLocked(
        proposed: Int64,
        session: TrackLabWatchConnectPersistedSession
    ) -> Int64 {
        let localNow = Self.nowMilliseconds()
        let relayStartedAt = session.relayStartedAt
            ?? min(session.connectedAt, localNow)
        return max(
            relayStartedAt,
            min(proposed, session.connectedUntil, localNow)
        )
    }

    private func sendWatchContextLocked() {
        guard let session, WCSession.isSupported() else { return }
        let context: [String: Any] = [
            "kind": Self.contextKind,
            "version": Self.contextVersion,
            "action": Self.connectContextAction,
            "contextId": session.contextId ?? "",
            "connectionId": session.connectionId,
            "workoutSessionId": session.workoutSessionId,
            "connectedUntil": Double(session.connectedUntil),
        ]
        deliverWatchContextLocked(context)
    }

    @discardableResult
    private func sendWatchClearContextLocked(
        for session: TrackLabWatchConnectPersistedSession
    ) -> Bool {
        guard WCSession.isSupported() else { return false }
        let context: [String: Any] = [
            "kind": Self.contextKind,
            "version": Self.contextVersion,
            "action": Self.clearContextAction,
            "contextId": session.contextId ?? "",
            "connectionId": session.connectionId,
            "workoutSessionId": session.workoutSessionId,
            "connectedUntil": Double(session.connectedUntil),
            "clearedAt": Double(Self.nowMilliseconds()),
        ]
        return deliverWatchContextLocked(context)
    }

    private func sendWatchClearContextOnceLocked(
        for session: TrackLabWatchConnectPersistedSession
    ) {
        guard let contextId = session.contextId,
              clearedTerminalContextId != contextId else { return }
        if sendWatchClearContextLocked(for: session) {
            clearedTerminalContextId = contextId
        }
    }

    @discardableResult
    private func deliverWatchContextLocked(_ context: [String: Any]) -> Bool {
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated {
            connectivity.activate()
        }
        do {
            try connectivity.updateApplicationContext(context)
        } catch {
            return false
        }
        if connectivity.isReachable {
            connectivity.sendMessage(context, replyHandler: nil, errorHandler: nil)
        }
        return true
    }

    private func stateDictionaryLocked(now: Int64) -> [String: Any] {
        guard let session else {
            return [
                "version": 1,
                "state": TrackLabWatchConnectPhase.inactive.rawValue,
                "scope": NSNull(),
                "connectionId": NSNull(),
                "sessionId": NSNull(),
                "connectedUntil": NSNull(),
                "remainingMs": 0,
                "requiresUserStart": true,
                "workoutReady": false,
                "relayConfigured": false,
            ]
        }
        let remaining = min(
            Self.maximumDurationMilliseconds,
            max(0, session.connectedUntil - now)
        )
        var result: [String: Any] = [
            "version": 1,
            "state": session.phase.rawValue,
            "scope": session.scope.rawValue,
            "connectionId": session.connectionId,
            "sessionId": session.relaySessionId,
            "connectedUntil": Double(session.connectedUntil),
            "remainingMs": Double(remaining),
            "requiresUserStart": [.inactive, .reconnect, .error].contains(session.phase)
                || (session.phase == .connecting
                    && !session.watchLaunchAccepted
                    && !session.workoutReady),
            "workoutReady": session.workoutReady,
            "relayConfigured": session.relayConfigured,
        ]
        if let reason = session.reason, !reason.isEmpty {
            result["reason"] = reason
        }
        return result
    }

    private func persistLocked() {
        guard let session,
              let data = try? JSONEncoder().encode(session) else {
            defaults.removeObject(forKey: Self.persistedSessionKey)
            return
        }
        defaults.set(data, forKey: Self.persistedSessionKey)
    }

    private func publishLocked() {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .trackLabWatchConnectDidChange, object: nil)
        }
    }

    private static func loadSession(from defaults: UserDefaults) -> TrackLabWatchConnectPersistedSession? {
        guard let data = defaults.data(forKey: persistedSessionKey),
              var session = try? JSONDecoder().decode(
                TrackLabWatchConnectPersistedSession.self,
                from: data
              ),
              [
                TrackLabWatchConnectPersistedSession.build10Version,
                TrackLabWatchConnectPersistedSession.currentVersion,
              ].contains(session.version),
              session.connectedUntil > session.connectedAt,
              session.connectedUntil - session.connectedAt <= maximumDurationMilliseconds,
              !session.connectionId.isEmpty,
              !session.pairingId.isEmpty,
              !session.relaySessionId.isEmpty else {
            defaults.removeObject(forKey: persistedSessionKey)
            return nil
        }

        if session.version == TrackLabWatchConnectPersistedSession.build10Version {
            guard migrateBuild10Session(&session),
                  let migratedData = try? JSONEncoder().encode(session) else {
                defaults.removeObject(forKey: persistedSessionKey)
                return nil
            }
            // Persist the migration before launch recovery can publish any
            // WatchConnectivity context. A crash can therefore never decode
            // the same terminal Build 10 row as a live connection next time.
            defaults.set(migratedData, forKey: persistedSessionKey)
        }

        let terminalPhases: [TrackLabWatchConnectPhase] = [
            .disconnecting,
            .syncing,
            .reconnect,
        ]
        let terminalIsValid = session.terminalFinalization.map({ terminal in
            terminal.contextId == session.contextId
                && terminal.endedAt >= (session.relayStartedAt ?? session.connectedAt)
                && terminal.endedAt <= session.connectedUntil
        }) != false
        let phaseAndTerminalAgree = terminalPhases.contains(session.phase)
            ? session.terminalFinalization != nil
            : ![.connecting, .connected].contains(session.phase)
                || session.terminalFinalization == nil
        guard session.version == TrackLabWatchConnectPersistedSession.currentVersion,
              session.phase != .inactive,
              terminalIsValid,
              phaseAndTerminalAgree else {
            defaults.removeObject(forKey: persistedSessionKey)
            return nil
        }
        return session
    }

    /// Build 10 used persisted schema v3, before terminal ownership was
    /// durable. Only unambiguously active rows may continue. Build 10 also used
    /// `.error` after a terminal relay-finalization failure, so an error row is
    /// conservatively ended and must be explicitly restarted. Every possibly
    /// terminal row first gains an exact unfinished latch; otherwise
    /// recoverAtLaunch could overwrite the Watch's pending clear envelope with
    /// a new connect context and resurrect a workout that was already ending.
    private static func migrateBuild10Session(
        _ session: inout TrackLabWatchConnectPersistedSession
    ) -> Bool {
        guard session.version == TrackLabWatchConnectPersistedSession.build10Version,
              session.terminalFinalization == nil else { return false }
        session.version = TrackLabWatchConnectPersistedSession.currentVersion
        switch session.phase {
        case .connecting, .connected:
            return true
        case .disconnecting, .syncing, .reconnect, .error:
            guard let contextId = session.contextId?.trimmingCharacters(
                in: .whitespacesAndNewlines
            ), !contextId.isEmpty else { return false }
            let localNow = nowMilliseconds()
            let relayStartedAt = session.relayStartedAt
                ?? min(session.connectedAt, localNow)
            session.terminalFinalization = TrackLabWatchConnectTerminalFinalization(
                contextId: contextId,
                endedAt: max(
                    relayStartedAt,
                    min(localNow, session.connectedUntil)
                ),
                completed: false
            )
            session.phase = .disconnecting
            return true
        case .inactive:
            return false
        }
    }

    private static func nowMilliseconds() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1_000).rounded())
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        return nil
    }
}

private final class WatchConnectIdentityStore: @unchecked Sendable {
    private let lock = NSLock()
    private let service = "com.preskilranch.tracklabbmx.watch-connect"
    private let account = "public-install-id-v1"

    func installId(defaults: UserDefaults) throws -> String {
        lock.lock()
        defer { lock.unlock() }

        // Keychain items can outlive an uninstall. The app-container marker
        // intentionally rotates that stale identity on a true reinstall while
        // preserving it across updates, relaunches, and normal app offloading.
        if !defaults.bool(forKey: WatchConnectSessionManager.installMarkerKey) {
            deleteLocked()
            defaults.set(true, forKey: WatchConnectSessionManager.installMarkerKey)
        }
        if let existing = loadLocked(), Self.valid(existing) {
            return existing
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw WatchConnectIdentityError.secureRandomFailed
        }
        let generated = "wci_" + bytes.map { String(format: "%02x", $0) }.joined()
        try storeLocked(generated)
        return generated
    }

    private func loadLocked() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func storeLocked(_ value: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw WatchConnectIdentityError.secureStorageFailed
        }
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let update = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else {
            throw WatchConnectIdentityError.secureStorageFailed
        }
        var insertion = lookup
        attributes.forEach { insertion[$0.key] = $0.value }
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else {
            throw WatchConnectIdentityError.secureStorageFailed
        }
    }

    private func deleteLocked() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func valid(_ value: String) -> Bool {
        value.range(of: #"^wci_[0-9a-f]{64}$"#, options: .regularExpression) != nil
    }
}

private enum WatchConnectIdentityError: LocalizedError {
    case secureRandomFailed
    case secureStorageFailed

    var errorDescription: String? {
        switch self {
        case .secureRandomFailed:
            return "Watch Connect could not create a trusted install identity."
        case .secureStorageFailed:
            return "Watch Connect could not protect its trusted install identity."
        }
    }
}
