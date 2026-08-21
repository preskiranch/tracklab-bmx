import Foundation
import Security
import UIKit

protocol HeartRateRelayObserver: AnyObject {
    func heartRateRelay(_ relay: HeartRateRelay, didChange state: [String: Any])
}

/// A native, durable relay for Apple Watch samples. The mirrored workout can
/// continue delivering data while the Capacitor web view is suspended, so the
/// relay must not depend on JavaScript being awake.
final class HeartRateRelay: NSObject, @unchecked Sendable {
    static let shared = HeartRateRelay()
    static let backgroundSessionIdentifier = "com.preskilranch.tracklabbmx.heart-rate-relay"

    private static let productionBaseURL = "https://tracklab-bmx.onrender.com"
    private static let maximumOutboxSamples = 10_000
    fileprivate static let maximumBatchSize = 250
    fileprivate static let maximumSequence = 1_000_000
    private static let maximumRelaySessions = 16
    private static let maximumClockSegments = 2_048
    private static let finalSampleGraceMilliseconds: Int64 = 5_000
    fileprivate static let maximumActiveDurationMs = 604_800_000

    private let workQueue = DispatchQueue(label: "com.preskilranch.tracklabbmx.heart-rate-relay.state")
    private let delegateQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "com.preskilranch.tracklabbmx.heart-rate-relay.url-session"
        queue.maxConcurrentOperationCount = 1
        return queue
    }()
    private let keychain = HeartRateRelayTokenStore()
    private let fileManager = FileManager.default
    private let observers = NSHashTable<AnyObject>.weakObjects()

    private var state = RelayPersistedState()
    private var responseData: [String: Data] = [:]
    private var recoveringBackgroundTasks = true
    private var backgroundEventsCompletionHandler: (() -> Void)?
    private var started = false
    private var clearingAll = false

    private lazy var backgroundSession: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: Self.backgroundSessionIdentifier
        )
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        configuration.allowsCellularAccess = true
        configuration.httpMaximumConnectionsPerHost = 1
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        return URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
    }()

    /// Foreground uploads use an app-owned session for low-latency studio
    /// telemetry. The exact same protected outbox falls back to the background
    /// session whenever iOS suspends or relaunches the companion.
    private lazy var foregroundSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.allowsCellularAccess = true
        configuration.httpMaximumConnectionsPerHost = 1
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 60
        return URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
    }()

    private override init() {
        super.init()
    }

    func start() {
        workQueue.async {
            guard !self.started else { return }
            self.started = true
            self.state = self.loadState()
            if let activeSessionId = self.state.activeSessionId,
               self.state.sessions[activeSessionId]?.configuration?.finalization != nil {
                self.state.activeSessionId = nil
            }
            if let activeJob = self.state.activeJob,
               self.state.sessions[activeJob.sessionId] == nil {
                self.removePayload(for: activeJob)
                self.state.activeJob = nil
            }
            if self.state.sessions.isEmpty {
                self.state.activeSessionId = nil
                self.state.activeJob = nil
                self.keychain.deleteAll()
            }
            self.prepareStorageDirectory()
            self.prunePayloadDirectory(keeping: self.state.activeJob?.payloadFileName)
            let session = self.backgroundSession
            session.getAllTasks { tasks in
                self.workQueue.async {
                    let liveJobIds = Set(tasks.compactMap(\.taskDescription))
                    tasks.filter { task in
                        guard let description = task.taskDescription else { return true }
                        return self.state.activeJob?.id != description
                    }.forEach { $0.cancel() }

                    if let activeJob = self.state.activeJob,
                       !liveJobIds.contains(activeJob.id) {
                        self.removePayload(for: activeJob)
                        self.state.activeJob = nil
                        self.persistState()
                    }
                    self.recoveringBackgroundTasks = false
                    self.processIfPossible()
                    self.publishRelayState(reason: "recovered")
                }
            }
        }
    }

    func configuredSessionId() -> String? {
        workQueue.sync { state.activeSessionId }
    }

    func addObserver(_ observer: HeartRateRelayObserver) {
        workQueue.async {
            self.observers.add(observer)
            let snapshot = self.relayStateSnapshot(reason: "observing")
            DispatchQueue.main.async {
                observer.heartRateRelay(self, didChange: snapshot)
            }
        }
    }

    func removeObserver(_ observer: HeartRateRelayObserver) {
        workQueue.async {
            self.observers.remove(observer)
        }
    }

    func relayState(completion: @escaping ([String: Any]) -> Void) {
        workQueue.async {
            completion(self.relayStateSnapshot(reason: nil))
        }
    }

    private func relayStateSnapshot(reason: String?) -> [String: Any] {
        let queuedSessionIds = state.sessions.values.compactMap { relay -> String? in
            guard relay.configuration?.finalization != nil else { return nil }
            return relay.configuration?.sessionId
        }.sorted()
        let sessionSnapshots: [[String: Any]] = state.sessions.keys.sorted().compactMap { sessionId in
            guard let relay = state.sessions[sessionId],
                  let configuration = relay.configuration else {
                return nil
            }
            let isActive = state.activeSessionId == sessionId
            let isSyncing = state.activeJob?.sessionId == sessionId
            let isFinalized = configuration.finalization != nil
            let retrying = relay.nextAttemptAt.map {
                $0 > Date().timeIntervalSince1970 * 1_000
            } ?? false
            let syncState: String
            if isSyncing {
                syncState = "syncing"
            } else if retrying {
                syncState = "retrying"
            } else if isFinalized {
                syncState = "queued"
            } else if isActive {
                syncState = "active"
            } else {
                syncState = "pending"
            }
            return [
                "sessionId": sessionId,
                "scope": configuration.scope.rawValue,
                "state": syncState,
                "finalized": isFinalized,
                "pendingSampleCount": relay.samples.count,
                "droppedSampleCount": relay.droppedSampleCount,
                "streamCreated": configuration.streamId != nil,
            ]
        }
        let pendingSampleCount = state.sessions.values.reduce(0) {
            $0 + $1.samples.count
        }
        let droppedSampleCount = state.sessions.values.reduce(0) {
            $0 + $1.droppedSampleCount
        }
        var snapshot: [String: Any] = [
            "version": RelayPersistedState.currentVersion,
            "configured": state.activeSessionId != nil,
            "syncing": state.activeJob != nil,
            "clearing": clearingAll,
            "queuedSessionIds": queuedSessionIds,
            "queuedCount": queuedSessionIds.count,
            "pendingSampleCount": pendingSampleCount,
            "droppedSampleCount": droppedSampleCount,
            "sessions": sessionSnapshots,
        ]
        if let activeSessionId = state.activeSessionId {
            snapshot["sessionId"] = activeSessionId
            if let scope = state.sessions[activeSessionId]?.configuration?.scope {
                snapshot["scope"] = scope.rawValue
            }
        }
        if let activeJob = state.activeJob {
            snapshot["syncingSessionId"] = activeJob.sessionId
        }
        if let reason {
            snapshot["reason"] = reason
        }
        return snapshot
    }

    private func publishRelayState(reason: String) {
        let snapshot = relayStateSnapshot(reason: reason)
        let currentObservers = observers.allObjects.compactMap {
            $0 as? HeartRateRelayObserver
        }
        guard !currentObservers.isEmpty else { return }
        DispatchQueue.main.async {
            currentObservers.forEach {
                $0.heartRateRelay(self, didChange: snapshot)
            }
        }
    }

    func configure(
        baseURL: String,
        ingestToken: String,
        sessionId: String,
        scope: HeartRateRelayScope,
        startedAt: Double,
        activeElapsedAtStartMs: Double?,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let canonicalBaseURL = Self.validatedBaseURL(baseURL),
              let normalizedSessionId = Self.validatedSessionId(sessionId),
              let normalizedStartedAt = Self.epochMilliseconds(startedAt),
              normalizedStartedAt <= Self.nowMilliseconds() + 60_000,
              let normalizedActiveElapsed = Self.activeDurationMilliseconds(
                activeElapsedAtStartMs ?? 0
              ),
              ingestToken.utf8.count >= 32,
              ingestToken.utf8.count <= 8_192,
              !ingestToken.unicodeScalars.contains(where: {
                  CharacterSet.whitespacesAndNewlines.contains($0)
                      || CharacterSet.controlCharacters.contains($0)
              }) else {
            completion(.failure(HeartRateRelayError.invalidConfiguration))
            return
        }

        workQueue.async {
            do {
                guard !self.clearingAll else {
                    completion(.failure(HeartRateRelayError.relayClearing))
                    return
                }
                if let activeSessionId = self.state.activeSessionId,
                   activeSessionId != normalizedSessionId {
                    completion(.failure(HeartRateRelayError.relayBusy))
                    return
                }

                if var existingRelay = self.state.sessions[normalizedSessionId],
                   var existingConfiguration = existingRelay.configuration {
                    guard existingConfiguration.finalization == nil else {
                        completion(.failure(HeartRateRelayError.sessionAlreadyFinalized))
                        return
                    }
                    guard existingConfiguration.startedAt == normalizedStartedAt else {
                        completion(.failure(HeartRateRelayError.sessionMismatch))
                        return
                    }
                    guard existingConfiguration.scope == scope else {
                        completion(.failure(HeartRateRelayError.sessionMismatch))
                        return
                    }
                    try self.keychain.store(ingestToken, sessionId: normalizedSessionId)
                    existingConfiguration.baseURL = canonicalBaseURL
                    existingRelay.configuration = existingConfiguration
                    existingRelay.consecutiveFailures = 0
                    existingRelay.nextAttemptAt = nil
                    self.state.sessions[normalizedSessionId] = existingRelay
                } else {
                    guard self.state.sessions.count < Self.maximumRelaySessions else {
                        completion(.failure(HeartRateRelayError.tooManyQueuedSessions))
                        return
                    }
                    try self.keychain.store(ingestToken, sessionId: normalizedSessionId)
                    let configuration = RelayConfiguration(
                        baseURL: canonicalBaseURL,
                        sessionId: normalizedSessionId,
                        scope: scope,
                        startedAt: normalizedStartedAt,
                        activeElapsedBaseMs: normalizedActiveElapsed,
                        activeClockStartedAt: normalizedActiveElapsed > 0
                            ? Self.nowMilliseconds()
                            : normalizedStartedAt,
                        modePaused: false,
                        workoutPaused: false,
                        streamId: nil,
                        finalization: nil,
                        clockSegments: []
                    )
                    self.state.sessions[normalizedSessionId] = RelaySessionState(
                        configuration: configuration
                    )
                }
                self.state.activeSessionId = normalizedSessionId
                self.persistState()
                self.processIfPossible()
                self.publishRelayState(reason: "configured")
                completion(.success([
                    "configured": true,
                    "sessionId": normalizedSessionId,
                    "scope": scope.rawValue,
                ]))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func enqueue(_ sample: HeartRateWireSample) {
        guard sample.sequence >= 0,
              sample.sequence <= Self.maximumSequence,
              sample.bpm.isFinite,
              sample.bpm >= 20,
              sample.bpm <= 260,
              let recordedAt = Self.epochMilliseconds(sample.measuredAt),
              recordedAt <= Self.nowMilliseconds() + 60_000 else {
            return
        }

        workQueue.async {
            if let activeSessionId = self.state.activeSessionId,
               let connectedUntil = WatchConnectSessionManager.shared.connectedUntil(
                for: activeSessionId
               ),
               recordedAt > connectedUntil {
                // The Watch and iPhone both enforce the four-hour boundary.
                // This final native guard prevents a late mirrored sample from
                // extending a Watch Connect session while either UI is asleep.
                WatchConnectSessionManager.shared.disconnect(
                    reason: "The four-hour Watch Connect session ended."
                )
                return
            }
            // sample.sessionId identifies the continuous Apple Watch workout;
            // configuration.sessionId identifies the current TrackLab mode.
            // They are intentionally different, so time/clock state—not ID
            // equality—defines which samples belong in a private mode stream.
            // Mirrored HealthKit samples can arrive a few seconds late, even
            // after that mode has finalized or the next mode has configured.
            let candidateSessionIds = self.state.sessions.compactMap { sessionId, relay -> String? in
                guard let configuration = relay.configuration,
                      recordedAt >= configuration.startedAt else {
                    return nil
                }
                if let finalization = configuration.finalization {
                    return recordedAt <= finalization.endedAt ? sessionId : nil
                }
                return self.state.activeSessionId == sessionId ? sessionId : nil
            }.sorted { lhs, rhs in
                let lhsIsActive = lhs == self.state.activeSessionId
                let rhsIsActive = rhs == self.state.activeSessionId
                if lhsIsActive != rhsIsActive { return lhsIsActive }
                let lhsStartedAt = self.state.sessions[lhs]?.configuration?.startedAt ?? 0
                let rhsStartedAt = self.state.sessions[rhs]?.configuration?.startedAt ?? 0
                if lhsStartedAt != rhsStartedAt { return lhsStartedAt > rhsStartedAt }
                return lhs < rhs
            }

            for sessionId in candidateSessionIds {
                guard var relay = self.state.sessions[sessionId],
                      let configuration = relay.configuration,
                      let activeElapsedMs = self.activeElapsed(
                        at: recordedAt,
                        configuration: configuration
                      ) else {
                    // A timestamp outside the completed/current active clock
                    // segments occurred while the TrackLab mode was paused.
                    continue
                }

                // Once a server finalize request has started, accepting more
                // samples for that stream would falsely imply they can sync.
                if self.state.activeJob?.sessionId == sessionId,
                   self.state.activeJob?.kind == .finalize {
                    continue
                }
                if relay.samples.contains(where: { $0.sequence == sample.sequence })
                    || (self.state.activeJob?.sessionId == sessionId
                        && self.state.activeJob?.sequences.contains(sample.sequence) == true) {
                    return
                }

                relay.samples.append(RelaySample(
                    sequence: sample.sequence,
                    recordedAt: recordedAt,
                    activeElapsedMs: activeElapsedMs,
                    bpm: Int(sample.bpm.rounded())
                ))
                relay.samples.sort { lhs, rhs in
                    lhs.sequence == rhs.sequence
                        ? lhs.recordedAt < rhs.recordedAt
                        : lhs.sequence < rhs.sequence
                }
                var reachedCapacity = false
                if relay.samples.count > Self.maximumOutboxSamples {
                    let overflow = relay.samples.count - Self.maximumOutboxSamples
                    relay.samples.removeFirst(overflow)
                    relay.droppedSampleCount += overflow
                    reachedCapacity = relay.droppedSampleCount == overflow
                }
                self.state.sessions[sessionId] = relay
                self.persistState()
                self.processIfPossible()
                if reachedCapacity {
                    self.publishRelayState(reason: "capacityLimited")
                }
                return
            }
        }
    }

    func pause(at date: Date = Date()) {
        workQueue.async {
            guard let activeSessionId = self.state.activeSessionId else { return }
            self.pauseRelay(
                sessionId: activeSessionId,
                at: Int64((date.timeIntervalSince1970 * 1_000).rounded()),
                activeElapsedOverride: nil,
                source: .workout
            )
        }
    }

    func resume(at date: Date = Date()) {
        workQueue.async {
            guard let activeSessionId = self.state.activeSessionId else { return }
            self.resumeRelay(
                sessionId: activeSessionId,
                at: Int64((date.timeIntervalSince1970 * 1_000).rounded()),
                activeElapsedOverride: nil,
                source: .workout
            )
        }
    }

    func pauseRelay(
        sessionId: String,
        at: Double,
        activeElapsedMs: Double,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let normalizedSessionId = Self.validatedSessionId(sessionId),
              let clockAt = Self.epochMilliseconds(at),
              let activeElapsed = Self.activeDurationMilliseconds(activeElapsedMs) else {
            completion(.failure(HeartRateRelayError.invalidClock))
            return
        }
        workQueue.async {
            guard let relay = self.state.sessions[normalizedSessionId],
                  let configuredSessionId = relay.configuration?.sessionId else {
                completion(.success([
                    "configured": false,
                    "reason": "No private heart-rate relay is configured.",
                ]))
                return
            }
            guard configuredSessionId == normalizedSessionId else {
                completion(.failure(HeartRateRelayError.sessionMismatch))
                return
            }
            guard self.state.activeSessionId == normalizedSessionId else {
                completion(.failure(HeartRateRelayError.sessionNotActive))
                return
            }
            guard let configuration = relay.configuration,
                  clockAt >= configuration.startedAt,
                  configuration.activeClockStartedAt.map({ clockAt >= $0 }) != false,
                  clockAt <= Self.nowMilliseconds() + 60_000,
                  activeElapsed >= configuration.activeElapsedBaseMs,
                  activeElapsed >= (relay.lastSubmittedActiveElapsedMs ?? 0) else {
                completion(.failure(HeartRateRelayError.invalidClock))
                return
            }
            self.pauseRelay(
                sessionId: normalizedSessionId,
                at: clockAt,
                activeElapsedOverride: activeElapsed,
                source: .mode
            )
            completion(.success([
                "configured": true,
                "sessionId": configuredSessionId,
            ]))
        }
    }

    func resumeRelay(
        sessionId: String,
        at: Double,
        activeElapsedMs: Double,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let normalizedSessionId = Self.validatedSessionId(sessionId),
              let clockAt = Self.epochMilliseconds(at),
              let activeElapsed = Self.activeDurationMilliseconds(activeElapsedMs) else {
            completion(.failure(HeartRateRelayError.invalidClock))
            return
        }
        workQueue.async {
            guard let relay = self.state.sessions[normalizedSessionId],
                  let configuredSessionId = relay.configuration?.sessionId else {
                completion(.success([
                    "configured": false,
                    "reason": "No private heart-rate relay is configured.",
                ]))
                return
            }
            guard configuredSessionId == normalizedSessionId else {
                completion(.failure(HeartRateRelayError.sessionMismatch))
                return
            }
            guard self.state.activeSessionId == normalizedSessionId else {
                completion(.failure(HeartRateRelayError.sessionNotActive))
                return
            }
            guard let configuration = relay.configuration,
                  clockAt >= configuration.startedAt,
                  configuration.activeClockStartedAt.map({ clockAt >= $0 }) != false,
                  clockAt <= Self.nowMilliseconds() + 60_000,
                  activeElapsed >= configuration.activeElapsedBaseMs,
                  activeElapsed >= (relay.lastSubmittedActiveElapsedMs ?? 0) else {
                completion(.failure(HeartRateRelayError.invalidClock))
                return
            }
            self.resumeRelay(
                sessionId: normalizedSessionId,
                at: clockAt,
                activeElapsedOverride: activeElapsed,
                source: .mode
            )
            completion(.success([
                "configured": true,
                "sessionId": configuredSessionId,
            ]))
        }
    }

    func finalize(
        sessionId: String,
        endedAt: Double,
        activeDurationMs: Double,
        zones: [HeartRateRelayZone]?,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let normalizedSessionId = Self.validatedSessionId(sessionId),
              let normalizedEndedAt = Self.epochMilliseconds(endedAt),
              normalizedEndedAt <= Self.nowMilliseconds() + 60_000,
              let normalizedActiveDuration = Self.activeDurationMilliseconds(activeDurationMs),
              zones?.allSatisfy({ $0.isValid(for: normalizedActiveDuration) }) != false,
              Self.validZoneOrdering(zones ?? []) else {
            completion(.failure(HeartRateRelayError.invalidFinalization))
            return
        }

        workQueue.async {
            guard var relay = self.state.sessions[normalizedSessionId],
                  var configuration = relay.configuration else {
                completion(.success([
                    "configured": false,
                    "reason": "No private heart-rate relay is configured.",
                ]))
                return
            }
            if configuration.finalization != nil {
                completion(.success([
                    "configured": true,
                    "sessionId": configuration.sessionId,
                    "scope": configuration.scope.rawValue,
                    "queued": true,
                ]))
                return
            }
            let wallDuration = normalizedEndedAt - configuration.startedAt
            let inFlightFitsFinalization = self.state.activeJob.map { job in
                guard job.sessionId == normalizedSessionId,
                      job.kind == .samples else { return true }
                return (job.lastRecordedAt ?? normalizedEndedAt) <= normalizedEndedAt
                    && (job.lastActiveElapsedMs ?? normalizedActiveDuration)
                        <= normalizedActiveDuration
            } ?? true
            guard wallDuration >= 0,
                  configuration.activeClockStartedAt.map({ normalizedEndedAt >= $0 }) != false,
                  normalizedActiveDuration >= configuration.activeElapsedBaseMs,
                  normalizedActiveDuration >= (relay.lastSubmittedActiveElapsedMs ?? 0),
                  inFlightFitsFinalization,
                  Int64(normalizedActiveDuration) <= wallDuration + 120_000 else {
                completion(.failure(HeartRateRelayError.invalidFinalization))
                return
            }
            relay.samples.removeAll {
                $0.recordedAt > normalizedEndedAt
                    || $0.activeElapsedMs > normalizedActiveDuration
            }
            self.closeActiveClock(
                configuration: &configuration,
                at: normalizedEndedAt,
                activeElapsedOverride: normalizedActiveDuration
            )
            configuration.finalization = RelayFinalization(
                endedAt: normalizedEndedAt,
                activeDurationMs: normalizedActiveDuration,
                zoneWindows: zones?.isEmpty == false ? zones : nil
            )
            relay.configuration = configuration
            relay.finalizeNotBefore = Self.nowMilliseconds()
                + Self.finalSampleGraceMilliseconds
            self.state.sessions[normalizedSessionId] = relay
            if self.state.activeSessionId == normalizedSessionId {
                self.state.activeSessionId = nil
            }
            self.persistState()
            self.processIfPossible()
            self.publishRelayState(reason: "queued")
            completion(.success([
                "configured": true,
                "sessionId": configuration.sessionId,
                "scope": configuration.scope.rawValue,
                "queued": true,
            ]))
        }
    }

    /// Ends the one relay whose lifecycle intentionally matches a continuous
    /// Watch workout. Personal mode relays remain owned by JavaScript so their
    /// authoritative pedal-zone windows are never lost on workout end.
    func finalizeContinuousBlockAtWorkoutEnd(
        at date: Date = Date(),
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let requestedEndedAt = Int64((date.timeIntervalSince1970 * 1_000).rounded())
        workQueue.async {
            guard let activeSessionId = self.state.activeSessionId,
                  let relay = self.state.sessions[activeSessionId],
                  let configuration = relay.configuration else {
                completion(.success([
                    "handled": false,
                    "configured": false,
                    "reason": "no-active-relay",
                ]))
                return
            }
            guard configuration.scope == .studioBlock
                    || configuration.scope == .accountBlock else {
                completion(.success([
                    "handled": false,
                    "configured": true,
                    "sessionId": configuration.sessionId,
                    "scope": configuration.scope.rawValue,
                    "reason": "personal-session-finalization-required",
                ]))
                return
            }

            let endedAt = [
                requestedEndedAt,
                configuration.startedAt,
                configuration.activeClockStartedAt ?? configuration.startedAt,
                relay.lastSubmittedRecordedAt ?? configuration.startedAt,
                relay.samples.map(\.recordedAt).max() ?? configuration.startedAt
            ].max() ?? requestedEndedAt
            let activeDurationMs = [
                self.activeElapsed(
                    at: endedAt,
                    configuration: configuration
                ) ?? configuration.activeElapsedBaseMs,
                relay.lastSubmittedActiveElapsedMs ?? 0,
                relay.samples.map(\.activeElapsedMs).max() ?? 0
            ].max() ?? configuration.activeElapsedBaseMs
            var finalizedConfiguration = configuration
            self.closeActiveClock(
                configuration: &finalizedConfiguration,
                at: endedAt,
                activeElapsedOverride: activeDurationMs
            )
            finalizedConfiguration.finalization = RelayFinalization(
                endedAt: endedAt,
                activeDurationMs: activeDurationMs,
                zoneWindows: nil
            )
            var finalizedRelay = relay
            finalizedRelay.configuration = finalizedConfiguration
            finalizedRelay.finalizeNotBefore = Self.nowMilliseconds()
                + Self.finalSampleGraceMilliseconds
            self.state.sessions[activeSessionId] = finalizedRelay
            self.state.activeSessionId = nil
            self.persistState()
            self.processIfPossible()
            self.publishRelayState(reason: "queued")
            completion(.success([
                "handled": true,
                "configured": true,
                "sessionId": activeSessionId,
                "scope": configuration.scope.rawValue,
                "queued": true,
            ]))
        }
    }

    /// Finalizes a Watch Connect stream at its server-issued four-hour boundary.
    /// Unlike an ordinary workout end, this method never moves `endedAt` later
    /// to accommodate a delayed mirrored sample.
    func finalizeWatchConnect(
        sessionId: String,
        endedAt: Int64,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let normalizedSessionId = Self.validatedSessionId(sessionId),
              endedAt >= 0,
              endedAt <= Self.nowMilliseconds() + 60_000 else {
            completion(.failure(HeartRateRelayError.invalidFinalization))
            return
        }
        workQueue.async {
            guard var relay = self.state.sessions[normalizedSessionId],
                  var configuration = relay.configuration else {
                completion(.success([
                    "handled": false,
                    "configured": false,
                    "reason": "no-active-watch-connect",
                ]))
                return
            }
            if configuration.finalization != nil {
                completion(.success([
                    "handled": true,
                    "configured": true,
                    "sessionId": normalizedSessionId,
                    "scope": configuration.scope.rawValue,
                    "queued": true,
                ]))
                return
            }
            guard configuration.scope == .studioBlock || configuration.scope == .accountBlock,
                  endedAt >= configuration.startedAt,
                  configuration.activeClockStartedAt.map({ endedAt >= $0 }) != false,
                  (relay.lastSubmittedRecordedAt ?? configuration.startedAt) <= endedAt else {
                completion(.failure(HeartRateRelayError.invalidFinalization))
                return
            }
            relay.samples.removeAll { $0.recordedAt > endedAt }
            let activeDurationMs = [
                self.activeElapsed(at: endedAt, configuration: configuration)
                    ?? configuration.activeElapsedBaseMs,
                relay.lastSubmittedActiveElapsedMs ?? 0,
                relay.samples.map(\.activeElapsedMs).max() ?? 0,
            ].max() ?? configuration.activeElapsedBaseMs
            self.closeActiveClock(
                configuration: &configuration,
                at: endedAt,
                activeElapsedOverride: activeDurationMs
            )
            configuration.finalization = RelayFinalization(
                endedAt: endedAt,
                activeDurationMs: activeDurationMs,
                zoneWindows: nil
            )
            relay.configuration = configuration
            relay.finalizeNotBefore = Self.nowMilliseconds()
                + Self.finalSampleGraceMilliseconds
            self.state.sessions[normalizedSessionId] = relay
            if self.state.activeSessionId == normalizedSessionId {
                self.state.activeSessionId = nil
            }
            self.persistState()
            self.processIfPossible()
            self.publishRelayState(reason: "queued")
            completion(.success([
                "handled": true,
                "configured": true,
                "sessionId": normalizedSessionId,
                "scope": configuration.scope.rawValue,
                "queued": true,
            ]))
        }
    }

    func clear(
        sessionId: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let normalizedSessionId = Self.validatedSessionId(sessionId) else {
            completion(.failure(HeartRateRelayError.invalidConfiguration))
            return
        }
        workQueue.async {
            guard self.state.sessions[normalizedSessionId] != nil else {
                completion(.success([
                    "configured": false,
                    "reason": "No private heart-rate relay is configured.",
                ]))
                return
            }
            if let activeJob = self.state.activeJob,
               activeJob.sessionId == normalizedSessionId {
                self.cancelUploadTasks(jobId: activeJob.id)
                self.removePayload(for: activeJob)
                self.state.activeJob = nil
            }
            self.state.sessions.removeValue(forKey: normalizedSessionId)
            if self.state.activeSessionId == normalizedSessionId {
                self.state.activeSessionId = nil
            }
            self.persistState()
            self.keychain.delete(sessionId: normalizedSessionId)
            self.processIfPossible()
            self.publishRelayState(reason: "cleared")
            completion(.success(["configured": false]))
        }
    }

    func clearAll(completion: @escaping (Result<[String: Any], Error>) -> Void) {
        workQueue.async {
            guard !self.clearingAll else {
                completion(.failure(HeartRateRelayError.relayClearing))
                return
            }
            self.clearingAll = true
            self.state = RelayPersistedState()
            self.persistState()
            self.keychain.deleteAll()
            self.cancelAllUploadTasks {
                self.workQueue.async {
                    self.prunePayloadDirectory(keeping: nil)
                    self.clearingAll = false
                    self.publishRelayState(reason: "clearedAll")
                    completion(.success([
                        "configured": false,
                        "queuedCount": 0,
                    ]))
                }
            }
        }
    }

    /// Clears active account-bound credentials without destroying finalized
    /// outboxes that still need their original token to receive a server ACK.
    /// Reconciliation never relabels those queued sessions for the next user.
    func clearForAccountBoundary(
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        workQueue.async {
            guard !self.clearingAll else {
                completion(.failure(HeartRateRelayError.relayClearing))
                return
            }
            self.clearingAll = true
            let removedSessionIds = self.state.sessions.compactMap { sessionId, relay in
                relay.configuration?.finalization == nil ? sessionId : nil
            }
            if let activeJob = self.state.activeJob,
               removedSessionIds.contains(activeJob.sessionId) {
                self.cancelUploadTasks(jobId: activeJob.id)
                self.removePayload(for: activeJob)
                self.state.activeJob = nil
            }
            removedSessionIds.forEach { sessionId in
                self.state.sessions.removeValue(forKey: sessionId)
                self.keychain.delete(sessionId: sessionId)
            }
            self.state.activeSessionId = nil
            self.persistState()
            self.clearingAll = false
            self.processIfPossible()
            self.publishRelayState(reason: "clearedAll")
            let queuedCount = self.state.sessions.values.filter {
                $0.configuration?.finalization != nil
            }.count
            completion(.success([
                "configured": false,
                "queuedCount": queuedCount,
                "preservedFinalized": true,
            ]))
        }
    }

    func handleEventsForBackgroundURLSession(
        identifier: String,
        completionHandler: @escaping () -> Void
    ) -> Bool {
        guard identifier == Self.backgroundSessionIdentifier else { return false }
        workQueue.async {
            self.backgroundEventsCompletionHandler = completionHandler
            _ = self.backgroundSession
        }
        return true
    }

    private func activeElapsed(at recordedAt: Int64, configuration: RelayConfiguration) -> Int? {
        if let completed = configuration.clockSegments.reversed().first(where: {
            recordedAt >= $0.startedAt && recordedAt <= $0.endedAt
        }) {
            return completed.activeElapsed(at: recordedAt)
        }
        guard let activeClockStartedAt = configuration.activeClockStartedAt,
              recordedAt >= activeClockStartedAt else { return nil }
        let delta = max(0, recordedAt - activeClockStartedAt)
        return min(
            Self.maximumActiveDurationMs,
            configuration.activeElapsedBaseMs + Int(delta)
        )
    }

    private func closeActiveClock(
        configuration: inout RelayConfiguration,
        at clockAt: Int64,
        activeElapsedOverride: Int?
    ) {
        guard let activeClockStartedAt = configuration.activeClockStartedAt else {
            if let activeElapsedOverride {
                configuration.activeElapsedBaseMs = activeElapsedOverride
            }
            return
        }
        let segmentEnd = max(activeClockStartedAt, clockAt)
        let calculatedEnd = min(
            Self.maximumActiveDurationMs,
            configuration.activeElapsedBaseMs + Int(segmentEnd - activeClockStartedAt)
        )
        let activeEnd = max(
            configuration.activeElapsedBaseMs,
            min(Self.maximumActiveDurationMs, activeElapsedOverride ?? calculatedEnd)
        )
        if segmentEnd > activeClockStartedAt,
           configuration.clockSegments.count < Self.maximumClockSegments {
            configuration.clockSegments.append(RelayClockSegment(
                startedAt: activeClockStartedAt,
                endedAt: segmentEnd,
                activeElapsedAtStartMs: configuration.activeElapsedBaseMs,
                activeElapsedAtEndMs: activeEnd
            ))
        }
        configuration.activeElapsedBaseMs = activeEnd
        configuration.activeClockStartedAt = nil
    }

    private func pauseRelay(
        sessionId: String,
        at clockAt: Int64,
        activeElapsedOverride: Int?,
        source: RelayClockSource
    ) {
        guard var relay = state.sessions[sessionId],
              var configuration = relay.configuration else { return }
        closeActiveClock(
            configuration: &configuration,
            at: clockAt,
            activeElapsedOverride: activeElapsedOverride
        )
        switch source {
        case .mode:
            configuration.modePaused = true
        case .workout:
            configuration.workoutPaused = true
        }
        relay.configuration = configuration
        state.sessions[sessionId] = relay
        persistState()
    }

    private func resumeRelay(
        sessionId: String,
        at clockAt: Int64,
        activeElapsedOverride: Int?,
        source: RelayClockSource
    ) {
        guard var relay = state.sessions[sessionId],
              var configuration = relay.configuration,
              configuration.finalization == nil else {
            return
        }
        if let activeElapsedOverride,
           let activeClockStartedAt = configuration.activeClockStartedAt,
           clockAt >= activeClockStartedAt {
            closeActiveClock(
                configuration: &configuration,
                at: clockAt,
                activeElapsedOverride: activeElapsedOverride
            )
        } else if let activeElapsedOverride,
                  configuration.activeClockStartedAt == nil {
            configuration.activeElapsedBaseMs = max(
                configuration.activeElapsedBaseMs,
                activeElapsedOverride
            )
        }
        switch source {
        case .mode:
            configuration.modePaused = false
        case .workout:
            configuration.workoutPaused = false
        }
        if !configuration.modePaused,
           !configuration.workoutPaused,
           configuration.activeClockStartedAt == nil {
            configuration.activeClockStartedAt = clockAt
        }
        relay.configuration = configuration
        state.sessions[sessionId] = relay
        persistState()
    }

    private func processIfPossible() {
        guard started,
              !recoveringBackgroundTasks,
              !clearingAll,
              state.activeJob == nil else {
            return
        }

        let now = Date().timeIntervalSince1970 * 1_000
        var earliestRetryAt: Double?
        let sessionIds = state.sessions.keys.sorted { lhs, rhs in
            guard lhs != rhs else { return false }
            let lhsConfiguration = state.sessions[lhs]?.configuration
            let rhsConfiguration = state.sessions[rhs]?.configuration
            let lhsIsActive = lhs == state.activeSessionId
            let rhsIsActive = rhs == state.activeSessionId
            if lhsIsActive != rhsIsActive { return lhsIsActive }
            let lhsFinalizing = lhsConfiguration?.finalization != nil
            let rhsFinalizing = rhsConfiguration?.finalization != nil
            if lhsFinalizing != rhsFinalizing { return lhsFinalizing }
            let lhsStartedAt = lhsConfiguration?.startedAt ?? 0
            let rhsStartedAt = rhsConfiguration?.startedAt ?? 0
            if lhsStartedAt != rhsStartedAt { return lhsStartedAt < rhsStartedAt }
            return lhs < rhs
        }

        for sessionId in sessionIds {
            guard var relay = state.sessions[sessionId],
                  let configuration = relay.configuration else {
                removeRelayAfterTerminalFailure(
                    sessionId: sessionId,
                    reason: "invalidState"
                )
                continue
            }
            if let nextAttemptAt = relay.nextAttemptAt, nextAttemptAt > now {
                earliestRetryAt = min(earliestRetryAt ?? nextAttemptAt, nextAttemptAt)
                continue
            }
            guard let token = keychain.load(sessionId: sessionId) else {
                removeRelayAfterTerminalFailure(
                    sessionId: sessionId,
                    reason: "credentialMissing"
                )
                continue
            }

            do {
                let prepared: (job: RelayJob, request: URLRequest, payload: Data)?
                if configuration.streamId == nil {
                    prepared = (
                        RelayJob(sessionId: sessionId, kind: .create, sequences: []),
                        try request(
                            configuration: configuration,
                            token: token,
                            pathComponents: ["api", "heart-rate", "streams"]
                        ),
                        try JSONSerialization.data(withJSONObject: [
                            "startedAt": configuration.startedAt,
                        ])
                    )
                } else if let streamId = configuration.streamId,
                          let batch = nextSampleBatch(relay: &relay) {
                    prepared = (
                        RelayJob(sessionId: sessionId, kind: .samples, samples: batch),
                        try request(
                            configuration: configuration,
                            token: token,
                            pathComponents: ["api", "heart-rate", "streams", streamId, "samples"]
                        ),
                        try JSONEncoder().encode(RelaySampleBatch(samples: batch))
                    )
                } else if let finalization = configuration.finalization,
                          let streamId = configuration.streamId {
                    if let finalizeNotBefore = relay.finalizeNotBefore,
                       Double(finalizeNotBefore) > now {
                        earliestRetryAt = min(
                            earliestRetryAt ?? Double(finalizeNotBefore),
                            Double(finalizeNotBefore)
                        )
                        prepared = nil
                    } else {
                        prepared = (
                            RelayJob(sessionId: sessionId, kind: .finalize, sequences: []),
                            try request(
                                configuration: configuration,
                                token: token,
                                pathComponents: ["api", "heart-rate", "streams", streamId, "finalize"]
                            ),
                            try JSONEncoder().encode(finalization)
                        )
                    }
                } else {
                    prepared = nil
                }

                state.sessions[sessionId] = relay
                guard let prepared else { continue }
                let payloadURL = try writePayload(prepared.payload, jobId: prepared.job.id)
                var persistedJob = prepared.job
                persistedJob.payloadFileName = payloadURL.lastPathComponent
                state.activeJob = persistedJob
                relay.nextAttemptAt = nil
                state.sessions[sessionId] = relay
                persistState()

                let uploadSession = UIApplication.shared.applicationState == .active
                    ? foregroundSession
                    : backgroundSession
                let task = uploadSession.uploadTask(with: prepared.request, fromFile: payloadURL)
                task.taskDescription = persistedJob.id
                task.resume()
                publishRelayState(reason: "syncing")
                return
            } catch {
                state.sessions[sessionId] = relay
                scheduleRetry(sessionId: sessionId)
                return
            }
        }

        if let earliestRetryAt {
            let delay = min(300, max(1, (earliestRetryAt - now) / 1_000))
            workQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.processIfPossible()
            }
        }
    }

    private func request(
        configuration: RelayConfiguration,
        token: String,
        pathComponents: [String]
    ) throws -> URLRequest {
        guard var url = URL(string: configuration.baseURL) else {
            throw HeartRateRelayError.invalidConfiguration
        }
        for component in pathComponents {
            url.appendPathComponent(component)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func handleCompletion(
        taskDescription: String?,
        response: URLResponse?,
        data: Data,
        error: Error?
    ) {
        guard let activeJob = state.activeJob,
              activeJob.id == taskDescription else {
            return
        }

        removePayload(for: activeJob)
        state.activeJob = nil

        guard error == nil, let httpResponse = response as? HTTPURLResponse else {
            persistState()
            scheduleRetry(sessionId: activeJob.sessionId)
            return
        }

        switch httpResponse.statusCode {
        case 200..<300:
            handleSuccessfulJob(activeJob, data: data)
        case 401, 403:
            removeRelayAfterTerminalFailure(
                sessionId: activeJob.sessionId,
                reason: "credentialRejected"
            )
            processIfPossible()
        case 404 where activeJob.kind != .create:
            if var relay = state.sessions[activeJob.sessionId],
               var configuration = relay.configuration {
                configuration.streamId = nil
                relay.configuration = configuration
                relay.consecutiveFailures = 0
                relay.nextAttemptAt = nil
                state.sessions[activeJob.sessionId] = relay
            }
            persistState()
            processIfPossible()
        case 408, 425, 429, 500...599:
            persistState()
            scheduleRetry(sessionId: activeJob.sessionId)
        default:
            removeRelayAfterTerminalFailure(
                sessionId: activeJob.sessionId,
                reason: "requestRejected"
            )
            processIfPossible()
        }
    }

    private func handleSuccessfulJob(_ job: RelayJob, data: Data) {
        guard var relay = state.sessions[job.sessionId],
              var configuration = relay.configuration else {
            processIfPossible()
            return
        }
        switch job.kind {
        case .create:
            guard let streamId = Self.streamId(from: data) else {
                persistState()
                scheduleRetry(sessionId: job.sessionId)
                return
            }
            configuration.streamId = streamId
            relay.configuration = configuration
        case .samples:
            let completedSequences = Set(job.sequences)
            relay.samples.removeAll { completedSequences.contains($0.sequence) }
            if let lastSequence = job.lastSequence {
                relay.lastSubmittedSequence = lastSequence
            }
            if let lastRecordedAt = job.lastRecordedAt {
                relay.lastSubmittedRecordedAt = lastRecordedAt
            }
            if let lastActiveElapsedMs = job.lastActiveElapsedMs {
                relay.lastSubmittedActiveElapsedMs = lastActiveElapsedMs
            }
        case .finalize:
            state.sessions.removeValue(forKey: job.sessionId)
            if state.activeSessionId == job.sessionId {
                state.activeSessionId = nil
            }
            persistState()
            keychain.delete(sessionId: job.sessionId)
            processIfPossible()
            publishRelayState(reason: "synced")
            return
        }
        relay.consecutiveFailures = 0
        relay.nextAttemptAt = nil
        state.sessions[job.sessionId] = relay
        persistState()
        processIfPossible()
        publishRelayState(reason: "progress")
    }

    private func scheduleRetry(sessionId: String) {
        guard var relay = state.sessions[sessionId] else {
            processIfPossible()
            return
        }
        relay.consecutiveFailures = min(relay.consecutiveFailures + 1, 12)
        let delays: [Double] = [2, 5, 15, 30, 60, 120, 300]
        let delay = delays[min(relay.consecutiveFailures - 1, delays.count - 1)]
        relay.nextAttemptAt = Date().timeIntervalSince1970 * 1_000 + delay * 1_000
        state.sessions[sessionId] = relay
        persistState()
        publishRelayState(reason: "retryScheduled")
        workQueue.async { [weak self] in
            self?.processIfPossible()
        }
        workQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.processIfPossible()
        }
    }

    private func removeRelayAfterTerminalFailure(sessionId: String, reason: String) {
        state.sessions.removeValue(forKey: sessionId)
        if state.activeSessionId == sessionId {
            state.activeSessionId = nil
        }
        persistState()
        keychain.delete(sessionId: sessionId)
        publishRelayState(reason: reason)
    }

    private func cancelUploadTasks(jobId: String) {
        [backgroundSession, foregroundSession].forEach { session in
            session.getAllTasks { tasks in
                tasks.filter { $0.taskDescription == jobId }.forEach { $0.cancel() }
            }
        }
    }

    private func cancelAllUploadTasks(completion: @escaping () -> Void) {
        let group = DispatchGroup()
        [backgroundSession, foregroundSession].forEach { session in
            group.enter()
            session.getAllTasks { tasks in
                tasks.forEach { $0.cancel() }
                group.leave()
            }
        }
        group.notify(queue: workQueue, execute: completion)
    }

    private func prepareStorageDirectory() {
        guard let directory = try? relayDirectory() else { return }
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        var mutableDirectory = directory
        try? mutableDirectory.setResourceValues(resourceValues)
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directory.path
        )
    }

    private func relayDirectory() throws -> URL {
        let applicationSupport = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return applicationSupport.appendingPathComponent("TrackLabHeartRateRelay", isDirectory: true)
    }

    private func stateURL() throws -> URL {
        try relayDirectory().appendingPathComponent("state.json", isDirectory: false)
    }

    private func payloadDirectory() throws -> URL {
        try relayDirectory().appendingPathComponent("PendingUploads", isDirectory: true)
    }

    private func loadState() -> RelayPersistedState {
        guard let url = try? stateURL(),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(RelayPersistedState.self, from: data),
              decoded.version == RelayPersistedState.currentVersion else {
            return RelayPersistedState()
        }

        var sanitized = RelayPersistedState()
        let sessionIds = decoded.sessions.keys.sorted { lhs, rhs in
            let lhsStartedAt = decoded.sessions[lhs]?.configuration?.startedAt ?? 0
            let rhsStartedAt = decoded.sessions[rhs]?.configuration?.startedAt ?? 0
            if lhsStartedAt != rhsStartedAt { return lhsStartedAt < rhsStartedAt }
            return lhs < rhs
        }
        for sessionId in sessionIds.prefix(Self.maximumRelaySessions) {
            guard let relay = decoded.sessions[sessionId],
                  let configuration = relay.configuration,
                  let validatedSessionId = Self.validatedSessionId(sessionId),
                  validatedSessionId == sessionId,
                  configuration.sessionId == sessionId,
                  Self.validatedBaseURL(configuration.baseURL) != nil,
                  configuration.startedAt >= 0,
                  configuration.activeElapsedBaseMs >= 0,
                  configuration.activeElapsedBaseMs <= Self.maximumActiveDurationMs,
                  configuration.activeClockStartedAt.map({
                      $0 >= configuration.startedAt
                          && $0 <= Self.nowMilliseconds() + 60_000
                  }) != false,
                  Self.validClockSegments(
                      configuration.clockSegments,
                      startedAt: configuration.startedAt,
                      endedAt: configuration.finalization?.endedAt,
                      activeElapsedBaseMs: configuration.activeElapsedBaseMs,
                      activeClockStartedAt: configuration.activeClockStartedAt
                  ),
                  Self.validClockLifecycle(configuration),
                  configuration.streamId.map(Self.validatedOpaqueId) != false,
                  Self.validFinalization(
                      configuration.finalization,
                      startedAt: configuration.startedAt
                  ) else {
                continue
            }

            var restored = RelaySessionState(configuration: configuration)
            var seenSequences = Set<Int>()
            restored.samples = relay.samples.filter { sample in
                guard sample.sequence >= 0,
                      sample.sequence <= Self.maximumSequence,
                      sample.recordedAt >= configuration.startedAt,
                      sample.activeElapsedMs >= 0,
                      sample.activeElapsedMs <= Self.maximumActiveDurationMs,
                      sample.bpm >= 20,
                      sample.bpm <= 260,
                      seenSequences.insert(sample.sequence).inserted else {
                    return false
                }
                return true
            }.sorted { lhs, rhs in
                lhs.sequence == rhs.sequence
                    ? lhs.recordedAt < rhs.recordedAt
                    : lhs.sequence < rhs.sequence
            }
            if restored.samples.count > Self.maximumOutboxSamples {
                restored.samples = Array(restored.samples.prefix(Self.maximumOutboxSamples))
            }
            if let lastSequence = relay.lastSubmittedSequence,
               lastSequence >= 0,
               lastSequence <= Self.maximumSequence {
                restored.lastSubmittedSequence = lastSequence
            }
            if let lastRecordedAt = relay.lastSubmittedRecordedAt,
               lastRecordedAt >= configuration.startedAt {
                restored.lastSubmittedRecordedAt = lastRecordedAt
            }
            if let lastActiveElapsedMs = relay.lastSubmittedActiveElapsedMs,
               lastActiveElapsedMs >= 0,
               lastActiveElapsedMs <= Self.maximumActiveDurationMs {
                restored.lastSubmittedActiveElapsedMs = lastActiveElapsedMs
            }
            restored.droppedSampleCount = max(0, relay.droppedSampleCount)
            restored.consecutiveFailures = min(max(0, relay.consecutiveFailures), 12)
            restored.nextAttemptAt = relay.nextAttemptAt.flatMap {
                $0.isFinite && $0 >= 0 ? $0 : nil
            }
            if configuration.finalization != nil {
                restored.finalizeNotBefore = relay.finalizeNotBefore.flatMap {
                    $0 >= 0 && $0 <= Self.nowMilliseconds() + 60_000 ? $0 : nil
                }
            }
            sanitized.sessions[sessionId] = restored
        }

        if let activeSessionId = decoded.activeSessionId,
           sanitized.sessions[activeSessionId]?.configuration?.finalization == nil {
            sanitized.activeSessionId = activeSessionId
        }
        if let activeJob = decoded.activeJob,
           sanitized.sessions[activeJob.sessionId] != nil,
           activeJob.isValidForRecovery {
            sanitized.activeJob = activeJob
        }
        return sanitized
    }

    private func persistState() {
        validateStateInvariants()
        prepareStorageDirectory()
        guard let url = try? stateURL(),
              let data = try? JSONEncoder().encode(state) else {
            return
        }
        do {
            try data.write(to: url, options: .atomic)
            try? fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
        } catch {
            // The in-memory outbox remains available for this process. A later
            // sample or lifecycle transition attempts the protected write again.
        }
    }

    private func writePayload(_ data: Data, jobId: String) throws -> URL {
        let directory = try payloadDirectory()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directory.path
        )
        let url = directory.appendingPathComponent("\(jobId).json", isDirectory: false)
        try data.write(to: url, options: .atomic)
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        return url
    }

    private func removePayload(for job: RelayJob) {
        guard let fileName = job.payloadFileName,
              let directory = try? payloadDirectory() else {
            return
        }
        try? fileManager.removeItem(at: directory.appendingPathComponent(fileName))
    }

    private func prunePayloadDirectory(keeping fileName: String?) {
        guard let directory = try? payloadDirectory(),
              let payloads = try? fileManager.contentsOfDirectory(
                  at: directory,
                  includingPropertiesForKeys: nil
              ) else {
            return
        }
        for payload in payloads where payload.pathExtension == "json"
            && payload.lastPathComponent != fileName {
            try? fileManager.removeItem(at: payload)
        }
    }

    private func validateStateInvariants() {
        assert(state.sessions.count <= Self.maximumRelaySessions)
        if let activeSessionId = state.activeSessionId {
            assert(state.sessions[activeSessionId]?.configuration?.finalization == nil)
        }
        if let activeJob = state.activeJob {
            assert(state.sessions[activeJob.sessionId] != nil)
            assert(activeJob.isValidForRecovery)
        }
        for (sessionId, relay) in state.sessions {
            assert(relay.configuration?.sessionId == sessionId)
            assert(relay.samples.count <= Self.maximumOutboxSamples)
            assert(relay.droppedSampleCount >= 0)
            assert(Set(relay.samples.map(\.sequence)).count == relay.samples.count)
            if let configuration = relay.configuration {
                assert(Self.validClockSegments(
                    configuration.clockSegments,
                    startedAt: configuration.startedAt,
                    endedAt: configuration.finalization?.endedAt,
                    activeElapsedBaseMs: configuration.activeElapsedBaseMs,
                    activeClockStartedAt: configuration.activeClockStartedAt
                ))
                assert(relay.finalizeNotBefore == nil || configuration.finalization != nil)
                assert(Self.validClockLifecycle(configuration))
            }
        }
    }

    private static func validatedBaseURL(_ rawValue: String) -> String? {
        guard let components = URLComponents(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == "tracklab-bmx.onrender.com",
              components.port == nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else {
            return nil
        }
        return productionBaseURL
    }

    private static func validatedSessionId(_ rawValue: String) -> String? {
        let normalized = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty,
              normalized.utf8.count <= 160,
              !containsControlCharacters(normalized) else {
            return nil
        }
        return normalized
    }

    private static func epochMilliseconds(_ value: Double) -> Int64? {
        guard value.isFinite,
              value >= 0,
              value <= Double(Int64.max) else {
            return nil
        }
        return Int64(value.rounded())
    }

    private static func nowMilliseconds() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1_000).rounded())
    }

    private static func activeDurationMilliseconds(_ value: Double) -> Int? {
        guard value.isFinite,
              value >= 0,
              value <= Double(maximumActiveDurationMs) else {
            return nil
        }
        return Int(value.rounded())
    }

    private static func streamId(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let stream = object["stream"] as? [String: Any],
              let rawId = stream["id"] as? String else {
            return nil
        }
        let id = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty,
              id.utf8.count <= 160,
              !containsControlCharacters(id) else {
            return nil
        }
        return id
    }

    private static func validatedOpaqueId(_ rawValue: String) -> Bool {
        let normalized = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return !normalized.isEmpty
            && normalized == rawValue
            && normalized.utf8.count <= 160
            && !containsControlCharacters(normalized)
    }

    private static func validFinalization(
        _ finalization: RelayFinalization?,
        startedAt: Int64
    ) -> Bool {
        guard let finalization else { return true }
        guard finalization.endedAt >= startedAt,
              finalization.activeDurationMs >= 0,
              finalization.activeDurationMs <= maximumActiveDurationMs else {
            return false
        }
        let zones = finalization.zoneWindows ?? []
        return zones.allSatisfy { $0.isValid(for: finalization.activeDurationMs) }
            && validZoneOrdering(zones)
    }

    private static func validClockSegments(
        _ segments: [RelayClockSegment],
        startedAt: Int64,
        endedAt: Int64?,
        activeElapsedBaseMs: Int,
        activeClockStartedAt: Int64?
    ) -> Bool {
        guard segments.count <= maximumClockSegments else { return false }
        var previousWallEnd = startedAt
        var previousActiveEnd = 0
        for segment in segments {
            guard segment.startedAt >= previousWallEnd,
                  segment.endedAt > segment.startedAt,
                  endedAt.map({ segment.endedAt <= $0 }) != false,
                  segment.activeElapsedAtStartMs >= previousActiveEnd,
                  segment.activeElapsedAtStartMs >= 0,
                  segment.activeElapsedAtEndMs >= segment.activeElapsedAtStartMs,
                  segment.activeElapsedAtEndMs <= maximumActiveDurationMs else {
                return false
            }
            previousWallEnd = segment.endedAt
            previousActiveEnd = segment.activeElapsedAtEndMs
        }
        guard activeElapsedBaseMs >= previousActiveEnd else { return false }
        if let activeClockStartedAt {
            guard endedAt == nil,
                  activeClockStartedAt >= previousWallEnd else {
                return false
            }
        }
        return true
    }

    private static func validClockLifecycle(_ configuration: RelayConfiguration) -> Bool {
        if let finalization = configuration.finalization {
            return configuration.activeClockStartedAt == nil
                && configuration.activeElapsedBaseMs == finalization.activeDurationMs
        }
        let isPaused = configuration.modePaused || configuration.workoutPaused
        return isPaused
            ? configuration.activeClockStartedAt == nil
            : configuration.activeClockStartedAt != nil
    }

    private static func containsControlCharacters(_ value: String) -> Bool {
        value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    private static func validZoneOrdering(_ zones: [HeartRateRelayZone]) -> Bool {
        guard zones.count <= 500,
              Set(zones.map(\.zoneId)).count == zones.count else {
            return false
        }
        var priorEnd = 0
        for zone in zones {
            guard zone.startElapsedMs >= priorEnd else { return false }
            priorEnd = zone.endElapsedMs
        }
        return true
    }

    /// HealthKit normally mirrors samples in order, but it can replay delayed
    /// data after reconnecting. Preserve the Watch measurement and clock values
    /// and discard only samples that arrive behind the durable server high-water
    /// mark; mutating their timestamps would make the saved record inaccurate.
    private func nextSampleBatch(relay: inout RelaySessionState) -> [RelaySample]? {
        var priorSequence = relay.lastSubmittedSequence ?? -1
        var priorRecordedAt = relay.lastSubmittedRecordedAt ?? Int64.min
        var priorActiveElapsedMs = relay.lastSubmittedActiveElapsedMs ?? 0
        var rejectedSequences = Set<Int>()
        var batch: [RelaySample] = []

        for sample in relay.samples {
            guard batch.count < Self.maximumBatchSize else { break }
            guard sample.sequence > priorSequence,
                  sample.recordedAt >= priorRecordedAt,
                  sample.activeElapsedMs >= priorActiveElapsedMs else {
                rejectedSequences.insert(sample.sequence)
                continue
            }
            batch.append(sample)
            priorSequence = sample.sequence
            priorRecordedAt = sample.recordedAt
            priorActiveElapsedMs = sample.activeElapsedMs
        }

        if !rejectedSequences.isEmpty {
            relay.samples.removeAll { rejectedSequences.contains($0.sequence) }
        }
        return batch.isEmpty ? nil : batch
    }
}

