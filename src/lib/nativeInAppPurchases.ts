import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

export const nativeInAppPurchasesPluginName = 'TrackLabStoreKit';
export const nativeStoreKitTransactionUpdatedEvent = 'transactionUpdated';
export const nativeInAppPurchasesContractVersion = 1 as const;

export const wattbikeSubscriptionProducts = [
  { productId: 'com.preskilranch.tracklabbmx.wattbike.1.monthly', bikeSeats: 1 },
  { productId: 'com.preskilranch.tracklabbmx.wattbike.2.monthly', bikeSeats: 2 },
  { productId: 'com.preskilranch.tracklabbmx.wattbike.3.monthly', bikeSeats: 3 },
  { productId: 'com.preskilranch.tracklabbmx.wattbike.4.monthly', bikeSeats: 4 },
] as const;

export type WattbikeSubscriptionProductId =
  typeof wattbikeSubscriptionProducts[number]['productId'];

export type NativeStoreKitSubscriptionPeriod = Readonly<{
  unit: 'day' | 'week' | 'month' | 'year';
  value: number;
}>;

export type NativeStoreKitProduct = Readonly<{
  productId: WattbikeSubscriptionProductId;
  bikeSeats: 1 | 2 | 3 | 4;
  displayName: string;
  description: string;
  /** Localized App Store price. This is the price the UI must display. */
  displayPrice: string;
  /** Decimal price as supplied by StoreKit; never use it to format a price. */
  price: string;
  currencyCode: string | null;
  subscriptionPeriod: NativeStoreKitSubscriptionPeriod;
}>;

export type NativeStoreKitTransaction = Readonly<{
  /** StoreKit UInt64 identifiers cross the bridge as strings to avoid JS precision loss. */
  transactionId: string;
  originalTransactionId: string;
  productId: WattbikeSubscriptionProductId;
  bikeSeats: 1 | 2 | 3 | 4;
  /** Signed transaction JWS. Send this unchanged to the TrackLab server. */
  signedTransaction: string;
  appAccountToken: string | null;
  purchaseDate: number;
  expirationDate: number | null;
  revocationDate: number | null;
  /** True until the server acknowledges the JWS and the caller explicitly finishes it. */
  needsFinish: boolean;
}>;

export type NativeStoreKitProductsResult = Readonly<{
  version: 1;
  products: readonly NativeStoreKitProduct[];
  missingProductIds: readonly WattbikeSubscriptionProductId[];
}>;

export type NativeStoreKitEntitlementsResult = Readonly<{
  version: 1;
  transactions: readonly NativeStoreKitTransaction[];
  unverifiedCount: number;
}>;

export type NativeStoreKitPurchaseStatus =
  | 'success'
  | 'pending'
  | 'userCancelled'
  | 'unverified'
  | 'unknown';

export type NativeStoreKitPurchaseResult = Readonly<{
  version: 1;
  status: NativeStoreKitPurchaseStatus;
  transaction: NativeStoreKitTransaction | null;
  message?: string;
}>;

export type NativeStoreKitTransactionUpdatedEvent = NativeStoreKitTransaction;

export type NativeStoreKitPlugin = {
  getProducts: () => Promise<unknown>;
  purchase: (options: {
    productId: WattbikeSubscriptionProductId;
    appAccountToken: string;
  }) => Promise<unknown>;
  getCurrentEntitlements: () => Promise<unknown>;
  restore: () => Promise<unknown>;
  finish: (options: { transactionId: string }) => Promise<unknown>;
  manageSubscriptions: () => Promise<unknown>;
  addListener: (
    eventName: typeof nativeStoreKitTransactionUpdatedEvent,
    listener: (event: unknown) => void,
  ) => Promise<PluginListenerHandle>;
};

