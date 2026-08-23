import Combine
import Foundation
import HealthKit
import WatchConnectivity

enum WatchWorkoutState: String {
    case idle
    case authorizing
    case connecting
    case active
    case paused
    case ending
    case ended
    case error
}

/// Runs the primary indoor-cycling workout on Apple Watch. An active HealthKit
/// workout keeps high-frequency heart-rate collection alive while the display
/// is lowered and mirrors versioned samples to the paired iPhone.
final class WatchWorkoutManager: NSObject, ObservableObject {
    static let shared = WatchWorkoutManager()

    @Published private(set) var state: WatchWorkoutState = .idle
    @Published private(set) var heartRateBpm: Double?
    @Published private(set) var message = "Ready to connect"
    @Published private(set) var recoveryPhase = "idle"
    @Published private(set) var recoveryMessage = "Recovery Alert ready"

    private let healthStore = HKHealthStore()
    private let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let encoder = JSONEncoder()
    private let sequenceDefaultsKey = "TrackLabHeartRateActiveWorkoutSequence"
    private let watchConnectUntilDefaultsKey = "TrackLabWatchConnectConnectedUntil"
    private let watchConnectConnectionDefaultsKey = "TrackLabWatchConnectConnectionId"
    private let watchConnectWorkoutDefaultsKey = "TrackLabWatchConnectWorkoutSessionId"
    private let watchConnectContextKind = "tracklab-watch-connect"
    private let watchConnectEndedKind = "tracklab-watch-connect-ended"
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var sequence = 0
    private var finishing = false
    private var connectedUntil: Date?
    private var watchConnectConnectionId: String?
    private var watchConnectWorkoutSessionId: String?
    private var expiryTimer: DispatchSourceTimer?

    private override init() {
        super.init()
        WatchRecoveryAlertEngine.shared.onStateChange = { [weak self] phase, message in
            DispatchQueue.main.async {
                self?.recoveryPhase = phase
                self?.recoveryMessage = message
            }
        }
        restoreWatchConnectDeadline()
        if WCSession.isSupported() {
            let connectivity = WCSession.default
            connectivity.delegate = self
            connectivity.activate()
            applyWatchConnectContext(connectivity.receivedApplicationContext)
        }
    }

    func startDefaultWorkout() {
        update(
            state: .idle,
            message: "Tap Connect in TrackLab on your paired iPhone"
        )
    }

    func start(with configuration: HKWorkoutConfiguration) {
        DispatchQueue.main.async {
            guard self.session == nil || self.state == .ended || self.state == .error else {
                return
            }
            self.state = .authorizing
            self.message = "Requesting Apple Health access…"
            // Every new workout gets a fresh hard four-hour cap. A valid
            // server deadline already delivered by iPhone can only shorten it.
            let fallback = Date(timeIntervalSinceNow: 4 * 60 * 60)
            let deadline = self.connectedUntil.map { existing in
                existing > Date() ? min(existing, fallback) : fallback
            } ?? fallback
            self.setWatchConnectDeadline(deadline, connectionId: nil, workoutSessionId: nil)
            self.requestAuthorizationThenStart(configuration)
        }
    }

    func pause() {
        session?.pause()
    }

    func resume() {
        session?.resume()
    }

    func end() {
        end(at: Date())
    }

    private func end(at endedAt: Date) {
        guard let session, !finishing else { return }
        finishing = true
        update(state: .ending, message: "Saving workout…")
        session.stopActivity(with: endedAt)
    }

    func recoverActiveWorkout() {
        healthStore.recoverActiveWorkoutSession { [weak self] recoveredSession, error in
            guard let self else { return }
            if let error {
                self.fail(error)
                return
            }
            guard let recoveredSession else {
                self.update(state: .idle, message: "No workout to recover")
                return
            }
            if let connectedUntil = self.connectedUntil,
               connectedUntil <= Date() {
                self.attachRecoveredSession(recoveredSession)
                self.end(at: connectedUntil)
                return
            }
            self.attachRecoveredSession(recoveredSession)
        }
    }