extension HeartRateRelay: URLSessionDataDelegate {
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard let taskDescription = dataTask.taskDescription else { return }
        responseData[taskDescription, default: Data()].append(data)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        let data = task.taskDescription.flatMap { responseData.removeValue(forKey: $0) } ?? Data()
        workQueue.async {
            self.handleCompletion(
                taskDescription: task.taskDescription,
                response: task.response,
                data: data,
                error: error
            )
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        workQueue.async {
            let completion = self.backgroundEventsCompletionHandler
            self.backgroundEventsCompletionHandler = nil
            DispatchQueue.main.async {
                completion?()
            }
        }
    }
}

private struct RelayPersistedState: Codable {
    static let currentVersion = 5

    var version = currentVersion
    var activeSessionId: String?
    var sessions: [String: RelaySessionState] = [:]
    var activeJob: RelayJob?
}

private struct RelaySessionState: Codable {
    var configuration: RelayConfiguration?
    var samples: [RelaySample] = []
    var lastSubmittedSequence: Int?
    var lastSubmittedRecordedAt: Int64?
    var lastSubmittedActiveElapsedMs: Int?
    var droppedSampleCount = 0
    var finalizeNotBefore: Int64?
    var consecutiveFailures = 0
    var nextAttemptAt: Double?

    init(configuration: RelayConfiguration) {
        self.configuration = configuration
    }
}

