import Foundation
import HealthKit
import UIKit
import WatchConnectivity

enum TrackLabHeartRateState: String {
    case idle
    case launching
    case connecting
    case active
    case paused
    case ending
    case ended
    case unavailable
    case error
}

struct TrackLabHeartRateStatus {
    let state: TrackLabHeartRateState
    let sessionId: String?
    let message: String?
    let at: Date

    func dictionary() -> [String: Any] {
        var value: [String: Any] = [
            "version": HeartRateWireSample.currentVersion,
            "state": state.rawValue,
            "sessionId": sessionId ?? NSNull(),
            "at": at.timeIntervalSince1970 * 1_000,
        ]
        if let message {
            value["message"] = message
        }
        return value
    }
}

protocol HeartRateCoordinatorObserver: AnyObject {
    func heartRateCoordinator(_ coordinator: HeartRateCoordinator, didReceive sample: [String: Any])
    func heartRateCoordinator(_ coordinator: HeartRateCoordinator, didChange status: TrackLabHeartRateStatus)
}

/// Owns the iPhone side of HealthKit workout mirroring. It is configured from
/// AppDelegate before the Capacitor web view loads so HealthKit can hand an
/// incoming mirrored workout to the app even when launching in the background.
final class HeartRateCoordinator: NSObject {
    static let shared = HeartRateCoordinator()

    private let healthStore = HKHealthStore()
    private let observerLock = NSLock()
    private let observers = NSHashTable<AnyObject>.weakObjects()
    private let recentSampleLock = NSLock()
    private var recentSamples: [HeartRateWireSample] = []
    private let recentSampleWindowMs: Double = 30_000
    private let maximumRecentSamples = 120
    private var workoutReadyWaiters: [UUID: WorkoutReadyWaiter] = [:]
    private var launchInFlight: WorkoutLaunchRequest?
    private var activeSessionId: String?
    private var activeGeneration: UUID?
    private var mirroredHandlerToken: UUID?
    private var latestStatus = TrackLabHeartRateStatus(
        state: .idle,
        sessionId: nil,
        message: nil,
        at: Date()
    )

    @available(iOS 17.0, *)
    private var mirroredWorkoutHandler: MirroredWorkoutHandler? {
        get { _mirroredWorkoutHandler as? MirroredWorkoutHandler }
        set { _mirroredWorkoutHandler = newValue }
    }
    private var _mirroredWorkoutHandler: AnyObject?

    private override init() {
        super.init()
    }

    func configureAtLaunch() {
        HeartRateRelay.shared.start()
        WatchConnectSessionManager.shared.recoverAtLaunch()
        if let recoveredSessionId = WatchConnectSessionManager.shared.recoverableWorkoutSessionId() {
            activeSessionId = recoveredSessionId
            activeGeneration = UUID()
            updateStatus(.connecting, message: "Recovering Apple Watch workout…")
        }

        if WCSession.isSupported() {
            let connectivity = WCSession.default
            connectivity.delegate = self
            connectivity.activate()
        }

        guard #available(iOS 17.0, *) else {
            updateStatus(.unavailable, message: "Apple Watch heart rate requires iOS 17 or later.")
            return
        }

