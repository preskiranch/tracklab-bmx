import Capacitor
import Foundation

@objc(HeartRatePlugin)
public final class HeartRatePlugin: CAPPlugin, CAPBridgedPlugin, HeartRateCoordinatorObserver,
    HeartRateRelayObserver {
    public let identifier = "HeartRatePlugin"
    public let jsName = "TrackLabHeartRate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRelayState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureRelay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseRelay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeRelay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finalizeRelay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearRelay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllRelays", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchConnectIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchConnectState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatchConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWatchConnect", returnType: CAPPluginReturnPromise),
    ]

    private var watchConnectObserver: NSObjectProtocol?
    private let watchConnectStartLock = NSLock()
    private var watchConnectStartToken: UUID?

    public override func load() {
        HeartRateCoordinator.shared.addObserver(self)
        HeartRateRelay.shared.addObserver(self)
        watchConnectObserver = NotificationCenter.default.addObserver(
            forName: .trackLabWatchConnectDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.emitWatchConnectStatus()
        }
    }

    deinit {
        HeartRateCoordinator.shared.removeObserver(self)
        HeartRateRelay.shared.removeObserver(self)
        if let watchConnectObserver {
            NotificationCenter.default.removeObserver(watchConnectObserver)
        }
    }

    @objc public func getAvailability(_ call: CAPPluginCall) {
        call.resolve(HeartRateCoordinator.shared.availability())
    }

    @objc public func getState(_ call: CAPPluginCall) {
        call.resolve(Self.stateWithWatchConnect())
    }

    @objc public func getWatchConnectIdentity(_ call: CAPPluginCall) {
        do {
            call.resolve(try WatchConnectSessionManager.shared.installIdentity())
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc public func getWatchConnectState(_ call: CAPPluginCall) {
        call.resolve(WatchConnectSessionManager.shared.stateDictionary())
    }

    @objc public func startWatchConnect(_ call: CAPPluginCall) {
        guard let scope = TrackLabWatchConnectScope(rawValue: call.getString("scope") ?? ""),
              let connectionId = Self.normalizedOpaqueId(call.getString("connectionId")),
              let pairingId = Self.normalizedOpaqueId(call.getString("pairingId")),
              let relaySessionId = Self.normalizedOpaqueId(call.getString("relaySessionId")),
              let baseURL = call.getString("baseUrl"),
              let ingestToken = call.getString("ingestToken"),
              let rawExpiresAt = call.getDouble("expiresAt"),
              rawExpiresAt.isFinite else {
            call.reject("Watch Connect received an invalid connection.")
            return
        }
        let connectedAt = Int64((Date().timeIntervalSince1970 * 1_000).rounded())
        let connectedUntil = Int64(rawExpiresAt.rounded())
        guard connectedUntil > connectedAt,
              connectedUntil - connectedAt <= WatchConnectSessionManager.maximumDurationMilliseconds else {
            call.reject("Watch Connect requires a new four-hour connection.")
            return
        }
        guard let startToken = beginWatchConnectStart() else {
            call.reject("Watch Connect is already connecting.")
            return
        }

        let effectiveConnectedAt = WatchConnectSessionManager.shared.prepare(
            scope: scope,
            connectionId: connectionId,
            pairingId: pairingId,
            relaySessionId: relaySessionId,
            connectedAt: connectedAt,
            connectedUntil: connectedUntil
        )
        let workoutSessionId = "watch-connect:\(pairingId)"
        HeartRateCoordinator.shared.startWorkout(sessionId: workoutSessionId) { workoutResult in
            guard self.watchConnectStartIsCurrent(startToken) else {
                call.reject("Watch Connect start was cancelled.")
                return
            }
            switch workoutResult {
            case .failure(let error):
                WatchConnectSessionManager.shared.fail(error.localizedDescription)
                self.finishWatchConnectStart(startToken)
                DispatchQueue.main.async { call.reject(error.localizedDescription) }
            case .success:
                HeartRateCoordinator.shared.waitForWorkoutReady(
                    sessionId: workoutSessionId
                ) { readyResult in
                    guard self.watchConnectStartIsCurrent(startToken) else {
                        call.reject("Watch Connect start was cancelled.")
                        return
                    }
                    switch readyResult {
                    case .failure(let error):
                        WatchConnectSessionManager.shared.fail(error.localizedDescription)
                        _ = HeartRateCoordinator.shared.endWorkout()
                        self.finishWatchConnectStart(startToken)
                        call.reject(error.localizedDescription)
                    case .success:
                        HeartRateRelay.shared.configure(
                            baseURL: baseURL,
                            ingestToken: ingestToken,
                            sessionId: relaySessionId,
                            scope: scope == .personal ? .accountBlock : .studioBlock,
                            startedAt: Double(effectiveConnectedAt),
                            activeElapsedAtStartMs: 0
                        ) { relayResult in
                            DispatchQueue.main.async {
                                guard self.watchConnectStartIsCurrent(startToken) else {
                                    call.reject("Watch Connect start was cancelled.")
                                    return
                                }
                                switch relayResult {
                                case .success(let relayState):
                                    HeartRateCoordinator.shared.replayRecentSamples(
                                        since: Double(effectiveConnectedAt)
                                    )
                                    guard relayState["configured"] as? Bool == true else {
                                        WatchConnectSessionManager.shared.fail(
                                            "Watch Connect could not configure its private relay."
                                        )
                                        _ = HeartRateCoordinator.shared.endWorkout()
                                        self.finishWatchConnectStart(startToken)
                                        call.reject("Watch Connect could not configure its private relay.")
                                        return
                                    }
                                    WatchConnectSessionManager.shared.markRelayConfigured()
                                    self.finishWatchConnectStart(startToken)
                                    call.resolve(WatchConnectSessionManager.shared.stateDictionary())
                                case .failure(let error):
                                    WatchConnectSessionManager.shared.fail(error.localizedDescription)
                                    _ = HeartRateCoordinator.shared.endWorkout()
                                    self.finishWatchConnectStart(startToken)
                                    call.reject(error.localizedDescription)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @objc public func stopWatchConnect(_ call: CAPPluginCall) {
        cancelWatchConnectStart()
        WatchConnectSessionManager.shared.disconnect()
        call.resolve(WatchConnectSessionManager.shared.stateDictionary())
    }

    @objc public func getRelayState(_ call: CAPPluginCall) {
        HeartRateRelay.shared.relayState { relayState in
            DispatchQueue.main.async {
                call.resolve(relayState)
            }
        }
    }

    @objc public func startWorkout(_ call: CAPPluginCall) {
        HeartRateCoordinator.shared.startWorkout(sessionId: call.getString("sessionId")) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let status):
                    call.resolve(status)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func pauseWorkout(_ call: CAPPluginCall) {
        call.resolve(HeartRateCoordinator.shared.pauseWorkout())
    }

    @objc public func resumeWorkout(_ call: CAPPluginCall) {
        call.resolve(HeartRateCoordinator.shared.resumeWorkout())
    }

    @objc public func endWorkout(_ call: CAPPluginCall) {
        HeartRateRelay.shared.finalizeContinuousBlockAtWorkoutEnd(at: Date()) { result in
            DispatchQueue.main.async {
                let workoutState = HeartRateCoordinator.shared.endWorkout()
                switch result {
                case .success(let relayState):
                    var response = workoutState
                    response["relay"] = relayState
                    call.resolve(response)
                case .failure(let error):
                    // The Watch workout still stops even if the private relay
                    // needs intervention; its protected outbox is not cleared.
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func configureRelay(_ call: CAPPluginCall) {
        guard let baseURL = call.getString("baseUrl"),
              let ingestToken = call.getString("ingestToken"),
              let sessionId = call.getString("sessionId"),
              let startedAt = call.getDouble("startedAt") else {
            call.reject("TrackLab could not configure a valid private heart-rate relay.")
            return
        }
        let rawScope = call.getString("scope")
            ?? HeartRateRelayScope.personalSession.rawValue
        guard let scope = HeartRateRelayScope(rawValue: rawScope) else {
            call.reject("TrackLab could not configure a valid private heart-rate relay scope.")
            return
        }

        HeartRateRelay.shared.configure(
            baseURL: baseURL,
            ingestToken: ingestToken,
            sessionId: sessionId,
            scope: scope,
            startedAt: startedAt,
            activeElapsedAtStartMs: call.getDouble("activeElapsedAtStartMs")
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let relayState):
                    HeartRateCoordinator.shared.replayRecentSamples(since: startedAt)
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func finalizeRelay(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"),
              let endedAt = call.getDouble("endedAt"),
              let activeDurationMs = call.getDouble("activeDurationMs") else {
            call.reject("TrackLab could not finalize an invalid heart-rate relay.")
            return
        }

        let rawZones = call.getArray("zones") ?? []
        guard rawZones.count <= 500 else {
            call.reject("TrackLab could not finalize invalid pedal-zone windows.")
            return
        }
        var zones: [HeartRateRelayZone] = []
        for rawZone in rawZones {
            guard let zone = rawZone as? JSObject,
                  let zoneId = zone["zoneId"] as? String,
                  let startElapsedMs = Self.doubleValue(zone["startElapsedMs"]),
                  let endElapsedMs = Self.doubleValue(zone["endElapsedMs"]),
                  let normalized = HeartRateRelayZone(
                    zoneId: zoneId,
                    zoneName: zone["zoneName"] as? String,
                    startElapsedMs: startElapsedMs,
                    endElapsedMs: endElapsedMs
                  ) else {
                call.reject("TrackLab could not finalize invalid pedal-zone windows.")
                return
            }
            zones.append(normalized)
        }

        HeartRateRelay.shared.finalize(
            sessionId: sessionId,
            endedAt: endedAt,
            activeDurationMs: activeDurationMs,
            zones: zones
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let relayState):
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func pauseRelay(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"),
              let at = call.getDouble("at"),
              let activeElapsedMs = call.getDouble("activeElapsedMs") else {
            call.reject("TrackLab could not update an invalid private heart-rate relay clock.")
            return
        }
        HeartRateRelay.shared.pauseRelay(
            sessionId: sessionId,
            at: at,
            activeElapsedMs: activeElapsedMs
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let relayState):
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func resumeRelay(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"),
              let at = call.getDouble("at"),
              let activeElapsedMs = call.getDouble("activeElapsedMs") else {
            call.reject("TrackLab could not update an invalid private heart-rate relay clock.")
            return
        }
        HeartRateRelay.shared.resumeRelay(
            sessionId: sessionId,
            at: at,
            activeElapsedMs: activeElapsedMs
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let relayState):
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func clearRelay(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("TrackLab could not clear an invalid private heart-rate relay.")
            return
        }
        HeartRateRelay.shared.clear(sessionId: sessionId) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let relayState):
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func clearAllRelays(_ call: CAPPluginCall) {
        cancelWatchConnectStart()
        let watchConnectState = WatchConnectSessionManager.shared.stateDictionary()
        if watchConnectState["state"] as? String != TrackLabWatchConnectPhase.inactive.rawValue {
            WatchConnectSessionManager.shared.disconnect(
                reason: "Watch Connect stopped at this account boundary."
            )
        }
        HeartRateRelay.shared.clearForAccountBoundary { result in
            DispatchQueue.main.async {
                WatchConnectSessionManager.shared.clearSessionForAccountBoundary()
                switch result {
                case .success(let relayState):
                    call.resolve(relayState)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    func heartRateCoordinator(_ coordinator: HeartRateCoordinator, didReceive sample: [String: Any]) {
        notifyListeners("heartRateSample", data: sample)
    }

    func heartRateCoordinator(_ coordinator: HeartRateCoordinator, didChange status: TrackLabHeartRateStatus) {
        var enriched = status.dictionary()
        enriched["watchConnect"] = WatchConnectSessionManager.shared.stateDictionary()
        notifyListeners("heartRateStatus", data: enriched, retainUntilConsumed: true)
    }

    func heartRateRelay(_ relay: HeartRateRelay, didChange state: [String: Any]) {
        WatchConnectSessionManager.shared.observeRelayState(state)
        notifyListeners("heartRateRelayStatus", data: state, retainUntilConsumed: true)
    }

    private func emitWatchConnectStatus() {
        notifyListeners(
            "heartRateStatus",
            data: Self.stateWithWatchConnect(),
            retainUntilConsumed: true
        )
    }

    private static func stateWithWatchConnect() -> [String: Any] {
        var status = HeartRateCoordinator.shared.state()
        status["watchConnect"] = WatchConnectSessionManager.shared.stateDictionary()
        return status
    }

    private func beginWatchConnectStart() -> UUID? {
        watchConnectStartLock.lock()
        defer { watchConnectStartLock.unlock() }
        guard watchConnectStartToken == nil else { return nil }
        let token = UUID()
        watchConnectStartToken = token
        return token
    }

    private func watchConnectStartIsCurrent(_ token: UUID) -> Bool {
        watchConnectStartLock.lock()
        defer { watchConnectStartLock.unlock() }
        return watchConnectStartToken == token
    }

    private func finishWatchConnectStart(_ token: UUID) {
        watchConnectStartLock.lock()
        if watchConnectStartToken == token {
            watchConnectStartToken = nil
        }
        watchConnectStartLock.unlock()
    }

    private func cancelWatchConnectStart() {
        watchConnectStartLock.lock()
        watchConnectStartToken = nil
        watchConnectStartLock.unlock()
    }

    private static func normalizedOpaqueId(_ value: String?) -> String? {
        guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !normalized.isEmpty,
              normalized.utf8.count <= 160,
              !normalized.unicodeScalars.contains(where: {
                CharacterSet.controlCharacters.contains($0)
              }) else { return nil }
        return normalized
    }

    private static func doubleValue(_ value: JSValue?) -> Double? {
        if let double = value as? Double { return double }
        if let integer = value as? Int { return Double(integer) }
        if let number = value as? NSNumber { return number.doubleValue }
        return nil
    }
}
