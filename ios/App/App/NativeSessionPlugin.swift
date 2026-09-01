import Capacitor
import Foundation
import Security

private enum NativeSessionError: LocalizedError {
    case invalidToken
    case invalidClubTabletCredential
    case invalidBluetoothDeviceId
    case readFailed(OSStatus)
    case writeFailed(OSStatus)
    case clubTabletReadFailed(OSStatus)
    case clubTabletWriteFailed(OSStatus)
    case clubTabletRecoveryReadFailed(OSStatus)
    case clubTabletRecoveryWriteFailed(OSStatus)
    case bluetoothReadFailed(OSStatus)
    case bluetoothWriteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidToken:
            return "TrackLab received an invalid sign-in session."
        case .invalidClubTabletCredential:
            return "TrackLab received an invalid club tablet authorization."
        case .invalidBluetoothDeviceId:
            return "TrackLab received an invalid saved Wattbike identifier."
        case .readFailed:
            return "The device could not read its TrackLab sign-in."
        case .writeFailed:
            return "The device could not securely save its TrackLab sign-in."
        case .clubTabletReadFailed:
            return "The device could not read its club tablet authorization."
        case .clubTabletWriteFailed:
            return "The device could not securely save its club tablet authorization."
        case .clubTabletRecoveryReadFailed:
            return "The device could not read its club tablet recovery identity."
        case .clubTabletRecoveryWriteFailed:
            return "The device could not securely save its club tablet recovery identity."
        case .bluetoothReadFailed:
            return "The device could not read its saved Wattbike pairing."
        case .bluetoothWriteFailed:
            return "The device could not securely save its Wattbike pairing."
        }
    }
}

/// Token-free identity used to find this same logical Club Tablet after its
/// bearer is rotated, invalidated, or lost with WebKit data. This is kept in a
/// separate Keychain item so clearing an unusable authorization never removes
/// the information needed for an owner-authorized recovery.
private struct StoredClubTabletRecoveryBinding: Codable {
    static let currentVersion = 1

    let version: Int
    let deviceId: String
    let deviceName: String
    let clubId: String
    let clubName: String
    let pairedBikeDeviceId: Int?
    let pairedBikeLabel: String?

    init(
        credential: StoredClubTabletCredential,
        preservingBikeFrom existing: StoredClubTabletRecoveryBinding? = nil
    ) {
        self.version = Self.currentVersion
        self.deviceId = credential.deviceId
        self.deviceName = credential.deviceName
        self.clubId = credential.clubId
        self.clubName = credential.clubName
        let sameLogicalTablet = existing?.deviceId == credential.deviceId
            && existing?.clubId == credential.clubId
        self.pairedBikeDeviceId = sameLogicalTablet ? existing?.pairedBikeDeviceId : nil
        self.pairedBikeLabel = sameLogicalTablet ? existing?.pairedBikeLabel : nil
    }

    init?(call: CAPPluginCall) {
        guard call.getInt("version") == Self.currentVersion,
              let deviceId = Self.normalizedText(call.getString("deviceId"), maxLength: 120),
              let deviceName = Self.normalizedText(call.getString("deviceName"), maxLength: 80),
              let clubId = Self.normalizedText(call.getString("clubId"), maxLength: 120),
              let clubName = Self.normalizedText(call.getString("clubName"), maxLength: 120) else {
            return nil
        }
        let suppliedBikeDeviceId = call.getInt("pairedBikeDeviceId")
        let suppliedBikeLabel = Self.normalizedText(call.getString("pairedBikeLabel"), maxLength: 120)
        guard (suppliedBikeDeviceId == nil && suppliedBikeLabel == nil)
                || (suppliedBikeDeviceId != nil && suppliedBikeLabel != nil),
              suppliedBikeDeviceId.map({ $0 > 0 }) ?? true else {
            return nil
        }
        self.version = Self.currentVersion
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.clubId = clubId
        self.clubName = clubName
        self.pairedBikeDeviceId = suppliedBikeDeviceId
        self.pairedBikeLabel = suppliedBikeLabel
    }

    var wireValue: JSObject {
        var value: JSObject = [
            "version": version,
            "deviceId": deviceId,
            "deviceName": deviceName,
            "clubId": clubId,
            "clubName": clubName,
        ]
        value["pairedBikeDeviceId"] = pairedBikeDeviceId ?? NSNull()
        value["pairedBikeLabel"] = pairedBikeLabel ?? NSNull()
        return value
    }

