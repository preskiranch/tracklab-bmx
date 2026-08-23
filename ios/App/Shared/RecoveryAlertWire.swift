import Foundation

enum RecoveryAlertWireMode: String, Codable {
    case timer
    case heartRate = "heart-rate"
    case smart
}

enum RecoveryAlertWireActivity: String, Codable {
    case race = "bmx-race"
    case straightSprint = "straight-sprint"
    case getPulled = "get-pulled"
}

enum RecoveryAlertWireTrigger: String, Codable {
    case target
    case planned
    case fallback
    case manual
}

enum RecoveryAlertWireConfidence: String, Codable {
    case fixed
    case provisional
    case personalized
}

/// Versioned, account-scoped recovery plan shared by iOS and watchOS. All
/// clocks are absolute epoch milliseconds so a relaunch or a bike reconnect
/// cannot restart an athlete's recovery period.
struct RecoveryAlertWirePlan: Codable, Equatable {
    static let currentVersion = 1
    static let messageKind = "tracklab-recovery-plan"
    static let maximumPlanDuration: Int64 = 24 * 60 * 60 * 1_000

    let version: Int
    let accountId: String
    let recoveryId: String
    let activityType: RecoveryAlertWireActivity
    let sessionId: String
    let repetitionId: String
    let mode: RecoveryAlertWireMode
    let serverState: String
    let startedAt: Int64
    let notBeforeAt: Int64
    let plannedReadyAt: Int64?
    let fallbackAt: Int64
    let readyAt: Int64?
    let alertTrigger: RecoveryAlertWireTrigger?
    let targetBpm: Double?
    let reason: String?
    let explanation: String?
    let confidence: RecoveryAlertWireConfidence
    let learningEpisodeCount: Int
    let issuedAt: Int64

    var deadlineAt: Int64 {
        switch mode {
        case .timer, .smart:
            return plannedReadyAt ?? fallbackAt
        case .heartRate:
            return fallbackAt
        }
    }

    var isServerReady: Bool {
        readyAt != nil || serverState == "ready"
    }

    var isValid: Bool {
        guard version == Self.currentVersion,
              Self.validAccountId(accountId),
              Self.validId(recoveryId),
              Self.validId(sessionId),
              Self.validId(repetitionId),
              Self.validText(serverState, maximumBytes: 80),
              startedAt >= 0,
              notBeforeAt >= startedAt,
              fallbackAt >= notBeforeAt,
              fallbackAt - startedAt <= Self.maximumPlanDuration,
              plannedReadyAt.map({ $0 >= notBeforeAt && $0 <= fallbackAt }) != false,
              readyAt.map({ $0 >= startedAt && $0 <= fallbackAt + 60_000 }) != false,
              targetBpm.map({ $0.isFinite && $0 >= 30 && $0 <= 240 }) != false,
              learningEpisodeCount >= 0,
              issuedAt >= 0,
              Self.validOptionalText(reason),
              Self.validOptionalText(explanation) else {
            return false
        }
        return mode != .heartRate || targetBpm != nil
    }

    func dictionary(action: String = "schedule") -> [String: Any] {
        var value: [String: Any] = [
            "kind": Self.messageKind,
            "action": action,
            "version": version,
            "accountId": accountId,
            "recoveryId": recoveryId,
            "activityType": activityType.rawValue,
            "sessionId": sessionId,
            "repetitionId": repetitionId,
            "mode": mode.rawValue,
            "state": serverState,
            "startedAt": Double(startedAt),
            "notBeforeAt": Double(notBeforeAt),
            "fallbackAt": Double(fallbackAt),
            "learningEpisodeCount": learningEpisodeCount,
            "issuedAt": Double(issuedAt),
        ]
        value["plannedReadyAt"] = plannedReadyAt.map(Double.init) ?? NSNull()
        value["readyAt"] = readyAt.map(Double.init) ?? NSNull()
        value["alertTrigger"] = alertTrigger?.rawValue ?? NSNull()
        value["targetBpm"] = targetBpm ?? NSNull()
        value["reason"] = reason ?? NSNull()
        value["explanation"] = explanation ?? NSNull()
        value["confidence"] = confidence.rawValue
        return value
    }

