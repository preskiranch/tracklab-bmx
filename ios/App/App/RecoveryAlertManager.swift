import Foundation
import UIKit
import UserNotifications
import WatchConnectivity

protocol RecoveryAlertManagerObserver: AnyObject {
    func recoveryAlertManager(
        _ manager: RecoveryAlertManager,
        didEmit event: [String: Any],
        ready: Bool
    )
}

enum RecoveryAlertManagerError: LocalizedError {
    case invalidPlan
    case stalePlan
    case identityMismatch

    var errorDescription: String? {
        switch self {
        case .invalidPlan:
            return "Recovery Alert received an invalid recovery plan."
        case .stalePlan:
            return "Recovery Alert ignored an older repetition."
        case .identityMismatch:
            return "Recovery Alert belongs to a different athlete or repetition."
        }
    }
}

/// Owns absolute local notifications on iPhone and iPad and forwards the same
/// exact recovery identity to a paired Watch. Notification permission is only
/// requested after an explicit web-layer call from a user action.
final class RecoveryAlertManager: NSObject {
    static let shared = RecoveryAlertManager()
    static let stateDidChange = Notification.Name("TrackLabRecoveryAlertStateDidChange")

    private struct StoredRecord: Codable {
        var version = 1
        var plan: RecoveryAlertWirePlan
        var phase: String
        var trigger: RecoveryAlertWireTrigger?
        var triggeredAt: Int64?
        var notificationId: String
        var transportSessionId: String?
        var watchOwnsCue: Bool?
    }

    /// A bounded, opaque identity/revision fence prevents an already queued
    /// relay response from resurrecting an episode after Stop or sign-out.
    /// Foreground JavaScript may explicitly resume the unchanged authoritative
    /// episode after the same account signs in again.
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

    private static let persistedKey = "TrackLabRecoveryAlertRecordsV1"
    private static let tombstonesKey = "TrackLabRecoveryAlertTombstonesV1"
    private static let boundAccountKey = "TrackLabRecoveryAlertBoundAccountV1"
    private static let bindingGenerationKey = "TrackLabRecoveryAlertBindingGenerationV1"
    private static let notificationCategory = "TRACKLAB_RECOVERY_READY"
    private static let notificationPrefix = "tracklab.recovery."
    private static let watchStatusKind = "tracklab-recovery-status"
    private static let maximumRecords = 32

    private let defaults = UserDefaults.standard
    private let center = UNUserNotificationCenter.current()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let observerLock = NSLock()
    private let observers = NSHashTable<AnyObject>.weakObjects()
    private var records: [String: StoredRecord] = [:]
    private var tombstones: [RevisionTombstone] = []
    private var timers: [String: DispatchSourceTimer] = [:]
    private var boundAccountId: String?
    private var bindingGeneration: Int64 = 0
    private var configured = false
    private var watchWorkoutActive = false
    private var watchConnectivityReachable = false
    private var lifecycleObserver: NSObjectProtocol?
    private var permissionStatus = "not-determined"

    private override init() {
        super.init()
    }