    private func requestAuthorizationThenStart(_ configuration: HKWorkoutConfiguration) {
        guard HKHealthStore.isHealthDataAvailable() else {
            update(state: .error, message: "Apple Health is unavailable")
            return
        }

        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        let readTypes: Set<HKObjectType> = [heartRateType]
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] success, error in
            guard let self else { return }
            if let error {
                self.fail(error)
                return
            }
            guard success else {
                self.update(state: .error, message: "Apple Health access was not completed")
                return
            }
            self.createAndStartSession(configuration)
        }
    }

    private func createAndStartSession(_ configuration: HKWorkoutConfiguration) {
        do {
            let workoutSession = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let workoutBuilder = workoutSession.associatedWorkoutBuilder()
            workoutBuilder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: configuration
            )
            attach(session: workoutSession, builder: workoutBuilder, recovering: false)

            let startDate = Date()
            update(state: .connecting, message: "Connecting to iPhone…")
            workoutSession.startActivity(with: startDate)
            workoutBuilder.beginCollection(withStart: startDate) { [weak self] success, error in
                if let error {
                    self?.fail(error)
                } else if !success {
                    self?.update(state: .error, message: "Heart-rate collection could not start")
                }
            }
            workoutSession.startMirroringToCompanionDevice { [weak self] success, error in
                if let error {
                    // The workout remains valid on Watch, and a later recovery
                    // can re-establish mirroring without discarding Health data.
                    self?.update(state: .active, message: "Recording on Watch · iPhone unavailable: \(error.localizedDescription)")
                } else if success {
                    self?.update(state: .active, message: "Live to TrackLab")
                }
            }
        } catch {
            fail(error)
        }
    }

    private func attachRecoveredSession(_ recoveredSession: HKWorkoutSession) {
        let recoveredBuilder = recoveredSession.associatedWorkoutBuilder()
        attach(session: recoveredSession, builder: recoveredBuilder, recovering: true)
        update(
            state: recoveredSession.state == .paused ? .paused : .active,
            message: "Workout recovered"
        )
        recoveredSession.startMirroringToCompanionDevice { [weak self] success, error in
            if let error {
                self?.update(state: .active, message: "Recovered on Watch · iPhone unavailable: \(error.localizedDescription)")
            } else if success {
                self?.update(state: .active, message: "Workout recovered · Live to TrackLab")
            }
        }
    }

    private func attach(
        session: HKWorkoutSession,
        builder: HKLiveWorkoutBuilder,
        recovering: Bool
    ) {
        self.session = session
        self.builder = builder
        self.sequence = recovering
            ? UserDefaults.standard.integer(forKey: sequenceDefaultsKey)
            : 0
        if !recovering {
            UserDefaults.standard.set(0, forKey: sequenceDefaultsKey)
        }
        self.finishing = false
        session.delegate = self
        builder.delegate = self
    }

    private func finishWorkout(at date: Date) {
        guard let builder, let session else { return }
        reportWatchConnectEnded(at: date)
        builder.endCollection(withEnd: date) { [weak self] success, error in
            guard let self else { return }
            if let error {
                self.fail(error)
                session.end()
                return
            }
            guard success else {
                self.update(state: .error, message: "Workout collection could not finish")
                session.end()
                return
            }
            builder.finishWorkout { [weak self] workout, error in
                guard let self else { return }
                if let error {
                    self.fail(error)
                } else if workout != nil {
                    self.update(state: .ended, message: "Saved to Apple Health")
                } else {
                    self.update(state: .error, message: "Apple Health did not save the workout")
                }
                session.end()
                self.session = nil
                self.builder = nil
                self.finishing = false
                UserDefaults.standard.removeObject(forKey: self.sequenceDefaultsKey)
                self.clearWatchConnectDeadline()
            }
        }
    }

    private func publishHeartRate(_ bpm: Double, measuredAt: Date) {
        guard bpm.isFinite, bpm >= 20, bpm <= 260 else { return }
        sequence += 1
        UserDefaults.standard.set(sequence, forKey: sequenceDefaultsKey)
        let sample = HeartRateWireSample(
            sessionId: nil,
            sequence: sequence,
            bpm: bpm,
            measuredAt: measuredAt
        )
        guard let payload = try? encoder.encode(sample), let session else { return }
        session.sendToRemoteWorkoutSession(data: payload) { _, _ in
            // HealthKit retains the authoritative workout. The companion and
            // later cloud layers deduplicate live samples by sequence number.
        }
    }

    private func update(state: WatchWorkoutState, message: String) {
        DispatchQueue.main.async {
            self.state = state
            self.message = message
            WatchRecoveryAlertEngine.shared.setWorkoutOwnsCue(
                [.active, .paused].contains(state)
            )
        }
    }

    private func applyWatchConnectContext(_ context: [String: Any]) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.applyWatchConnectContext(context)
            }
            return
        }
        guard context["kind"] as? String == watchConnectContextKind,
              let rawConnectedUntil = Self.doubleValue(context["connectedUntil"]),
              rawConnectedUntil.isFinite,
              let connectionId = context["connectionId"] as? String,
              !connectionId.isEmpty,
              let workoutSessionId = context["workoutSessionId"] as? String,
              !workoutSessionId.isEmpty else { return }
        let deadline = Date(timeIntervalSince1970: rawConnectedUntil / 1_000)
        let hasMismatchedIdentity = watchConnectWorkoutSessionId.map { $0 != workoutSessionId } == true
            || watchConnectConnectionId.map { $0 != connectionId } == true
        if hasMismatchedIdentity {
            if session != nil {
                return
            }
            if let connectedUntil,
               connectedUntil > Date(),
               deadline <= connectedUntil {
                // Ignore a delayed message from an older connection after a
                // newer connection has already been prepared on this Watch.
                return
            }
        }
        let exactDeadline = session != nil && watchConnectWorkoutSessionId == workoutSessionId
            ? min(deadline, connectedUntil ?? deadline)
            : deadline
        setWatchConnectDeadline(
            exactDeadline,
            connectionId: connectionId,
            workoutSessionId: workoutSessionId
        )
        if deadline <= Date(), session != nil {
            end(at: deadline)
        } else if state == .idle {
            update(state: .idle, message: "Watch Connect ready")
        }
    }

    private func setWatchConnectDeadline(
        _ deadline: Date,
        connectionId: String?,
        workoutSessionId: String?
    ) {
        let maximum = Date(timeIntervalSinceNow: 4 * 60 * 60)
        connectedUntil = min(deadline, maximum)
        guard let connectedUntil else { return }
        UserDefaults.standard.set(
            connectedUntil.timeIntervalSince1970 * 1_000,
            forKey: watchConnectUntilDefaultsKey
        )
        if let connectionId {
            watchConnectConnectionId = connectionId
            UserDefaults.standard.set(connectionId, forKey: watchConnectConnectionDefaultsKey)
        }
        if let workoutSessionId {
            watchConnectWorkoutSessionId = workoutSessionId
            UserDefaults.standard.set(workoutSessionId, forKey: watchConnectWorkoutDefaultsKey)
        }
        scheduleWatchConnectExpiry()
    }

    private func restoreWatchConnectDeadline() {
        let raw = UserDefaults.standard.double(forKey: watchConnectUntilDefaultsKey)
        watchConnectConnectionId = UserDefaults.standard.string(
            forKey: watchConnectConnectionDefaultsKey
        )
        watchConnectWorkoutSessionId = UserDefaults.standard.string(
            forKey: watchConnectWorkoutDefaultsKey
        )
        guard raw.isFinite, raw > 0 else { return }
        let restored = Date(timeIntervalSince1970: raw / 1_000)
        guard restored > Date() else {
            clearWatchConnectDeadline()
            return
        }
        connectedUntil = restored
        scheduleWatchConnectExpiry()
    }

    private func scheduleWatchConnectExpiry() {
        expiryTimer?.cancel()
        expiryTimer = nil
        guard let connectedUntil else { return }
        let remaining = connectedUntil.timeIntervalSinceNow
        if remaining <= 0 {
            if session != nil { end(at: connectedUntil) }
            else { clearWatchConnectDeadline() }
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + remaining, leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.message = "Four-hour Watch Connect session complete"
            if self.session != nil {
                self.end(at: connectedUntil)
            } else {
                self.clearWatchConnectDeadline()
            }
        }
        expiryTimer = timer
        timer.resume()
    }

    private func clearWatchConnectDeadline() {
        expiryTimer?.cancel()
        expiryTimer = nil
        connectedUntil = nil
        watchConnectConnectionId = nil
        watchConnectWorkoutSessionId = nil
        UserDefaults.standard.removeObject(forKey: watchConnectUntilDefaultsKey)
        UserDefaults.standard.removeObject(forKey: watchConnectConnectionDefaultsKey)
        UserDefaults.standard.removeObject(forKey: watchConnectWorkoutDefaultsKey)
    }

    /// `transferUserInfo` survives a temporarily unreachable companion. The
    /// matching workout identifier prevents a delayed end event from closing a
    /// later Watch Connect session after the athlete reconnects.
    private func reportWatchConnectEnded(at endedAt: Date) {
        guard let connectionId = watchConnectConnectionId,
              let workoutSessionId = watchConnectWorkoutSessionId,
              WCSession.isSupported() else { return }
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated {
            connectivity.activate()
        }
        let event: [String: Any] = [
            "kind": watchConnectEndedKind,
            "connectionId": connectionId,
            "workoutSessionId": workoutSessionId,
            "endedAt": endedAt.timeIntervalSince1970 * 1_000,
        ]
        connectivity.transferUserInfo(event)
        if connectivity.isReachable {
            connectivity.sendMessage(event, replyHandler: nil, errorHandler: nil)
        }
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        return nil
    }

    private func fail(_ error: Error) {
        update(state: .error, message: error.localizedDescription)
    }
}

