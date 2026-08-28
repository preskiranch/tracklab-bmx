import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  Type,
} from '@apple/app-store-server-library';

export const appleIapProducts = Object.freeze([
  Object.freeze({ productId: 'com.preskilranch.tracklabbmx.wattbike.1.monthly', bikeSeats: 1 }),
  Object.freeze({ productId: 'com.preskilranch.tracklabbmx.wattbike.2.monthly', bikeSeats: 2 }),
  Object.freeze({ productId: 'com.preskilranch.tracklabbmx.wattbike.3.monthly', bikeSeats: 3 }),
  Object.freeze({ productId: 'com.preskilranch.tracklabbmx.wattbike.4.monthly', bikeSeats: 4 }),
]);

const productById = new Map(appleIapProducts.map((product) => [product.productId, product]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const transactionIdPattern = /^[1-9][0-9]{1,30}$/u;
const subscriptionGroupIdPattern = /^[1-9][0-9]{1,30}$/u;
const notificationUuidPattern = /^[0-9a-f-]{16,64}$/iu;
const rootCertificateUrls = [
  new URL('./apple-root-certificates/AppleIncRootCertificate.pem', import.meta.url),
  new URL('./apple-root-certificates/AppleRootCA-G2.pem', import.meta.url),
  new URL('./apple-root-certificates/AppleRootCA-G3.pem', import.meta.url),
];

const statusNames = Object.freeze({
  [Status.ACTIVE]: 'active',
  [Status.EXPIRED]: 'expired',
  [Status.BILLING_RETRY]: 'billing_retry',
  [Status.BILLING_GRACE_PERIOD]: 'grace_period',
  [Status.REVOKED]: 'revoked',
});

export class AppleBillingError extends Error {
  constructor(code, message, statusCode = 400, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppleBillingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function enabledValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizedPrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('BEGIN PRIVATE KEY')) {
    return raw.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded.includes('BEGIN PRIVATE KEY') ? decoded : raw;
  } catch {
    return raw;
  }
}

function normalizedSandboxAccountTokens(value) {
  const values = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : String(value || '').split(',');
  return new Set(values
    .map((token) => String(token || '').trim().toLowerCase())
    .filter((token) => uuidPattern.test(token)));
}

export function appleBillingConfigStatus(environment = process.env) {
  const enabled = enabledValue(environment.TRACKLAB_APPLE_IAP_ENABLED);
  const appIdText = String(environment.TRACKLAB_APPLE_APP_ID || '').trim();
  const appId = Number(appIdText);
  const privateKey = normalizedPrivateKey(environment.TRACKLAB_APPLE_PRIVATE_KEY);
  const config = {
    enabled,
    bundleId: String(environment.TRACKLAB_APPLE_BUNDLE_ID || '').trim(),
    appId: Number.isSafeInteger(appId) && appId > 0 ? appId : null,
    subscriptionGroupId: String(environment.TRACKLAB_APPLE_SUBSCRIPTION_GROUP_ID || '').trim(),
    sandboxAccountTokens: normalizedSandboxAccountTokens(
      environment.TRACKLAB_APPLE_SANDBOX_ACCOUNT_TOKENS,
    ),
    issuerId: String(environment.TRACKLAB_APPLE_ISSUER_ID || '').trim(),
    keyId: String(environment.TRACKLAB_APPLE_KEY_ID || '').trim(),
    privateKey,
  };
  const missing = enabled
    ? [
      !config.bundleId && 'TRACKLAB_APPLE_BUNDLE_ID',
      !config.appId && 'TRACKLAB_APPLE_APP_ID',
      !subscriptionGroupIdPattern.test(config.subscriptionGroupId)
        && 'TRACKLAB_APPLE_SUBSCRIPTION_GROUP_ID',
      !config.issuerId && 'TRACKLAB_APPLE_ISSUER_ID',
      !config.keyId && 'TRACKLAB_APPLE_KEY_ID',
      !config.privateKey.includes('BEGIN PRIVATE KEY') && 'TRACKLAB_APPLE_PRIVATE_KEY',
    ].filter(Boolean)
    : [];
  return {
    ...config,
    configured: enabled && missing.length === 0,
    missing,
    products: appleIapProducts,
  };
}

export function publicAppleBillingConfiguration(configStatus = appleBillingConfigStatus()) {
  return {
    provider: 'apple-app-store',
    enabled: configStatus.enabled,
    configured: configStatus.configured,
    products: appleIapProducts,
    appAccountTokenRequired: true,
    subscriptionManagement: 'storekit',
  };
}

function normalizedEnvironment(value) {
  if (value === Environment.PRODUCTION || String(value).toLowerCase() === 'production') {
    return Environment.PRODUCTION;
  }
  if (value === Environment.SANDBOX || String(value).toLowerCase() === 'sandbox') {
    return Environment.SANDBOX;
  }
  return null;
}

function environmentKey(value) {
  return normalizedEnvironment(value) === Environment.PRODUCTION ? 'production' : 'sandbox';
}

/**
 * One-way, lineage-scoped representation of StoreKit's appAccountToken. This
 * lets account deletion remove the former TrackLab UUID while a later explicit
 * Restore Purchases request can still prove that Apple's signed transaction is
 * from the same original subscription lineage.
 */
export function appleAppAccountTokenLineageHash(
  appAccountToken,
  originalTransactionId,
  environment,
) {
  const token = normalizedAccountToken(appAccountToken);
  const originalId = String(originalTransactionId || '').trim();
  const normalized = normalizedEnvironment(environment);
  if (!token || !transactionIdPattern.test(originalId) || !normalized) return null;
  return createHash('sha256')
    .update(`tracklab-apple-lineage-v1\u0000${environmentKey(normalized)}\u0000${originalId}\u0000${token}`)
    .digest('hex');
}

function validTimestamp(value, required = true) {
  if (!required && value == null) return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AppleBillingError('invalid-apple-timestamp', 'Apple returned an invalid transaction timestamp.');
  }
  return timestamp;
}

function normalizedAccountToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return uuidPattern.test(token) ? token : null;
}