        healthStore.workoutSessionMirroringStartHandler = { [weak self] session in
            self?.acceptMirroredWorkout(session)
        }
    }

    func addObserver(_ observer: HeartRateCoordinatorObserver) {
        observerLock.lock()
        observers.add(observer)
        observerLock.unlock()
        observer.heartRateCoordinator(self, didChange: latestStatus)
    }

    func removeObserver(_ observer: HeartRateCoordinatorObserver) {
        observerLock.lock()
        observers.remove(observer)
        observerLock.unlock()
    }

    func availability() -> [String: Any] {
        let device = UIDevice.current.userInterfaceIdiom
        let platform = device == .phone ? "iphone" : device == .pad ? "ipad" : "other"
        var paired = false
        var installed = false

        if WCSession.isSupported() {
            let session = WCSession.default
            paired = session.activationState == .activated && session.isPaired
            installed = session.activationState == .activated && session.isWatchAppInstalled
        }

        let healthAvailable = HKHealthStore.isHealthDataAvailable()
        let supported = device == .phone
            && healthAvailable
            && paired
            && installed
            && ProcessInfo.processInfo.isOperatingSystemAtLeast(
                OperatingSystemVersion(majorVersion: 17, minorVersion: 0, patchVersion: 0)
            )

        var reason: String?
        if device != .phone {
            reason = "Apple Watch connects through its paired iPhone. Use TrackLab on that iPhone for live heart rate."
        } else if !healthAvailable {
            reason = "Health data is not available on this device."
        } else if !paired {
            reason = "No active Apple Watch is paired with this iPhone."
        } else if !installed {
            reason = "Install the TrackLab BMX companion app on Apple Watch."
        } else if !supported {
            reason = "Apple Watch heart rate requires iOS 17 or later."
        }

        var value: [String: Any] = [
            "version": HeartRateWireSample.currentVersion,
            "supported": supported,
            "platform": platform,
            "paired": paired,
            "watchAppInstalled": installed,
            "healthDataAvailable": healthAvailable,
            "minimumIOS": "17.0",
            "minimumWatchOS": "10.0",
        ]
        if let reason {
            value["reason"] = reason
        }
        return value
    }

    func state() -> [String: Any] {
        latestStatus.dictionary()
    }

    func startWorkout(sessionId: String?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.startWorkout(sessionId: sessionId, completion: completion)
            }
            return
        }
        guard #available(iOS 17.0, *) else {
            completeUnavailable("Apple Watch heart rate requires iOS 17 or later.", completion: completion)
            return
        }
        guard availability()["supported"] as? Bool == true else {
            let message = availability()["reason"] as? String ?? "Apple Watch heart rate is unavailable."
            completeUnavailable(message, completion: completion)
            return
        }

        let trimmedSessionId = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestedSessionId = trimmedSessionId?.isEmpty == false ? trimmedSessionId : nil
        if launchInFlight != nil {
            completion(.failure(HeartRateCoordinatorError.watchLaunchInProgress))
            return
        }
        if let requestedSessionId,
           activeSessionId == requestedSessionId,
           ([.active, .paused].contains(latestStatus.state)
            || ([.launching, .connecting].contains(latestStatus.state)
                && WatchConnectSessionManager.shared.watchLaunchWasAccepted(
                    workoutSessionId: requestedSessionId
                ))) {
            completion(.success(state()))
            return
        }
        if let staleHandler = mirroredWorkoutHandler {
            mirroredWorkoutHandler = nil
            mirroredHandlerToken = nil
            staleHandler.quarantine()
        }
        clearRecentSamples()
        activeSessionId = requestedSessionId ?? UUID().uuidString
        guard let launchSessionId = activeSessionId else {
            completion(.failure(HeartRateCoordinatorError.watchLaunchFailed))
            return
        }
        let launch = WorkoutLaunchRequest(
            sessionId: launchSessionId,
            generation: UUID(),
            completion: completion
        )
        activeGeneration = launch.generation
        launchInFlight = launch
        updateStatus(.launching, message: "Opening TrackLab BMX on Apple Watch…")

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .cycling
        configuration.locationType = .indoor

        healthStore.startWatchApp(with: configuration) { [weak self] success, error in
            guard let self else { return }
            DispatchQueue.main.async {
                guard self.launchInFlight === launch,
                      self.activeGeneration == launch.generation,
                      self.activeSessionId == launch.sessionId else { return }
                self.launchInFlight = nil
                if let error {
                    self.updateStatus(.error, message: error.localizedDescription)
                    self.activeSessionId = nil
                    self.activeGeneration = nil
                    launch.finish(.failure(error))
                    return
                }
                guard success else {
                    let error = HeartRateCoordinatorError.watchLaunchFailed
                    self.updateStatus(.error, message: error.localizedDescription)
                    self.activeSessionId = nil
                    self.activeGeneration = nil
                    launch.finish(.failure(error))
                    return
                }
                WatchConnectSessionManager.shared.markWatchLaunchAccepted(
                    workoutSessionId: launch.sessionId
                )
                self.updateStatus(.connecting, message: "Waiting for Apple Watch heart rate…")
                launch.finish(.success(self.state()))
            }
        }
    }

    /// Waits for the mirrored HealthKit workout—not merely the Watch launch—to
    /// become authoritative before any Watch Connect relay creates a server
    /// stream. Waiters live only in memory and are removed on every terminal
    /// transition or bounded timeout.
    func waitForWorkoutReady(
        sessionId: String,
        timeout: TimeInterval = 45,
        completion: @escaping (Result<TrackLabHeartRateStatus, Error>) -> Void
    ) {
        DispatchQueue.main.async {
            if self.latestStatus.sessionId == sessionId {
                switch self.latestStatus.state {
                case .active, .paused:
                    completion(.success(self.latestStatus))
                    return
                case .ending, .ended, .unavailable, .error:
                    completion(.failure(HeartRateCoordinatorError.workoutEndedBeforeReady))
                    return
                case .idle, .launching, .connecting:
                    break
                }
            }

            let token = UUID()
            self.workoutReadyWaiters[token] = WorkoutReadyWaiter(
                sessionId: sessionId,
                completion: completion
            )
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                guard let self,
                      let waiter = self.workoutReadyWaiters.removeValue(forKey: token) else { return }
                waiter.completion(.failure(HeartRateCoordinatorError.workoutReadyTimedOut))
            }
        }
    }

    func pauseWorkout() -> [String: Any] {
        guard #available(iOS 17.0, *), let handler = mirroredWorkoutHandler else {
            return state()
        }
        handler.pause()
        updateStatus(.paused, message: nil)
        return state()
    }

    func resumeWorkout() -> [String: Any] {
        guard #available(iOS 17.0, *), let handler = mirroredWorkoutHandler else {
            return state()
        }
        handler.resume()
        updateStatus(.active, message: nil)
        return state()
    }

    func endWorkout(sessionId expectedSessionId: String? = nil) -> [String: Any] {
        if let expectedSessionId,
           activeSessionId != expectedSessionId {
            return state()
        }
        if let launch = launchInFlight,
           expectedSessionId == nil || launch.sessionId == expectedSessionId {
            launchInFlight = nil
            launch.finish(.failure(HeartRateCoordinatorError.watchLaunchCancelled))
        }
        guard #available(iOS 17.0, *),
              let handler = mirroredWorkoutHandler,
              expectedSessionId == nil || handler.sessionId == expectedSessionId else {
            updateStatus(.ended, message: nil)
            activeSessionId = nil
            activeGeneration = nil
            return state()
        }
        updateStatus(.ending, message: "Saving workout on Apple Watch…")
        handler.stop()
        return state()
    }

    /// Invalidates an exact Watch Connect launch generation before stopping
    /// its mirrored workout. The removed request owns its callback, so a late
    /// HealthKit launch completion cannot resolve it twice or rebind a later
    /// account's workout.
    func cancelWorkoutLaunchAndStop(
        sessionId expectedSessionId: String?,
        reason: String,
        completion: @escaping () -> Void
    ) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.cancelWorkoutLaunchAndStop(
                    sessionId: expectedSessionId,
                    reason: reason,
                    completion: completion
                )
            }
            return
        }
        guard let expectedSessionId else {
            completion()
            return
        }

        if let launch = launchInFlight,
           launch.sessionId == expectedSessionId {
            launchInFlight = nil
            launch.finish(.failure(HeartRateCoordinatorError.watchLaunchCancelled))
        }
        guard activeSessionId == expectedSessionId else {
            completion()
            return
        }

        if #available(iOS 17.0, *),
           mirroredWorkoutHandler?.sessionId == expectedSessionId {
            let handler = mirroredWorkoutHandler
            mirroredWorkoutHandler = nil
            mirroredHandlerToken = nil
            handler?.quarantine()
        }
        activeGeneration = nil
        updateStatus(.ended, message: reason, manageRelayLifecycle: false)
        activeSessionId = nil
        clearRecentSamples()
        completion()
    }

    /// Replays only the in-memory samples measured after a TrackLab mode's
    /// authoritative start. This closes the short claim/configuration network
    /// window without ever persisting heart rate collected before that mode.
    func replayRecentSamples(since startedAt: Double) {
        guard startedAt.isFinite, startedAt >= 0 else { return }
        recentSampleLock.lock()
        let snapshot = recentSamples.filter { $0.measuredAt >= startedAt }
        recentSampleLock.unlock()
        snapshot.forEach { HeartRateRelay.shared.enqueue($0) }
    }

    @available(iOS 17.0, *)
    private func acceptMirroredWorkout(_ session: HKWorkoutSession) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.acceptMirroredWorkout(session)
            }
            return
        }
        guard let expectedSessionId = activeSessionId,
              let generation = activeGeneration else {
            session.stopActivity(with: Date())
            return
        }
        if expectedSessionId.hasPrefix("watch-connect:"),
           !WatchConnectSessionManager.shared.shouldAwaitMirroredReconnect(
               workoutSessionId: expectedSessionId
           ) {
            // HealthKit may deliver a replacement mirror after Watch-ended,
            // expiry, an explicit stop, or an account boundary. The persisted
            // four-hour lifecycle is authoritative over that late transport.
            session.stopActivity(with: Date())
            return
        }
        if let existingHandler = mirroredWorkoutHandler {
            if existingHandler.owns(session) { return }
            if existingHandler.isInvalidated {
                // A HealthKit replacement mirror can arrive before the old
                // handler's queued main-thread disconnect cleanup. Retire only
                // that already-invalid transport and accept the replacement.
                mirroredWorkoutHandler = nil
                mirroredHandlerToken = nil
            } else {
                // A genuinely concurrent live mirror is not a replacement.
                // Stopping the candidate preserves the authoritative handler.
                session.stopActivity(with: Date())
                return
            }
        }
        let handlerToken = UUID()
        let handler = MirroredWorkoutHandler(
            session: session,
            sessionId: expectedSessionId,
            requiresSessionIdentity: expectedSessionId.hasPrefix("watch-connect:"),
            onSample: { [weak self] sample in
                self?.receive(
                    sample,
                    expectedSessionId: expectedSessionId,
                    generation: generation,
                    handlerToken: handlerToken
                )
            },
            onState: { [weak self] state, message, transitionDate in
                self?.updateMirroredStatus(
                    state,
                    message: message,
                    at: transitionDate,
                    expectedSessionId: expectedSessionId,
                    generation: generation,
                    handlerToken: handlerToken
                )
            },
            onIdentityMismatch: { [weak self] in
                self?.rejectMirroredIdentity(
                    expectedSessionId: expectedSessionId,
                    generation: generation,
                    handlerToken: handlerToken
                )
            },
            onDisconnect: { [weak self] errorMessage in
                self?.handleMirroredDisconnect(
                    errorMessage: errorMessage,
                    expectedSessionId: expectedSessionId,
                    generation: generation,
                    handlerToken: handlerToken
                )
            }
        )
        mirroredHandlerToken = handlerToken
        mirroredWorkoutHandler = handler
        updateStatus(.connecting, message: "Apple Watch workout connected.")
    }

    private func receive(
        _ sample: HeartRateWireSample,
        expectedSessionId: String,
        generation: UUID,
        handlerToken: UUID
    ) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.receive(
                    sample,
                    expectedSessionId: expectedSessionId,
                    generation: generation,
                    handlerToken: handlerToken
                )
            }
            return
        }
        guard activeSessionId == expectedSessionId,
              activeGeneration == generation,
              mirroredHandlerToken == handlerToken else { return }
        if let receivedSessionId = sample.sessionId,
           receivedSessionId != expectedSessionId {
            return
        }
        if expectedSessionId.hasPrefix("watch-connect:"),
           sample.sessionId == nil {
            return
        }
        let receivedAt = Date().timeIntervalSince1970 * 1_000
        let resolvedSessionId = sample.sessionId ?? expectedSessionId
        let resolved = HeartRateWireSample(
            sessionId: resolvedSessionId,
            sequence: sample.sequence,
            bpm: sample.bpm,
            measuredAt: Date(timeIntervalSince1970: sample.measuredAt / 1_000),
            source: sample.source
        )
        let dictionary: [String: Any] = [
            "version": resolved.version,
            "sessionId": resolved.sessionId ?? NSNull(),
            "sequence": resolved.sequence,
            "bpm": resolved.bpm,
            "measuredAt": resolved.measuredAt,
            "receivedAt": receivedAt,
            "source": resolved.source,
        ]
        rememberRecentSample(resolved, receivedAt: receivedAt)
        HeartRateRelay.shared.enqueue(resolved)
        if latestStatus.state != .active {
            updateStatus(.active, message: nil)
        }
        notifyObservers { $0.heartRateCoordinator(self, didReceive: dictionary) }
    }

    private func updateMirroredStatus(
        _ state: TrackLabHeartRateState,
        message: String?,
        at transitionDate: Date,
        expectedSessionId: String,
        generation: UUID,
        handlerToken: UUID
    ) {
        DispatchQueue.main.async {
            guard self.activeSessionId == expectedSessionId,
                  self.activeGeneration == generation,
                  self.mirroredHandlerToken == handlerToken else { return }
            self.updateStatus(state, message: message, at: transitionDate)
        }
    }

    @available(iOS 17.0, *)
    private func rejectMirroredIdentity(
        expectedSessionId: String,
        generation: UUID,
        handlerToken: UUID
    ) {
        DispatchQueue.main.async {
            guard self.activeSessionId == expectedSessionId,
                  self.activeGeneration == generation,
                  self.mirroredHandlerToken == handlerToken,
                  [.launching, .connecting, .active, .paused].contains(
                    self.latestStatus.state
                  ) else { return }
            self.mirroredWorkoutHandler = nil
            self.mirroredHandlerToken = nil
            self.updateStatus(
                .connecting,
                message: "Ignored an Apple Watch workout from an earlier connection."
            )
        }
    }

    /// A mirrored iPhone session is only a transport endpoint for the primary
    /// workout that remains authoritative on Apple Watch. HealthKit invalidates
    /// this mirrored object when transport drops and automatically delivers a
    /// new one through `workoutSessionMirroringStartHandler` if the Watch
    /// workout is still running. Keep the exact account/session generation
    /// alive, discard only the invalid transport object, and wait for that
    /// replacement instead of stopping the athlete's Watch workout.
    @available(iOS 17.0, *)
    private func handleMirroredDisconnect(
        errorMessage: String?,
        expectedSessionId: String,
        generation: UUID,
        handlerToken: UUID
    ) {
        DispatchQueue.main.async {
            guard self.activeSessionId == expectedSessionId,
                  self.activeGeneration == generation,
                  self.mirroredHandlerToken == handlerToken,
                  [.launching, .connecting, .active, .paused].contains(
                    self.latestStatus.state
                  ) else { return }
            self.mirroredWorkoutHandler?.detachInvalidTransport()
            self.mirroredWorkoutHandler = nil
            self.mirroredHandlerToken = nil
            if !expectedSessionId.hasPrefix("watch-connect:") {
                let detail = errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
                let message: String
                if let detail, !detail.isEmpty {
                    message = "Apple Watch connection interrupted. \(detail)"
                } else {
                    message = "Apple Watch connection interrupted."
                }
                // Legacy account/studio workouts have no durable four-hour
                // lifecycle that can authorize an indefinite reconnect state.
                // Report the lost transport honestly instead of retaining an
                // active status with no handler. HealthKit can still deliver a
                // replacement mirror for this exact generation, which will
                // move the coordinator back to active when it arrives.
                self.updateStatus(.error, message: message, manageRelayLifecycle: false)
                return
            }
            guard WatchConnectSessionManager.shared.shouldAwaitMirroredReconnect(
                workoutSessionId: expectedSessionId
            ) else { return }
            let detail = errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
            let message: String
            if let detail, !detail.isEmpty {
                message = "Apple Watch connection interrupted. Reconnecting… \(detail)"
            } else {
                message = "Apple Watch connection interrupted. Reconnecting…"
            }
            self.updateStatus(.connecting, message: message, manageRelayLifecycle: false)
        }
    }

    private func completeUnavailable(
        _ message: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let error = HeartRateCoordinatorError.unavailable(message)
        updateStatus(.unavailable, message: message)
        completion(.failure(error))
    }

    private func updateStatus(
        _ state: TrackLabHeartRateState,
        message: String?,
        manageRelayLifecycle: Bool = true,
        at transitionDate: Date = Date()
    ) {
        if manageRelayLifecycle {
            switch state {
            case .active:
                HeartRateRelay.shared.resume(at: transitionDate)
            case .paused:
                HeartRateRelay.shared.pause(at: transitionDate)
            case .ending, .ended:
                // A rider can stop from either the iPhone UI or directly on Watch.
                // Studio and private account blocks follow that continuous workout
                // lifecycle; personal sessions remain paused for JavaScript to
                // finalize with authoritative pedal-zone windows.
                HeartRateRelay.shared.finalizeContinuousBlockAtWorkoutEnd(
                    at: transitionDate
                ) { result in
                    let handled: Bool
                    switch result {
                    case .success(let relayState):
                        handled = relayState["handled"] as? Bool == true
                    case .failure:
                        handled = false
                    }
                    if !handled {
                        HeartRateRelay.shared.pause(at: transitionDate)
                    }
                }
            case .idle, .launching, .connecting, .unavailable, .error:
                break
            }
        }
        if state == .ended {
            clearRecentSamples()
        }
        let status = TrackLabHeartRateStatus(
            state: state,
            sessionId: activeSessionId,
            message: message,
            at: transitionDate
        )
        latestStatus = status
        RecoveryAlertManager.shared.setWatchWorkoutActive(
            [.active, .paused].contains(state)
        )
        resolveWorkoutReadyWaiters(with: status)
        WatchConnectSessionManager.shared.observeWorkoutStatus(status)
        notifyObservers { $0.heartRateCoordinator(self, didChange: status) }
    }

    private func rememberRecentSample(_ sample: HeartRateWireSample, receivedAt: Double) {
        recentSampleLock.lock()
        recentSamples.append(sample)
        let cutoff = receivedAt - recentSampleWindowMs
        recentSamples.removeAll { $0.measuredAt < cutoff }
        if recentSamples.count > maximumRecentSamples {
            recentSamples.removeFirst(recentSamples.count - maximumRecentSamples)
        }
        recentSampleLock.unlock()
    }

    private func clearRecentSamples() {
        recentSampleLock.lock()
        recentSamples.removeAll(keepingCapacity: true)
        recentSampleLock.unlock()
    }

    private func resolveWorkoutReadyWaiters(with status: TrackLabHeartRateStatus) {
        DispatchQueue.main.async {
            let matching = self.workoutReadyWaiters.filter { _, waiter in
                waiter.sessionId == status.sessionId
            }
            guard !matching.isEmpty else { return }
            let result: Result<TrackLabHeartRateStatus, Error>
            switch status.state {
            case .active, .paused:
                result = .success(status)
            case .ending, .ended, .unavailable, .error:
                result = .failure(HeartRateCoordinatorError.workoutEndedBeforeReady)
            case .idle, .launching, .connecting:
                return
            }
            matching.keys.forEach { self.workoutReadyWaiters.removeValue(forKey: $0) }
            matching.values.forEach { $0.completion(result) }
        }
    }

    private func notifyObservers(_ body: @escaping (HeartRateCoordinatorObserver) -> Void) {
        observerLock.lock()
        let current = observers.allObjects.compactMap { $0 as? HeartRateCoordinatorObserver }
        observerLock.unlock()
        DispatchQueue.main.async {
            current.forEach(body)
        }
    }
}

