import Foundation
import StoreKit
import UIKit

enum TrackLabStoreKitCatalog {
    struct Plan {
        let productID: String
        let bikeSeats: Int
    }

    static let plans: [Plan] = (1...4).map { bikeSeats in
        Plan(
            productID: "com.preskilranch.tracklabbmx.wattbike.\(bikeSeats).monthly",
            bikeSeats: bikeSeats
        )
    }

    static let productIDs = Set(plans.map(\.productID))

    static func bikeSeats(for productID: String) -> Int? {
        plans.first(where: { $0.productID == productID })?.bikeSeats
    }
}

enum StoreKitPurchaseManagerError: LocalizedError {
    case invalidProduct
    case productUnavailable
    case invalidAccountToken
    case invalidTransaction
    case invalidSubscriptionConfiguration
    case unverifiedTransaction
    case noForegroundScene

    var errorDescription: String? {
        switch self {
        case .invalidProduct:
            return "Choose a valid Wattbike connection plan."
        case .productUnavailable:
            return "That Wattbike connection plan is not available from the App Store right now."
        case .invalidAccountToken:
            return "The TrackLab account could not be linked to this App Store purchase."
        case .invalidTransaction:
            return "The App Store transaction identifier is invalid."
        case .invalidSubscriptionConfiguration:
            return "That Wattbike plan is not configured as a monthly App Store subscription."
        case .unverifiedTransaction:
            return "The App Store could not verify this transaction on this device."
        case .noForegroundScene:
            return "Open TrackLab before managing your App Store subscriptions."
        }
    }
}

/// StoreKit is intentionally authoritative only for the Apple transaction.
/// The TrackLab backend remains authoritative for Wattbike access. Verified
/// transactions stay unfinished until the web layer posts their signed JWS to
/// the backend and explicitly calls `finish(transactionId:)` after its ack.
@MainActor
final class StoreKitPurchaseManager {
    static let shared = StoreKitPurchaseManager()

    typealias TransactionEventHandler = ([String: Any]) -> Void

    private var productsByID: [String: Product] = [:]
    private var validatedSubscriptionGroupID: String?
    private var unfinishedTransactions: [UInt64: Transaction] = [:]
    private var retainedUpdateEvents: [[String: Any]] = []
    private var emittedTransactionIDs = Set<UInt64>()
    private var updateHandler: TransactionEventHandler?
    private var updatesTask: Task<Void, Never>?

    private init() {}

    deinit {
        updatesTask?.cancel()
    }