private struct RelayConfiguration: Codable {
    var baseURL: String
    var sessionId: String
    var scope: HeartRateRelayScope
    var startedAt: Int64
    var activeElapsedBaseMs: Int
    var activeClockStartedAt: Int64?
    var modePaused: Bool
    var workoutPaused: Bool
    var streamId: String?
    var finalization: RelayFinalization?
    var clockSegments: [RelayClockSegment]
}

enum HeartRateRelayScope: String, Codable, Equatable {
    case personalSession = "personal-session"
    case studioBlock = "studio-block"
    case accountBlock = "account-block"
}

private enum RelayClockSource {
    case mode
    case workout
}

private struct RelaySample: Codable {
    let sequence: Int
    let recordedAt: Int64
    let activeElapsedMs: Int
    let bpm: Int
}

private struct RelayClockSegment: Codable {
    let startedAt: Int64
    let endedAt: Int64
    let activeElapsedAtStartMs: Int
    let activeElapsedAtEndMs: Int

    func activeElapsed(at recordedAt: Int64) -> Int? {
        guard recordedAt >= startedAt, recordedAt <= endedAt else { return nil }
        let wallDuration = max(1, endedAt - startedAt)
        let activeDuration = max(0, activeElapsedAtEndMs - activeElapsedAtStartMs)
        let elapsedWall = max(0, recordedAt - startedAt)
        let interpolated = activeElapsedAtStartMs
            + Int((Double(elapsedWall) / Double(wallDuration) * Double(activeDuration)).rounded())
        return min(activeElapsedAtEndMs, max(activeElapsedAtStartMs, interpolated))
    }
}