function validatedTransaction(payload, options) {
  if (!payload || typeof payload !== 'object') {
    throw new AppleBillingError('invalid-apple-transaction', 'Apple returned an invalid transaction.');
  }
  const environment = normalizedEnvironment(payload.environment ?? options.environment);
  const transactionId = String(payload.transactionId || '').trim();
  const originalTransactionId = String(payload.originalTransactionId || '').trim();
  const appAccountToken = normalizedAccountToken(payload.appAccountToken);
  const product = productById.get(String(payload.productId || ''));
  const subscriptionGroupId = String(payload.subscriptionGroupIdentifier || '').trim();
  if (payload.bundleId !== options.bundleId) {
    throw new AppleBillingError('apple-bundle-mismatch', 'The App Store transaction belongs to another app.');
  }
  if (!environment || (options.environment && environment !== options.environment)) {
    throw new AppleBillingError('apple-environment-mismatch', 'The App Store transaction environment did not match.');
  }
  if (!product) {
    throw new AppleBillingError('unknown-apple-product', 'This App Store product does not grant Wattbike access.');
  }
  if (
    !subscriptionGroupIdPattern.test(subscriptionGroupId)
    || subscriptionGroupId !== options.subscriptionGroupId
  ) {
    throw new AppleBillingError(
      'apple-subscription-group-mismatch',
      'This App Store subscription belongs to another subscription group.',
    );
  }
  if (payload.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) {
    throw new AppleBillingError('invalid-apple-product-type', 'This purchase is not a Wattbike subscription.');
  }
  if (!transactionIdPattern.test(transactionId) || !transactionIdPattern.test(originalTransactionId)) {
    throw new AppleBillingError('invalid-apple-transaction-id', 'Apple returned an invalid transaction identifier.');
  }
  if (!appAccountToken) {
    throw new AppleBillingError('missing-apple-account-token', 'This purchase is not linked to a TrackLab account.');
  }
  if (
    environment === Environment.SANDBOX
    && !normalizedSandboxAccountTokens(options.sandboxAccountTokens).has(appAccountToken)
  ) {
    throw new AppleBillingError(
      'apple-sandbox-account-not-allowed',
      'This sandbox purchase is not authorized for this TrackLab test account.',
      403,
    );
  }
  if (
    options.expectedAppAccountToken
    && appAccountToken !== normalizedAccountToken(options.expectedAppAccountToken)
  ) {
    throw new AppleBillingError(
      'apple-account-mismatch',
      'This purchase is linked to a different TrackLab account.',
      409,
    );
  }
  const appAccountTokenHash = appleAppAccountTokenLineageHash(
    appAccountToken,
    originalTransactionId,
    environment,
  );
  const expectedAppAccountTokenHashes = new Set(
    (Array.isArray(options.expectedAppAccountTokenHashes)
      ? options.expectedAppAccountTokenHashes
      : [])
      .map((hash) => String(hash || '').trim().toLowerCase())
      .filter((hash) => /^[a-f0-9]{64}$/u.test(hash)),
  );
  if (
    expectedAppAccountTokenHashes.size > 0
    && !expectedAppAccountTokenHashes.has(appAccountTokenHash)
  ) {
    throw new AppleBillingError(
      'apple-account-mismatch',
      'This purchase is linked to a different TrackLab account.',
      409,
    );
  }
  const purchaseDate = validTimestamp(payload.purchaseDate);
  const expiresDate = validTimestamp(payload.expiresDate);
  const signedDate = validTimestamp(payload.signedDate);
  const revocationDate = validTimestamp(payload.revocationDate, false);
  return {
    transactionId,
    originalTransactionId,
    productId: product.productId,
    subscriptionGroupId,
    bikeSeats: product.bikeSeats,
    appAccountToken,
    appAccountTokenHash,
    environment: environmentKey(environment),
    purchaseDate,
    expiresDate,
    entitlementExpiresDate: expiresDate,
    signedDate,
    revocationDate,
    revocationReason: payload.revocationReason == null ? null : Number(payload.revocationReason),
    isUpgraded: payload.isUpgraded === true,
  };
}