export type NativeInAppPurchasesClient = Readonly<{
  isAvailable: () => boolean;
  getProducts: () => Promise<NativeStoreKitProductsResult>;
  purchase: (
    productId: WattbikeSubscriptionProductId,
    appAccountToken: string,
  ) => Promise<NativeStoreKitPurchaseResult>;
  getCurrentEntitlements: () => Promise<NativeStoreKitEntitlementsResult>;
  /** Explicit user-initiated restore. This calls AppStore.sync() natively. */
  restore: () => Promise<NativeStoreKitEntitlementsResult>;
  /** Call only after the backend has durably acknowledged signedTransaction. */
  finish: (transactionId: string) => Promise<{
    version: 1;
    transactionId: string;
    finished: boolean;
    alreadyFinished: boolean;
  }>;
  manageSubscriptions: () => Promise<void>;
  addTransactionUpdatedListener: (
    listener: (event: NativeStoreKitTransactionUpdatedEvent) => void,
  ) => Promise<PluginListenerHandle>;
}>;

type CapacitorFeatureDetector = Pick<
  typeof Capacitor,
  'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'
>;

const rawPlugin = registerPlugin<NativeStoreKitPlugin>(nativeInAppPurchasesPluginName);
const productById = new Map<string, typeof wattbikeSubscriptionProducts[number]>(
  wattbikeSubscriptionProducts.map((product) => [product.productId, product]),
);
const purchaseStatuses = new Set<NativeStoreKitPurchaseStatus>([
  'success',
  'pending',
  'userCancelled',
  'unverified',
  'unknown',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unsignedIntegerPattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const signedJWSPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && new TextEncoder().encode(normalized).length <= maximumBytes
    ? normalized
    : null;
}

function epoch(value: unknown, nullable = false): number | null {
  if (value == null && nullable) return null;
  const number = Number(value);
  return Number.isSafeInteger(Math.round(number)) && number >= 0
    ? Math.round(number)
    : null;
}

function normalizedTransactionId(value: unknown): string | null {
  const normalized = boundedText(value, 24);
  return normalized && unsignedIntegerPattern.test(normalized) ? normalized : null;
}

function normalizedProductId(value: unknown): WattbikeSubscriptionProductId | null {
  return typeof value === 'string' && productById.has(value)
    ? value as WattbikeSubscriptionProductId
    : null;
}

function normalizeSubscriptionPeriod(value: unknown): NativeStoreKitSubscriptionPeriod | null {
  if (value == null) return null;
  const item = record(value);
  const unit = item?.unit;
  const periodValue = Number(item?.value);
  if (
    !item
    || !['day', 'week', 'month', 'year'].includes(String(unit))
    || !Number.isSafeInteger(periodValue)
    || periodValue < 1
    || periodValue > 100
  ) return null;
  return {
    unit: unit as NativeStoreKitSubscriptionPeriod['unit'],
    value: periodValue,
  };
}

export function normalizeNativeStoreKitProduct(value: unknown): NativeStoreKitProduct | null {
  const item = record(value);
  const productId = normalizedProductId(item?.productId);
  const catalogProduct = productId ? productById.get(productId) : undefined;
  const displayName = boundedText(item?.displayName, 500);
  const description = typeof item?.description === 'string'
    ? item.description.trim().slice(0, 2_000)
    : null;
  const displayPrice = boundedText(item?.displayPrice, 100);
  const price = boundedText(item?.price, 100);
  const currencyCode = item?.currencyCode == null
    ? null
    : boundedText(item.currencyCode, 16);
  const subscriptionPeriod = normalizeSubscriptionPeriod(item?.subscriptionPeriod);
  if (
    !item
    || !productId
    || !catalogProduct
    || !displayName
    || description == null
    || !displayPrice
    || !price
    || (item.currencyCode != null && !currencyCode)
    || subscriptionPeriod?.unit !== 'month'
    || subscriptionPeriod.value !== 1
  ) return null;
  return {
    productId,
    bikeSeats: catalogProduct.bikeSeats,
    displayName,
    description,
    displayPrice,
    price,
    currencyCode,
    subscriptionPeriod,
  };
}

export function normalizeNativeStoreKitTransaction(
  value: unknown,
): NativeStoreKitTransaction | null {
  const item = record(value);
  const transactionId = normalizedTransactionId(item?.transactionId);
  const originalTransactionId = normalizedTransactionId(item?.originalTransactionId);
  const productId = normalizedProductId(item?.productId);
  const catalogProduct = productId ? productById.get(productId) : undefined;
  const signedTransaction = boundedText(item?.signedTransaction, 40_000);
  const appAccountToken = item?.appAccountToken == null
    ? null
    : boundedText(item.appAccountToken, 64);
  const purchaseDate = epoch(item?.purchaseDate);
  const expirationDate = epoch(item?.expirationDate, true);
  const revocationDate = epoch(item?.revocationDate, true);
  if (
    !item
    || !transactionId
    || !originalTransactionId
    || !productId
    || !catalogProduct
    || !signedTransaction
    || !signedJWSPattern.test(signedTransaction)
    || (appAccountToken != null && !uuidPattern.test(appAccountToken))
    || purchaseDate == null
    || (item.expirationDate != null && expirationDate == null)
    || (item.revocationDate != null && revocationDate == null)
    || typeof item.needsFinish !== 'boolean'
  ) return null;
  return {
    transactionId,
    originalTransactionId,
    productId,
    bikeSeats: catalogProduct.bikeSeats,
    signedTransaction,
    appAccountToken,
    purchaseDate,
    expirationDate,
    revocationDate,
    needsFinish: item.needsFinish,
  };
}

function normalizeProductsResult(value: unknown): NativeStoreKitProductsResult | null {
  const item = record(value);
  if (!item || item.version !== nativeInAppPurchasesContractVersion) return null;
  const rawProducts = Array.isArray(item.products) ? item.products : null;
  const rawMissingIds = Array.isArray(item.missingProductIds) ? item.missingProductIds : null;
  if (!rawProducts || !rawMissingIds) return null;
  const products = rawProducts.map(normalizeNativeStoreKitProduct);
  const missingProductIds = rawMissingIds.map(normalizedProductId);
  if (products.some((product) => !product) || missingProductIds.some((id) => !id)) return null;
  const productIds = products.map((product) => product!.productId);
  const missingIds = missingProductIds as WattbikeSubscriptionProductId[];
  const completeCatalog = [...productIds, ...missingIds];
  if (
    new Set(productIds).size !== productIds.length
    || new Set(missingIds).size !== missingIds.length
    || new Set(completeCatalog).size !== wattbikeSubscriptionProducts.length
    || wattbikeSubscriptionProducts.some(({ productId }) => !completeCatalog.includes(productId))
  ) return null;
  return {
    version: nativeInAppPurchasesContractVersion,
    products: products as NativeStoreKitProduct[],
    missingProductIds: missingIds,
  };
}

function normalizeEntitlementsResult(value: unknown): NativeStoreKitEntitlementsResult | null {
  const item = record(value);
  const unverifiedCount = Number(item?.unverifiedCount);
  const rawTransactions = Array.isArray(item?.transactions) ? item.transactions : null;
  if (
    !item
    || item.version !== nativeInAppPurchasesContractVersion
    || !rawTransactions
    || !Number.isSafeInteger(unverifiedCount)
    || unverifiedCount < 0
  ) return null;
  const transactions = rawTransactions.map(normalizeNativeStoreKitTransaction);
  if (transactions.some((transaction) => !transaction)) return null;
  return {
    version: nativeInAppPurchasesContractVersion,
    transactions: transactions as NativeStoreKitTransaction[],
    unverifiedCount,
  };
}

function normalizePurchaseResult(value: unknown): NativeStoreKitPurchaseResult | null {
  const item = record(value);
  const status = item?.status as NativeStoreKitPurchaseStatus;
  const transaction = item?.transaction == null
    ? null
    : normalizeNativeStoreKitTransaction(item.transaction);
  const message = typeof item?.message === 'string'
    ? item.message.trim().slice(0, 500)
    : '';
  if (
    !item
    || item.version !== nativeInAppPurchasesContractVersion
    || !purchaseStatuses.has(status)
    || (item.transaction != null && !transaction)
    || (status === 'success' && !transaction)
    || (status !== 'success' && transaction)
  ) return null;
  return {
    version: nativeInAppPurchasesContractVersion,
    status,
    transaction,
    ...(message ? { message } : {}),
  };
}

function emptyListenerHandle(): PluginListenerHandle {
  return { remove: async () => undefined };
}

function unavailableError(): Error {
  return new Error('Apple in-app purchases are available in the TrackLab iPhone and iPad app.');
}

function requireResponse<T>(value: T | null, message: string): T {
  if (value) return value;
  throw new Error(message);
}

export function createNativeInAppPurchasesClient({
  capacitor = Capacitor,
  plugin = rawPlugin,
}: {
  capacitor?: CapacitorFeatureDetector;
  plugin?: NativeStoreKitPlugin;
} = {}): NativeInAppPurchasesClient {
  const isAvailable = () => {
    try {
      return capacitor.getPlatform() === 'ios'
        && capacitor.isNativePlatform()
        && capacitor.isPluginAvailable(nativeInAppPurchasesPluginName);
    } catch {
      return false;
    }
  };
  const requireAvailable = () => {
    if (!isAvailable()) throw unavailableError();
  };

  return {
    isAvailable,
    async getProducts() {
      requireAvailable();
      return requireResponse(
        normalizeProductsResult(await plugin.getProducts()),
        'The App Store returned invalid Wattbike product information.',
      );
    },
    async purchase(productId, appAccountToken) {
      requireAvailable();
      const normalizedProduct = normalizedProductId(productId);
      const normalizedToken = boundedText(appAccountToken, 64);
      if (!normalizedProduct) throw new Error('Choose a valid Wattbike connection plan.');
      if (!normalizedToken || !uuidPattern.test(normalizedToken)) {
        throw new Error('The TrackLab account could not be linked to this App Store purchase.');
      }
      return requireResponse(
        normalizePurchaseResult(await plugin.purchase({
          productId: normalizedProduct,
          appAccountToken: normalizedToken,
        })),
        'The App Store returned an invalid purchase result.',
      );
    },
    async getCurrentEntitlements() {
      requireAvailable();
      return requireResponse(
        normalizeEntitlementsResult(await plugin.getCurrentEntitlements()),
        'The App Store returned invalid current subscriptions.',
      );
    },
    async restore() {
      requireAvailable();
      return requireResponse(
        normalizeEntitlementsResult(await plugin.restore()),
        'The App Store returned invalid restored subscriptions.',
      );
    },
    async finish(transactionId) {
      requireAvailable();
      const normalizedId = normalizedTransactionId(transactionId);
      if (!normalizedId) throw new Error('The App Store transaction identifier is invalid.');
      const response = record(await plugin.finish({ transactionId: normalizedId }));
      if (
        !response
        || response.version !== nativeInAppPurchasesContractVersion
        || normalizedTransactionId(response.transactionId) !== normalizedId
        || typeof response.finished !== 'boolean'
        || typeof response.alreadyFinished !== 'boolean'
        || response.finished === response.alreadyFinished
      ) throw new Error('The App Store returned an invalid transaction completion result.');
      return {
        version: nativeInAppPurchasesContractVersion,
        transactionId: normalizedId,
        finished: response.finished,
        alreadyFinished: response.alreadyFinished,
      };
    },
    async manageSubscriptions() {
      requireAvailable();
      await plugin.manageSubscriptions();
    },
    async addTransactionUpdatedListener(listener) {
      if (!isAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeStoreKitTransactionUpdatedEvent, (event) => {
        const normalized = normalizeNativeStoreKitTransaction(event);
        if (normalized) listener(normalized);
      });
    },
  };
}

export const nativeInAppPurchases = createNativeInAppPurchasesClient();