private struct RelaySampleBatch: Codable {
    let samples: [RelaySample]
}

private struct RelayFinalization: Codable {
    let endedAt: Int64
    let activeDurationMs: Int
    let zoneWindows: [HeartRateRelayZone]?
}

struct HeartRateRelayZone: Codable {
    let zoneId: String
    let zoneName: String?
    let startElapsedMs: Int
    let endElapsedMs: Int

    init?(zoneId: String, zoneName: String?, startElapsedMs: Double, endElapsedMs: Double) {
        let trimmedId = zoneId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedId = String(trimmedId.unicodeScalars.map { scalar in
            let value = scalar.value
            let allowed = (48...57).contains(value)
                || (65...90).contains(value)
                || (97...122).contains(value)
                || scalar == ":" || scalar == "." || scalar == "_" || scalar == "-"
            return allowed ? Character(String(scalar)) : "-"
        })
        let normalizedName = zoneName?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedId.isEmpty,
              normalizedId == trimmedId,
              normalizedId.utf8.count <= 80,
              normalizedName?.utf8.count ?? 0 <= 80,
              normalizedName?.unicodeScalars.contains(where: {
                CharacterSet.controlCharacters.contains($0)
              }) != true,
              startElapsedMs.isFinite,
              endElapsedMs.isFinite,
              startElapsedMs >= 0,
              endElapsedMs > startElapsedMs,
              endElapsedMs <= Double(HeartRateRelay.maximumActiveDurationMs) else {
            return nil
        }
        self.zoneId = normalizedId
        self.zoneName = normalizedName?.isEmpty == false ? normalizedName : nil
        self.startElapsedMs = Int(startElapsedMs.rounded())
        self.endElapsedMs = Int(endElapsedMs.rounded())
    }

