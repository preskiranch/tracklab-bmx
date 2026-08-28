import Capacitor
import Foundation

@objc(StoreKitPlugin)
public final class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "TrackLabStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        Task { @MainActor [weak self] in
            StoreKitPurchaseManager.shared.startObserving()
            StoreKitPurchaseManager.shared.setTransactionUpdateHandler { [weak self] event in
                self?.notifyListeners(
                    "transactionUpdated",
                    data: event,
                    retainUntilConsumed: true
                )
            }
        }
    }

    @objc public func getProducts(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                call.resolve(try await StoreKitPurchaseManager.shared.loadProducts())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard let productID = Self.normalizedProductID(call.getString("productId")) else {
            call.reject(StoreKitPurchaseManagerError.invalidProduct.localizedDescription)
            return
        }
        guard let tokenText = call.getString("appAccountToken")?.trimmingCharacters(in: .whitespacesAndNewlines),
              let token = UUID(uuidString: tokenText) else {
            call.reject(StoreKitPurchaseManagerError.invalidAccountToken.localizedDescription)
            return
        }
        Task { @MainActor in
            do {
                call.resolve(try await StoreKitPurchaseManager.shared.purchase(
                    productID: productID,
                    appAccountToken: token
                ))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func getCurrentEntitlements(_ call: CAPPluginCall) {
        Task { @MainActor in
            call.resolve(await StoreKitPurchaseManager.shared.currentEntitlements())
        }
    }

    @objc public func restore(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                call.resolve(try await StoreKitPurchaseManager.shared.restore())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func finish(_ call: CAPPluginCall) {
        guard let transactionID = Self.normalizedTransactionID(call.getString("transactionId")) else {
            call.reject(StoreKitPurchaseManagerError.invalidTransaction.localizedDescription)
            return
        }
        Task { @MainActor in
            do {
                call.resolve(try await StoreKitPurchaseManager.shared.finish(
                    transactionID: transactionID
                ))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await StoreKitPurchaseManager.shared.showManageSubscriptions()
                call.resolve(["version": 1, "opened": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private static func normalizedProductID(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              TrackLabStoreKitCatalog.productIDs.contains(value) else { return nil }
        return value
    }

    private static func normalizedTransactionID(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.count <= 20,
              let identifier = UInt64(value),
              identifier > 0 else { return nil }
        return value
    }
}