extension HeartRateCoordinator: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // Apple only guarantees paired/install flags after activation. Re-emit
        // the current status so the web layer refreshes availability instead of
        // leaving Watch Connect unavailable until the athlete taps retry.
        if activationState == .activated {
            DispatchQueue.main.async {
                WatchConnectSessionManager.shared.recoverAtLaunch()
                let status = self.latestStatus
                self.notifyObservers { observer in
                    observer.heartRateCoordinator(self, didChange: status)
                }
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if RecoveryAlertManager.shared.handleWatchMessage(message) { return }
        WatchConnectSessionManager.shared.handleWatchEndedEvent(message)
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        if RecoveryAlertManager.shared.handleWatchMessage(message, replyHandler: replyHandler) {
            return
        }
        WatchConnectSessionManager.shared.handleWatchEndedEvent(message)
        replyHandler([
            "version": HeartRateWireSample.currentVersion,
            "accepted": false,
            "cueOwner": "phone",
        ])
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if RecoveryAlertManager.shared.handleWatchMessage(userInfo) { return }
        WatchConnectSessionManager.shared.handleWatchEndedEvent(userInfo)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        RecoveryAlertManager.shared.setWatchConnectivityReachable(session.isReachable)
    }
}

private enum HeartRateCoordinatorError: LocalizedError {
    case unavailable(String)
    case watchLaunchFailed
    case watchLaunchInProgress
    case watchLaunchCancelled
    case workoutReadyTimedOut
    case workoutEndedBeforeReady

