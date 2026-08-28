import Capacitor
import Foundation
import Security

private enum NativeSessionError: LocalizedError {
    case invalidToken
    case readFailed(OSStatus)
    case writeFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidToken:
            return "TrackLab received an invalid sign-in session."
        case .readFailed:
            return "The device could not read its TrackLab sign-in."
        case .writeFailed:
            return "The device could not securely save its TrackLab sign-in."
        }
    }
}

/// Stores only the server-issued opaque session credential. It is never
/// mirrored to UserDefaults, localStorage, iCloud Keychain, logs, or backups.
@objc(NativeSessionPlugin)
public final class NativeSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSessionPlugin"
    public let jsName = "TrackLabNativeSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "com.preskilranch.tracklabbmx.native-session"
    private static let account = "server-session-v1"
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

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
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
}