    func isValid(for activeDurationMs: Int) -> Bool {
        startElapsedMs >= 0
            && endElapsedMs > startElapsedMs
            && endElapsedMs <= activeDurationMs
    }
}

private struct RelayJob: Codable {
    enum Kind: String, Codable, Equatable {
        case create
        case samples
        case finalize
    }

    let id: String
    let sessionId: String
    let kind: Kind
    let sequences: [Int]
    let lastSequence: Int?
    let lastRecordedAt: Int64?
    let lastActiveElapsedMs: Int?
    var payloadFileName: String?

    init(sessionId: String, kind: Kind, sequences: [Int]) {
        self.id = UUID().uuidString
        self.sessionId = sessionId
        self.kind = kind
        self.sequences = sequences
        self.lastSequence = nil
        self.lastRecordedAt = nil
        self.lastActiveElapsedMs = nil
        self.payloadFileName = nil
    }

    init(sessionId: String, kind: Kind, samples: [RelaySample]) {
        self.id = UUID().uuidString
        self.sessionId = sessionId
        self.kind = kind
        self.sequences = samples.map(\.sequence)
        self.lastSequence = samples.last?.sequence
        self.lastRecordedAt = samples.last?.recordedAt
        self.lastActiveElapsedMs = samples.last?.activeElapsedMs
        self.payloadFileName = nil
    }