    static func fromDictionary(_ value: [String: Any]) -> RecoveryAlertWirePlan? {
        let action = value["action"] as? String ?? "schedule"
        guard value["kind"] as? String == messageKind,
              ["schedule", "resume"].contains(action),
              intValue(value["version"]) == currentVersion,
              let accountId = value["accountId"] as? String,
              let recoveryId = (value["recoveryId"] ?? value["id"]) as? String,
              let rawActivity = value["activityType"] as? String,
              let activityType = RecoveryAlertWireActivity(rawValue: rawActivity),
              let sessionId = value["sessionId"] as? String,
              let repetitionId = value["repetitionId"] as? String,
              let rawMode = value["mode"] as? String,
              let mode = RecoveryAlertWireMode(rawValue: rawMode),
              let startedAt = milliseconds(value["startedAt"]),
              let notBeforeAt = milliseconds(value["notBeforeAt"]),
              let fallbackAt = milliseconds(value["fallbackAt"]),
              let rawConfidence = value["confidence"] as? String,
              let confidence = RecoveryAlertWireConfidence(rawValue: rawConfidence),
              let learningEpisodeCount = intValue(value["learningEpisodeCount"]),
              let issuedAt = milliseconds(value["issuedAt"]) else {
            return nil
        }
        let plan = RecoveryAlertWirePlan(
            version: currentVersion,
            accountId: accountId,
            recoveryId: recoveryId,
            activityType: activityType,
            sessionId: sessionId,
            repetitionId: repetitionId,
            mode: mode,
            serverState: (value["state"] as? String) ?? "recovering",
            startedAt: startedAt,
            notBeforeAt: notBeforeAt,
            plannedReadyAt: nullableMilliseconds(value["plannedReadyAt"]),
            fallbackAt: fallbackAt,
            readyAt: nullableMilliseconds(value["readyAt"]),
            alertTrigger: nullableString(value["alertTrigger"]).flatMap(RecoveryAlertWireTrigger.init),
            targetBpm: nullableDouble(value["targetBpm"]),
            reason: nullableString(value["reason"]),
            explanation: nullableString(value["explanation"]),
            confidence: confidence,
            learningEpisodeCount: learningEpisodeCount,
            issuedAt: issuedAt
        )
        return plan.isValid ? plan : nil
    }