extension WatchWorkoutManager: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        applyWatchConnectContext(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        applyWatchConnectContext(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if WatchRecoveryAlertEngine.shared.handle(message) { return }
        applyWatchConnectContext(message)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if WatchRecoveryAlertEngine.shared.handle(userInfo) { return }
        applyWatchConnectContext(userInfo)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        WatchRecoveryAlertEngine.shared.connectivityReachabilityDidChange(session.isReachable)
    }
}

extension WatchWorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        switch toState {
        case .running:
            update(state: .active, message: "Live to TrackLab")
        case .paused:
            update(state: .paused, message: "Workout paused")
        case .stopped:
            update(state: .ending, message: "Saving workout…")
            finishWorkout(at: date)
        case .ended:
            if state != .ended {
                update(state: .ended, message: "Workout ended")
            }
        case .prepared, .notStarted:
            update(state: .connecting, message: "Preparing workout…")
        @unknown default:
            update(state: .connecting, message: "Updating workout…")
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        fail(error)
    }
}

extension WatchWorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        guard collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let quantity = statistics.mostRecentQuantity() else {
            return
        }
        let unit = HKUnit.count().unitDivided(by: HKUnit.minute())
        let bpm = quantity.doubleValue(for: unit)
        let measuredAt = statistics.mostRecentQuantityDateInterval()?.end ?? Date()
        guard bpm.isFinite, bpm >= 20, bpm <= 260 else { return }
        DispatchQueue.main.async {
            self.heartRateBpm = bpm
            WatchRecoveryAlertEngine.shared.ingestHeartRate(bpm, measuredAt: measuredAt)
        }
        publishHeartRate(bpm, measuredAt: measuredAt)
    }
}