    /// Called from AppDelegate before Capacitor creates the web view. This is
    /// idempotent and also recovers transactions left unfinished by a prior
    /// launch before listening for new StoreKit updates.
    func startObserving() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await verification in Transaction.unfinished {
                guard !Task.isCancelled else { return }
                self?.receive(verification)
            }
            for await verification in Transaction.updates {
                guard !Task.isCancelled else { return }
                self?.receive(verification)
            }
        }
    }

    func setTransactionUpdateHandler(_ handler: @escaping TransactionEventHandler) {
        updateHandler = handler
        let retained = retainedUpdateEvents
        retainedUpdateEvents.removeAll(keepingCapacity: true)
        retained.forEach(handler)
    }

    func loadProducts() async throws -> [String: Any] {
        let products = try await loadValidatedCatalogProducts()
        productsByID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
        let returnedIDs = Set(products.map(\.id))
        let missing = TrackLabStoreKitCatalog.plans
            .map(\.productID)
            .filter { !returnedIDs.contains($0) }
        return [
            "version": 1,
            "products": products.compactMap(productDictionary),
            "missingProductIds": missing,
        ]
    }

    func purchase(productID: String, appAccountToken: UUID) async throws -> [String: Any] {
        guard TrackLabStoreKitCatalog.productIDs.contains(productID) else {
            throw StoreKitPurchaseManagerError.invalidProduct
        }
        if productsByID.count != TrackLabStoreKitCatalog.plans.count
            || validatedSubscriptionGroupID == nil {
            let products = try await loadValidatedCatalogProducts()
            productsByID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
        }
        guard let product = productsByID[productID] else {
            throw StoreKitPurchaseManagerError.productUnavailable
        }
        guard isExpectedMonthlySubscription(product) else {
            productsByID.removeValue(forKey: productID)
            throw StoreKitPurchaseManagerError.invalidSubscriptionConfiguration
        }

        let result = try await product.purchase(options: [.appAccountToken(appAccountToken)])
        switch result {
        case .success(let verification):
            switch verification {
            case .verified(let transaction):
                unfinishedTransactions[transaction.id] = transaction
                return [
                    "version": 1,
                    "status": "success",
                    "transaction": transactionDictionary(
                        verification: verification,
                        transaction: transaction,
                        needsFinish: true
                    ),
                ]
            case .unverified:
                return [
                    "version": 1,
                    "status": "unverified",
                    "transaction": NSNull(),
                    "message": StoreKitPurchaseManagerError.unverifiedTransaction.localizedDescription,
                ]
            }
        case .pending:
            return [
                "version": 1,
                "status": "pending",
                "transaction": NSNull(),
                "message": "The App Store purchase is waiting for approval.",
            ]
        case .userCancelled:
            return [
                "version": 1,
                "status": "userCancelled",
                "transaction": NSNull(),
            ]
        @unknown default:
            return [
                "version": 1,
                "status": "unknown",
                "transaction": NSNull(),
                "message": "The App Store returned an unknown purchase status.",
            ]
        }
    }

    func currentEntitlements() async -> [String: Any] {
        var unverifiedCount = 0
        var transactionsByID: [UInt64: [String: Any]] = [:]

        // Refresh the in-memory unfinished set first. A subscription can be a
        // current entitlement even after its transaction has been finished,
        // so `needsFinish` must not simply mean "currently entitled".
        for await verification in Transaction.unfinished {
            switch verification {
            case .verified(let transaction):
                guard TrackLabStoreKitCatalog.productIDs.contains(transaction.productID) else { continue }
                unfinishedTransactions[transaction.id] = transaction
                transactionsByID[transaction.id] = transactionDictionary(
                    verification: verification,
                    transaction: transaction,
                    needsFinish: true
                )
            case .unverified:
                unverifiedCount += 1
            }
        }

        for await verification in Transaction.currentEntitlements {
            switch verification {
            case .verified(let transaction):
                guard TrackLabStoreKitCatalog.productIDs.contains(transaction.productID) else { continue }
                transactionsByID[transaction.id] = transactionDictionary(
                    verification: verification,
                    transaction: transaction,
                    needsFinish: unfinishedTransactions[transaction.id] != nil
                )
            case .unverified:
                unverifiedCount += 1
            }
        }
        var transactions = Array(transactionsByID.values)
        transactions.sort {
            (($0["bikeSeats"] as? Int) ?? .max) < (($1["bikeSeats"] as? Int) ?? .max)
        }
        return [
            "version": 1,
            "transactions": transactions,
            "unverifiedCount": unverifiedCount,
        ]
    }

    func restore() async throws -> [String: Any] {
        try await AppStore.sync()
        return await currentEntitlements()
    }

    func finish(transactionID: String) async throws -> [String: Any] {
        guard let identifier = UInt64(transactionID), identifier > 0 else {
            throw StoreKitPurchaseManagerError.invalidTransaction
        }

        if let transaction = unfinishedTransactions[identifier] {
            await transaction.finish()
            didFinish(identifier)
            return finishDictionary(identifier: identifier, finished: true)
        }

        for await verification in Transaction.unfinished {
            switch verification {
            case .verified(let transaction) where transaction.id == identifier:
                await transaction.finish()
                didFinish(identifier)
                return finishDictionary(identifier: identifier, finished: true)
            case .unverified(let transaction, _) where transaction.id == identifier:
                throw StoreKitPurchaseManagerError.unverifiedTransaction
            default:
                continue
            }
        }

        // Finishing is deliberately idempotent so a successful backend ack can
        // be retried safely after a navigation, crash, or network response race.
        return finishDictionary(identifier: identifier, finished: false)
    }

    func showManageSubscriptions() async throws {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) else {
            throw StoreKitPurchaseManagerError.noForegroundScene
        }
        try await AppStore.showManageSubscriptions(in: scene)
    }

    private func receive(_ verification: VerificationResult<Transaction>) {
        guard case .verified(let transaction) = verification,
              TrackLabStoreKitCatalog.productIDs.contains(transaction.productID) else { return }
        unfinishedTransactions[transaction.id] = transaction
        guard emittedTransactionIDs.insert(transaction.id).inserted else { return }
        let event = transactionDictionary(
            verification: verification,
            transaction: transaction,
            needsFinish: true
        )
        if let updateHandler {
            updateHandler(event)
        } else {
            retainedUpdateEvents.append(event)
        }
    }

    private func didFinish(_ identifier: UInt64) {
        unfinishedTransactions.removeValue(forKey: identifier)
        emittedTransactionIDs.remove(identifier)
        retainedUpdateEvents.removeAll {
            ($0["transactionId"] as? String) == String(identifier)
        }
    }

    private func finishDictionary(identifier: UInt64, finished: Bool) -> [String: Any] {
        [
            "version": 1,
            "transactionId": String(identifier),
            "finished": finished,
            "alreadyFinished": !finished,
        ]
    }

    private func productDictionary(_ product: Product) -> [String: Any]? {
        guard let bikeSeats = TrackLabStoreKitCatalog.bikeSeats(for: product.id),
              isExpectedMonthlySubscription(product) else { return nil }
        var result: [String: Any] = [
            "productId": product.id,
            "bikeSeats": bikeSeats,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).stringValue,
            "currencyCode": product.priceFormatStyle.currencyCode,
            "subscriptionPeriod": NSNull(),
        ]
        if let period = product.subscription?.subscriptionPeriod {
            result["subscriptionPeriod"] = [
                "unit": subscriptionPeriodUnit(period.unit),
                "value": period.value,
            ]
        }
        return result
    }

    private func loadValidatedCatalogProducts() async throws -> [Product] {
        let products = try await Product.products(for: TrackLabStoreKitCatalog.productIDs)
            .filter {
                TrackLabStoreKitCatalog.productIDs.contains($0.id)
                    && isExpectedMonthlySubscription($0)
            }
            .sorted {
                (TrackLabStoreKitCatalog.bikeSeats(for: $0.id) ?? .max)
                    < (TrackLabStoreKitCatalog.bikeSeats(for: $1.id) ?? .max)
            }
        let groupIDs = Set(products.compactMap {
            $0.subscription?.subscriptionGroupID.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty })
        guard products.count == TrackLabStoreKitCatalog.plans.count,
              groupIDs.count == 1,
              let groupID = groupIDs.first else {
            productsByID.removeAll(keepingCapacity: true)
            validatedSubscriptionGroupID = nil
            throw StoreKitPurchaseManagerError.invalidSubscriptionConfiguration
        }
        validatedSubscriptionGroupID = groupID
        return products
    }

    private func isExpectedMonthlySubscription(_ product: Product) -> Bool {
        guard product.type == .autoRenewable,
              let period = product.subscription?.subscriptionPeriod else { return false }
        return period.unit == .month && period.value == 1
    }

    private func transactionDictionary(
        verification: VerificationResult<Transaction>,
        transaction: Transaction,
        needsFinish: Bool
    ) -> [String: Any] {
        [
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "bikeSeats": TrackLabStoreKitCatalog.bikeSeats(for: transaction.productID) ?? 0,
            "signedTransaction": verification.jwsRepresentation,
            "appAccountToken": transaction.appAccountToken?.uuidString.lowercased() ?? NSNull(),
            "purchaseDate": epochMilliseconds(transaction.purchaseDate),
            "expirationDate": transaction.expirationDate.map(epochMilliseconds) ?? NSNull(),
            "revocationDate": transaction.revocationDate.map(epochMilliseconds) ?? NSNull(),
            "needsFinish": needsFinish,
        ]
    }

    private func epochMilliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded())
    }

    private func subscriptionPeriodUnit(_ unit: Product.SubscriptionPeriod.Unit) -> String {
        switch unit {
        case .day: return "day"
        case .week: return "week"
        case .month: return "month"
        case .year: return "year"
        @unknown default: return "month"
        }
    }
}
