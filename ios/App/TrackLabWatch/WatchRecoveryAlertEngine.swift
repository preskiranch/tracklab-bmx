import Foundation
import WatchConnectivity
import WatchKit

/// Evaluates the active athlete's recovery plan on Watch while the HealthKit
/// workout is collecting. Sensor readiness fails closed on stale data; the
/// absolute planned/fallback deadline remains available without sensor data.
final class WatchRecoveryAlertEngine {
    static let shared = WatchRecoveryAlertEngine()

    static let statusKind = "tracklab-recovery-status"
    static let cancelAction = "cancel"
    static let bindAccountAction = "bind-account"
    static let clearAccountAction = "clear-account"
    static let sustainedTargetMilliseconds: Int64 = 12_000
    static let staleHeartRateMilliseconds: Int64 = 10_000
    static let maximumSustainedSampleGapMilliseconds: Int64 = 6_000
    static let maximumFutureSkewMilliseconds: Int64 = 2_000

    private struct HeartRatePoint {
        let bpm: Double
        let measuredAt: Int64
    }

    private struct PersistedState: Codable {
        var version = 1
        var plan: RecoveryAlertWirePlan
        var phase: String
        var trigger: RecoveryAlertWireTrigger?
        var triggeredAt: Int64?
    }

    private struct RevisionTombstone: Codable {
        let accountId: String
        let recoveryId: String
        let repetitionId: String
        let sessionId: String
        let issuedAt: Int64
        let allowForegroundResume: Bool
        let terminal: Bool

        func matches(_ plan: RecoveryAlertWirePlan) -> Bool {
            accountId == plan.accountId
                && recoveryId == plan.recoveryId
                && repetitionId == plan.repetitionId
                && sessionId == plan.sessionId
        }
    }

    private let defaultsKey = "TrackLabRecoveryAlertWatchStateV1"
    private let tombstonesKey = "TrackLabRecoveryAlertWatchTombstonesV1"
    private let legacyLastIssuedAtKey = "TrackLabRecoveryAlertWatchLastIssuedAtV1"
    private let boundAccountKey = "TrackLabRecoveryAlertWatchBoundAccountV1"
    private let bindingGenerationKey = "TrackLabRecoveryAlertWatchBindingGenerationV1"
    private let maximumTombstones = 32
    private let defaults = UserDefaults.standard
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var persisted: PersistedState?
    private var tombstones: [RevisionTombstone] = []
    private var heartRatePoints: [HeartRatePoint] = []
    private var belowTargetSince: Int64?
    private var deadlineTimer: DispatchSourceTimer?
    private var boundAccountId: String?
    private var bindingGeneration: Int64 = 0
    private var workoutOwnsCue = false
    private var cueOwnershipOffered = false

    var onStateChange: ((String, String) -> Void)? {
        didSet { publishLocalState() }
    }

    private init() {
        restore()
    }

