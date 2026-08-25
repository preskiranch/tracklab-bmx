import Capacitor
import Foundation
import Security
import UIKit
import UserNotifications

private enum PushInstallationError: LocalizedError {
    case missingPushEnvironment
    case randomGenerationFailed(OSStatus)
    case keychainReadFailed(OSStatus)
    case keychainWriteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .missingPushEnvironment:
            return "Push notifications are unavailable in this app build."
        case .randomGenerationFailed:
            return "The device could not create a secure notification identity."
        case .keychainReadFailed:
            return "The device could not read its notification identity."
        case .keychainWriteFailed:
            return "The device could not securely save its notification identity."
        }
    }
}

private struct StoredPushInstallation: Codable {
    let version: Int
    let installationId: String
    let credential: String
}

/// Provides the web layer with a device-scoped, opaque identity used to bind an
/// APNs token to an authenticated TrackLab account. Neither value identifies a
/// rider, and both remain local to this physical installation.
@objc(PushInstallationPlugin)
public final class PushInstallationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushInstallationPlugin"
    public let jsName = "TrackLabPushInstallation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInstallation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDeliveredSocialNotifications", returnType: CAPPluginReturnPromise),
    ]

    private static let recordVersion = 1
    private static let keychainService = "com.preskilranch.tracklabbmx.push-installation"
    private static let keychainAccount = "installation-v1"
    private let identityQueue = DispatchQueue(label: "com.preskilranch.tracklabbmx.push-installation")

    @objc public func getInstallation(_ call: CAPPluginCall) {
        identityQueue.async {
            do {
                let environment = try Self.pushEnvironment()
                let record = try Self.loadOrCreateRecord()
                let appBuild = Bundle.main.object(
                    forInfoDictionaryKey: kCFBundleVersionKey as String
                ) as? String ?? ""
                let osVersion = ProcessInfo.processInfo.operatingSystemVersion
                let normalizedOSVersion = [
                    osVersion.majorVersion,
                    osVersion.minorVersion,
                    osVersion.patchVersion,
                ].map(String.init).joined(separator: ".")

                call.resolve([
                    "version": record.version,
                    "installationId": record.installationId,
                    "credential": record.credential,
                    "environment": environment,
                    "appBuild": appBuild,
                    "osVersion": normalizedOSVersion,
                ])
            } catch {
                call.reject((error as? LocalizedError)?.errorDescription
                    ?? "The device notification identity is unavailable.")
            }
        }
    }

    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.reject("Settings are unavailable on this device.")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Settings could not be opened.")
                }
            }
        }
    }

    @objc public func clearDeliveredSocialNotifications(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        let completionLock = NSLock()
        var completed = false
        let completeOnce = { () -> Bool in
            completionLock.lock()
            defer { completionLock.unlock() }
            guard !completed else { return false }
            completed = true
            return true
        }

        // Finish inside the web coordinator's remaining selective-cleanup
        // budget so a delayed callback cannot cross an account boundary.
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) {
            guard completeOnce() else { return }
            call.resolve(["removed": 0])
        }
        center.getDeliveredNotifications { notifications in
            guard completeOnce() else { return }
            let identifiers = notifications.compactMap { notification -> String? in
                let request = notification.request
                guard request.trigger is UNPushNotificationTrigger,
                      Self.isTrackLabSocialPush(request.content.userInfo) else {
                    return nil
                }
                return request.identifier
            }
            if !identifiers.isEmpty {
                center.removeDeliveredNotifications(withIdentifiers: identifiers)
            }
            call.resolve(["removed": identifiers.count])
        }
    }

    private static func loadOrCreateRecord() throws -> StoredPushInstallation {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess,
           let data = result as? Data,
           let record = try? JSONDecoder().decode(StoredPushInstallation.self, from: data),
           valid(record) {
            return record
        }
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PushInstallationError.keychainReadFailed(status)
        }

        // A malformed value cannot be trusted. Delete only this exact Keychain
        // item, then atomically replace it with a fresh random identity.
        if status == errSecSuccess {
            let deleteStatus = SecItemDelete(baseKeychainQuery() as CFDictionary)
            guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
                throw PushInstallationError.keychainWriteFailed(deleteStatus)
            }
        }

        let record = try newRecord()
        let encoded = try JSONEncoder().encode(record)
        var attributes = baseKeychainQuery()
        attributes[kSecValueData as String] = encoded
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)

        if addStatus == errSecDuplicateItem {
            // This path is defensive if another plugin instance races creation.
            return try loadOrCreateRecord()
        }
        guard addStatus == errSecSuccess else {
            throw PushInstallationError.keychainWriteFailed(addStatus)
        }
        return record
    }

    private static func baseKeychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private static func newRecord() throws -> StoredPushInstallation {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw PushInstallationError.randomGenerationFailed(status)
        }
        let credential = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return StoredPushInstallation(
            version: recordVersion,
            installationId: UUID().uuidString.lowercased(),
            credential: credential
        )
    }

    private static func valid(_ record: StoredPushInstallation) -> Bool {
        guard record.version == recordVersion,
              let uuid = UUID(uuidString: record.installationId),
              uuid.uuidString.lowercased() == record.installationId,
              record.credential.count == 43 else { return false }
        var base64 = record.credential
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)?.count == 32
    }

    private static func isTrackLabSocialPush(_ info: [AnyHashable: Any]) -> Bool {
        let allowedKinds: Set<String> = [
            "live_audio_invite",
            "friend_request",
            "friend_connection",
            "track_share",
        ]
        guard let version = info["v"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              version.intValue == 1,
              version.doubleValue == 1,
              info["route"] as? String == "friends",
              let kind = info["kind"] as? String,
              allowedKinds.contains(kind) else {
            return false
        }
        return true
    }

    private static func pushEnvironment() throws -> String {
        // iOS does not expose SecTask's entitlement lookup in the public SDK.
        // Xcode expands this signed Info.plist value and `aps-environment` from
        // the same build setting, keeping the server environment tied to the
        // effective capability without relying on private APIs.
        guard let value = Bundle.main.object(
            forInfoDictionaryKey: "TrackLabAPNsEnvironment"
        ) as? String else {
            throw PushInstallationError.missingPushEnvironment
        }
        switch value {
        case "development": return "sandbox"
        case "production": return "production"
        default: throw PushInstallationError.missingPushEnvironment
        }
    }
}
