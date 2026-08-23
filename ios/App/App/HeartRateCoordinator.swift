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
    private var launchInFlightSessionId: String?
    private var activeSessionId: String?
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
        if let requestedSessionId,
           launchInFlightSessionId == requestedSessionId {
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
        clearRecentSamples()
        activeSessionId = requestedSessionId ?? UUID().uuidString
        guard let launchSessionId = activeSessionId else {
            completion(.failure(HeartRateCoordinatorError.watchLaunchFailed))
            return
        }
        launchInFlightSessionId = launchSessionId
        updateStatus(.launching, message: "Opening TrackLab BMX on Apple Watch…")

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .cycling
        configuration.locationType = .indoor

        healthStore.startWatchApp(with: configuration) { [weak self] success, error in
            guard let self else { return }
            DispatchQueue.main.async {
                guard self.launchInFlightSessionId == launchSessionId else { return }
                self.launchInFlightSessionId = nil
                if let error {
                    self.updateStatus(.error, message: error.localizedDescription)
                    completion(.failure(error))
                    return
                }
                guard success else {
                    let error = HeartRateCoordinatorError.watchLaunchFailed
                    self.updateStatus(.error, message: error.localizedDescription)
                    completion(.failure(error))
                    return
                }
                WatchConnectSessionManager.shared.markWatchLaunchAccepted(
                    workoutSessionId: launchSessionId
                )
                self.updateStatus(.connecting, message: "Waiting for Apple Watch heart rate…")
                completion(.success(self.state()))
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

    func endWorkout() -> [String: Any] {
        guard #available(iOS 17.0, *), let handler = mirroredWorkoutHandler else {
            updateStatus(.ended, message: nil)
            return state()
        }
        updateStatus(.ending, message: "Saving workout on Apple Watch…")
        handler.stop()
        return state()
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
        let handler = MirroredWorkoutHandler(
            session: session,
            sessionId: activeSessionId,
            onSample: { [weak self] sample in self?.receive(sample) },
            onState: { [weak self] state, message in self?.updateStatus(state, message: message) }
        )
        mirroredWorkoutHandler = handler
        updateStatus(.connecting, message: "Apple Watch workout connected.")
    }

    private func receive(_ sample: HeartRateWireSample) {
        let receivedAt = Date().timeIntervalSince1970 * 1_000
        let resolvedSessionId = sample.sessionId
            ?? activeSessionId
            ?? HeartRateRelay.shared.configuredSessionId()
        if activeSessionId == nil {
            activeSessionId = resolvedSessionId
        }
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

    private func completeUnavailable(
        _ message: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let error = HeartRateCoordinatorError.unavailable(message)
        updateStatus(.unavailable, message: message)
        completion(.failure(error))
    }

    private func updateStatus(_ state: TrackLabHeartRateState, message: String?) {
        let transitionDate = Date()
        switch state {
        case .active:
            HeartRateRelay.shared.resume()
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

@available(iOS 17.0, *)
private final class MirroredWorkoutHandler: NSObject, HKWorkoutSessionDelegate {
    private let session: HKWorkoutSession
    private let sessionId: String?
    private let decoder = JSONDecoder()
    private let onSample: (HeartRateWireSample) -> Void
    private let onState: (TrackLabHeartRateState, String?) -> Void

    init(
        session: HKWorkoutSession,
        sessionId: String?,
        onSample: @escaping (HeartRateWireSample) -> Void,
        onState: @escaping (TrackLabHeartRateState, String?) -> Void
    ) {
        self.session = session
        self.sessionId = sessionId
        self.onSample = onSample
        self.onState = onState
        super.init()
        session.delegate = self
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

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        switch toState {
        case .running:
            onState(.active, nil)
        case .paused:
            onState(.paused, nil)
        case .stopped:
            onState(.ending, "Saving workout on Apple Watch…")
        case .ended:
            onState(.ended, nil)
        case .prepared:
            onState(.connecting, "Apple Watch workout is prepared.")
        case .notStarted:
            onState(.connecting, "Waiting for Apple Watch workout…")
        @unknown default:
            onState(.connecting, nil)
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        onState(.error, error.localizedDescription)
    }

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didReceiveDataFromRemoteWorkoutSession data: [Data]
    ) {
        data.forEach { payload in
            guard let sample = try? decoder.decode(HeartRateWireSample.self, from: payload),
                  sample.version == HeartRateWireSample.currentVersion,
                  sample.bpm.isFinite,
                  sample.bpm >= 20,
                  sample.bpm <= 260 else {
                return
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
        onState(error == nil ? .ended : .error, error?.localizedDescription)
    }
}
