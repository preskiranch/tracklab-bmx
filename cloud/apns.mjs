import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect as connectHttp2 } from 'node:http2';

export const trackLabApnsTopic = 'com.preskilranch.tracklabbmx';
export const maximumApnsPayloadBytes = 4_096;
export const pushInstallationLeaseMs = 30 * 24 * 60 * 60 * 1_000;

const apnsHosts = Object.freeze({
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
});
const pushKinds = new Set([
  'live_audio_invite',
  'friend_request',
  'friend_connection',
  'track_share',
  'recovery_ready',
]);
const permanentDeviceReasons = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'ExpiredToken',
  'Unregistered',
]);
const permanentRequestReasons = new Set([
  'BadCollapseId',
  'BadExpirationDate',
  'BadMessageId',
  'BadPath',
  'BadPriority',
  'BadTopic',
  'DuplicateHeaders',
  'Forbidden',
  'MethodNotAllowed',
  'MissingDeviceToken',
  'MissingTopic',
  'PayloadEmpty',
  'PayloadTooLarge',
  'TopicDisallowed',
]);
const providerFailureReasons = new Set([
  'BadCertificate',
  'BadCertificateEnvironment',
  'BadTopic',
  'ExpiredProviderToken',
  'Forbidden',
  'InvalidProviderToken',
  'MissingProviderToken',
  'MissingTopic',
  'TopicDisallowed',
]);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function boundedText(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function parseBase64Secret(value, expectedBytes) {
  const text = boundedText(value, 8_192);
  if (!text) return null;
  try {
    const decoded = Buffer.from(text, 'base64');
    if (decoded.length !== expectedBytes || decoded.toString('base64').replace(/=+$/u, '') !== text.replace(/=+$/u, '')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseFingerprintSecret(value) {
  const text = boundedText(value, 8_192);
  if (!text) return null;
  const decoded = parseBase64Secret(text, 32);
  if (decoded) return decoded;
  const raw = Buffer.from(text, 'utf8');
  return raw.length >= 32 ? raw : null;
}

function parsePreviousEncryptionKeys(value, currentVersion) {
  const text = boundedText(value, 8_192);
  if (!text) return { valid: true, keys: new Map() };
  try {
    const parsed = JSON.parse(text);
    const entries = Object.entries(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    if (entries.length === 0 || entries.length > 4) return { valid: false, keys: new Map() };
    const keys = new Map();
    for (const [versionText, secretText] of entries) {
      const version = Number(versionText);
      const key = parseBase64Secret(secretText, 32);
      if (
        !Number.isInteger(version) || version < 1 || version > 1_000
        || version === currentVersion || !key || keys.has(version)
      ) return { valid: false, keys: new Map() };
      keys.set(version, key);
    }
    return { valid: true, keys };
  } catch {
    return { valid: false, keys: new Map() };
  }
}

function privateKeyText(env) {
  const path = boundedText(env.TRACKLAB_APNS_PRIVATE_KEY_PATH, 1_024);
  if (path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }
  const configured = String(env.TRACKLAB_APNS_PRIVATE_KEY || '').trim();
  if (!configured) return '';
  if (configured.includes('BEGIN PRIVATE KEY')) return configured.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(configured, 'base64').toString('utf8');
    return decoded.includes('BEGIN PRIVATE KEY') ? decoded : '';
  } catch {
    return '';
  }
}

export function normalizeApnsDeviceToken(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return token.length >= 32
    && token.length <= 512
    && token.length % 2 === 0
    && /^[0-9a-f]+$/u.test(token)
    ? token
    : '';
}

export function pushTokenProtectionConfiguration(env = process.env) {
  const encryptionKey = parseBase64Secret(env.TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY, 32);
  const fingerprintKey = parseFingerprintSecret(env.TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY);
  const keyVersion = Math.max(1, Math.min(
    1_000,
    Math.round(Number(env.TRACKLAB_PUSH_TOKEN_KEY_VERSION) || 1),
  ));
  const previous = parsePreviousEncryptionKeys(
    env.TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS,
    keyVersion,
  );
  const encryptionKeys = new Map(previous.keys);
  if (encryptionKey) encryptionKeys.set(keyVersion, encryptionKey);
  return {
    ready: Boolean(encryptionKey && fingerprintKey && previous.valid),
    encryptionKey,
    encryptionKeys,
    fingerprintKey,
    keyVersion,
    reason: encryptionKey && fingerprintKey && previous.valid
      ? ''
      : previous.valid
        ? 'push-token-protection-not-configured'
        : 'push-token-previous-keys-invalid',
  };
}

export function protectApnsDeviceToken(tokenValue, environment, configuration) {
  const token = normalizeApnsDeviceToken(tokenValue);
  if (!token || !apnsHosts[environment] || !configuration?.ready) return null;
  const fingerprint = createHmac('sha256', configuration.fingerprintKey)
    .update(`${trackLabApnsTopic}\0${environment}\0${token}`)
    .digest('hex');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', configuration.encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`${trackLabApnsTopic}\0${environment}\0${fingerprint}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString('base64url'),
    tokenNonce: nonce.toString('base64url'),
    tokenTag: cipher.getAuthTag().toString('base64url'),
    tokenFingerprint: fingerprint,
    tokenKeyVersion: configuration.keyVersion,
  };
}

export function unprotectApnsDeviceToken(installation, configuration) {
  if (!installation || !configuration?.ready) return '';
  const encryptionKey = configuration.encryptionKeys?.get(Number(installation.tokenKeyVersion))
    ?? (Number(installation.tokenKeyVersion) === configuration.keyVersion ? configuration.encryptionKey : null);
  if (!encryptionKey) return '';
  const environment = boundedText(installation.environment, 20);
  const fingerprint = boundedText(installation.tokenFingerprint, 180);
  if (!apnsHosts[environment] || !/^[0-9a-f]{64}$/u.test(fingerprint)) return '';
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(String(installation.tokenNonce || ''), 'base64url'),
    );
    decipher.setAAD(Buffer.from(`${trackLabApnsTopic}\0${environment}\0${fingerprint}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(String(installation.tokenTag || ''), 'base64url'));
    const token = Buffer.concat([
      decipher.update(Buffer.from(String(installation.tokenCiphertext || ''), 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const normalized = normalizeApnsDeviceToken(token);
    if (!normalized) return '';
    const expected = createHmac('sha256', configuration.fingerprintKey)
      .update(`${trackLabApnsTopic}\0${environment}\0${normalized}`)
      .digest();
    const actual = Buffer.from(fingerprint, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? normalized : '';
  } catch {
    return '';
  }
}

export function apnsConfigurationFromEnv(env = process.env) {
  const enabled = String(env.TRACKLAB_APNS_ENABLED || '').trim() === '1';
  if (!enabled) {
    return { enabled: false, ready: true, reason: 'disabled', topic: trackLabApnsTopic };
  }
  const teamId = boundedText(env.TRACKLAB_APNS_TEAM_ID, 32);
  const keyId = boundedText(env.TRACKLAB_APNS_KEY_ID, 32);
  const keyText = privateKeyText(env);
  let privateKey = null;
  try {
    privateKey = keyText ? createPrivateKey(keyText) : null;
  } catch {
    privateKey = null;
  }
  const ready = /^[A-Z0-9]{10}$/u.test(teamId)
    && /^[A-Z0-9]{10}$/u.test(keyId)
    && privateKey?.asymmetricKeyType === 'ec'
    && privateKey?.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  return {
    enabled,
    ready,
    reason: ready ? '' : 'apns-provider-not-configured',
    teamId,
    keyId,
    privateKey,
    topic: trackLabApnsTopic,
  };
}

export function apnsHealthSnapshot(
  configuration,
  tokenProtection,
  runtimeFailure = '',
  runtimeFailureAt = 0,
) {
  if (!configuration?.enabled) {
    return {
      startupReady: true,
      push: { enabled: false, ready: true, degraded: false, reason: 'disabled' },
    };
  }
  const configurationReason = !configuration.ready
    ? boundedText(configuration.reason, 120) || 'apns-provider-not-configured'
    : !tokenProtection?.ready
      ? boundedText(tokenProtection?.reason, 120) || 'push-token-protection-not-configured'
      : '';
  const operationalReason = configurationReason || boundedText(runtimeFailure, 120);
  const failureTime = Number(runtimeFailureAt);
  return {
    // A bad startup configuration must fail the deployment health gate. A
    // provider failure discovered after startup is operational degradation,
    // not a reason for Render to evict the web/API/WebSocket instance.
    startupReady: !configurationReason,
    push: {
      enabled: true,
      ready: !operationalReason,
      degraded: Boolean(operationalReason),
      reason: operationalReason,
      ...(!configurationReason && operationalReason && Number.isFinite(failureTime) && failureTime > 0
        ? { degradedAt: new Date(failureTime).toISOString() }
        : {}),
    },
  };
}

export function createApnsProviderToken({ teamId, keyId, privateKey, issuedAt }) {
  const issued = Math.floor(Number(issuedAt));
  if (!/^[A-Z0-9]{10}$/u.test(teamId) || !/^[A-Z0-9]{10}$/u.test(keyId) || !Number.isSafeInteger(issued)) {
    throw new Error('APNs provider token configuration is invalid.');
  }
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issued }));
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${unsigned}.${base64url(signature)}`;
}

export function genericSocialPushPayload(kind, notificationId) {
  const id = boundedText(notificationId, 64);
  if (!pushKinds.has(kind) || !/^[a-f0-9-]{32,64}$/iu.test(id)) return null;
  const recovery = kind === 'recovery_ready';
  const body = recovery
    ? 'Your recovery timer is complete.'
    : kind === 'live_audio_invite'
      ? 'A friend wants to talk live.'
      : kind === 'friend_request'
        ? 'You have a new friend request.'
        : kind === 'friend_connection'
          ? 'A friend connection was updated.'
          : 'A friend shared a BMX track.';
  const payload = {
    aps: {
      alert: { title: recovery ? 'Recovery ready' : 'TrackLab BMX', body },
      sound: 'default',
      'thread-id': recovery ? 'tracklab-recovery' : 'tracklab-friends',
    },
    v: 1,
    kind,
    notificationId: id,
    route: recovery ? 'recovery' : 'friends',
  };
  const encoded = JSON.stringify(payload);
  return Buffer.byteLength(encoded, 'utf8') <= maximumApnsPayloadBytes ? { payload, encoded } : null;
}

export function classifyApnsResponse(statusValue, reasonValue = '') {
  const status = Math.round(Number(statusValue));
  const reason = boundedText(reasonValue, 120);
  if (status === 200) return { outcome: 'sent', retryable: false, invalidateDevice: false };
  if (status === 410 || permanentDeviceReasons.has(reason)) {
    return { outcome: 'device-invalid', retryable: false, invalidateDevice: true };
  }
  if (reason === 'ExpiredProviderToken') {
    return { outcome: 'refresh-provider-token', retryable: true, invalidateDevice: false };
  }
  if (reason === 'IdleTimeout') {
    return { outcome: 'transient', retryable: true, invalidateDevice: false };
  }
  if (status === 429 || reason === 'TooManyRequests' || reason === 'TooManyProviderTokenUpdates') {
    return { outcome: 'throttled', retryable: true, invalidateDevice: false };
  }
  if (status >= 500 || status === 0) {
    return { outcome: 'transient', retryable: true, invalidateDevice: false };
  }
  if (permanentRequestReasons.has(reason) || (status >= 400 && status < 500)) {
    return { outcome: 'permanent', retryable: false, invalidateDevice: false };
  }
  return { outcome: 'transient', retryable: true, invalidateDevice: false };
}

export function apnsResponseIndicatesProviderFailure(statusValue, reasonValue = '') {
  const status = Math.round(Number(statusValue));
  const reason = boundedText(reasonValue, 120);
  return providerFailureReasons.has(reason)
    || (status === 403 && !permanentDeviceReasons.has(reason));
}

export function apnsRetryDelayMs(result, attemptCount, random = Math.random) {
  const attempt = Math.max(1, Math.min(10, Math.round(Number(attemptCount) || 1)));
  const classification = classifyApnsResponse(result?.status, result?.reason);
  if (!classification.retryable) return null;
  const base = result?.reason === 'TooManyProviderTokenUpdates'
    ? 20 * 60 * 1_000
    : classification.outcome === 'transient' && Number(result?.status) >= 500
    ? 15 * 60 * 1_000
    : classification.outcome === 'refresh-provider-token'
      ? 1_000
      : 60 * 1_000;
  const maximum = result?.reason === 'TooManyProviderTokenUpdates'
    ? 60 * 60 * 1_000
    : classification.outcome === 'transient' && Number(result?.status) >= 500
    ? 60 * 60 * 1_000
    : 30 * 60 * 1_000;
  const nominal = Math.min(maximum, base * (2 ** (attempt - 1)));
  const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.max(1_000, Math.min(maximum, Math.round(nominal * (1 + (jitter * 0.25)))));
}

function boundedApnsErrorBody(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return {
      reason: boundedText(parsed?.reason, 120),
      timestamp: Number.isFinite(Number(parsed?.timestamp)) ? Number(parsed.timestamp) : null,
    };
  } catch {
    return { reason: '', timestamp: null };
  }
}

export class ApnsProvider {
  constructor(configuration, options = {}) {
    this.configuration = configuration;
    this.connect = options.connect ?? connectHttp2;
    this.now = options.now ?? Date.now;
    this.timeoutMs = Math.max(1_000, Math.min(30_000, Number(options.timeoutMs) || 8_000));
    this.sessions = new Map();
    this.providerToken = '';
    this.providerTokenIssuedAt = 0;
  }

  status() {
    return {
      enabled: this.configuration.enabled === true,
      ready: this.configuration.ready === true,
      reason: this.configuration.reason || '',
    };
  }

  close() {
    for (const session of this.sessions.values()) {
      try { session.close(); } catch { /* best-effort shutdown */ }
    }
    this.sessions.clear();
  }

  invalidateProviderToken() {
    this.providerToken = '';
    this.providerTokenIssuedAt = 0;
  }

  authenticationToken(force = false) {
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (
      !force
      && this.providerToken
      && nowSeconds - this.providerTokenIssuedAt < 50 * 60
    ) return this.providerToken;
    this.providerToken = createApnsProviderToken({
      teamId: this.configuration.teamId,
      keyId: this.configuration.keyId,
      privateKey: this.configuration.privateKey,
      issuedAt: nowSeconds,
    });
    this.providerTokenIssuedAt = nowSeconds;
    return this.providerToken;
  }

  session(environment) {
    const host = apnsHosts[environment];
    if (!host) throw new Error('APNs environment is invalid.');
    const existing = this.sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = this.connect(host);
    this.sessions.set(environment, session);
    const discard = () => {
      if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    };
    session.once?.('close', discard);
    session.once?.('error', discard);
    session.once?.('goaway', discard);
    return session;
  }

  async send(message, allowProviderTokenRefresh = true) {
    if (!this.configuration.enabled || !this.configuration.ready) {
      return { status: 0, reason: this.configuration.reason || 'provider-disabled', timestamp: null };
    }
    const token = normalizeApnsDeviceToken(message?.deviceToken);
    const environment = boundedText(message?.environment, 20);
    const payloadValue = genericSocialPushPayload(message?.kind, message?.notificationId);
    const apnsId = boundedText(message?.apnsId, 64);
    const collapseId = boundedText(message?.collapseId, 64);
    const expiration = Math.max(0, Math.floor(Number(message?.expiration) || 0));
    const priority = ['live_audio_invite', 'recovery_ready'].includes(message?.kind) ? '10' : '5';
    if (!token || !apnsHosts[environment] || !payloadValue || !/^[a-f0-9-]{32,64}$/iu.test(apnsId) || !collapseId) {
      return { status: 400, reason: 'BadMessageId', timestamp: null };
    }
    const session = this.session(environment);
    const result = await new Promise((resolve) => {
      let settled = false;
      let status = 0;
      let responseApnsId = apnsId;
      let responseBody = '';
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const discardTransportSession = () => {
        if (this.sessions.get(environment) === session) this.sessions.delete(environment);
        try { session.close(); } catch { /* best-effort broken-session disposal */ }
      };
      const finishTransportError = () => {
        if (settled) return;
        finish({
          status: 0,
          reason: 'TransportError',
          timestamp: null,
          apnsId: responseApnsId,
        });
        discardTransportSession();
      };
      let stream;
      try {
        stream = session.request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${this.authenticationToken()}`,
          'apns-push-type': 'alert',
          'apns-topic': this.configuration.topic,
          'apns-priority': priority,
          'apns-expiration': String(expiration),
          'apns-collapse-id': collapseId,
          'apns-id': apnsId,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payloadValue.encoded, 'utf8')),
        });
      } catch {
        finish({ status: 0, reason: 'TransportError', timestamp: null, apnsId });
        discardTransportSession();
        return;
      }
      stream.setEncoding?.('utf8');
      stream.setTimeout?.(this.timeoutMs, () => {
        finish({ status: 0, reason: 'TransportTimeout', timestamp: null, apnsId: responseApnsId });
        discardTransportSession();
        try { stream.close(); } catch { /* stream already closed */ }
      });
      stream.on('response', (headers) => {
        status = Math.round(Number(headers[':status'])) || 0;
        responseApnsId = boundedText(headers['apns-id'], 64) || apnsId;
      });
      stream.on('data', (chunk) => {
        if (responseBody.length < 8_192) responseBody += String(chunk).slice(0, 8_192 - responseBody.length);
      });
      stream.once('error', finishTransportError);
      stream.once('aborted', finishTransportError);
      stream.once('close', finishTransportError);
      stream.once('end', () => {
        const parsed = boundedApnsErrorBody(responseBody);
        finish({ status, reason: parsed.reason, timestamp: parsed.timestamp, apnsId: responseApnsId });
      });
      stream.end(payloadValue.encoded);
    });
    if (result.reason === 'IdleTimeout' && this.sessions.get(environment) === session) {
      this.sessions.delete(environment);
      try { session.close(); } catch { /* best-effort stale session disposal */ }
    }
    if (
      allowProviderTokenRefresh
      && classifyApnsResponse(result.status, result.reason).outcome === 'refresh-provider-token'
    ) {
      this.invalidateProviderToken();
      return this.send(message, false);
    }
    return result;
  }
}