function validatedRenewal(payload, options) {
  if (!payload || typeof payload !== 'object') return null;
  const environment = normalizedEnvironment(payload.environment ?? options.environment);
  if (!environment || (options.environment && environment !== options.environment)) {
    throw new AppleBillingError('apple-environment-mismatch', 'The App Store renewal environment did not match.');
  }
  const originalTransactionId = String(payload.originalTransactionId || '').trim();
  if (originalTransactionId && originalTransactionId !== options.originalTransactionId) {
    throw new AppleBillingError('apple-original-transaction-mismatch', 'Apple returned mismatched renewal information.');
  }
  const appAccountToken = payload.appAccountToken == null
    ? null
    : normalizedAccountToken(payload.appAccountToken);
  if (payload.appAccountToken != null && !appAccountToken) {
    throw new AppleBillingError('invalid-apple-account-token', 'Apple returned an invalid account token.');
  }
  if (appAccountToken && appAccountToken !== options.appAccountToken) {
    throw new AppleBillingError('apple-account-mismatch', 'Apple returned renewal information for another account.', 409);
  }
  const renewalProduct = String(payload.autoRenewProductId || payload.productId || '');
  if (renewalProduct && !productById.has(renewalProduct)) {
    throw new AppleBillingError('unknown-apple-product', 'Apple returned renewal information for another product.');
  }
  return {
    originalTransactionId: originalTransactionId || options.originalTransactionId,
    gracePeriodExpiresDate: validTimestamp(payload.gracePeriodExpiresDate, false),
    signedDate: validTimestamp(payload.signedDate),
    autoRenewStatus: payload.autoRenewStatus == null ? null : Number(payload.autoRenewStatus),
  };
}

function appleStatus(statusValue) {
  const numeric = Number(statusValue);
  return statusNames[numeric] ? numeric : null;
}