    var errorDescription: String? {
        switch self {
        case .unavailable(let message):
            return message
        case .watchLaunchFailed:
            return "TrackLab BMX could not start the workout on Apple Watch."
        case .watchLaunchInProgress:
            return "Watch Connect is already opening on Apple Watch."
        case .watchLaunchCancelled:
            return "Watch Connect start was cancelled."
        case .workoutReadyTimedOut:
            return "Watch Connect timed out before the Apple Watch workout became active."
        case .workoutEndedBeforeReady:
            return "The Apple Watch workout ended before Watch Connect became active."
        }
    }
}

private struct WorkoutReadyWaiter {
    let sessionId: String
    let completion: (Result<TrackLabHeartRateStatus, Error>) -> Void
}

/// A launch completion is consumed exactly once. HealthKit may return after an
/// account boundary, so object identity—not a reusable session string—is the
/// authority for the one callback allowed to finish this request.
private final class WorkoutLaunchRequest {
    let sessionId: String
    let generation: UUID
    private var completion: ((Result<[String: Any], Error>) -> Void)?

    init(
        sessionId: String,
        generation: UUID,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        self.sessionId = sessionId
        self.generation = generation
        self.completion = completion
    }

    func finish(_ result: Result<[String: Any], Error>) {
        guard let completion else { return }
        self.completion = nil
        completion(result)
    }
}