    var valid: Bool {
        version == Self.currentVersion
            && Self.normalizedText(deviceId, maxLength: 120) == deviceId
            && Self.normalizedText(deviceName, maxLength: 80) == deviceName
            && Self.normalizedText(clubId, maxLength: 120) == clubId
            && Self.normalizedText(clubName, maxLength: 120) == clubName
            && ((pairedBikeDeviceId == nil && pairedBikeLabel == nil)
                || (pairedBikeDeviceId.map({ $0 > 0 }) == true
                    && Self.normalizedText(pairedBikeLabel, maxLength: 120) == pairedBikeLabel))
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

private struct StoredBluetoothDeviceIds: Codable {
    static let currentVersion = 1
    static let maximumDeviceCount = 4

    let version: Int
    let deviceIds: [String]

    init(deviceIds: [String]) {
        self.version = Self.currentVersion
        self.deviceIds = Self.normalizedDeviceIds(deviceIds)
    }

    var wireValue: JSObject {
        [
            "version": version,
            "deviceIds": deviceIds,
        ]
    }

    var valid: Bool {
        version == Self.currentVersion
            && !deviceIds.isEmpty
            && Self.normalizedDeviceIds(deviceIds) == deviceIds
    }

    static func normalizedDeviceId(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty,
              normalized.count <= 240,
              normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            return nil
        }
        return normalized
    }

    private static func normalizedDeviceIds(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return Array(
            values.compactMap(normalizedDeviceId)
                .filter { seen.insert($0).inserted }
                .suffix(maximumDeviceCount)
        )
    }
}

/// Stores the server-issued personal session, Club Tablet authorization, and
/// remembered CoreBluetooth peripherals in separate, device-only Keychain
/// items. None synchronize through iCloud Keychain or backups, and clearing
/// one identity cannot erase the other durable device state.
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
        CAPPluginMethod(name: "loadClubTabletRecoveryBinding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveClubTabletRecoveryBinding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearClubTabletRecoveryBinding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadSavedBluetoothDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBluetoothDevice", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "com.preskilranch.tracklabbmx.native-session"
    private static let account = "server-session-v1"
    private static let clubTabletService = "com.preskilranch.tracklabbmx.club-tablet"
    private static let clubTabletAccount = "device-credential-v1"
    private static let clubTabletRecoveryService = "com.preskilranch.tracklabbmx.club-tablet-recovery"
    private static let clubTabletRecoveryAccount = "device-binding-v1"
    private static let bluetoothService = "com.preskilranch.tracklabbmx.bluetooth"
    private static let bluetoothAccount = "peripheral-ids-v1"
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
                    // Migrate authorizations written by native builds that
                    // predate the token-free recovery item. A recovery write
                    // must never hide an otherwise usable bearer; it will be
                    // retried on the next launch if protected data is busy.
                    try? Self.refreshClubTabletRecoveryBinding(for: credential)
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
                // Seed the non-secret recovery item in the same native call so
                // a WebView crash cannot leave a newly issued bearer as the
                // installation's only durable identity. Preserve a known bike
                // when this is merely a token rotation for the same tablet.
                try Self.refreshClubTabletRecoveryBinding(for: credential)
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

    @objc public func loadClubTabletRecoveryBinding(_ call: CAPPluginCall) {
        queue.async {
            do {
                if let binding = try Self.loadClubTabletRecoveryBinding() {
                    call.resolve(["binding": binding.wireValue])
                } else {
                    call.resolve([:])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func saveClubTabletRecoveryBinding(_ call: CAPPluginCall) {
        guard let binding = StoredClubTabletRecoveryBinding(call: call) else {
            call.reject(NativeSessionError.invalidClubTabletCredential.localizedDescription)
            return
        }
        queue.async {
            do {
                try Self.storeClubTabletRecoveryBinding(binding)
                call.resolve(["saved": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func clearClubTabletRecoveryBinding(_ call: CAPPluginCall) {
        queue.async {
            let status = SecItemDelete(Self.clubTabletRecoveryQuery() as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                call.reject(NativeSessionError.clubTabletRecoveryWriteFailed(status).localizedDescription)
                return
            }
            call.resolve(["cleared": true])
        }
    }

    @objc public func loadSavedBluetoothDevices(_ call: CAPPluginCall) {
        queue.async {
            do {
                if let savedDevices = try Self.loadSavedBluetoothDevices() {
                    call.resolve(savedDevices.wireValue)
                } else {
                    call.resolve(["version": StoredBluetoothDeviceIds.currentVersion, "deviceIds": []])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func saveBluetoothDevice(_ call: CAPPluginCall) {
        guard let deviceId = StoredBluetoothDeviceIds.normalizedDeviceId(call.getString("deviceId")) else {
            call.reject(NativeSessionError.invalidBluetoothDeviceId.localizedDescription)
            return
        }
        queue.async {
            do {
                let existing = try Self.loadSavedBluetoothDevices()?.deviceIds ?? []
                let savedDevices = StoredBluetoothDeviceIds(
                    deviceIds: existing.filter { $0 != deviceId } + [deviceId]
                )
                try Self.storeSavedBluetoothDevices(savedDevices)
                call.resolve(["saved": true, "deviceIds": savedDevices.deviceIds])
            } catch {
                call.reject(error.localizedDescription)
            }
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

    private static func clubTabletRecoveryQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: clubTabletRecoveryService,
            kSecAttrAccount as String: clubTabletRecoveryAccount,
        ]
    }

    private static func bluetoothQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: bluetoothService,
            kSecAttrAccount as String: bluetoothAccount,
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

    private static func loadClubTabletRecoveryBinding() throws -> StoredClubTabletRecoveryBinding? {
        var request = clubTabletRecoveryQuery()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NativeSessionError.clubTabletRecoveryReadFailed(status)
        }
        guard let data = result as? Data,
              let binding = try? JSONDecoder().decode(StoredClubTabletRecoveryBinding.self, from: data),
              binding.valid else {
            _ = SecItemDelete(clubTabletRecoveryQuery() as CFDictionary)
            return nil
        }
        return binding
    }

    private static func storeClubTabletRecoveryBinding(
        _ binding: StoredClubTabletRecoveryBinding
    ) throws {
        let encoded: Data
        do {
            encoded = try JSONEncoder().encode(binding)
        } catch {
            throw NativeSessionError.invalidClubTabletCredential
        }
        let updateStatus = SecItemUpdate(
            clubTabletRecoveryQuery() as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NativeSessionError.clubTabletRecoveryWriteFailed(updateStatus)
        }
        var insertion = clubTabletRecoveryQuery()
        insertion[kSecValueData as String] = encoded
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        insertion[kSecAttrSynchronizable as String] = false
        let addStatus = SecItemAdd(insertion as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NativeSessionError.clubTabletRecoveryWriteFailed(addStatus)
        }
    }

    private static func refreshClubTabletRecoveryBinding(
        for credential: StoredClubTabletCredential
    ) throws {
        // If an old or unreadable item is present, store() still performs an
        // update using the stable service/account pair. Names refresh on every
        // token rotation while a paired-bike hint is retained only for this
        // exact device and club.
        let existing = try? loadClubTabletRecoveryBinding()
        try storeClubTabletRecoveryBinding(
            StoredClubTabletRecoveryBinding(
                credential: credential,
                preservingBikeFrom: existing
            )
        )
    }

    private static func loadSavedBluetoothDevices() throws -> StoredBluetoothDeviceIds? {
        var request = bluetoothQuery()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NativeSessionError.bluetoothReadFailed(status)
        }
        guard let data = result as? Data,
              let savedDevices = try? JSONDecoder().decode(StoredBluetoothDeviceIds.self, from: data),
              savedDevices.valid else {
            _ = SecItemDelete(bluetoothQuery() as CFDictionary)
            return nil
        }
        return savedDevices
    }

    private static func storeSavedBluetoothDevices(_ savedDevices: StoredBluetoothDeviceIds) throws {
        let encoded: Data
        do {
            encoded = try JSONEncoder().encode(savedDevices)
        } catch {
            throw NativeSessionError.invalidBluetoothDeviceId
        }
        let updateStatus = SecItemUpdate(
            bluetoothQuery() as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NativeSessionError.bluetoothWriteFailed(updateStatus)
        }
        var insertion = bluetoothQuery()
        insertion[kSecValueData as String] = encoded
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        insertion[kSecAttrSynchronizable as String] = false
        let addStatus = SecItemAdd(insertion as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NativeSessionError.bluetoothWriteFailed(addStatus)
        }
    }
}