    static func validId(_ value: String) -> Bool {
        validText(value, maximumBytes: 160) && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func validAccountId(_ value: String) -> Bool {
        guard value.hasPrefix("recacct_"), value.utf8.count == 40 else { return false }
        return value.utf8.dropFirst(8).allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private static func validOptionalText(_ value: String?) -> Bool {
        value.map { validText($0, maximumBytes: 500) } ?? true
    }

    private static func validText(_ value: String, maximumBytes: Int) -> Bool {
        !value.isEmpty
            && value.utf8.count <= maximumBytes
            && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }

    static func milliseconds(_ value: Any?) -> Int64? {
        guard let double = doubleValue(value),
              double.isFinite,
              double >= 0,
              double <= Double(Int64.max) else { return nil }
        return Int64(double.rounded())
    }

    static func nullableMilliseconds(_ value: Any?) -> Int64? {
        value is NSNull || value == nil ? nil : milliseconds(value)
    }

    static func nullableDouble(_ value: Any?) -> Double? {
        value is NSNull || value == nil ? nil : doubleValue(value)
    }

    static func nullableString(_ value: Any?) -> String? {
        value is NSNull || value == nil ? nil : value as? String
    }

    static func doubleValue(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? Int64 { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        return nil
    }

    static func intValue(_ value: Any?) -> Int? {
        guard let double = doubleValue(value),
              double.isFinite,
              double.rounded() == double,
              double >= 0,
              double <= Double(Int.max) else { return nil }
        return Int(double)
    }
}

struct RecoveryAlertWireEvent: Codable, Equatable {
    static let messageKind = "tracklab-recovery-event"

    let version: Int
    let accountId: String
    let recoveryId: String
    let repetitionId: String
    let sessionId: String
    /// Server episode revision observed by Watch. Schedule fields below are
    /// the stable anti-stale identity because HR ingest may advance issuedAt
    /// without changing the athlete's recovery schedule.
    let issuedAt: Int64
    let mode: RecoveryAlertWireMode
    let notBeforeAt: Int64
    let plannedReadyAt: Int64?
    let fallbackAt: Int64
    let targetBpm: Double?
    let trigger: RecoveryAlertWireTrigger
    let triggeredAt: Int64
    /// Whether Watch actually played the one restrained cue. This is not part
    /// of server learning or ACK identity; iPhone uses it only for failover.
    let cueDelivered: Bool

    var isValid: Bool {
        version == RecoveryAlertWirePlan.currentVersion
            && RecoveryAlertWirePlan.validAccountId(accountId)
            && RecoveryAlertWirePlan.validId(recoveryId)
            && RecoveryAlertWirePlan.validId(repetitionId)
            && RecoveryAlertWirePlan.validId(sessionId)
            && issuedAt >= 0
            && notBeforeAt >= 0
            && fallbackAt >= notBeforeAt
            && plannedReadyAt.map({ $0 >= notBeforeAt && $0 <= fallbackAt }) != false
            && targetBpm.map({ $0.isFinite && $0 >= 30 && $0 <= 240 }) != false
            && (mode != .heartRate || targetBpm != nil)
            && triggeredAt >= 0
    }

    func dictionary() -> [String: Any] {
        [
            "kind": Self.messageKind,
            "version": version,
            "accountId": accountId,
            "recoveryId": recoveryId,
            "repetitionId": repetitionId,
            "sessionId": sessionId,
            "issuedAt": Double(issuedAt),
            "mode": mode.rawValue,
            "notBeforeAt": Double(notBeforeAt),
            "plannedReadyAt": plannedReadyAt.map(Double.init) ?? NSNull(),
            "fallbackAt": Double(fallbackAt),
            "targetBpm": targetBpm ?? NSNull(),
            "trigger": trigger.rawValue,
            "triggeredAt": Double(triggeredAt),
            "cueDelivered": cueDelivered,
        ]
    }

    static func fromDictionary(_ value: [String: Any]) -> RecoveryAlertWireEvent? {
        guard value["kind"] as? String == messageKind,
              RecoveryAlertWirePlan.intValue(value["version"]) == RecoveryAlertWirePlan.currentVersion,
              let accountId = value["accountId"] as? String,
              let recoveryId = value["recoveryId"] as? String,
              let repetitionId = value["repetitionId"] as? String,
              let sessionId = value["sessionId"] as? String,
              let issuedAt = RecoveryAlertWirePlan.milliseconds(value["issuedAt"]),
              let rawMode = value["mode"] as? String,
              let mode = RecoveryAlertWireMode(rawValue: rawMode),
              let notBeforeAt = RecoveryAlertWirePlan.milliseconds(value["notBeforeAt"]),
              let fallbackAt = RecoveryAlertWirePlan.milliseconds(value["fallbackAt"]),
              let rawTrigger = value["trigger"] as? String,
              let trigger = RecoveryAlertWireTrigger(rawValue: rawTrigger),
              let triggeredAt = RecoveryAlertWirePlan.milliseconds(value["triggeredAt"]) else {
            return nil
        }
        let event = RecoveryAlertWireEvent(
            version: RecoveryAlertWirePlan.currentVersion,
            accountId: accountId,
            recoveryId: recoveryId,
            repetitionId: repetitionId,
            sessionId: sessionId,
            issuedAt: issuedAt,
            mode: mode,
            notBeforeAt: notBeforeAt,
            plannedReadyAt: RecoveryAlertWirePlan.nullableMilliseconds(value["plannedReadyAt"]),
            fallbackAt: fallbackAt,
            targetBpm: RecoveryAlertWirePlan.nullableDouble(value["targetBpm"]),
            trigger: trigger,
            triggeredAt: triggeredAt,
            cueDelivered: value["cueDelivered"] as? Bool ?? false
        )
        return event.isValid ? event : nil
    }

    func matchesSchedule(_ plan: RecoveryAlertWirePlan) -> Bool {
        accountId == plan.accountId
            && recoveryId == plan.recoveryId
            && repetitionId == plan.repetitionId
            && sessionId == plan.sessionId
            && mode == plan.mode
            && notBeforeAt == plan.notBeforeAt
            && plannedReadyAt == plan.plannedReadyAt
            && fallbackAt == plan.fallbackAt
            && targetBpm == plan.targetBpm
    }
}
