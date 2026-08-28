import Capacitor
import Foundation
import Security

private enum NativeSessionError: LocalizedError {
    case invalidToken
    case invalidClubTabletCredential
    case readFailed(OSStatus)
    case writeFailed(OSStatus)
    case clubTabletReadFailed(OSStatus)
    case clubTabletWriteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidToken:
            return "TrackLab received an invalid sign-in session."
        case .invalidClubTabletCredential:
            return "TrackLab received an invalid club tablet authorization."
        case .readFailed:
            return "The device could not read its TrackLab sign-in."
        case .writeFailed:
            return "The device could not securely save its TrackLab sign-in."
        case .clubTabletReadFailed:
            return "The device could not read its club tablet authorization."
        case .clubTabletWriteFailed:
            return "The device could not securely save its club tablet authorization."
        }
    }
}

private struct StoredClubTabletCredential: Codable {
    static let currentVersion = 1

    let version: Int
    let deviceId: String
    let deviceName: String
    let clubId: String
    let clubName: String
    let deviceToken: String

    init?(call: CAPPluginCall) {
        guard call.getInt("version") == Self.currentVersion,
              let deviceId = Self.normalizedText(call.getString("deviceId"), maxLength: 120),
              let deviceName = Self.normalizedText(call.getString("deviceName"), maxLength: 80),
              let clubId = Self.normalizedText(call.getString("clubId"), maxLength: 120),
              let clubName = Self.normalizedText(call.getString("clubName"), maxLength: 120),
              let deviceToken = Self.normalizedToken(call.getString("deviceToken")) else {
            return nil
        }
        self.version = Self.currentVersion
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.clubId = clubId
        self.clubName = clubName
        self.deviceToken = deviceToken
    }

    var wireValue: JSObject {
        [
            "version": version,
            "deviceId": deviceId,
            "deviceName": deviceName,
            "clubId": clubId,
            "clubName": clubName,
            "deviceToken": deviceToken,
        ]
    }

    var valid: Bool {
        version == Self.currentVersion
            && Self.normalizedText(deviceId, maxLength: 120) == deviceId
            && Self.normalizedText(deviceName, maxLength: 80) == deviceName
            && Self.normalizedText(clubId, maxLength: 120) == clubId
            && Self.normalizedText(clubName, maxLength: 120) == clubName
            && Self.normalizedToken(deviceToken) == deviceToken
    }

    private static func normalizedText(_ value: String?, maxLength: Int) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty,
              normalized.count <= maxLength,
              normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            return nil
        }
        return normalized
    }

    private static func normalizedToken(_ value: String?) -> String? {
        guard let value, value.utf8.count == 43,
              value.unicodeScalars.allSatisfy({ scalar in
                  (48...57).contains(scalar.value)
                    || (65...90).contains(scalar.value)
                    || (97...122).contains(scalar.value)
                    || scalar.value == 45 || scalar.value == 95
              }) else { return nil }
        return value
    }
}

/// Stores the server-issued personal session and Club Tablet authorization in
/// separate, device-only Keychain items. Neither item synchronizes through
/// iCloud Keychain or backups, and clearing one identity cannot erase the other.
@objc(NativeSessionPlugin)
public final class NativeSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSessionPlugin"
    public let jsName = "TrackLabNativeSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadClubTabletCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveClubTabletCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearClubTabletCredential", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "com.preskilranch.tracklabbmx.native-session"
    private static let account = "server-session-v1"
    private static let clubTabletService = "com.preskilranch.tracklabbmx.club-tablet"
    private static let clubTabletAccount = "device-credential-v1"
    private let queue = DispatchQueue(label: "com.preskilranch.tracklabbmx.native-session")

    @objc public func loadSession(_ call: CAPPluginCall) {
        queue.async {
            do {
                if let token = try Self.loadToken() {
                    call.resolve(["token": token])
                } else {
                    call.resolve([:])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func saveSession(_ call: CAPPluginCall) {
        guard let token = Self.validToken(call.getString("token")) else {
            call.reject(NativeSessionError.invalidToken.localizedDescription)
            return
        }
        queue.async {
            do {
                try Self.store(token)
                call.resolve(["saved": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func clearSession(_ call: CAPPluginCall) {
        queue.async {
            let status = SecItemDelete(Self.query() as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                call.reject(NativeSessionError.writeFailed(status).localizedDescription)
                return
            }
            call.resolve(["cleared": true])
        }
    }

    @objc public func loadClubTabletCredential(_ call: CAPPluginCall) {
        queue.async {
            do {
                if let credential = try Self.loadClubTabletCredential() {
                    call.resolve(["credential": credential.wireValue])
                } else {
                    call.resolve([:])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func saveClubTabletCredential(_ call: CAPPluginCall) {
        guard let credential = StoredClubTabletCredential(call: call) else {
            call.reject(NativeSessionError.invalidClubTabletCredential.localizedDescription)
            return
        }
        queue.async {
            do {
                try Self.storeClubTabletCredential(credential)
                call.resolve(["saved": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func clearClubTabletCredential(_ call: CAPPluginCall) {
        queue.async {
            let status = SecItemDelete(Self.clubTabletQuery() as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                call.reject(NativeSessionError.clubTabletWriteFailed(status).localizedDescription)
                return
            }
            call.resolve(["cleared": true])
        }
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func clubTabletQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: clubTabletService,
            kSecAttrAccount as String: clubTabletAccount,
        ]
    }

    private static func validToken(_ value: String?) -> String? {
        guard let value, value.utf8.count == 43,
              value.unicodeScalars.allSatisfy({ scalar in
                  (48...57).contains(scalar.value)
                    || (65...90).contains(scalar.value)
                    || (97...122).contains(scalar.value)
                    || scalar.value == 45 || scalar.value == 95
              }) else { return nil }
        return value
    }

    private static func loadToken() throws -> String? {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw NativeSessionError.readFailed(status) }
        guard let data = result as? Data,
              let token = validToken(String(data: data, encoding: .utf8)) else {
            _ = SecItemDelete(query() as CFDictionary)
            return nil
        }
        return token
    }

    private static func store(_ token: String) throws {
        let encoded = Data(token.utf8)
        let updateStatus = SecItemUpdate(
            query() as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NativeSessionError.writeFailed(updateStatus)
        }
        var insertion = query()
        insertion[kSecValueData as String] = encoded
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        insertion[kSecAttrSynchronizable as String] = false
        let addStatus = SecItemAdd(insertion as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw NativeSessionError.writeFailed(addStatus) }
    }

    private static func loadClubTabletCredential() throws -> StoredClubTabletCredential? {
        var request = clubTabletQuery()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NativeSessionError.clubTabletReadFailed(status)
        }
        guard let data = result as? Data,
              let credential = try? JSONDecoder().decode(StoredClubTabletCredential.self, from: data),
              credential.valid else {
            _ = SecItemDelete(clubTabletQuery() as CFDictionary)
            return nil
        }
        return credential
    }

    private static func storeClubTabletCredential(_ credential: StoredClubTabletCredential) throws {
        let encoded: Data
        do {
            encoded = try JSONEncoder().encode(credential)
        } catch {
            throw NativeSessionError.invalidClubTabletCredential
        }
        let updateStatus = SecItemUpdate(
            clubTabletQuery() as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NativeSessionError.clubTabletWriteFailed(updateStatus)
        }
        var insertion = clubTabletQuery()
        insertion[kSecValueData as String] = encoded
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        insertion[kSecAttrSynchronizable as String] = false
        let addStatus = SecItemAdd(insertion as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NativeSessionError.clubTabletWriteFailed(addStatus)
        }
    }
}