    func configureAtLaunch() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.configureAtLaunch() }
            return
        }
        guard !configured else {
            reconcileDeadlines()
            return
        }
        configured = true
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Self.notificationCategory,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ])
        restore()
        refreshPermissionStatus(completion: nil)
        lifecycleObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.reconcileDeadlines()
            self?.refreshPermissionStatus(completion: nil)
        }
        reconcileDeadlines()
    }

    func addObserver(_ observer: RecoveryAlertManagerObserver) {
        observerLock.lock()
        observers.add(observer)
        observerLock.unlock()
    }

    func removeObserver(_ observer: RecoveryAlertManagerObserver) {
        observerLock.lock()
        observers.remove(observer)
        observerLock.unlock()
    }

    func requestPermission(completion: @escaping ([String: Any]) -> Void) {
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            self.refreshPermissionStatus(completion: completion)
        }
    }

    func getPermissionStatus(completion: @escaping ([String: Any]) -> Void) {
        refreshPermissionStatus(completion: completion)
    }

    func schedule(
        plan: RecoveryAlertWirePlan,
        transportSessionId: String? = nil,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard plan.isValid else {
            completion(.failure(RecoveryAlertManagerError.invalidPlan))
            return
        }
        DispatchQueue.main.async {
            self.configureAtLaunch()
            // A plan is accepted only after authenticated web hydration has
            // atomically bound this native process to the exact opaque account.
            // In particular, nil after sign-out is a closed boundary: a relay
            // response already dispatched to main must not re-arm the old account.
            guard self.boundAccountId == plan.accountId else {
                completion(.failure(RecoveryAlertManagerError.identityMismatch))
                return
            }
            var consumedForegroundResume = false
            if plan.serverState == "cancelled" {
                completion(self.applyServerCancellation(plan))
                return
            }
            if let tombstone = self.tombstones.last(where: { $0.matches(plan) }) {
                guard transportSessionId == nil,
                      tombstone.allowForegroundResume,
                      !tombstone.terminal,
                      plan.issuedAt >= tombstone.issuedAt else {
                    completion(.failure(RecoveryAlertManagerError.stalePlan))
                    return
                }
                // Only an authenticated foreground web schedule may resume an
                // unchanged server episode after an account-boundary clear.
                self.tombstones.removeAll { $0.matches(plan) }
                self.persist()
                consumedForegroundResume = true
            }
            let priorRecord = self.records[plan.accountId]
            if let existing = self.records[plan.accountId] {
                guard existing.plan.startedAt <= plan.startedAt else {
                    completion(.failure(RecoveryAlertManagerError.stalePlan))
                    return
                }
                let isSameEpisode = self.sameEpisode(existing.plan, plan)
                if isSameEpisode {
                    guard plan.issuedAt >= existing.plan.issuedAt else {
                        completion(.failure(RecoveryAlertManagerError.stalePlan))
                        return
                    }

                    if self.sameRevision(existing.plan, plan) {
                        // A relay repeats an unchanged directive with every
                        // accepted sample. Attach its transport session without
                        // replacing the timer, HR window, or an already-delivered cue.
                        var refreshed = existing
                        refreshed.plan = plan
                        refreshed.transportSessionId = transportSessionId
                            ?? existing.transportSessionId
                        self.records[plan.accountId] = refreshed
                        self.persist()
                        if refreshed.phase == "ready" {
                            self.enqueueAcknowledgementIfNeeded(refreshed)
                        }
                        completion(.success(self.stateDictionary(refreshed)))
                        return
                    }

                    guard plan.issuedAt > existing.plan.issuedAt else {
                        completion(.failure(RecoveryAlertManagerError.stalePlan))
                        return
                    }

                    if existing.phase == "ready" {
                        if plan.isServerReady,
                           self.sameSchedule(existing.plan, plan) {
                            // The Watch/iPhone may have already delivered READY
                            // before the server echoes authoritative readyAt.
                            // Store that confirmation without a second notification.
                            var confirmed = existing
                            confirmed.plan = plan
                            confirmed.trigger = plan.alertTrigger ?? existing.trigger
                            confirmed.triggeredAt = plan.readyAt ?? existing.triggeredAt
                            confirmed.transportSessionId = transportSessionId
                                ?? existing.transportSessionId
                            self.records[plan.accountId] = confirmed
                            self.persist()
                            self.sendWatchPlan(
                                plan,
                                allowTombstoneResume: consumedForegroundResume
                            )
                            if confirmed.trigger == .manual {
                                HeartRateRelay.shared.discardRecoveryAcknowledgements(
                                    for: confirmed.plan
                                )
                            } else {
                                self.enqueueAcknowledgementIfNeeded(confirmed)
                            }
                            completion(.success(self.stateDictionary(confirmed)))
                            return
                        }

                        guard !plan.isServerReady,
                              self.advancesSchedule(plan, after: existing.plan) else {
                            completion(.failure(RecoveryAlertManagerError.stalePlan))
                            return
                        }
                    }

                    HeartRateRelay.shared.discardRecoveryAcknowledgements(for: existing.plan)
                    if !self.preservesScheduledNotification(existing.plan, for: plan) {
                        self.cancelNotification(existing)
                    }
                    self.cancelTimer(accountId: plan.accountId)
                } else {
                    self.cancelNotification(existing)
                    self.cancelTimer(accountId: plan.accountId)
                    HeartRateRelay.shared.discardRecoveryAcknowledgements(for: existing.plan)
                    self.sendWatchCancel(
                        existing.plan,
                        allowForegroundResume: false,
                        terminal: false
                    )
                    self.recordTombstone(
                        for: existing.plan,
                        allowForegroundResume: false,
                        terminal: false
                    )
                    self.emit(existing, state: "cancelled", message: "Recovery stopped", ready: false)
                }
            }

            let existing = self.records[plan.accountId]
            let preservesProgress = existing.map {
                self.sameEpisode($0.plan, plan)
                    && $0.phase != "ready"
                    && self.sameSchedule($0.plan, plan)
            } == true
            let phase = plan.mode == .heartRate || (plan.mode == .smart && plan.targetBpm != nil)
                ? "monitoring"
                : "scheduled"
            var record = StoredRecord(
                plan: plan,
                phase: phase,
                trigger: preservesProgress ? existing?.trigger : nil,
                triggeredAt: preservesProgress ? existing?.triggeredAt : nil,
                notificationId: preservesProgress
                    ? (existing?.notificationId ?? self.makeNotificationId())
                    : self.makeNotificationId(),
                transportSessionId: transportSessionId ?? existing?.transportSessionId,
                watchOwnsCue: preservesProgress ? existing?.watchOwnsCue : false
            )
            if preservesProgress, existing?.phase == "ready" {
                record.phase = "ready"
            }
            self.records[plan.accountId] = record
            self.pruneRecords()
            self.persist()

            if plan.isServerReady {
                // The Watch must receive the same authoritative transition even
                // when no foreground JavaScript is alive on the paired iPhone.
                self.sendWatchPlan(
                    plan,
                    allowTombstoneResume: consumedForegroundResume
                )
                self.markReady(
                    accountId: plan.accountId,
                    trigger: plan.alertTrigger ?? .planned,
                    triggeredAt: plan.readyAt ?? Self.nowMilliseconds(),
                    showImmediateNotification: self.shouldShowImmediateNotification(
                        for: plan,
                        replacing: priorRecord
                    )
                )
            } else {
                self.scheduleNotification(record)
                self.scheduleTimer(record)
                self.sendWatchPlan(
                    plan,
                    allowTombstoneResume: consumedForegroundResume
                )
                self.emit(
                    record,
                    state: phase,
                    message: phase == "monitoring" ? "Watching recovery" : "Recovery set",
                    ready: false
                )
            }
            completion(.success(self.stateDictionary(self.records[plan.accountId] ?? record)))
        }
    }

    func state(accountId: String) -> [String: Any] {
        dispatchPrecondition(condition: .onQueue(.main))
        reconcileDeadline(accountId: accountId)
        guard let record = records[accountId] else { return idleState() }
        return stateDictionary(record)
    }

    func cancel(
        accountId: String,
        recoveryId: String,
        repetitionId: String
    ) -> Result<[String: Any], Error> {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let record = records[accountId],
              record.plan.recoveryId == recoveryId,
              record.plan.repetitionId == repetitionId else {
            return .failure(RecoveryAlertManagerError.identityMismatch)
        }
        cancelNotification(record)
        cancelTimer(accountId: accountId)
        HeartRateRelay.shared.discardRecoveryAcknowledgements(for: record.plan)
        sendWatchCancel(record.plan, allowForegroundResume: false, terminal: true)
        recordTombstone(for: record.plan, allowForegroundResume: false, terminal: true)
        var cancelled = record
        cancelled.phase = "cancelled"
        cancelled.trigger = nil
        cancelled.triggeredAt = Self.nowMilliseconds()
        records.removeValue(forKey: accountId)
        persist()
        emit(cancelled, state: "cancelled", message: "Recovery stopped", ready: false)
        return .success(stateDictionary(cancelled))
    }

    /// Clears every device-local episode when the signed-in account changes.
    /// This deliberately does not mutate server episodes; it only prevents a
    /// prior athlete's timer or Watch cue from surviving into the next account.
    func clearAllEpisodes(completion: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            self.configureAtLaunch()
            let existing = Array(self.records.values)
            existing.forEach { record in
                self.cancelNotification(record)
                self.cancelTimer(accountId: record.plan.accountId)
                HeartRateRelay.shared.discardRecoveryAcknowledgements(for: record.plan)
                self.sendWatchCancel(
                    record.plan,
                    allowForegroundResume: true,
                    terminal: false
                )
                self.recordTombstone(
                    for: record.plan,
                    allowForegroundResume: true,
                    terminal: false
                )
            }
            self.records.removeAll()
            self.timers.values.forEach { $0.cancel() }
            self.timers.removeAll()
            self.boundAccountId = nil
            self.bindingGeneration += 1
            self.defaults.removeObject(forKey: Self.boundAccountKey)
            self.defaults.set(self.bindingGeneration, forKey: Self.bindingGenerationKey)
            self.sendWatchAccountBoundary(
                accountId: nil,
                generation: self.bindingGeneration
            )
            self.persist()
            NotificationCenter.default.post(name: Self.stateDidChange, object: self)
            completion([
                "version": RecoveryAlertWirePlan.currentVersion,
                "supported": true,
                "clearedCount": existing.count,
            ])
        }
    }

    /// Establishes the authenticated opaque account for this native process.
    /// Same-account records survive relaunch; every foreign record is cancelled
    /// locally and on Watch before the new account can schedule.
    func bindAccount(_ accountId: String, completion: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            self.configureAtLaunch()
            let foreign = self.records.values.filter { $0.plan.accountId != accountId }
            foreign.forEach { record in
                self.cancelNotification(record)
                self.cancelTimer(accountId: record.plan.accountId)
                HeartRateRelay.shared.discardRecoveryAcknowledgements(for: record.plan)
                self.sendWatchCancel(
                    record.plan,
                    allowForegroundResume: false,
                    terminal: true
                )
                self.recordTombstone(
                    for: record.plan,
                    allowForegroundResume: false,
                    terminal: true
                )
                self.records.removeValue(forKey: record.plan.accountId)
            }
            self.boundAccountId = accountId
            self.bindingGeneration += 1
            self.defaults.set(accountId, forKey: Self.boundAccountKey)
            self.defaults.set(self.bindingGeneration, forKey: Self.bindingGenerationKey)
            self.sendWatchAccountBoundary(
                accountId: accountId,
                generation: self.bindingGeneration
            )
            self.persist()
            completion([
                "version": RecoveryAlertWirePlan.currentVersion,
                "supported": true,
                "accountId": accountId,
                "clearedCount": foreign.count,
            ])
        }
    }

    /// A running/paused mirrored Watch workout owns the single physical cue.
    /// Removing the iPhone request also prevents iOS from mirroring a second
    /// notification haptic to that same Watch. If the workout ends first, the
    /// iPhone restores its absolute local fallback without changing readyAt.
    func setWatchWorkoutActive(_ active: Bool) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.setWatchWorkoutActive(active) }
            return
        }
        guard watchWorkoutActive != active else { return }
        watchWorkoutActive = active
        if active {
            // Re-offer every exact active plan. This covers the narrow case in
            // which Watch's first receipt arrived before HealthKit reported the
            // mirrored workout active on iPhone.
            records.values.filter { $0.phase != "ready" }.forEach {
                sendWatchPlan($0.plan, allowTombstoneResume: false)
            }
            return
        }
        restorePhoneCueOwnership()
    }

    func setWatchConnectivityReachable(_ reachable: Bool) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.setWatchConnectivityReachable(reachable) }
            return
        }
        guard watchConnectivityReachable != reachable else { return }
        watchConnectivityReachable = reachable
        if !reachable {
            restorePhoneCueOwnership()
        }
    }

    private func restorePhoneCueOwnership() {
        for (accountId, record) in records where record.phase != "ready" {
            if record.watchOwnsCue == true {
                var restored = record
                restored.watchOwnsCue = false
                records[accountId] = restored
                scheduleNotification(restored)
            }
        }
        persist()
    }

    /// Parses only the server-owned `recoveryAlert` envelope returned by an
    /// authenticated heart-rate ingest response. A raw profile identifier is
    /// never synthesized here; the opaque server accountId must be present.
    func applyRelayDirective(
        _ data: Data,
        transportSessionId: String,
        completion: @escaping () -> Void = {}
    ) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let directive = object["recoveryAlert"] as? [String: Any] else {
            completion()
            return
        }
        var wire = directive
        wire["kind"] = RecoveryAlertWirePlan.messageKind
        wire["action"] = "schedule"
        wire["recoveryId"] = directive["id"]
        guard let plan = RecoveryAlertWirePlan.fromDictionary(wire) else {
            completion()
            return
        }
        schedule(plan: plan, transportSessionId: transportSessionId) { _ in completion() }
    }

    @discardableResult
    func handleWatchMessage(_ value: [String: Any]) -> Bool {
        if value["kind"] as? String == RecoveryAlertWireEvent.messageKind {
            guard let event = RecoveryAlertWireEvent.fromDictionary(value) else { return true }
            DispatchQueue.main.async { self.applyWatchReady(event) }
            return true
        }
        if value["kind"] as? String == Self.watchStatusKind {
            // A one-way status may update display state, but it cannot transfer
            // physical-cue ownership because Watch would never learn whether
            // the exact schedule was accepted.
            DispatchQueue.main.async {
                _ = self.applyWatchStatus(value, allowCueOwnership: false)
            }
            return true
        }
        return false
    }

    @discardableResult
    func handleWatchMessage(
        _ value: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) -> Bool {
        guard value["kind"] as? String == Self.watchStatusKind else {
            let handled = handleWatchMessage(value)
            replyHandler([
                "version": RecoveryAlertWirePlan.currentVersion,
                "accepted": handled,
                "cueOwner": "phone",
            ])
            return handled
        }
        DispatchQueue.main.async {
            let accepted = self.applyWatchStatus(value, allowCueOwnership: true)
            replyHandler([
                "version": RecoveryAlertWirePlan.currentVersion,
                "accepted": accepted,
                "cueOwner": accepted ? "watch" : "phone",
                "ownershipNonce": value["ownershipNonce"] as? String ?? "",
                "accountId": value["accountId"] as? String ?? "",
                "recoveryId": value["recoveryId"] as? String ?? "",
                "repetitionId": value["repetitionId"] as? String ?? "",
                "sessionId": value["sessionId"] as? String ?? "",
            ])
        }
        return true
    }

    private func applyWatchReady(_ event: RecoveryAlertWireEvent) {
        guard let record = records[event.accountId],
              event.matchesSchedule(record.plan),
              record.phase != "ready" else { return }
        let needsPhoneFailover = record.watchOwnsCue == true && !event.cueDelivered
        if needsPhoneFailover {
            var restored = record
            restored.watchOwnsCue = false
            records[event.accountId] = restored
            persist()
        }
        let isEarlyTarget = event.trigger == .target && event.triggeredAt < record.plan.deadlineAt
        markReady(
            accountId: event.accountId,
            trigger: event.trigger,
            triggeredAt: event.triggeredAt,
            showImmediateNotification: isEarlyTarget || needsPhoneFailover
        )
    }

    @discardableResult
    private func applyWatchStatus(
        _ value: [String: Any],
        allowCueOwnership: Bool
    ) -> Bool {
        guard let accountId = value["accountId"] as? String,
              let recoveryId = value["recoveryId"] as? String,
              let repetitionId = value["repetitionId"] as? String,
              let sessionId = value["sessionId"] as? String,
              let issuedAt = RecoveryAlertWirePlan.milliseconds(value["issuedAt"]),
              let rawMode = value["mode"] as? String,
              let mode = RecoveryAlertWireMode(rawValue: rawMode),
              let notBeforeAt = RecoveryAlertWirePlan.milliseconds(value["notBeforeAt"]),
              let fallbackAt = RecoveryAlertWirePlan.milliseconds(value["fallbackAt"]),
              let state = value["state"] as? String,
              ["scheduled", "monitoring", "cancelled"].contains(state),
              let record = records[accountId],
              record.plan.recoveryId == recoveryId,
              record.plan.repetitionId == repetitionId,
              record.plan.sessionId == sessionId,
              issuedAt <= record.plan.issuedAt,
              mode == record.plan.mode,
              notBeforeAt == record.plan.notBeforeAt,
              RecoveryAlertWirePlan.nullableMilliseconds(value["plannedReadyAt"])
                == record.plan.plannedReadyAt,
              fallbackAt == record.plan.fallbackAt,
              RecoveryAlertWirePlan.nullableDouble(value["targetBpm"])
                == record.plan.targetBpm,
              record.phase != "ready" else { return false }
        let watchRequestsCue = allowCueOwnership
            && value["cueOwner"] as? String == "watch"
            && (value["ownershipNonce"] as? String).map {
                RecoveryAlertWirePlan.validId($0)
            } == true
        watchConnectivityReachable = watchRequestsCue
        if watchRequestsCue,
           watchWorkoutActive,
           WCSession.default.isReachable,
           record.plan.deadlineAt - Self.nowMilliseconds() >= 3_000 {
            var owned = record
            owned.watchOwnsCue = true
            records[accountId] = owned
            cancelNotification(owned)
            persist()
        } else if record.watchOwnsCue == true {
            var restored = record
            restored.watchOwnsCue = false
            records[accountId] = restored
            scheduleNotification(restored)
            persist()
        }
        let message = (value["message"] as? String) ?? "Recovery updated"
        emit(records[accountId] ?? record, state: state, message: message, ready: false)
        return watchRequestsCue
            && watchWorkoutActive
            && WCSession.default.isReachable
            && record.plan.deadlineAt - Self.nowMilliseconds() >= 3_000
    }

    private func applyServerCancellation(
        _ plan: RecoveryAlertWirePlan
    ) -> Result<[String: Any], Error> {
        guard let existing = records[plan.accountId] else {
            // The iPhone process may have relaunched after its local record was
            // cleared while Watch still retained the exact episode.
            HeartRateRelay.shared.discardRecoveryAcknowledgements(for: plan)
            sendWatchCancel(plan, allowForegroundResume: false, terminal: true)
            recordTombstone(for: plan, allowForegroundResume: false, terminal: true)
            return .success(idleState())
        }
        guard sameEpisode(existing.plan, plan),
              plan.issuedAt >= existing.plan.issuedAt else {
            recordTombstone(for: plan, allowForegroundResume: false, terminal: true)
            return .failure(RecoveryAlertManagerError.stalePlan)
        }
        cancelNotification(existing)
        cancelTimer(accountId: plan.accountId)
        HeartRateRelay.shared.discardRecoveryAcknowledgements(for: existing.plan)
        sendWatchCancel(plan, allowForegroundResume: false, terminal: true)
        recordTombstone(for: plan, allowForegroundResume: false, terminal: true)
        var cancelled = existing
        cancelled.plan = plan
        cancelled.phase = "cancelled"
        cancelled.trigger = nil
        cancelled.triggeredAt = Self.nowMilliseconds()
        records.removeValue(forKey: plan.accountId)
        persist()
        emit(cancelled, state: "cancelled", message: "Recovery stopped", ready: false)
        return .success(stateDictionary(cancelled))
    }

    private func scheduleNotification(_ record: StoredRecord) {
        guard record.phase != "ready" else { return }
        guard record.watchOwnsCue != true else {
            cancelNotification(record)
            return
        }
        let content = notificationContent(record)
        let deadline = Date(timeIntervalSince1970: Double(record.plan.deadlineAt) / 1_000)
        let now = Date()
        let trigger: UNNotificationTrigger?
        if deadline <= now {
            trigger = nil
        } else {
            // Calendar components have whole-second precision. Round upward so
            // a xx.900 absolute deadline can never notify 900 ms early.
            let deliveryDate = Date(timeIntervalSince1970: ceil(deadline.timeIntervalSince1970))
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            var components = calendar.dateComponents(
                [.era, .year, .month, .day, .hour, .minute, .second],
                from: deliveryDate
            )
            components.calendar = calendar
            components.timeZone = calendar.timeZone
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        }
        center.add(UNNotificationRequest(
            identifier: record.notificationId,
            content: content,
            trigger: trigger
        ))
    }

    private func notificationContent(_ record: StoredRecord) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "Recovery Alert"
        content.body = "Recovery target reached — start when you feel ready."
        content.sound = .default
        content.categoryIdentifier = Self.notificationCategory
        content.threadIdentifier = "tracklab-recovery"
        content.userInfo = [
            "accountId": record.plan.accountId,
            "recoveryId": record.plan.recoveryId,
            "repetitionId": record.plan.repetitionId,
            "sessionId": record.plan.sessionId,
        ]
        // Ordinary notifications honor the athlete's notification and Focus
        // settings. TrackLab intentionally requests neither Time Sensitive nor
        // Critical Alerts capabilities, so build signing remains unchanged.
        return content
    }

    private func scheduleTimer(_ record: StoredRecord) {
        cancelTimer(accountId: record.plan.accountId)
        let remaining = record.plan.deadlineAt - Self.nowMilliseconds()
        if remaining <= 0 {
            markReady(
                accountId: record.plan.accountId,
                trigger: deadlineTrigger(record.plan),
                triggeredAt: record.plan.deadlineAt,
                showImmediateNotification: false
            )
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(
            deadline: .now() + .milliseconds(Int(remaining)),
            leeway: .milliseconds(200)
        )
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.markReady(
                accountId: record.plan.accountId,
                trigger: self.deadlineTrigger(record.plan),
                triggeredAt: record.plan.deadlineAt,
                showImmediateNotification: false
            )
        }
        timers[record.plan.accountId] = timer
        timer.resume()
    }

    private func markReady(
        accountId: String,
        trigger: RecoveryAlertWireTrigger,
        triggeredAt: Int64,
        showImmediateNotification: Bool
    ) {
        guard var record = records[accountId], record.phase != "ready" else { return }
        let normalizedTriggeredAt = trigger == .manual
            ? max(record.plan.startedAt, triggeredAt)
            : max(record.plan.notBeforeAt, triggeredAt)
        record.phase = "ready"
        record.trigger = trigger
        record.triggeredAt = normalizedTriggeredAt
        records[accountId] = record
        cancelTimer(accountId: accountId)
        if trigger == .manual {
            // Start anyway is an athlete decision, not a recovery cue. Remove
            // the scheduled request and update state without alerting again.
            cancelNotification(record)
            HeartRateRelay.shared.discardRecoveryAcknowledgements(for: record.plan)
        } else if record.watchOwnsCue == true {
            // WatchRecoveryAlertEngine owns the one restrained haptic while
            // its mirrored workout is alive. Do not create a notification that
            // iOS could mirror straight back to the same wrist.
            cancelNotification(record)
        } else if showImmediateNotification {
            cancelNotification(record)
            center.add(UNNotificationRequest(
                identifier: record.notificationId,
                content: notificationContent(record),
                trigger: nil
            ))
        }
        persist()
        emit(
            record,
            state: "ready",
            message: "Recovery target reached — start when you feel ready.",
            ready: true
        )
        enqueueAcknowledgementIfNeeded(record)
    }

    private func sendWatchPlan(
        _ plan: RecoveryAlertWirePlan,
        allowTombstoneResume: Bool
    ) {
        var value = plan.dictionary(
            action: allowTombstoneResume ? "resume" : "schedule"
        )
        value["accountBindingGeneration"] = Double(bindingGeneration)
        sendWatchMessage(value)
    }

    private func sendWatchCancel(
        _ plan: RecoveryAlertWirePlan,
        allowForegroundResume: Bool,
        terminal: Bool
    ) {
        sendWatchMessage([
            "kind": RecoveryAlertWirePlan.messageKind,
            "action": "cancel",
            "version": RecoveryAlertWirePlan.currentVersion,
            "accountId": plan.accountId,
            "recoveryId": plan.recoveryId,
            "repetitionId": plan.repetitionId,
            "sessionId": plan.sessionId,
            "issuedAt": Double(plan.issuedAt),
            "allowForegroundResume": allowForegroundResume,
            "terminal": terminal,
            "accountBindingGeneration": Double(bindingGeneration),
        ])
    }

    private func sendWatchAccountBoundary(accountId: String?, generation: Int64) {
        sendWatchMessage([
            "kind": RecoveryAlertWirePlan.messageKind,
            "action": accountId == nil ? "clear-account" : "bind-account",
            "version": RecoveryAlertWirePlan.currentVersion,
            "accountId": accountId ?? NSNull(),
            "accountBindingGeneration": Double(generation),
        ])
    }

    private func sendWatchMessage(_ value: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let connectivity = WCSession.default
        if connectivity.activationState == .notActivated { connectivity.activate() }
        // Transfer survives a temporarily unreachable iPhone/Watch. Exact IDs
        // and issuedAt make delayed schedules/cancels harmless.
        connectivity.transferUserInfo(value)
        if connectivity.isReachable {
            connectivity.sendMessage(value, replyHandler: nil, errorHandler: nil)
        }
    }

    private func reconcileDeadlines() {
        for accountId in Array(records.keys) {
            reconcileDeadline(accountId: accountId)
        }
    }

    private func reconcileDeadline(accountId: String) {
        guard let record = records[accountId], record.phase != "ready" else { return }
        if record.plan.isServerReady || Self.nowMilliseconds() >= record.plan.deadlineAt {
            markReady(
                accountId: accountId,
                trigger: record.plan.alertTrigger ?? deadlineTrigger(record.plan),
                triggeredAt: record.plan.readyAt ?? record.plan.deadlineAt,
                showImmediateNotification: record.plan.readyAt != nil
            )
        } else {
            // A prior process may have removed this request while an active
            // Watch workout owned the cue. Restored records are deliberately
            // phone-owned, so recreate the same identifier before relying on
            // the in-process timer. Adding an existing identifier is idempotent.
            scheduleNotification(record)
            scheduleTimer(record)
        }
    }

    private func deadlineTrigger(_ plan: RecoveryAlertWirePlan) -> RecoveryAlertWireTrigger {
        plan.plannedReadyAt == nil ? .fallback : .planned
    }

    private func cancelNotification(_ record: StoredRecord) {
        center.removePendingNotificationRequests(withIdentifiers: [record.notificationId])
        center.removeDeliveredNotifications(withIdentifiers: [record.notificationId])
    }

    private func cancelTimer(accountId: String) {
        timers.removeValue(forKey: accountId)?.cancel()
    }

    private func makeNotificationId() -> String {
        Self.notificationPrefix + UUID().uuidString.lowercased()
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

    /// Fields that can change when the server merely confirms a READY event
    /// (state, readyAt, alertTrigger) are intentionally excluded.
    private func sameSchedule(_ lhs: RecoveryAlertWirePlan, _ rhs: RecoveryAlertWirePlan) -> Bool {
        lhs.activityType == rhs.activityType
            && lhs.mode == rhs.mode
            && lhs.notBeforeAt == rhs.notBeforeAt
            && lhs.plannedReadyAt == rhs.plannedReadyAt
            && lhs.fallbackAt == rhs.fallbackAt
            && lhs.targetBpm == rhs.targetBpm
    }

    /// Add time is the sole same-episode operation that may re-arm READY. Both
    /// the effective deadline and hard fallback must move forward.
    private func advancesSchedule(
        _ candidate: RecoveryAlertWirePlan,
        after current: RecoveryAlertWirePlan
    ) -> Bool {
        candidate.deadlineAt > current.deadlineAt
            && candidate.fallbackAt > current.fallbackAt
    }

    private func preservesScheduledNotification(
        _ current: RecoveryAlertWirePlan,
        for candidate: RecoveryAlertWirePlan
    ) -> Bool {
        guard candidate.isServerReady,
              candidate.alertTrigger != .manual,
              sameSchedule(current, candidate) else { return false }
        let readyAt = candidate.readyAt ?? candidate.deadlineAt
        return candidate.alertTrigger != .target || readyAt >= current.deadlineAt
    }

    private func shouldShowImmediateNotification(
        for candidate: RecoveryAlertWirePlan,
        replacing current: StoredRecord?
    ) -> Bool {
        guard candidate.alertTrigger != .manual else { return false }
        guard let current,
              sameEpisode(current.plan, candidate),
              sameSchedule(current.plan, candidate) else { return true }
        let readyAt = candidate.readyAt ?? candidate.deadlineAt
        return candidate.alertTrigger == .target && readyAt < current.plan.deadlineAt
    }

    private func enqueueAcknowledgementIfNeeded(_ record: StoredRecord) {
        guard let trigger = record.trigger,
              trigger != .manual,
              let triggeredAt = record.triggeredAt,
              let transportSessionId = record.transportSessionId else { return }
        HeartRateRelay.shared.enqueueRecoveryAcknowledgement(
            event: RecoveryAlertWireEvent(
                version: RecoveryAlertWirePlan.currentVersion,
                accountId: record.plan.accountId,
                recoveryId: record.plan.recoveryId,
                repetitionId: record.plan.repetitionId,
                sessionId: record.plan.sessionId,
                issuedAt: record.plan.issuedAt,
                mode: record.plan.mode,
                notBeforeAt: record.plan.notBeforeAt,
                plannedReadyAt: record.plan.plannedReadyAt,
                fallbackAt: record.plan.fallbackAt,
                targetBpm: record.plan.targetBpm,
                trigger: trigger,
                triggeredAt: triggeredAt,
                cueDelivered: record.watchOwnsCue == true
            ),
            transportSessionId: transportSessionId,
            fallbackAt: record.plan.fallbackAt
        )
    }

    private func emit(_ record: StoredRecord, state: String, message: String, ready: Bool) {
        var event: [String: Any] = [
            "version": RecoveryAlertWirePlan.currentVersion,
            "accountId": record.plan.accountId,
            "recoveryId": record.plan.recoveryId,
            "repetitionId": record.plan.repetitionId,
            "sessionId": record.plan.sessionId,
            "state": state,
            "readyAt": record.triggeredAt.map(Double.init) ?? NSNull(),
            "triggeredAt": Double(record.triggeredAt ?? Self.nowMilliseconds()),
            "message": message,
        ]
        if let trigger = record.trigger { event["trigger"] = trigger.rawValue }
        observerLock.lock()
        let current = observers.allObjects.compactMap { $0 as? RecoveryAlertManagerObserver }
        observerLock.unlock()
        current.forEach { $0.recoveryAlertManager(self, didEmit: event, ready: ready) }
        NotificationCenter.default.post(name: Self.stateDidChange, object: self)
    }

    private func stateDictionary(_ record: StoredRecord) -> [String: Any] {
        [
            "version": RecoveryAlertWirePlan.currentVersion,
            "supported": true,
            "state": record.phase,
            "accountId": record.plan.accountId,
            "recoveryId": record.plan.recoveryId,
            "repetitionId": record.plan.repetitionId,
            "sessionId": record.plan.sessionId,
            "mode": record.plan.mode.rawValue,
            "notBeforeAt": Double(record.plan.notBeforeAt),
            "plannedReadyAt": record.plan.plannedReadyAt.map(Double.init) ?? NSNull(),
            "fallbackAt": Double(record.plan.fallbackAt),
            "readyAt": record.triggeredAt.map(Double.init) ?? NSNull(),
            "targetBpm": record.plan.targetBpm ?? NSNull(),
            "trigger": record.trigger?.rawValue ?? NSNull(),
            "message": record.phase == "ready"
                ? "Recovery target reached — start when you feel ready."
                : record.phase == "monitoring" ? "Watching recovery" : "Recovery set",
            "notificationPermission": permissionStatus,
        ]
    }

    private func idleState() -> [String: Any] {
        [
            "version": RecoveryAlertWirePlan.currentVersion,
            "supported": true,
            "state": "idle",
            "accountId": NSNull(),
            "recoveryId": NSNull(),
            "repetitionId": NSNull(),
            "sessionId": NSNull(),
            "mode": NSNull(),
            "notBeforeAt": NSNull(),
            "plannedReadyAt": NSNull(),
            "fallbackAt": NSNull(),
            "readyAt": NSNull(),
            "targetBpm": NSNull(),
            "notificationPermission": permissionStatus,
        ]
    }

    private func refreshPermissionStatus(completion: (([String: Any]) -> Void)?) {
        center.getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .notDetermined: status = "not-determined"
            case .denied: status = "denied"
            case .authorized: status = "authorized"
            case .provisional: status = "provisional"
            case .ephemeral: status = "ephemeral"
            @unknown default: status = "unavailable"
            }
            let result: [String: Any] = [
                "version": RecoveryAlertWirePlan.currentVersion,
                "supported": true,
                "status": status,
                "alertsEnabled": settings.alertSetting == .enabled,
                "soundsEnabled": settings.soundSetting == .enabled,
                "timeSensitiveEnabled": false,
            ]
            DispatchQueue.main.async {
                self.permissionStatus = status
                completion?(result)
            }
        }
    }

    private func restore() {
        bindingGeneration = max(
            0,
            Int64(defaults.double(forKey: Self.bindingGenerationKey).rounded())
        )
        if let storedAccountId = defaults.string(forKey: Self.boundAccountKey),
           RecoveryAlertWirePlan.validAccountId(storedAccountId) {
            boundAccountId = storedAccountId
        } else {
            defaults.removeObject(forKey: Self.boundAccountKey)
        }
        if let tombstoneData = defaults.data(forKey: Self.tombstonesKey),
           let decoded = try? decoder.decode([RevisionTombstone].self, from: tombstoneData) {
            tombstones = Array(decoded.filter {
                RecoveryAlertWirePlan.validAccountId($0.accountId)
                    && RecoveryAlertWirePlan.validId($0.recoveryId)
                    && RecoveryAlertWirePlan.validId($0.repetitionId)
                    && RecoveryAlertWirePlan.validId($0.sessionId)
                    && $0.issuedAt >= 0
            }.suffix(Self.maximumRecords))
        } else {
            defaults.removeObject(forKey: Self.tombstonesKey)
        }
        guard let data = defaults.data(forKey: Self.persistedKey),
              let decoded = try? decoder.decode([StoredRecord].self, from: data) else {
            defaults.removeObject(forKey: Self.persistedKey)
            return
        }
        records = Dictionary(uniqueKeysWithValues: decoded.compactMap { record in
            guard record.version == 1,
                  record.plan.isValid,
                  ["scheduled", "monitoring", "ready"].contains(record.phase),
                  !record.notificationId.isEmpty,
                  record.notificationId.hasPrefix(Self.notificationPrefix) else { return nil }
            // Ownership is an in-memory receipt from a currently reachable
            // Watch process. Never persist it across an iPhone relaunch.
            var restored = record
            restored.watchOwnsCue = false
            return (restored.plan.accountId, restored)
        })
        if boundAccountId == nil, records.count == 1, let restoredAccountId = records.keys.first {
            // One-time migration from the first Recovery Alert build.
            boundAccountId = restoredAccountId
            bindingGeneration = max(1, bindingGeneration)
            defaults.set(restoredAccountId, forKey: Self.boundAccountKey)
            defaults.set(bindingGeneration, forKey: Self.bindingGenerationKey)
        }
    }

    private func persist() {
        let ordered = records.values.sorted { $0.plan.startedAt < $1.plan.startedAt }
        if let data = try? encoder.encode(ordered) {
            defaults.set(data, forKey: Self.persistedKey)
        }
        if let tombstoneData = try? encoder.encode(tombstones) {
            defaults.set(tombstoneData, forKey: Self.tombstonesKey)
        }
    }

    private func recordTombstone(
        for plan: RecoveryAlertWirePlan,
        issuedAt: Int64? = nil,
        allowForegroundResume: Bool,
        terminal: Bool
    ) {
        let revision = issuedAt ?? plan.issuedAt
        if let prior = tombstones.last(where: { $0.matches(plan) }),
           prior.issuedAt > revision {
            return
        }
        let prior = tombstones.last(where: { $0.matches(plan) })
        let isTerminal = prior?.terminal == true || terminal
        let canResume = !isTerminal
            && (prior?.allowForegroundResume == true || allowForegroundResume)
        tombstones.removeAll { $0.matches(plan) }
        tombstones.append(RevisionTombstone(
            accountId: plan.accountId,
            recoveryId: plan.recoveryId,
            repetitionId: plan.repetitionId,
            sessionId: plan.sessionId,
            issuedAt: revision,
            allowForegroundResume: canResume,
            terminal: isTerminal
        ))
        if tombstones.count > Self.maximumRecords {
            tombstones.removeFirst(tombstones.count - Self.maximumRecords)
        }
        persist()
    }

    private func pruneRecords() {
        guard records.count > Self.maximumRecords else { return }
        let keep = Set(records.values.sorted { $0.plan.startedAt > $1.plan.startedAt }
            .prefix(Self.maximumRecords).map(\.plan.accountId))
        records = records.filter { keep.contains($0.key) }
    }

    private static func nowMilliseconds() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1_000).rounded())
    }

    /// Called exclusively through Capacitor's NotificationRouter local handler.
    /// Keeping the router as the sole UNUserNotificationCenter delegate allows
    /// the official push plugin to own remote notifications at the same time.
    func willPresentLocalNotification(
        _ notification: UNNotification
    ) -> UNNotificationPresentationOptions {
        let apply = { () -> Bool in
            guard let record = self.currentRecord(for: notification.request) else {
                return false
            }
            self.markReady(
                accountId: record.plan.accountId,
                trigger: self.deadlineTrigger(record.plan),
                triggeredAt: record.plan.deadlineAt,
                showImmediateNotification: false
            )
            return true
        }
        let isCurrentRequest = Thread.isMainThread
            ? apply()
            : DispatchQueue.main.sync(execute: apply)
        guard isCurrentRequest else { return [] }
        return [.banner, .list, .sound]
    }

    func didReceiveLocalNotificationResponse(_ response: UNNotificationResponse) {
        let apply = {
            guard let record = self.currentRecord(for: response.notification.request) else {
                return
            }
            self.markReady(
                accountId: record.plan.accountId,
                trigger: record.trigger ?? self.deadlineTrigger(record.plan),
                triggeredAt: record.triggeredAt ?? record.plan.deadlineAt,
                showImmediateNotification: false
            )
        }
        if Thread.isMainThread {
            apply()
        } else {
            DispatchQueue.main.sync(execute: apply)
        }
    }

    private func currentRecord(for request: UNNotificationRequest) -> StoredRecord? {
        let info = request.content.userInfo
        guard let accountId = info["accountId"] as? String,
              let record = records[accountId],
              request.identifier == record.notificationId,
              info["recoveryId"] as? String == record.plan.recoveryId,
              info["repetitionId"] as? String == record.plan.repetitionId,
              info["sessionId"] as? String == record.plan.sessionId else {
            return nil
        }
        return record
    }
}
