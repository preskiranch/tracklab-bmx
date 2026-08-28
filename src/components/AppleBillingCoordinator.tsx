import { useEffect } from 'react';
import type { AuthUser } from '../lib/auth';
import { readCurrentAuthUser } from '../lib/auth';
import {
  appleBillingServerIsReady,
  claimAppleTransaction,
  reconcileAppleBillingStatus,
} from '../lib/appleBilling';
import {
  nativeInAppPurchases,
  type NativeStoreKitTransaction,
} from '../lib/nativeInAppPurchases';

type AppleBillingCoordinatorProps = {
  accountId: string | null;
  onUserRefresh: (user: AuthUser) => void;
};

type AppleBillingLifecycleDependencies = {
  serverIsReady: () => Promise<boolean>;
  claimTransaction: (transaction: NativeStoreKitTransaction) => Promise<unknown>;
  reconcileStatus: () => Promise<unknown>;
  readUser: () => Promise<AuthUser | null>;
  getCurrentEntitlements: () => Promise<{ transactions: readonly NativeStoreKitTransaction[] }>;
  addTransactionUpdatedListener: (
    listener: (transaction: NativeStoreKitTransaction) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
  isForeground: () => boolean;
  isOnline: () => boolean;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
  addWindowListener: (type: 'focus' | 'online', listener: () => void) => void;
  removeWindowListener: (type: 'focus' | 'online', listener: () => void) => void;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
  warn: (message: string) => void;
};

type AppleBillingLifecycleOptions = {
  accountId: string;
  onUserRefresh: (user: AuthUser) => void;
};

export const appleBillingForegroundRefreshMs = 5 * 60 * 1_000;
export const appleBillingRetryDelaysMs = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000] as const;

function browserAppleBillingDependencies(): AppleBillingLifecycleDependencies {
  return {
    serverIsReady: appleBillingServerIsReady,
    claimTransaction: claimAppleTransaction,
    reconcileStatus: reconcileAppleBillingStatus,
    readUser: readCurrentAuthUser,
    getCurrentEntitlements: () => nativeInAppPurchases.getCurrentEntitlements(),
    addTransactionUpdatedListener: (listener) => (
      nativeInAppPurchases.addTransactionUpdatedListener(listener)
    ),
    isForeground: () => document.visibilityState !== 'hidden',
    isOnline: () => navigator.onLine !== false,
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timer) => window.clearTimeout(timer),
    addWindowListener: (type, listener) => window.addEventListener(type, listener),
    removeWindowListener: (type, listener) => window.removeEventListener(type, listener),
    addVisibilityListener: (listener) => document.addEventListener('visibilitychange', listener),
    removeVisibilityListener: (listener) => document.removeEventListener('visibilitychange', listener),
    // Never include native or server error details here: those may contain a signed JWS.
    warn: (message) => console.warn(message),
  };
}

/**
 * Keeps the local auth snapshot aligned with Apple lifecycle changes. This reads
 * StoreKit's local current entitlements; only the explicit Restore action calls
 * AppStore.sync().
 */