    @discardableResult
    func handle(_ message: [String: Any]) -> Bool {
        guard message["kind"] as? String == RecoveryAlertWirePlan.messageKind else {
            return false
        }
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in _ = self?.handle(message) }
            return true
        }
        let action = message["action"] as? String ?? "schedule"
        if action == Self.bindAccountAction || action == Self.clearAccountAction {
            handleAccountBoundary(message, clear: action == Self.clearAccountAction)
            return true
        }
        if action == Self.cancelAction {
            handleCancel(message)
            return true
        }
        guard let plan = RecoveryAlertWirePlan.fromDictionary(message) else {
            return true
        }
        guard let messageGeneration = RecoveryAlertWirePlan.milliseconds(
            message["accountBindingGeneration"]
        ) else { return true }
        if messageGeneration > bindingGeneration {
            // A plan sent after the authenticated native bind may outrun the
            // separate binding message. Its monotonic generation makes the
            // account transition atomic and rejects every older queued plan.
            handleAccountBoundary([
                "accountId": plan.accountId,
                "accountBindingGeneration": Double(messageGeneration),
            ], clear: false)
        }
        guard messageGeneration == bindingGeneration,
              boundAccountId == plan.accountId else { return true }
        if plan.serverState == "cancelled" {
            applyServerCancellation(plan)
            return true
        }
        apply(plan, allowTombstoneResume: action == "resume")
        return true
    }

    private func handleAccountBoundary(_ message: [String: Any], clear shouldClear: Bool) {
        guard let generation = RecoveryAlertWirePlan.milliseconds(
            message["accountBindingGeneration"]
        ), generation >= bindingGeneration else { return }
        let nextAccountId: String?
        if shouldClear {
            nextAccountId = nil
        } else {
            guard let accountId = message["accountId"] as? String,
                  RecoveryAlertWirePlan.validAccountId(accountId) else { return }
            nextAccountId = accountId
        }
        if generation == bindingGeneration,
           boundAccountId != nextAccountId {
            return
        }
        if let current = persisted,
           shouldClear || current.plan.accountId != nextAccountId {
            recordTombstone(
                for: current.plan,
                issuedAt: current.plan.issuedAt,
                allowForegroundResume: shouldClear,
                terminal: !shouldClear
            )
            sendStatus(state: "cancelled", message: "Recovery stopped")
            clear()
        }
        bindingGeneration = generation
        boundAccountId = nextAccountId
        defaults.set(bindingGeneration, forKey: bindingGenerationKey)
        if let nextAccountId {
            defaults.set(nextAccountId, forKey: boundAccountKey)
        } else {
            defaults.removeObject(forKey: boundAccountKey)
        }
    }

    func ingestHeartRate(_ bpm: Double, measuredAt date: Date) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let current = persisted,
              current.phase != "ready",
              [.heartRate, .smart].contains(current.plan.mode),
              let targetBpm = current.plan.targetBpm else { return }

        let now = Self.nowMilliseconds()
        let measuredAt = Int64((date.timeIntervalSince1970 * 1_000).rounded())
        // The relay/server ignores a delayed or duplicate point before it
        // evaluates freshness. Keep that exact order so an out-of-order stale
        // HealthKit sample cannot break only the Watch's sustained hold.
        if let previous = heartRatePoints.last,
           measuredAt <= previous.measuredAt {
            return
        }
        guard bpm.isFinite,
              bpm >= 20,
              bpm <= 260,
              now >= current.plan.notBeforeAt,
              measuredAt >= current.plan.startedAt,
              measuredAt >= current.plan.notBeforeAt,
              measuredAt >= now - Self.staleHeartRateMilliseconds,
              measuredAt <= now + Self.maximumFutureSkewMilliseconds else {
            // Match the server evaluator: an invalid/stale point never enters
            // the rolling median and resets only the sustained hold. Prior
            // valid decision points remain available for the next fresh point.
            belowTargetSince = nil
            return
        }
        // HeartRateRelay uploads the nearest integer BPM. Make the wrist-side
        // recovery decision from that same value, including threshold edges.
        let decisionBpm = Double(Int(bpm.rounded()))
        if let previous = heartRatePoints.last,
           measuredAt - previous.measuredAt > Self.maximumSustainedSampleGapMilliseconds {
            clearHeartRateProgress()
        }
        heartRatePoints.append(HeartRatePoint(bpm: decisionBpm, measuredAt: measuredAt))
        heartRatePoints.removeAll { $0.measuredAt < now - Self.staleHeartRateMilliseconds }
        if heartRatePoints.count > 5 {
            heartRatePoints.removeFirst(heartRatePoints.count - 5)
        }

        let smoothed = median(heartRatePoints.map(\.bpm))
        guard heartRatePoints.count >= 2, smoothed <= targetBpm else {
            belowTargetSince = nil
            publishLocalState(message: "Recovering · \(Int(smoothed.rounded())) BPM")
            return
        }
        if belowTargetSince == nil {
            belowTargetSince = measuredAt
        }
        let sustainedFor = measuredAt - (belowTargetSince ?? measuredAt)
        publishLocalState(message: "Target · \(Int(smoothed.rounded())) BPM")
        guard sustainedFor >= Self.sustainedTargetMilliseconds else { return }
        becomeReady(trigger: .target, at: measuredAt)
    }

    func setWorkoutOwnsCue(_ ownsCue: Bool) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.setWorkoutOwnsCue(ownsCue) }
            return
        }
        workoutOwnsCue = ownsCue
        if !ownsCue {
            cueOwnershipOffered = false
            if let current = persisted, current.phase != "ready" {
                sendStatus(state: current.phase, message: "Recovery set")
            }
        } else if let current = persisted, current.phase != "ready" {
            sendStatus(state: current.phase, message: "Recovery set")
        }
    }

    func connectivityReachabilityDidChange(_ reachable: Bool) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.connectivityReachabilityDidChange(reachable)
            }
            return
        }
        if !reachable {
            cueOwnershipOffered = false
        } else if workoutOwnsCue, let current = persisted, current.phase != "ready" {
            sendStatus(state: current.phase, message: "Recovery set")
        }
    }

    private func apply(
        _ plan: RecoveryAlertWirePlan,
        allowTombstoneResume: Bool = false
    ) {
        dispatchPrecondition(condition: .onQueue(.main))
        if let tombstone = tombstones.last(where: { $0.matches(plan) }) {
            guard allowTombstoneResume,
                  tombstone.allowForegroundResume,
                  !tombstone.terminal,
                  plan.issuedAt >= tombstone.issuedAt else { return }
            // Only an authenticated foreground web schedule can explicitly
            // resume the unchanged server episode after an account boundary.
            // Background relay/queued messages remain unable to resurrect it.
            tombstones.removeAll { $0.matches(plan) }
            persistTombstones()
        }

        if let current = persisted,
           current.plan.accountId == plan.accountId,
           !sameEpisode(current.plan, plan) {
            // WatchConnectivity may deliver the direct message and queued
            // transfer out of order. A prior repetition can never replace the
            // newer repetition for the same exact account.
            guard plan.startedAt > current.plan.startedAt
                    || (plan.startedAt == current.plan.startedAt
                        && plan.issuedAt > current.plan.issuedAt) else { return }
        }

        if var current = persisted, sameEpisode(current.plan, plan) {
            guard plan.issuedAt >= current.plan.issuedAt else { return }
            if sameRevision(current.plan, plan) {
                current.plan = plan
                persisted = current
                persist()
                if current.phase != "ready" {
                    sendStatus(state: current.phase, message: "Recovery set")
                }
                return
            }
            guard plan.issuedAt > current.plan.issuedAt else { return }

            if current.phase == "ready" {
                if plan.isServerReady, sameSchedule(current.plan, plan) {
                    // The server is confirming the target cue already delivered
                    // at the wrist. Update authority without a second haptic.
                    current.plan = plan
                    current.trigger = plan.alertTrigger ?? current.trigger
                    current.triggeredAt = plan.readyAt ?? current.triggeredAt
                    persisted = current
                    persist()
                    return
                }
                guard !plan.isServerReady,
                      advancesSchedule(plan, after: current.plan) else { return }
            }
        }
        if let current = persisted, !sameEpisode(current.plan, plan) {
            recordTombstone(
                for: current.plan,
                issuedAt: current.plan.issuedAt,
                allowForegroundResume: false,
                terminal: false
            )
        }
        tombstones.removeAll { $0.matches(plan) }
        persistTombstones()
        let preservesSensorProgress = persisted.map {
            sameEpisode($0.plan, plan)
                && $0.phase != "ready"
                && sameSchedule($0.plan, plan)
        } == true
        let phase = plan.mode == .heartRate || (plan.mode == .smart && plan.targetBpm != nil)
            ? "monitoring"
            : "scheduled"
        persisted = PersistedState(
            plan: plan,
            phase: phase,
            trigger: nil,
            triggeredAt: nil
        )
        if !preservesSensorProgress {
            clearHeartRateProgress()
        }
        cueOwnershipOffered = false
        persist()
        scheduleDeadline()

        if plan.isServerReady {
            becomeReady(
                trigger: plan.alertTrigger ?? .planned,
                at: plan.readyAt ?? Self.nowMilliseconds(),
                deliverCue: plan.alertTrigger != .manual
            )
            return
        }
        publishLocalState()
        sendStatus(state: phase, message: phase == "monitoring" ? "Watching recovery" : "Recovery set")
        evaluateDeadline()
    }

    private func handleCancel(_ message: [String: Any]) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let accountId = message["accountId"] as? String,
              let recoveryId = message["recoveryId"] as? String,
              let repetitionId = message["repetitionId"] as? String,
              let sessionId = message["sessionId"] as? String,
              let issuedAt = RecoveryAlertWirePlan.milliseconds(message["issuedAt"]),
              let allowForegroundResume = message["allowForegroundResume"] as? Bool,
              let terminal = message["terminal"] as? Bool,
              RecoveryAlertWirePlan.validAccountId(accountId),
              RecoveryAlertWirePlan.validId(recoveryId),
              RecoveryAlertWirePlan.validId(repetitionId),
              RecoveryAlertWirePlan.validId(sessionId) else { return }
        guard let current = persisted,
              current.plan.accountId == accountId,
              current.plan.recoveryId == recoveryId,
              current.plan.repetitionId == repetitionId,
              current.plan.sessionId == sessionId else {
            recordTombstone(
                accountId: accountId,
                recoveryId: recoveryId,
                repetitionId: repetitionId,
                sessionId: sessionId,
                issuedAt: issuedAt,
                allowForegroundResume: allowForegroundResume,
                terminal: terminal
            )
            return
        }
        guard issuedAt >= current.plan.issuedAt else { return }
        recordTombstone(
            for: current.plan,
            issuedAt: issuedAt,
            allowForegroundResume: allowForegroundResume,
            terminal: terminal
        )
        sendStatus(state: "cancelled", message: "Recovery stopped")
        clear()
    }

    private func applyServerCancellation(_ plan: RecoveryAlertWirePlan) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let current = persisted else {
            recordTombstone(
                for: plan,
                issuedAt: plan.issuedAt,
                allowForegroundResume: false,
                terminal: true
            )
            return
        }
        guard sameEpisode(current.plan, plan),
              plan.issuedAt >= current.plan.issuedAt else {
            recordTombstone(
                for: plan,
                issuedAt: plan.issuedAt,
                allowForegroundResume: false,
                terminal: true
            )
            return
        }
        recordTombstone(
            for: current.plan,
            issuedAt: plan.issuedAt,
            allowForegroundResume: false,
            terminal: true
        )
        sendStatus(state: "cancelled", message: "Recovery stopped")
        clear()
    }

    private func scheduleDeadline() {
        deadlineTimer?.cancel()
        deadlineTimer = nil
        guard let current = persisted, current.phase != "ready" else { return }
        let remaining = current.plan.deadlineAt - Self.nowMilliseconds()
        if remaining <= 0 {
            evaluateDeadline()
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(
            deadline: .now() + .milliseconds(Int(remaining)),
            leeway: .milliseconds(150)
        )
        timer.setEventHandler { [weak self] in self?.evaluateDeadline() }
        deadlineTimer = timer
        timer.resume()
    }

    private func evaluateDeadline() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let current = persisted,
              current.phase != "ready",
              Self.nowMilliseconds() >= current.plan.deadlineAt else { return }
        let trigger: RecoveryAlertWireTrigger
        switch current.plan.mode {
        case .timer, .smart:
            trigger = current.plan.plannedReadyAt == nil ? .fallback : .planned
        case .heartRate:
            trigger = .fallback
        }
        becomeReady(trigger: trigger, at: current.plan.deadlineAt)
    }

    private func becomeReady(
        trigger: RecoveryAlertWireTrigger,
        at triggeredAt: Int64,
        deliverCue: Bool = true
    ) {
        guard var current = persisted, current.phase != "ready" else { return }
        current.phase = "ready"
        current.trigger = trigger
        current.triggeredAt = triggeredAt
        persisted = current
        deadlineTimer?.cancel()
        deadlineTimer = nil
        clearHeartRateProgress()
        persist()

        // One restrained haptic per exact recovery/repetition identity. A
        // server-confirmed Start anyway is deliberately silent.
        let watchDeliversCue = deliverCue
            && workoutOwnsCue
            && cueOwnershipOffered
            && WCSession.isSupported()
            && WCSession.default.isReachable
        if watchDeliversCue {
            WKInterfaceDevice.current().play(.notification)
        }
        publishLocalState(message: "READY")
        if deliverCue {
            sendReady(current, cueDelivered: watchDeliversCue)
        }
    }

    private func sendReady(_ current: PersistedState, cueDelivered: Bool) {
        guard let trigger = current.trigger,
              let triggeredAt = current.triggeredAt,
              WCSession.isSupported() else { return }
        let event = RecoveryAlertWireEvent(
            version: RecoveryAlertWirePlan.currentVersion,
            accountId: current.plan.accountId,
            recoveryId: current.plan.recoveryId,
            repetitionId: current.plan.repetitionId,
            sessionId: current.plan.sessionId,
            issuedAt: current.plan.issuedAt,
            mode: current.plan.mode,
            notBeforeAt: current.plan.notBeforeAt,
            plannedReadyAt: current.plan.plannedReadyAt,
            fallbackAt: current.plan.fallbackAt,
            targetBpm: current.plan.targetBpm,
            trigger: trigger,
            triggeredAt: triggeredAt,
            cueDelivered: cueDelivered
        ).dictionary()
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated { connectivity.activate() }
        connectivity.transferUserInfo(event)
        if connectivity.isReachable {
            connectivity.sendMessage(event, replyHandler: nil, errorHandler: nil)
        }
    }

    private func sendStatus(state: String, message: String) {
        guard let current = persisted, WCSession.isSupported() else { return }
        let ownershipNonce = UUID().uuidString.lowercased()
        var value: [String: Any] = [
            "kind": Self.statusKind,
            "version": RecoveryAlertWirePlan.currentVersion,
            "accountId": current.plan.accountId,
            "recoveryId": current.plan.recoveryId,
            "repetitionId": current.plan.repetitionId,
            "sessionId": current.plan.sessionId,
            "issuedAt": Double(current.plan.issuedAt),
            "mode": current.plan.mode.rawValue,
            "notBeforeAt": Double(current.plan.notBeforeAt),
            "plannedReadyAt": current.plan.plannedReadyAt.map(Double.init) ?? NSNull(),
            "fallbackAt": Double(current.plan.fallbackAt),
            "targetBpm": current.plan.targetBpm ?? NSNull(),
            "state": state,
            "triggeredAt": Double(Self.nowMilliseconds()),
            "message": message,
            "ownershipNonce": ownershipNonce,
        ]
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated { connectivity.activate() }
        let offersWatchCue = workoutOwnsCue
            && ["scheduled", "monitoring"].contains(state)
            && current.plan.deadlineAt - Self.nowMilliseconds() >= 3_000
            && connectivity.isReachable
        cueOwnershipOffered = false
        value["cueOwner"] = offersWatchCue ? "watch" : "phone"
        if connectivity.isReachable {
            let offeredPlan = current.plan
            connectivity.sendMessage(value, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    guard let self,
                          offersWatchCue,
                          reply["accepted"] as? Bool == true,
                          reply["cueOwner"] as? String == "watch",
                          reply["ownershipNonce"] as? String == ownershipNonce,
                          reply["accountId"] as? String == offeredPlan.accountId,
                          reply["recoveryId"] as? String == offeredPlan.recoveryId,
                          reply["repetitionId"] as? String == offeredPlan.repetitionId,
                          reply["sessionId"] as? String == offeredPlan.sessionId,
                          let latest = self.persisted,
                          latest.phase != "ready",
                          self.sameEpisode(latest.plan, offeredPlan),
                          self.sameSchedule(latest.plan, offeredPlan),
                          self.workoutOwnsCue,
                          connectivity.isReachable else { return }
                    self.cueOwnershipOffered = true
                }
            }, errorHandler: { [weak self] _ in
                DispatchQueue.main.async { self?.cueOwnershipOffered = false }
            })
        }
    }

    private func restore() {
        defaults.removeObject(forKey: legacyLastIssuedAtKey)
        bindingGeneration = max(
            0,
            Int64(defaults.double(forKey: bindingGenerationKey).rounded())
        )
        if let storedAccountId = defaults.string(forKey: boundAccountKey),
           RecoveryAlertWirePlan.validAccountId(storedAccountId) {
            boundAccountId = storedAccountId
        } else {
            defaults.removeObject(forKey: boundAccountKey)
        }
        if let tombstoneData = defaults.data(forKey: tombstonesKey),
           let decoded = try? decoder.decode([RevisionTombstone].self, from: tombstoneData) {
            tombstones = Array(decoded.filter {
                RecoveryAlertWirePlan.validAccountId($0.accountId)
                    && RecoveryAlertWirePlan.validId($0.recoveryId)
                    && RecoveryAlertWirePlan.validId($0.repetitionId)
                    && RecoveryAlertWirePlan.validId($0.sessionId)
                    && $0.issuedAt >= 0
            }.suffix(maximumTombstones))
        } else {
            defaults.removeObject(forKey: tombstonesKey)
        }
        guard let data = defaults.data(forKey: defaultsKey),
              let state = try? decoder.decode(PersistedState.self, from: data),
              state.version == 1,
              state.plan.isValid else {
            defaults.removeObject(forKey: defaultsKey)
            return
        }
        persisted = state
        if boundAccountId == nil {
            // One-time migration from the first Recovery Alert build.
            boundAccountId = state.plan.accountId
            bindingGeneration = max(1, bindingGeneration)
            defaults.set(state.plan.accountId, forKey: boundAccountKey)
            defaults.set(bindingGeneration, forKey: bindingGenerationKey)
        }
        DispatchQueue.main.async { [weak self] in
            self?.scheduleDeadline()
            self?.publishLocalState()
        }
    }

    private func persist() {
        guard let persisted,
              let data = try? encoder.encode(persisted) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    private func clear() {
        deadlineTimer?.cancel()
        deadlineTimer = nil
        persisted = nil
        cueOwnershipOffered = false
        clearHeartRateProgress()
        defaults.removeObject(forKey: defaultsKey)
        publishLocalState(message: "Recovery Alert ready")
    }

    private func clearHeartRateProgress() {
        heartRatePoints.removeAll(keepingCapacity: true)
        belowTargetSince = nil
    }

    private func recordTombstone(
        for plan: RecoveryAlertWirePlan,
        issuedAt: Int64,
        allowForegroundResume: Bool,
        terminal: Bool
    ) {
        recordTombstone(
            accountId: plan.accountId,
            recoveryId: plan.recoveryId,
            repetitionId: plan.repetitionId,
            sessionId: plan.sessionId,
            issuedAt: issuedAt,
            allowForegroundResume: allowForegroundResume,
            terminal: terminal
        )
    }

    private func recordTombstone(
        accountId: String,
        recoveryId: String,
        repetitionId: String,
        sessionId: String,
        issuedAt: Int64,
        allowForegroundResume: Bool,
        terminal: Bool
    ) {
        let matchesIdentity: (RevisionTombstone) -> Bool = {
            $0.accountId == accountId
                && $0.recoveryId == recoveryId
                && $0.repetitionId == repetitionId
                && $0.sessionId == sessionId
        }
        let prior = tombstones.last(where: matchesIdentity)
        if let prior, prior.issuedAt > issuedAt { return }
        let isTerminal = prior?.terminal == true || terminal
        let canResume = !isTerminal
            && (prior?.allowForegroundResume == true || allowForegroundResume)
        tombstones.removeAll(where: matchesIdentity)
        tombstones.append(RevisionTombstone(
            accountId: accountId,
            recoveryId: recoveryId,
            repetitionId: repetitionId,
            sessionId: sessionId,
            issuedAt: issuedAt,
            allowForegroundResume: canResume,
            terminal: isTerminal
        ))
        if tombstones.count > maximumTombstones {
            tombstones.removeFirst(tombstones.count - maximumTombstones)
        }
        persistTombstones()
    }

    private func persistTombstones() {
        guard let data = try? encoder.encode(tombstones) else { return }
        defaults.set(data, forKey: tombstonesKey)
    }

    private func publishLocalState(message: String? = nil) {
        let phase = persisted?.phase ?? "idle"
        let defaultMessage: String
        switch phase {
        case "ready": defaultMessage = "READY"
        case "monitoring": defaultMessage = "Watching recovery"
        case "scheduled": defaultMessage = "Recovery set"
        default: defaultMessage = "Recovery Alert ready"
        }
        onStateChange?(phase, message ?? defaultMessage)
    }

    private func sameEpisode(_ lhs: RecoveryAlertWirePlan, _ rhs: RecoveryAlertWirePlan) -> Bool {
        lhs.accountId == rhs.accountId
            && lhs.recoveryId == rhs.recoveryId
            && lhs.repetitionId == rhs.repetitionId
            && lhs.sessionId == rhs.sessionId
            && lhs.startedAt == rhs.startedAt
    }

    private func sameRevision(_ lhs: RecoveryAlertWirePlan, _ rhs: RecoveryAlertWirePlan) -> Bool {
        lhs.notBeforeAt == rhs.notBeforeAt
            && lhs.plannedReadyAt == rhs.plannedReadyAt
            && lhs.fallbackAt == rhs.fallbackAt
            && lhs.readyAt == rhs.readyAt
            && lhs.targetBpm == rhs.targetBpm
            && lhs.serverState == rhs.serverState
            && lhs.alertTrigger == rhs.alertTrigger
    }

    private func sameSchedule(_ lhs: RecoveryAlertWirePlan, _ rhs: RecoveryAlertWirePlan) -> Bool {
        lhs.activityType == rhs.activityType
            && lhs.mode == rhs.mode
            && lhs.notBeforeAt == rhs.notBeforeAt
            && lhs.plannedReadyAt == rhs.plannedReadyAt
            && lhs.fallbackAt == rhs.fallbackAt
            && lhs.targetBpm == rhs.targetBpm
    }

    private func advancesSchedule(
        _ candidate: RecoveryAlertWirePlan,
        after current: RecoveryAlertWirePlan
    ) -> Bool {
        candidate.deadlineAt > current.deadlineAt
            && candidate.fallbackAt > current.fallbackAt
    }

    private func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return 0 }
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2)
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle]
    }

    private static func nowMilliseconds() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1_000).rounded())
    }
}