function entitlementFromStatus(transaction, statusValue, renewal, now) {
  const numericStatus = appleStatus(statusValue);
  if (!numericStatus) {
    throw new AppleBillingError('invalid-apple-subscription-status', 'Apple returned an invalid subscription status.');
  }
  if (numericStatus === Status.BILLING_GRACE_PERIOD && renewal?.gracePeriodExpiresDate == null) {
    throw new AppleBillingError(
      'apple-grace-period-incomplete',
      'Apple has not supplied the grace-period expiration yet. Try again.',
      503,
    );
  }
  const entitlementExpiresDate = numericStatus === Status.BILLING_GRACE_PERIOD
    ? renewal.gracePeriodExpiresDate
    : transaction.expiresDate;
  const revoked = transaction.revocationDate != null || transaction.isUpgraded || numericStatus === Status.REVOKED;
  const activeStatus = numericStatus === Status.ACTIVE || numericStatus === Status.BILLING_GRACE_PERIOD;
  return {
    ...transaction,
    status: statusNames[numericStatus],
    appleStatus: numericStatus,
    lifecycleSignedDate: Math.max(transaction.signedDate, renewal?.signedDate ?? 0),
    entitlementExpiresDate,
    active: activeStatus && !revoked && entitlementExpiresDate > now,
  };
}

function safeNotificationType(value) {
  const type = String(value || '').trim();
  return /^[A-Z][A-Z0-9_]{1,80}$/u.test(type) ? type : null;
}

function signedPayloadHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function createDefaultDependencies(config) {
  const rootCertificates = rootCertificateUrls.map((url) => readFileSync(fileURLToPath(url)));
  return {
    verifiers: {
      production: new SignedDataVerifier(
        rootCertificates,
        true,
        Environment.PRODUCTION,
        config.bundleId,
        config.appId,
      ),
      sandbox: new SignedDataVerifier(
        rootCertificates,
        true,
        Environment.SANDBOX,
        config.bundleId,
      ),
    },
    clients: {
      production: new AppStoreServerAPIClient(
        config.privateKey,
        config.keyId,
        config.issuerId,
        config.bundleId,
        Environment.PRODUCTION,
      ),
      sandbox: new AppStoreServerAPIClient(
        config.privateKey,
        config.keyId,
        config.issuerId,
        config.bundleId,
        Environment.SANDBOX,
      ),
    },
  };
}