export function startAppleBillingLifecycle(
  { accountId, onUserRefresh }: AppleBillingLifecycleOptions,
  dependencies: AppleBillingLifecycleDependencies = browserAppleBillingDependencies(),
) {
  let disposed = false;
  let timer: number | null = null;
  let inFlight: Promise<void> | null = null;
  let runAgain = false;
  let retryAttempt = 0;
  let storeKitListener: { remove: () => Promise<void> } | null = null;
  const pendingTransactions = new Map<string, NativeStoreKitTransaction>();
  const acknowledgedTransactions = new Set<string>();

  const clearScheduledTimer = () => {
    if (timer === null) return;
    dependencies.clearTimer(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearScheduledTimer();
    if (disposed || !dependencies.isForeground()) return;
    timer = dependencies.setTimer(() => {
      timer = null;
      void requestReconcile();
    }, delayMs);
  };

  const scheduleRetry = () => {
    const delay = appleBillingRetryDelaysMs[
      Math.min(retryAttempt, appleBillingRetryDelaysMs.length - 1)
    ];
    retryAttempt += 1;
    schedule(delay);
  };

  const runCycle = async () => {
    let succeeded = true;
    let ready = false;

    try {
      ready = await dependencies.serverIsReady();
    } catch {
      ready = false;
    }

    if (ready) {
      try {
        const current = await dependencies.getCurrentEntitlements();
        for (const transaction of current.transactions) {
          if (!acknowledgedTransactions.has(transaction.transactionId)) {
            pendingTransactions.set(transaction.transactionId, transaction);
          }
        }
      } catch {
        succeeded = false;
      }

      for (const [transactionId, transaction] of [...pendingTransactions]) {
        try {
          await dependencies.claimTransaction(transaction);
          pendingTransactions.delete(transactionId);
          acknowledgedTransactions.add(transactionId);
        } catch {
          succeeded = false;
        }
      }

      try {
        await dependencies.reconcileStatus();
      } catch {
        succeeded = false;
      }
    } else {
      succeeded = false;
    }

    // Refresh auth even when Apple is temporarily unavailable. A server
    // notification may already have changed or expired the membership.
    try {
      const user = await dependencies.readUser();
      if (!disposed && user?.id === accountId) onUserRefresh(user);
    } catch {
      succeeded = false;
    }

    return succeeded;
  };

  const requestReconcile = (allowWhileHidden = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    clearScheduledTimer();

    if ((!allowWhileHidden && !dependencies.isForeground()) || !dependencies.isOnline()) {
      scheduleRetry();
      return Promise.resolve();
    }

    if (inFlight) {
      runAgain = true;
      return inFlight;
    }

    let succeeded = false;
    inFlight = runCycle()
      .then((result) => {
        succeeded = result;
      })
      .catch(() => {
        succeeded = false;
      })
      .finally(() => {
        inFlight = null;
        if (disposed) return;
        if (runAgain) {
          runAgain = false;
          void requestReconcile();
          return;
        }
        if (succeeded) {
          retryAttempt = 0;
          schedule(appleBillingForegroundRefreshMs);
        } else {
          dependencies.warn('App Store access could not be refreshed and will retry.');
          scheduleRetry();
        }
      });
    return inFlight;
  };

  const handleFocus = () => {
    if (dependencies.isForeground()) void requestReconcile();
  };
  const handleOnline = () => {
    if (dependencies.isForeground()) void requestReconcile();
  };
  const handleVisibilityChange = () => {
    if (dependencies.isForeground()) {
      void requestReconcile();
    } else {
      clearScheduledTimer();
    }
  };
  const handleStoreKitUpdate = (transaction: NativeStoreKitTransaction) => {
    if (!acknowledgedTransactions.has(transaction.transactionId)) {
      pendingTransactions.set(transaction.transactionId, transaction);
    }
    // StoreKit updates are actionable immediately, even if iOS is transitioning
    // the web view between lifecycle states.
    void requestReconcile(true);
  };

  dependencies.addWindowListener('focus', handleFocus);
  dependencies.addWindowListener('online', handleOnline);
  dependencies.addVisibilityListener(handleVisibilityChange);
  void dependencies.addTransactionUpdatedListener(handleStoreKitUpdate)
    .then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      storeKitListener = listener;
    })
    .catch(() => {
      dependencies.warn('App Store transaction updates are temporarily unavailable.');
    });
  void requestReconcile();

  return {
    reconcileNow: () => requestReconcile(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearScheduledTimer();
      dependencies.removeWindowListener('focus', handleFocus);
      dependencies.removeWindowListener('online', handleOnline);
      dependencies.removeVisibilityListener(handleVisibilityChange);
      if (storeKitListener) void storeKitListener.remove();
      pendingTransactions.clear();
      acknowledgedTransactions.clear();
    },
  };
}

export function AppleBillingCoordinator({
  accountId,
  onUserRefresh,
}: AppleBillingCoordinatorProps) {
  useEffect(() => {
    // App renders this coordinator only outside club-tablet kiosk mode.
    if (!accountId || !nativeInAppPurchases.isAvailable()) return;
    const lifecycle = startAppleBillingLifecycle({ accountId, onUserRefresh });
    return () => lifecycle.dispose();
  }, [accountId, onUserRefresh]);

  return null;
}