    var isValidForRecovery: Bool {
        guard !id.isEmpty,
              id.utf8.count <= 160,
              !id.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              }),
              !sessionId.isEmpty,
              sessionId.utf8.count <= 160,
              !sessionId.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              }),
              sequences.count <= HeartRateRelay.maximumBatchSize,
              Set(sequences).count == sequences.count,
              sequences.allSatisfy({
                  $0 >= 0 && $0 <= HeartRateRelay.maximumSequence
              }),
              let payloadFileName,
              !payloadFileName.isEmpty,
              payloadFileName.utf8.count <= 200,
              payloadFileName == (payloadFileName as NSString).lastPathComponent,
              (payloadFileName as NSString).pathExtension == "json" else {
            return false
        }
        switch kind {
        case .samples:
            return !sequences.isEmpty
                && lastSequence == sequences.last
                && lastRecordedAt != nil
                && lastActiveElapsedMs != nil
        case .create, .finalize:
            return sequences.isEmpty
                && lastSequence == nil
                && lastRecordedAt == nil
                && lastActiveElapsedMs == nil
        }
    }
}

private final class HeartRateRelayTokenStore {
    private let service = "com.preskilranch.tracklabbmx.heart-rate-relay"

    func store(_ token: String, sessionId: String) throws {
        guard let data = token.data(using: .utf8) else {
            throw HeartRateRelayError.secureStorageFailed
        }
        let account = account(for: sessionId)
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let updateStatus = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw HeartRateRelayError.secureStorageFailed
        }
        var insertion = lookup
        attributes.forEach { insertion[$0.key] = $0.value }
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else {
            throw HeartRateRelayError.secureStorageFailed
        }
    }

    func load(sessionId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(for: sessionId),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    func delete(sessionId: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(for: sessionId),
        ]
        SecItemDelete(query as CFDictionary)
    }

    func deleteAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func account(for sessionId: String) -> String {
        "ingest-token:\(sessionId)"
    }
}

