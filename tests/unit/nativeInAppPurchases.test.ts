import { describe, expect, it, vi } from 'vitest';
import {
  createNativeInAppPurchasesClient,
  nativeInAppPurchasesPluginName,
  normalizeNativeStoreKitProduct,
  normalizeNativeStoreKitTransaction,
  wattbikeSubscriptionProducts,
  type NativeStoreKitPlugin,
} from '../../src/lib/nativeInAppPurchases';

const accountToken = '8ad02b22-4526-4b02-b4aa-1ca1700cda51';
const productId = wattbikeSubscriptionProducts[0].productId;
const transaction = {
  transactionId: '9223372036854775807',
  originalTransactionId: '9223372036854775806',
  productId,
  bikeSeats: 1,
  signedTransaction: 'eyJhbGciOiJFUzI1NiJ9.eyJ0cmFuc2FjdGlvbklkIjoiMSJ9.signature',
  appAccountToken: accountToken,
  purchaseDate: 1_788_000_000_000,
  expirationDate: 1_790_678_400_000,
  revocationDate: null,
  needsFinish: true,
};
const product = {
  productId,
  bikeSeats: 1,
  displayName: '1 Wattbike connection',
  description: 'One monthly Wattbike connection.',
  displayPrice: '$9.99',
  price: '9.99',
  currencyCode: 'USD',
  subscriptionPeriod: { unit: 'month', value: 1 },
};

function detector({
  platform = 'ios',
  native = true,
  available = true,
}: {
  platform?: string;
  native?: boolean;
  available?: boolean;
} = {}) {
  return {
    getPlatform: () => platform,
    isNativePlatform: () => native,
    isPluginAvailable: (name: string) => available && name === nativeInAppPurchasesPluginName,
  };
}

function fakePlugin(overrides: Partial<NativeStoreKitPlugin> = {}): NativeStoreKitPlugin {
  return {
    getProducts: vi.fn(async () => ({
      version: 1,
      products: [product],
      missingProductIds: wattbikeSubscriptionProducts.slice(1).map((item) => item.productId),
    })),
    purchase: vi.fn(async () => ({
      version: 1,
      status: 'success',
      transaction,
    })),
    getCurrentEntitlements: vi.fn(async () => ({
      version: 1,
      transactions: [transaction],
      unverifiedCount: 0,
    })),
    restore: vi.fn(async () => ({
      version: 1,
      transactions: [transaction],
      unverifiedCount: 0,
    })),
    finish: vi.fn(async ({ transactionId }) => ({
      version: 1,
      transactionId,
      finished: true,
      alreadyFinished: false,
    })),
    manageSubscriptions: vi.fn(async () => ({ version: 1, opened: true })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
    ...overrides,
  };
}

describe('native StoreKit adapter', () => {
  it('accepts only the fixed Wattbike catalog and verified transaction wire shape', () => {
    expect(normalizeNativeStoreKitProduct(product)).toMatchObject({
      productId,
      bikeSeats: 1,
      displayPrice: '$9.99',
    });
    expect(normalizeNativeStoreKitProduct({
      ...product,
      productId: 'com.example.unknown',
    })).toBeNull();
    expect(normalizeNativeStoreKitProduct({
      ...product,
      subscriptionPeriod: null,
    })).toBeNull();
    expect(normalizeNativeStoreKitProduct({
      ...product,
      subscriptionPeriod: { unit: 'year', value: 1 },
    })).toBeNull();
    expect(normalizeNativeStoreKitProduct({
      ...product,
      subscriptionPeriod: { unit: 'month', value: 3 },
    })).toBeNull();
    expect(normalizeNativeStoreKitTransaction(transaction)).toEqual(transaction);
    expect(normalizeNativeStoreKitTransaction({
      ...transaction,
      signedTransaction: 'not-a-signed-jws',
    })).toBeNull();
    expect(normalizeNativeStoreKitTransaction({
      ...transaction,
      appAccountToken: 'not-a-uuid',
    })).toBeNull();
  });

  it('requires native iOS and the installed plugin before calling StoreKit', async () => {
    for (const unavailable of [
      detector({ platform: 'web', native: false }),
      detector({ available: false }),
    ]) {
      const plugin = fakePlugin();
      const client = createNativeInAppPurchasesClient({ capacitor: unavailable, plugin });
      expect(client.isAvailable()).toBe(false);
      await expect(client.getProducts()).rejects.toThrow('iPhone and iPad app');
      await expect(client.addTransactionUpdatedListener(vi.fn())).resolves.toHaveProperty('remove');
      expect(plugin.getProducts).not.toHaveBeenCalled();
      expect(plugin.addListener).not.toHaveBeenCalled();
    }
  });

  it('fails closed when the StoreKit catalog omits or duplicates a product without reporting it missing', async () => {
    const malformedCatalog = fakePlugin({
      getProducts: vi.fn(async () => ({
        version: 1,
        products: [product, product],
        missingProductIds: wattbikeSubscriptionProducts.slice(2).map((item) => item.productId),
      })),
    });
    const client = createNativeInAppPurchasesClient({
      capacitor: detector(),
      plugin: malformedCatalog,
    });

    await expect(client.getProducts()).rejects.toThrow('invalid Wattbike product information');
  });

  it('rejects an invalid app-account UUID before opening the purchase sheet', async () => {
    const plugin = fakePlugin();
    const client = createNativeInAppPurchasesClient({ capacitor: detector(), plugin });

    await expect(client.purchase(productId, 'not-a-uuid')).rejects.toThrow('could not be linked');
    expect(plugin.purchase).not.toHaveBeenCalled();
  });

  it('returns the signed transaction unfinished and finishes only on an explicit backend ack', async () => {
    const plugin = fakePlugin();
    const client = createNativeInAppPurchasesClient({ capacitor: detector(), plugin });

    await expect(client.purchase(productId, accountToken)).resolves.toMatchObject({
      status: 'success',
      transaction: { signedTransaction: transaction.signedTransaction, needsFinish: true },
    });
    expect(plugin.finish).not.toHaveBeenCalled();

    await expect(client.finish(transaction.transactionId)).resolves.toMatchObject({
      transactionId: transaction.transactionId,
      finished: true,
      alreadyFinished: false,
    });
    expect(plugin.finish).toHaveBeenCalledWith({ transactionId: transaction.transactionId });
  });
});
