import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/lib/auth';
import {
  appleBillingForegroundRefreshMs,
  appleBillingRetryDelaysMs,
  startAppleBillingLifecycle,
} from '../../src/components/AppleBillingCoordinator';
import {
  wattbikeSubscriptionProducts,
  type NativeStoreKitTransaction,
} from '../../src/lib/nativeInAppPurchases';

const accountId = '8ad02b22-4526-4b02-b4aa-1ca1700cda51';
const signedTransaction = 'eyJhbGciOiJFUzI1NiJ9.eyJ0cmFuc2FjdGlvbklkIjoiMSJ9.signature';
const transaction: NativeStoreKitTransaction = {
  transactionId: '9223372036854775807',
  originalTransactionId: '9223372036854775806',
  productId: wattbikeSubscriptionProducts[0].productId,
  bikeSeats: 1,
  signedTransaction,
  appAccountToken: accountId,
  purchaseDate: 1_788_000_000_000,
  expirationDate: 1_790_678_400_000,
  revocationDate: null,
  needsFinish: true,
};
const expiredUser: AuthUser = {
  id: accountId,
  profileKey: 'account:rasheen',
  email: 'rasheen@example.com',
  name: 'Rasheen',
  admin: false,
  membership: {
    tier: 'visitor',
    bikeSeats: 1,
    updatedAt: 1_800_000_000_000,
  },
};

