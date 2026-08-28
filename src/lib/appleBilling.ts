import {
  nativeInAppPurchases,
  type NativeStoreKitTransaction,
} from './nativeInAppPurchases';
import { trackLabAuthenticatedFetch } from './serviceTransport';

type AppleTransactionClaimDependencies = {
  fetch: typeof globalThis.fetch;
  finish: (transactionId: string) => Promise<unknown>;
};

const defaultDependencies: AppleTransactionClaimDependencies = {
  fetch: trackLabAuthenticatedFetch,
  finish: (transactionId) => nativeInAppPurchases.finish(transactionId),
};

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  return `App Store transaction verification returned ${response.status}.`;
}

/**
 * Sends Apple's signed transaction to TrackLab before StoreKit is allowed to
 * finish it. An interrupted claim remains unfinished so StoreKit can redeliver
 * it after the app or network recovers.
 */
export async function claimAppleTransaction(
  transaction: NativeStoreKitTransaction,
  dependencies: AppleTransactionClaimDependencies = defaultDependencies,
  options: { restore?: boolean } = {},
) {
  if (!transaction.signedTransaction.trim()) {
    throw new Error('Apple did not provide a signed transaction to verify.');
  }

  const response = await dependencies.fetch('/api/billing/apple/transactions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedTransaction: transaction.signedTransaction,
      ...(options.restore === true ? { restore: true } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  if (transaction.needsFinish) {
    await dependencies.finish(transaction.transactionId);
  }
}

export async function claimAppleTransactions(
  transactions: readonly NativeStoreKitTransaction[],
  dependencies: AppleTransactionClaimDependencies = defaultDependencies,
  options: { restore?: boolean } = {},
) {
  for (const transaction of transactions) {
    await claimAppleTransaction(transaction, dependencies, options);
  }
}

/** Reconciles the signed-in account against server-observed Apple lifecycle state. */
export async function reconcileAppleBillingStatus(fetcher: typeof globalThis.fetch = trackLabAuthenticatedFetch) {
  const response = await fetcher('/api/billing/apple/status', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
}

export async function appleBillingServerIsReady(fetcher: typeof globalThis.fetch = trackLabAuthenticatedFetch) {
  try {
    const response = await fetcher('/api/billing/config', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return payload?.provider === 'apple-app-store'
      && payload.enabled === true
      && payload.configured === true;
  } catch {
    return false;
  }
}
