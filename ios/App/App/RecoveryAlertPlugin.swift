import Capacitor
import Foundation
import UserNotifications

private final class RecoveryAlertNotificationHandler: NSObject, NotificationHandlerProtocol {
    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        RecoveryAlertManager.shared.willPresentLocalNotification(notification)
    }

    func didReceive(response: UNNotificationResponse) {
        RecoveryAlertManager.shared.didReceiveLocalNotificationResponse(response)
    }
}

@objc(RecoveryAlertPlugin)
public final class RecoveryAlertPlugin: CAPPlugin, CAPBridgedPlugin, RecoveryAlertManagerObserver {
    public let identifier = "RecoveryAlertPlugin"
    public let jsName = "TrackLabRecoveryAlerts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPermissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleEpisode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActiveEpisode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bindAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelEpisode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllEpisodes", returnType: CAPPluginReturnPromise),
    ]
    private let notificationHandler = RecoveryAlertNotificationHandler()

    public override func load() {
        bridge?.notificationRouter.localNotificationHandler = notificationHandler
        RecoveryAlertManager.shared.configureAtLaunch()
        RecoveryAlertManager.shared.addObserver(self)
    }

    deinit {
        RecoveryAlertManager.shared.removeObserver(self)
    }

    @objc public func requestPermission(_ call: CAPPluginCall) {
        RecoveryAlertManager.shared.requestPermission { value in call.resolve(value) }
    }

    @objc public func getPermissionStatus(_ call: CAPPluginCall) {
        RecoveryAlertManager.shared.getPermissionStatus { value in call.resolve(value) }
    }

    @objc public func scheduleEpisode(_ call: CAPPluginCall) {
        guard let accountId = Self.normalizedRecoveryAccountId(call.getString("accountId")),
              let episode = call.getObject("episode") else {
            call.reject(RecoveryAlertManagerError.invalidPlan.localizedDescription)
            return
        }
        var raw: [String: Any] = [:]
        episode.forEach { raw[$0.key] = $0.value }
        raw["kind"] = RecoveryAlertWirePlan.messageKind
        raw["action"] = "schedule"
        raw["version"] = RecoveryAlertWirePlan.currentVersion
        raw["accountId"] = accountId
        raw["recoveryId"] = episode["id"]
        // `updatedAt` is the server-authoritative episode revision. Do not use
        // the device clock here: a delayed pre-extension response must never
        // overwrite a newer Add time schedule.
        raw["issuedAt"] = episode["updatedAt"]
        guard let plan = RecoveryAlertWirePlan.fromDictionary(raw) else {
            call.reject(RecoveryAlertManagerError.invalidPlan.localizedDescription)
            return
        }
        RecoveryAlertManager.shared.schedule(plan: plan) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let state): call.resolve(state)
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func getActiveEpisode(_ call: CAPPluginCall) {
        guard let accountId = Self.normalizedRecoveryAccountId(call.getString("accountId")) else {
            call.reject("Choose an athlete first.")
            return
        }
        DispatchQueue.main.async {
            call.resolve(RecoveryAlertManager.shared.state(accountId: accountId))
        }
    }

    @objc public func bindAccount(_ call: CAPPluginCall) {
        guard let accountId = Self.normalizedRecoveryAccountId(call.getString("accountId")) else {
            call.reject("Recovery Alert received an invalid account binding.")
            return
        }
        RecoveryAlertManager.shared.bindAccount(accountId) { value in
            DispatchQueue.main.async { call.resolve(value) }
        }
    }

    @objc public func cancelEpisode(_ call: CAPPluginCall) {
        guard let accountId = Self.normalizedRecoveryAccountId(call.getString("accountId")),
              let recoveryId = Self.normalizedOpaqueId(call.getString("recoveryId")),
              let repetitionId = Self.normalizedOpaqueId(call.getString("repetitionId")) else {
            call.reject(RecoveryAlertManagerError.identityMismatch.localizedDescription)
            return
        }
        DispatchQueue.main.async {
            switch RecoveryAlertManager.shared.cancel(
                accountId: accountId,
                recoveryId: recoveryId,
                repetitionId: repetitionId
            ) {
            case .success(let state): call.resolve(state)
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func clearAllEpisodes(_ call: CAPPluginCall) {
        RecoveryAlertManager.shared.clearAllEpisodes { result in
            DispatchQueue.main.async { call.resolve(result) }
        }
    }

    func recoveryAlertManager(
        _ manager: RecoveryAlertManager,
        didEmit event: [String: Any],
        ready: Bool
    ) {
        notifyListeners(
            "recoveryAlertStatus",
            data: event,
            retainUntilConsumed: true
        )
        if ready {
            notifyListeners(
                "recoveryAlertReady",
                data: event,
                retainUntilConsumed: true
            )
        }
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

    private static func normalizedRecoveryAccountId(_ value: String?) -> String? {
        guard let value = normalizedOpaqueId(value),
              RecoveryAlertWirePlan.validAccountId(value) else { return nil }
        return value
    }
}