@available(iOS 17.0, *)
private final class MirroredWorkoutHandler: NSObject, HKWorkoutSessionDelegate {
    private let session: HKWorkoutSession
    let sessionId: String?
    private let requiresSessionIdentity: Bool
    private let decoder = JSONDecoder()
    private let onSample: (HeartRateWireSample) -> Void
    private let onState: (TrackLabHeartRateState, String?, Date) -> Void
    private let onIdentityMismatch: () -> Void
    private let onDisconnect: (String?) -> Void
    private let invalidationLock = NSLock()
    private var identityVerified: Bool
    private var identityRejected = false
    private var pendingLiveState: TrackLabHeartRateState?
    private var pendingLiveTransitionDate: Date?

    init(
        session: HKWorkoutSession,
        sessionId: String?,
        requiresSessionIdentity: Bool,
        onSample: @escaping (HeartRateWireSample) -> Void,
        onState: @escaping (TrackLabHeartRateState, String?, Date) -> Void,
        onIdentityMismatch: @escaping () -> Void,
        onDisconnect: @escaping (String?) -> Void
    ) {
        self.session = session
        self.sessionId = sessionId
        self.requiresSessionIdentity = requiresSessionIdentity
        self.identityVerified = sessionId == nil
        self.onSample = onSample
        self.onState = onState
        self.onIdentityMismatch = onIdentityMismatch
        self.onDisconnect = onDisconnect
        super.init()
        session.delegate = self
    }