private enum HeartRateRelayError: LocalizedError {
    case invalidConfiguration
    case invalidClock
    case invalidFinalization
    case sessionMismatch
    case sessionNotActive
    case sessionAlreadyFinalized
    case relayBusy
    case relayClearing
    case tooManyQueuedSessions
    case secureStorageFailed

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "TrackLab could not configure a valid private heart-rate relay."
        case .invalidClock:
            return "TrackLab could not update an invalid private heart-rate relay clock."
        case .invalidFinalization:
            return "TrackLab could not finalize an invalid heart-rate relay."
        case .sessionMismatch:
            return "This private heart-rate relay belongs to a different TrackLab training session."
        case .sessionNotActive:
            return "This TrackLab heart-rate session is already waiting to sync and cannot be resumed."
        case .sessionAlreadyFinalized:
            return "This TrackLab heart-rate session is already waiting to finish syncing."
        case .relayBusy:
            return "Finish or cancel the active TrackLab heart-rate session before starting another."
        case .relayClearing:
            return "TrackLab is still clearing private heart-rate relay data for sign out."
        case .tooManyQueuedSessions:
            return "Too many offline heart-rate sessions are waiting to sync. Reconnect before starting another."
        case .secureStorageFailed:
            return "TrackLab could not protect the private heart-rate relay credential."
        }
    }
}