async function flushAsync(rounds = 30) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness(overrides: Record<string, unknown> = {}) {
  let foreground = true;
  let online = true;
  let nextTimerId = 1;
  let storeKitUpdate: ((value: NativeStoreKitTransaction) => void) | null = null;
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const windowListeners = new Map<string, Set<() => void>>();
  const visibilityListeners = new Set<() => void>();
  const removeStoreKitListener = vi.fn(async () => undefined);
  const base = {
    serverIsReady: vi.fn(async () => true),
    claimTransaction: vi.fn(async () => undefined),
    reconcileStatus: vi.fn(async () => undefined),
    readUser: vi.fn(async () => expiredUser),
    getCurrentEntitlements: vi.fn(async () => ({ transactions: [transaction] })),
    addTransactionUpdatedListener: vi.fn(async (
      listener: (value: NativeStoreKitTransaction) => void,
    ) => {
      storeKitUpdate = listener;
      return { remove: removeStoreKitListener };
    }),
    isForeground: () => foreground,
    isOnline: () => online,
    setTimer: (callback: () => void, delayMs: number) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clearTimer: (timer: number) => {
      timers.delete(timer);
    },
    addWindowListener: (type: 'focus' | 'online', listener: () => void) => {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeWindowListener: (type: 'focus' | 'online', listener: () => void) => {
      windowListeners.get(type)?.delete(listener);
    },
    addVisibilityListener: (listener: () => void) => visibilityListeners.add(listener),
    removeVisibilityListener: (listener: () => void) => visibilityListeners.delete(listener),
    warn: vi.fn(),
    ...overrides,
  };

  return {
    dependencies: base,
    timers,
    removeStoreKitListener,
    setForeground(value: boolean) {
      foreground = value;
    },
    setOnline(value: boolean) {
      online = value;
    },
    fireWindow(type: 'focus' | 'online') {
      for (const listener of windowListeners.get(type) ?? []) listener();
    },
    fireVisibility() {
      for (const listener of visibilityListeners) listener();
    },
    fireStoreKitUpdate(value: NativeStoreKitTransaction) {
      if (!storeKitUpdate) throw new Error('StoreKit listener is not ready.');
      storeKitUpdate(value);
    },
    runTimer() {
      const entry = [...timers.entries()][0];
      if (!entry) throw new Error('No timer is scheduled.');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    listenerCount() {
      return [...windowListeners.values()].reduce((total, listeners) => total + listeners.size, 0)
        + visibilityListeners.size;
    },
  };
}

describe('Apple billing lifecycle coordinator', () => {
  it('reconciles every five foreground minutes and delivers membership expiry to App state', async () => {
    const test = harness();
    const onUserRefresh = vi.fn();
    const lifecycle = startAppleBillingLifecycle(
      { accountId, onUserRefresh },
      test.dependencies,
    );

    await flushAsync();

    expect(test.dependencies.reconcileStatus).toHaveBeenCalledTimes(1);
    expect(test.dependencies.readUser).toHaveBeenCalledTimes(1);
    expect(onUserRefresh).toHaveBeenCalledWith(expiredUser);
    expect(test.dependencies.claimTransaction).toHaveBeenCalledTimes(1);
    expect([...test.timers.values()].map((item) => item.delayMs)).toEqual([
      appleBillingForegroundRefreshMs,
    ]);

    test.runTimer();
    await flushAsync();

    expect(test.dependencies.reconcileStatus).toHaveBeenCalledTimes(2);
    expect(test.dependencies.readUser).toHaveBeenCalledTimes(2);
    expect(test.dependencies.claimTransaction).toHaveBeenCalledTimes(1);

    test.setForeground(false);
    test.fireVisibility();
    expect(test.timers.size).toBe(0);
    test.setForeground(true);
    test.fireVisibility();
    await flushAsync();
    expect(test.dependencies.reconcileStatus).toHaveBeenCalledTimes(3);

    test.fireWindow('focus');
    await flushAsync();
    expect(test.dependencies.reconcileStatus).toHaveBeenCalledTimes(4);
    test.fireWindow('online');
    await flushAsync();
    expect(test.dependencies.reconcileStatus).toHaveBeenCalledTimes(5);

    lifecycle.dispose();
    await flushAsync();
    expect(test.listenerCount()).toBe(0);
    expect(test.timers.size).toBe(0);
    expect(test.removeStoreKitListener).toHaveBeenCalledTimes(1);
  });

  it('coalesces focus, online, visibility, and StoreKit events without overlapping requests', async () => {
    const firstStatus = deferred<void>();
    const reconcileStatus = vi.fn()
      .mockImplementationOnce(() => firstStatus.promise)
      .mockResolvedValue(undefined);
    const getCurrentEntitlements = vi.fn(async () => ({ transactions: [] }));
    const test = harness({ reconcileStatus, getCurrentEntitlements });
    const lifecycle = startAppleBillingLifecycle(
      { accountId, onUserRefresh: vi.fn() },
      test.dependencies,
    );

    await flushAsync();
    expect(reconcileStatus).toHaveBeenCalledTimes(1);

    test.fireWindow('focus');
    test.fireWindow('online');
    test.fireVisibility();
    test.fireStoreKitUpdate(transaction);
    await flushAsync();
    expect(reconcileStatus).toHaveBeenCalledTimes(1);

    firstStatus.resolve(undefined);
    await flushAsync();

    expect(reconcileStatus).toHaveBeenCalledTimes(2);
    expect(test.dependencies.claimTransaction).toHaveBeenCalledTimes(1);
    expect([...test.timers.values()].map((item) => item.delayMs)).toEqual([
      appleBillingForegroundRefreshMs,
    ]);
    lifecycle.dispose();
  });

  it('backs off safely, still refreshes auth, and never logs a signed transaction', async () => {
    const claimTransaction = vi.fn()
      .mockRejectedValueOnce(new Error(`claim failed: ${signedTransaction}`))
      .mockResolvedValue(undefined);
    const reconcileStatus = vi.fn()
      .mockRejectedValueOnce(new Error(`status failed: ${signedTransaction}`))
      .mockResolvedValue(undefined);
    const warn = vi.fn();
    const test = harness({ claimTransaction, reconcileStatus, warn });
    const onUserRefresh = vi.fn();
    const lifecycle = startAppleBillingLifecycle(
      { accountId, onUserRefresh },
      test.dependencies,
    );

    await flushAsync();

    expect(onUserRefresh).toHaveBeenCalledWith(expiredUser);
    expect([...test.timers.values()].map((item) => item.delayMs)).toEqual([
      appleBillingRetryDelaysMs[0],
    ]);
    expect(warn).toHaveBeenCalledWith('App Store access could not be refreshed and will retry.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(signedTransaction);

    test.runTimer();
    await flushAsync();

    expect(claimTransaction).toHaveBeenCalledTimes(2);
    expect(reconcileStatus).toHaveBeenCalledTimes(2);
    expect([...test.timers.values()].map((item) => item.delayMs)).toEqual([
      appleBillingForegroundRefreshMs,
    ]);
    lifecycle.dispose();
  });
});
