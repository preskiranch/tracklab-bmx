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
    static let currentVersion = 3

    var version = currentVersion
    var phase: TrackLabWatchConnectPhase
    var scope: TrackLabWatchConnectScope
    var connectionId: String
    var pairingId: String
    var relaySessionId: String
    var workoutSessionId: String
    var connectedAt: Int64
    var connectedUntil: Int64
    var workoutReady: Bool
    var watchLaunchAccepted: Bool
    var relayConfigured: Bool
    var reason: String?
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

    private static let persistedSessionKey = "TrackLabWatchConnectSessionV1"
    fileprivate static let installMarkerKey = "TrackLabWatchConnectInstallMarkerV1"
    private static let contextKind = "tracklab-watch-connect"
    private static let endedEventKind = "tracklab-watch-connect-ended"

    private let queue = DispatchQueue(label: "com.preskilranch.tracklabbmx.watch-connect")
    private let defaults = UserDefaults.standard
    private let identityStore = WatchConnectIdentityStore()
    private var session: TrackLabWatchConnectPersistedSession?
    private var expiryTimer: DispatchSourceTimer?
    private var expirationInFlight = false

    private init() {
        session = Self.loadSession(from: defaults)
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
            let effectiveConnectedAt = isSameConnection
                ? existing?.connectedAt ?? connectedAt
                : connectedAt
            let recoveredWorkoutReady = isSameConnection
                && existing?.workoutReady == true
            let recoveredWatchLaunchAccepted = isSameConnection
                && existing?.watchLaunchAccepted == true
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            self.expirationInFlight = false
            self.session = TrackLabWatchConnectPersistedSession(
                phase: .connecting,
                scope: scope,
                connectionId: connectionId,
                pairingId: pairingId,
                relaySessionId: relaySessionId,
                workoutSessionId: "watch-connect:\(pairingId)",
                connectedAt: effectiveConnectedAt,
                connectedUntil: connectedUntil,
                workoutReady: recoveredWorkoutReady,
                watchLaunchAccepted: recoveredWatchLaunchAccepted,
                relayConfigured: false,
                reason: nil
            )
            self.persistLocked()
            self.publishLocked()
            self.sendWatchContextLocked()
            self.scheduleExpiryLocked()
            return effectiveConnectedAt
        }
    }

    /// Internal-only recovery identity. It is intentionally absent from the
    /// JavaScript state contract and is used solely to bind an incoming
    /// mirrored HealthKit workout to the persisted Watch Connect session.
    func recoverableWorkoutSessionId() -> String? {
        queue.sync {
            guard let session,
                  session.connectedUntil > Self.nowMilliseconds(),
                  [.connecting, .connected, .error].contains(session.phase) else { return nil }
            return session.workoutSessionId
        }
    }

    func markRelayConfigured() {
        queue.sync {
            guard var session = self.session else { return }
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
                  session.workoutSessionId == workoutSessionId,
                  session.connectedUntil > Self.nowMilliseconds() else { return false }
            return session.watchLaunchAccepted || session.workoutReady
        }
    }

    func recoverAtLaunch() {
        queue.async {
            guard let session = self.session else { return }
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
                if session.phase != .error {
                    session.workoutReady = true
                    session.watchLaunchAccepted = true
                    session.phase = session.relayConfigured ? .connected : .connecting
                    session.reason = nil
                }
            case .launching, .connecting:
                if session.phase != .error {
                    session.phase = .connecting
                }
            case .ending:
                if session.phase != .error {
                    session.phase = .disconnecting
                }
            case .ended:
                if session.phase != .error {
                    session.phase = .syncing
                    session.reason = nil
                }
            case .error, .unavailable:
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
            guard var session = self.session,
                  [.connecting, .connected, .error].contains(session.phase),
                  !self.expirationInFlight else { return }
            self.expirationInFlight = true
            session.phase = .disconnecting
            session.reason = reason
            self.session = session
            self.persistLocked()
            self.publishLocked()
            self.finalizeLocked(at: min(Self.nowMilliseconds(), session.connectedUntil))
        }
    }

    /// Completes a stop initiated on Apple Watch. The Watch queues this event
    /// through WatchConnectivity, so an unreachable iPhone can finalize the
    /// exact connection after it comes back without touching a later session.
    func handleWatchEndedEvent(_ event: [String: Any]) {
        queue.async {
            guard event["kind"] as? String == Self.endedEventKind,
                  let connectionId = event["connectionId"] as? String,
                  let workoutSessionId = event["workoutSessionId"] as? String,
                  let rawEndedAt = Self.doubleValue(event["endedAt"]),
                  rawEndedAt.isFinite,
                  rawEndedAt >= 0,
                  rawEndedAt <= Double(Int64.max),
                  var session = self.session,
                  session.connectionId == connectionId,
                  session.workoutSessionId == workoutSessionId,
                  [.connecting, .connected, .error].contains(session.phase),
                  !self.expirationInFlight else { return }
            self.expirationInFlight = true
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            session.phase = .disconnecting
            session.reason = nil
            self.session = session
            self.persistLocked()
            self.publishLocked()
            let endedAt = max(
                session.connectedAt,
                min(Int64(rawEndedAt.rounded()), session.connectedUntil)
            )
            self.finalizeLocked(at: endedAt)
        }
    }

    /// Called at an account boundary after native relay credentials have been
    /// cleared. The public install identity may remain, but it cannot authorize
    /// another account and the previous connection can no longer appear live.
    func clearSessionForAccountBoundary() {
        queue.sync {
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            self.expirationInFlight = false
            self.session = nil
            self.defaults.removeObject(forKey: Self.persistedSessionKey)
            self.publishLocked()
        }
    }

    func relaySessionIdAccepting(recordedAt: Int64) -> String? {
        queue.sync {
            guard let session,
                  [.connecting, .connected].contains(session.phase),
                  recordedAt <= session.connectedUntil else { return nil }
            return session.relaySessionId
        }
    }

    func connectedUntil(for relaySessionId: String) -> Int64? {
        queue.sync {
            guard let session,
                  session.relaySessionId == relaySessionId,
                  [.connecting, .connected].contains(session.phase) else { return nil }
            return session.connectedUntil
        }
    }

    private func scheduleExpiryLocked() {
        expiryTimer?.cancel()
        expiryTimer = nil
        guard let session,
              [.connecting, .connected].contains(session.phase) else { return }
        let remaining = session.connectedUntil - Self.nowMilliseconds()
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
              !expirationInFlight,
              [.connecting, .connected].contains(session.phase) else { return }
        expirationInFlight = true
        expiryTimer?.cancel()
        expiryTimer = nil
        session.phase = .disconnecting
        session.reason = reason
        self.session = session
        persistLocked()
        publishLocked()
        finalizeLocked(at: session.connectedUntil)
    }

    private func finalizeLocked(at endedAt: Int64) {
        guard let session else { return }
        HeartRateRelay.shared.finalizeWatchConnect(
            sessionId: session.relaySessionId,
            endedAt: endedAt
        ) { [weak self] result in
            guard let self else { return }
            DispatchQueue.main.async {
                _ = HeartRateCoordinator.shared.endWorkout()
            }
            self.queue.async {
                self.expirationInFlight = false
                guard var current = self.session,
                      current.relaySessionId == session.relaySessionId else { return }
                switch result {
                case .success:
                    current.phase = .syncing
                case .failure(let error):
                    current.phase = .error
                    current.reason = error.localizedDescription
                }
                self.session = current
                self.persistLocked()
                self.publishLocked()
            }
        }
    }

    private func sendWatchContextLocked() {
        guard let session, WCSession.isSupported() else { return }
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated {
            connectivity.activate()
        }
        let context: [String: Any] = [
            "kind": Self.contextKind,
            "connectionId": session.connectionId,
            "workoutSessionId": session.workoutSessionId,
            "connectedUntil": Double(session.connectedUntil),
        ]
        try? connectivity.updateApplicationContext(context)
        if connectivity.isReachable {
            connectivity.sendMessage(context, replyHandler: nil, errorHandler: nil)
        }
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
        let remaining = max(0, session.connectedUntil - now)
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
              let session = try? JSONDecoder().decode(
                TrackLabWatchConnectPersistedSession.self,
                from: data
              ),
              session.version == TrackLabWatchConnectPersistedSession.currentVersion,
              session.connectedUntil > session.connectedAt,
              session.connectedUntil - session.connectedAt <= maximumDurationMilliseconds,
              !session.connectionId.isEmpty,
              !session.pairingId.isEmpty,
              !session.relaySessionId.isEmpty else {
            defaults.removeObject(forKey: persistedSessionKey)
            return nil
        }
        return session
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