export function createAppleBillingService(options = {}) {
  const config = options.config ?? appleBillingConfigStatus(options.environment ?? process.env);
  if (config.enabled && !config.configured) {
    throw new Error(`Apple in-app purchases are enabled but incomplete: ${config.missing.join(', ')}`);
  }
  const publicConfiguration = publicAppleBillingConfiguration(config);
  if (!config.enabled) {
    return Object.freeze({
      enabled: false,
      configuration: publicConfiguration,
      claimTransaction: async () => {
        throw new AppleBillingError('apple-iap-disabled', 'Apple in-app purchases are unavailable.', 503);
      },
      claimRestoredTransaction: async () => {
        throw new AppleBillingError('apple-iap-disabled', 'Apple in-app purchases are unavailable.', 503);
      },
      verifyNotification: async () => {
        throw new AppleBillingError('apple-iap-disabled', 'Apple in-app purchases are unavailable.', 503);
      },
      reconcileVerifiedTransaction: async () => {
        throw new AppleBillingError('apple-iap-disabled', 'Apple in-app purchases are unavailable.', 503);
      },
    });
  }

  const dependencies = options.verifiers && options.clients
    ? { verifiers: options.verifiers, clients: options.clients }
    : createDefaultDependencies(config);
  const now = options.now ?? (() => Date.now());

  async function verifyForEnvironment(
    kind,
    signedValue,
    environment,
    expectedAppAccountToken,
    expectedAppAccountTokenHashes = [],
  ) {
    const key = environmentKey(environment);
    const verifier = dependencies.verifiers[key];
    if (!verifier || typeof verifier[kind] !== 'function') {
      throw new AppleBillingError('apple-verifier-unavailable', 'Apple transaction verification is unavailable.', 503);
    }
    const decoded = await verifier[kind](signedValue);
    if (kind === 'verifyAndDecodeTransaction') {
      return validatedTransaction(decoded, {
        bundleId: config.bundleId,
        subscriptionGroupId: config.subscriptionGroupId,
        sandboxAccountTokens: config.sandboxAccountTokens,
        environment,
        expectedAppAccountToken,
        expectedAppAccountTokenHashes,
      });
    }
    return decoded;
  }

  async function verifyTransaction(
    signedTransaction,
    expectedAppAccountToken,
    expectedEnvironment = null,
    expectedAppAccountTokenHashes = [],
  ) {
    const value = String(signedTransaction || '').trim();
    if (!value || value.length > 50_000) {
      throw new AppleBillingError('invalid-signed-transaction', 'A signed App Store transaction is required.');
    }
    const environments = expectedEnvironment
      ? [expectedEnvironment]
      : [Environment.PRODUCTION, Environment.SANDBOX];
    let lastError;
    for (const environment of environments) {
      try {
        return await verifyForEnvironment(
          'verifyAndDecodeTransaction',
          value,
          environment,
          expectedAppAccountToken,
          expectedAppAccountTokenHashes,
        );
      } catch (error) {
        if (error instanceof AppleBillingError) throw error;
        lastError = error;
      }
    }
    throw new AppleBillingError(
      'apple-signature-invalid',
      'The App Store transaction could not be verified.',
      400,
      lastError,
    );
  }

  async function verifyRenewal(signedRenewal, environment, transaction) {
    if (!signedRenewal) return null;
    try {
      const verifier = dependencies.verifiers[environmentKey(environment)];
      const decoded = await verifier.verifyAndDecodeRenewalInfo(String(signedRenewal));
      return validatedRenewal(decoded, {
        environment,
        originalTransactionId: transaction.originalTransactionId,
        appAccountToken: transaction.appAccountToken,
      });
    } catch (error) {
      if (error instanceof AppleBillingError) throw error;
      throw new AppleBillingError('apple-renewal-signature-invalid', 'Apple renewal information could not be verified.', 400, error);
    }
  }

  async function reconcileVerifiedTransaction(seedTransaction, minimumLifecycleSignedDate = 0) {
    const environment = seedTransaction.environment === 'production'
      ? Environment.PRODUCTION
      : Environment.SANDBOX;
    const client = dependencies.clients[environmentKey(environment)];
    let response;
    try {
      response = await client.getAllSubscriptionStatuses(seedTransaction.originalTransactionId);
    } catch (error) {
      throw new AppleBillingError(
        'apple-status-unavailable',
        'Apple subscription status is temporarily unavailable. Try again.',
        503,
        error,
      );
    }
    if (
      !response
      || response.bundleId !== config.bundleId
      || normalizedEnvironment(response.environment) !== environment
      || (environment === Environment.PRODUCTION && Number(response.appAppleId) !== config.appId)
      || (
        environment === Environment.SANDBOX
        && response.appAppleId != null
        && Number(response.appAppleId) !== 0
        && Number(response.appAppleId) !== config.appId
      )
    ) {
      throw new AppleBillingError('apple-status-app-mismatch', 'Apple returned subscription status for another app.');
    }
    const matchingGroups = (Array.isArray(response.data) ? response.data : [])
      .filter((group) => (
        String(group?.subscriptionGroupIdentifier || '').trim() === config.subscriptionGroupId
      ));
    if (matchingGroups.length !== 1) {
      throw new AppleBillingError(
        'apple-subscription-group-mismatch',
        'Apple did not return the configured Wattbike subscription group.',
      );
    }
    const items = matchingGroups
      .flatMap((group) => Array.isArray(group?.lastTransactions) ? group.lastTransactions : []);
    if (items.length === 0) {
      throw new AppleBillingError('apple-status-empty', 'Apple did not return this subscription yet. Try again.', 503);
    }
    const records = [];
    const expectedAppAccountTokenHashes = Array.isArray(seedTransaction.appAccountTokenHashes)
      ? seedTransaction.appAccountTokenHashes
      : seedTransaction.appAccountTokenHash
        ? [seedTransaction.appAccountTokenHash]
        : [];
    for (const item of items) {
      if (!item?.signedTransactionInfo) continue;
      const transaction = await verifyTransaction(
        item.signedTransactionInfo,
        expectedAppAccountTokenHashes.length > 0 ? null : seedTransaction.appAccountToken,
        environment,
        expectedAppAccountTokenHashes,
      );
      if (transaction.originalTransactionId !== seedTransaction.originalTransactionId) continue;
      const renewal = await verifyRenewal(item.signedRenewalInfo, environment, transaction);
      const record = entitlementFromStatus(transaction, item.status, renewal, now());
      records.push({
        ...record,
        lifecycleSignedDate: Math.max(
          record.lifecycleSignedDate,
          Number(minimumLifecycleSignedDate) || 0,
        ),
      });
    }
    if (records.length === 0) {
      throw new AppleBillingError('apple-status-empty', 'Apple did not return a verified subscription. Try again.', 503);
    }
    records.sort((left, right) => (
      Number(right.active) - Number(left.active)
      || right.entitlementExpiresDate - left.entitlementExpiresDate
      || right.signedDate - left.signedDate
    ));
    return {
      originalTransactionId: seedTransaction.originalTransactionId,
      appAccountToken: seedTransaction.appAccountToken,
      environment: environmentKey(environment),
      entitlement: records[0],
      transactions: records,
      reconciledAt: now(),
    };
  }

  async function claimTransaction(signedTransaction, appAccountToken) {
    const seedTransaction = await verifyTransaction(signedTransaction, appAccountToken);
    return reconcileVerifiedTransaction(seedTransaction);
  }

  async function claimRestoredTransaction(signedTransaction) {
    // No TrackLab-account equality is assumed here. Persistence will only bind
    // a mismatch when this verified token hash matches an unbound deletion
    // lineage. Apple is queried again before any entitlement is granted.
    const seedTransaction = await verifyTransaction(signedTransaction, null);
    return reconcileVerifiedTransaction(seedTransaction);
  }

  async function verifyNotification(signedPayload) {
    const value = String(signedPayload || '').trim();
    if (!value || value.length > 100_000) {
      throw new AppleBillingError('invalid-apple-notification', 'A signed Apple notification is required.');
    }
    let decoded;
    let environment;
    let lastError;
    for (const candidate of [Environment.PRODUCTION, Environment.SANDBOX]) {
      try {
        decoded = await verifyForEnvironment('verifyAndDecodeNotification', value, candidate);
        environment = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!decoded || !environment) {
      throw new AppleBillingError('apple-notification-signature-invalid', 'The Apple notification could not be verified.', 400, lastError);
    }
    const notificationType = safeNotificationType(decoded.notificationType);
    const notificationUUID = String(decoded.notificationUUID || '').trim().toLowerCase();
    const data = decoded.data ?? null;
    if (!notificationType || !notificationUuidPattern.test(notificationUUID) || decoded.version !== '2.0') {
      throw new AppleBillingError('invalid-apple-notification', 'Apple returned invalid notification metadata.');
    }
    if (data) {
      const dataEnvironment = normalizedEnvironment(data.environment);
      const appIdMatches = environment === Environment.PRODUCTION
        ? Number(data.appAppleId) === config.appId
        : data.appAppleId == null || Number(data.appAppleId) === 0 || Number(data.appAppleId) === config.appId;
      if (data.bundleId !== config.bundleId || dataEnvironment !== environment || !appIdMatches) {
        throw new AppleBillingError('apple-notification-app-mismatch', 'The Apple notification belongs to another app.');
      }
    }
    let transaction = null;
    if (data?.signedTransactionInfo) {
      transaction = await verifyTransaction(data.signedTransactionInfo, null, environment);
    }
    return {
      notificationUUID,
      notificationType,
      subtype: decoded.subtype == null ? null : String(decoded.subtype).slice(0, 80),
      environment: environmentKey(environment),
      signedDate: validTimestamp(decoded.signedDate),
      signedPayloadHash: signedPayloadHash(value),
      transaction,
      status: data?.status == null ? null : statusNames[appleStatus(data.status)] ?? null,
      receivedAt: now(),
    };
  }

  return Object.freeze({
    enabled: true,
    configuration: publicConfiguration,
    claimTransaction,
    claimRestoredTransaction,
    verifyNotification,
    reconcileVerifiedTransaction,
  });
}