    func owns(_ candidate: HKWorkoutSession) -> Bool {
        session === candidate
    }

    /// HealthKit disconnect callbacks are not guaranteed to wait for the
    /// coordinator's main-queue cleanup. This lock-protected state lets the
    /// main-thread accept path distinguish an invalid old transport from a
    /// genuinely concurrent live mirror.
    var isInvalidated: Bool {
        invalidationLock.lock()
        defer { invalidationLock.unlock() }
        return identityRejected
    }

    func pause() {
        session.pause()
    }

    func resume() {
        session.resume()
    }

    func stop() {
        session.stopActivity(with: Date())
    }

    func quarantine() {
        guard markInvalidatedIfNeeded() else { return }
        session.stopActivity(with: Date())
    }

    /// The system has already invalidated this mirrored transport object. Do
    /// not call `stopActivity`: that command controls the primary Watch workout
    /// and would turn a recoverable radio/transport interruption into a real
    /// workout end.
    func detachInvalidTransport() {
        _ = markInvalidatedIfNeeded()
    }

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        guard !isInvalidated else { return }
        let mapped: (TrackLabHeartRateState, String?)
        switch toState {
        case .running:
            mapped = (.active, nil)
        case .paused:
            mapped = (.paused, nil)
        case .stopped:
            mapped = (.ending, "Saving workout on Apple Watch…")
        case .ended:
            mapped = (.ended, nil)
        case .prepared:
            mapped = (.connecting, "Apple Watch workout is prepared.")
        case .notStarted:
            mapped = (.connecting, "Waiting for Apple Watch workout…")
        @unknown default:
            mapped = (.connecting, nil)
        }
        if !identityVerified {
            if [.active, .paused].contains(mapped.0) {
                pendingLiveState = mapped.0
                pendingLiveTransitionDate = date
            }
            if [.ending, .ended].contains(mapped.0) {
                quarantine()
                onIdentityMismatch()
                return
            }
            onState(.connecting, "Verifying this Apple Watch connection…", date)
            return
        }
        onState(mapped.0, mapped.1, date)
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        guard !isInvalidated else { return }
        if !identityVerified {
            quarantine()
            onIdentityMismatch()
            return
        }
        onState(.error, error.localizedDescription, Date())
    }

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didReceiveDataFromRemoteWorkoutSession data: [Data]
    ) {
        guard !isInvalidated else { return }
        data.forEach { payload in
            guard !isInvalidated else { return }
            let maximumMeasuredAt = Date().timeIntervalSince1970 * 1_000 + 60_000
            guard let sample = try? decoder.decode(HeartRateWireSample.self, from: payload),
                  sample.version == HeartRateWireSample.currentVersion,
                  sample.bpm.isFinite,
                  sample.bpm >= 20,
                  sample.bpm <= 260,
                  sample.measuredAt.isFinite,
                  sample.measuredAt >= 0,
                  sample.measuredAt <= maximumMeasuredAt else {
                return
            }
            if let receivedSessionId = sample.sessionId,
               receivedSessionId != sessionId {
                if requiresSessionIdentity {
                    quarantine()
                    onIdentityMismatch()
                }
                // A legacy workout can briefly inherit the previous account's
                // Watch Connect application context before its clear envelope
                // arrives. Drop that foreign sample but keep waiting; the next
                // nil legacy sample can safely establish the requested session.
                return
            }
            if requiresSessionIdentity {
                guard sample.sessionId != nil else {
                    // The Watch may begin measuring just before application
                    // context arrives. Do not bind or relay those samples.
                    return
                }
            }
            if !identityVerified {
                identityVerified = true
                let transitionDate = pendingLiveTransitionDate
                    ?? Date(timeIntervalSince1970: sample.measuredAt / 1_000)
                onState(
                    pendingLiveState == .paused ? .paused : .active,
                    nil,
                    transitionDate
                )
                pendingLiveState = nil
                pendingLiveTransitionDate = nil
            }
            if sample.sessionId == nil, let sessionId {
                onSample(HeartRateWireSample(
                    sessionId: sessionId,
                    sequence: sample.sequence,
                    bpm: sample.bpm,
                    measuredAt: Date(timeIntervalSince1970: sample.measuredAt / 1_000),
                    source: sample.source
                ))
            } else {
                onSample(sample)
            }
        }
    }

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didDisconnectFromRemoteDeviceWithError error: Error?
    ) {
        guard markInvalidatedIfNeeded() else { return }
        // Apple documents this mirrored session as invalid after the callback;
        // the primary Watch workout remains running and HealthKit retries the
        // mirror automatically. A transport disconnect is not proof of an
        // identity mismatch, even when it occurs before the first sample.
        onDisconnect(error?.localizedDescription)
    }

    @discardableResult
    private func markInvalidatedIfNeeded() -> Bool {
        invalidationLock.lock()
        defer { invalidationLock.unlock() }
        guard !identityRejected else { return false }
        identityRejected = true
        return true
    }
}
