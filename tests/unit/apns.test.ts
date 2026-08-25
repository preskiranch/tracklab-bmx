import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApnsProvider,
  apnsConfigurationFromEnv,
  apnsHealthSnapshot,
  apnsResponseIndicatesProviderFailure,
  apnsRetryDelayMs,
  classifyApnsResponse,
  createApnsProviderToken,
  genericSocialPushPayload,
  normalizeApnsDeviceToken,
  protectApnsDeviceToken,
  pushTokenProtectionConfiguration,
  trackLabApnsTopic,
  unprotectApnsDeviceToken,
} from '../../cloud/apns.mjs';

function providerEnvironment(namedCurve = 'P-256') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve });
  return {
    TRACKLAB_APNS_ENABLED: '1',
    TRACKLAB_APNS_TEAM_ID: 'TEAMID1234',
    TRACKLAB_APNS_KEY_ID: 'KEYID12345',
    TRACKLAB_APNS_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

function tokenProtectionEnvironment() {
  return {
    TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY: Buffer.alloc(32, 9).toString('base64'),
    TRACKLAB_PUSH_TOKEN_KEY_VERSION: '4',
  };
}

describe('APNs private social notification primitives', () => {
  it('normalizes only bounded even-length hexadecimal APNs device tokens', () => {
    expect(normalizeApnsDeviceToken(` ${'AB'.repeat(32)} `)).toBe('ab'.repeat(32));
    expect(normalizeApnsDeviceToken('abc')).toBe('');
    expect(normalizeApnsDeviceToken('zz'.repeat(32))).toBe('');
    expect(normalizeApnsDeviceToken('aa')).toBe('');
  });

  it('encrypts tokens with authenticated context and never stores the raw token', () => {
    const configuration = pushTokenProtectionConfiguration(tokenProtectionEnvironment());
    const token = 'ab'.repeat(32);
    const protectedToken = protectApnsDeviceToken(token, 'production', configuration);

    expect(configuration.ready).toBe(true);
    expect(protectedToken).toMatchObject({ tokenKeyVersion: 4 });
    expect(JSON.stringify(protectedToken)).not.toContain(token);
    expect(unprotectApnsDeviceToken({
      ...protectedToken,
      environment: 'production',
    }, configuration)).toBe(token);
    expect(unprotectApnsDeviceToken({
      ...protectedToken,
      environment: 'sandbox',
    }, configuration)).toBe('');
    expect(unprotectApnsDeviceToken({
      ...protectedToken,
      environment: 'production',
      tokenCiphertext: `${protectedToken?.tokenCiphertext}x`,
    }, configuration)).toBe('');
  });

  it('decrypts a bounded previous key version during staged key rotation', () => {
    const previousEnvironment = tokenProtectionEnvironment();
    const previousConfiguration = pushTokenProtectionConfiguration(previousEnvironment);
    const token = 'cd'.repeat(32);
    const protectedToken = protectApnsDeviceToken(token, 'sandbox', previousConfiguration);
    const currentKey = Buffer.alloc(32, 11).toString('base64');
    const rotated = pushTokenProtectionConfiguration({
      ...previousEnvironment,
      TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY: currentKey,
      TRACKLAB_PUSH_TOKEN_KEY_VERSION: '5',
      TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS: JSON.stringify({
        4: previousEnvironment.TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY,
      }),
    });

    expect(rotated.ready).toBe(true);
    expect(rotated.encryptionKeys.has(4)).toBe(true);
    expect(rotated.encryptionKeys.has(5)).toBe(true);
    expect(unprotectApnsDeviceToken({
      ...protectedToken,
      environment: 'sandbox',
    }, rotated)).toBe(token);
    expect(pushTokenProtectionConfiguration({
      ...previousEnvironment,
      TRACKLAB_PUSH_TOKEN_KEY_VERSION: '5',
      TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS: '{bad-json',
    })).toMatchObject({ ready: false, reason: 'push-token-previous-keys-invalid' });
  });

  it('reports disabled APNs as ready but requires an exact P-256 provider key when enabled', () => {
    expect(apnsConfigurationFromEnv({})).toMatchObject({
      enabled: false,
      ready: true,
      reason: 'disabled',
      topic: trackLabApnsTopic,
    });
    expect(apnsConfigurationFromEnv(providerEnvironment('P-256'))).toMatchObject({
      enabled: true,
      ready: true,
      reason: '',
    });
    expect(apnsConfigurationFromEnv(providerEnvironment('P-384'))).toMatchObject({
      enabled: true,
      ready: false,
      reason: 'apns-provider-not-configured',
    });
    expect(apnsConfigurationFromEnv({
      ...providerEnvironment(),
      TRACKLAB_APNS_TEAM_ID: 'TEAMID123',
    })).toMatchObject({ enabled: true, ready: false });
    expect(apnsConfigurationFromEnv({
      ...providerEnvironment(),
      TRACKLAB_APNS_KEY_ID: 'KEYID123456',
    })).toMatchObject({ enabled: true, ready: false });
  });

  it('fails startup for invalid required configuration without taking core health down for a runtime provider outage', () => {
    const protection = pushTokenProtectionConfiguration(tokenProtectionEnvironment());
    expect(apnsHealthSnapshot(
      apnsConfigurationFromEnv({ TRACKLAB_APNS_ENABLED: '1' }),
      protection,
    )).toEqual({
      startupReady: false,
      push: {
        enabled: true,
        ready: false,
        degraded: true,
        reason: 'apns-provider-not-configured',
      },
    });

    expect(apnsHealthSnapshot(
      apnsConfigurationFromEnv(providerEnvironment()),
      protection,
      'InvalidProviderToken',
      1_800_000_000_000,
    )).toEqual({
      startupReady: true,
      push: {
        enabled: true,
        ready: false,
        degraded: true,
        reason: 'InvalidProviderToken',
        degradedAt: '2027-01-15T08:00:00.000Z',
      },
    });
  });

  it('creates a correctly shaped ES256 provider JWT', () => {
    const configuration = apnsConfigurationFromEnv(providerEnvironment());
    const token = createApnsProviderToken({
      teamId: configuration.teamId,
      keyId: configuration.keyId,
      privateKey: configuration.privateKey,
      issuedAt: 1_800_000_000,
    });
    const [header, claims, signature] = token.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEYID12345',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'TEAMID1234',
      iat: 1_800_000_000,
    });
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(() => createApnsProviderToken({
      teamId: 'TEAMID123',
      keyId: configuration.keyId,
      privateKey: configuration.privateKey,
      issuedAt: 1_800_000_000,
    })).toThrow('APNs provider token configuration is invalid.');
    expect(() => createApnsProviderToken({
      teamId: configuration.teamId,
      keyId: 'KEYID123456',
      privateKey: configuration.privateKey,
      issuedAt: 1_800_000_000,
    })).toThrow('APNs provider token configuration is invalid.');
  });

  it('uses generic payloads with no account, room, track, or health data', () => {
    const notificationId = '123e4567-e89b-12d3-a456-426614174000';
    for (const kind of ['live_audio_invite', 'friend_request', 'friend_connection', 'track_share'] as const) {
      const encoded = genericSocialPushPayload(kind, notificationId)?.encoded ?? '';
      const parsed = JSON.parse(encoded);
      expect(parsed).toMatchObject({
        v: 1,
        kind,
        notificationId,
        route: 'friends',
      });
      expect(encoded).not.toMatch(/room|trackId|userId|heart|bpm|name|handle/iu);
    }
  });

  it('classifies APNs invalidation and bounded retry behavior', () => {
    expect(classifyApnsResponse(200)).toEqual({
      outcome: 'sent', retryable: false, invalidateDevice: false,
    });
    expect(classifyApnsResponse(410, 'Unregistered')).toEqual({
      outcome: 'device-invalid', retryable: false, invalidateDevice: true,
    });
    expect(classifyApnsResponse(429, 'TooManyRequests')).toMatchObject({
      outcome: 'throttled', retryable: true,
    });
    expect(classifyApnsResponse(500, 'InternalServerError')).toMatchObject({
      outcome: 'transient', retryable: true,
    });
    expect(apnsResponseIndicatesProviderFailure(403, 'InvalidProviderToken')).toBe(true);
    expect(apnsResponseIndicatesProviderFailure(400, 'TopicDisallowed')).toBe(true);
    expect(apnsResponseIndicatesProviderFailure(410, 'Unregistered')).toBe(false);
    expect(apnsRetryDelayMs({ status: 500 }, 1, () => 0)).toBe(15 * 60 * 1_000);
    expect(classifyApnsResponse(400, 'IdleTimeout')).toEqual({
      outcome: 'transient', retryable: true, invalidateDevice: false,
    });
    expect(apnsRetryDelayMs({ status: 429, reason: 'TooManyProviderTokenUpdates' }, 1, () => 0))
      .toBe(20 * 60 * 1_000);
    expect(apnsRetryDelayMs({ status: 410, reason: 'Unregistered' }, 1)).toBeNull();
  });

  it('keeps APNs signing and token-protection secrets out of tracked configuration', () => {
    const render = readFileSync('render.yaml', 'utf8');
    const example = readFileSync('.env.example', 'utf8');
    const ignore = readFileSync('.gitignore', 'utf8');
    const deploymentSmoke = readFileSync('.github/workflows/deployment-smoke.yml', 'utf8');
    expect(render).not.toContain('BEGIN PRIVATE KEY');
    expect(example).not.toContain('BEGIN PRIVATE KEY');
    expect(render).toMatch(/key: TRACKLAB_APNS_PRIVATE_KEY\s+sync: false/u);
    expect(render).toMatch(/key: TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY\s+sync: false/u);
    expect(render).toMatch(/key: TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY\s+sync: false/u);
    expect(ignore).toMatch(/^AuthKey_\*\.p8$/mu);
    expect(deploymentSmoke).toMatch(/TRACKLAB_EXPECT_APNS:\s*["']1["']/u);
  });

  it('discards an APNs HTTP/2 session after Apple reports IdleTimeout', async () => {
    let connectCount = 0;
    const sessions: Array<EventEmitter & { closed: boolean; destroyed: boolean; request: Function; close: Function }> = [];
    const provider = new ApnsProvider(apnsConfigurationFromEnv(providerEnvironment()), {
      connect: vi.fn(() => {
        connectCount += 1;
        const session = Object.assign(new EventEmitter(), {
          closed: false,
          destroyed: false,
          request: vi.fn((headers: Record<string, string>) => Object.assign(new EventEmitter(), {
            setEncoding: vi.fn(),
            setTimeout: vi.fn(),
            close: vi.fn(),
            end() {
              queueMicrotask(() => {
                this.emit('response', { ':status': connectCount === 1 ? 400 : 200, 'apns-id': headers['apns-id'] });
                if (connectCount === 1) this.emit('data', JSON.stringify({ reason: 'IdleTimeout' }));
                this.emit('end');
              });
            },
          })),
          close: vi.fn(),
        });
        sessions.push(session);
        return session;
      }),
      now: () => 1_800_000_000_000,
    });
    const message = {
      deviceToken: 'ab'.repeat(32),
      environment: 'production',
      kind: 'friend_request',
      notificationId: '123e4567-e89b-12d3-a456-426614174000',
      apnsId: '123e4567-e89b-12d3-a456-426614174001',
      collapseId: 'tl-friend-request',
      expiration: 1_800_000_600,
    } as const;

    await expect(provider.send(message)).resolves.toMatchObject({ status: 400, reason: 'IdleTimeout' });
    await expect(provider.send(message)).resolves.toMatchObject({ status: 200 });
    expect(connectCount).toBe(2);
    expect(sessions[0].close).toHaveBeenCalledOnce();
  });

  for (const terminalEvent of ['close', 'aborted'] as const) {
    it(`settles and discards an APNs stream that emits ${terminalEvent} without end`, async () => {
      let connectCount = 0;
      const sessions: Array<EventEmitter & { closed: boolean; destroyed: boolean; request: Function; close: Function }> = [];
      const provider = new ApnsProvider(apnsConfigurationFromEnv(providerEnvironment()), {
        connect: vi.fn(() => {
          connectCount += 1;
          const sessionNumber = connectCount;
          const session = Object.assign(new EventEmitter(), {
            closed: false,
            destroyed: false,
            request: vi.fn((headers: Record<string, string>) => Object.assign(new EventEmitter(), {
              setEncoding: vi.fn(),
              setTimeout: vi.fn(),
              close: vi.fn(),
              end() {
                queueMicrotask(() => {
                  if (sessionNumber === 1) {
                    this.emit(terminalEvent);
                    return;
                  }
                  this.emit('response', { ':status': 200, 'apns-id': headers['apns-id'] });
                  this.emit('end');
                });
              },
            })),
            close: vi.fn(),
          });
          sessions.push(session);
          return session;
        }),
        now: () => 1_800_000_000_000,
      });
      const message = {
        deviceToken: 'ab'.repeat(32),
        environment: 'production',
        kind: 'friend_request',
        notificationId: '123e4567-e89b-12d3-a456-426614174000',
        apnsId: '123e4567-e89b-12d3-a456-426614174001',
        collapseId: 'tl-friend-request',
        expiration: 1_800_000_600,
      } as const;

      await expect(provider.send(message)).resolves.toMatchObject({
        status: 0,
        reason: 'TransportError',
      });
      await expect(provider.send(message)).resolves.toMatchObject({ status: 200 });
      expect(connectCount).toBe(2);
      expect(sessions[0].close).toHaveBeenCalledOnce();
    });
  }

  it('sends only fixed-topic alert requests and refreshes ExpiredProviderToken once', async () => {
    const requests: Array<{ headers: Record<string, string>; body: string }> = [];
    let responseCount = 0;
    const session = Object.assign(new EventEmitter(), {
      closed: false,
      destroyed: false,
      request: vi.fn((headers: Record<string, string>) => {
        const stream = Object.assign(new EventEmitter(), {
          body: '',
          setEncoding: vi.fn(),
          setTimeout: vi.fn(),
          close: vi.fn(),
          end(body: string) {
            this.body = body;
            requests.push({ headers, body });
            responseCount += 1;
            queueMicrotask(() => {
              this.emit('response', { ':status': responseCount === 1 ? 403 : 200, 'apns-id': headers['apns-id'] });
              if (responseCount === 1) this.emit('data', JSON.stringify({ reason: 'ExpiredProviderToken' }));
              this.emit('end');
            });
          },
        });
        return stream;
      }),
      close: vi.fn(),
    });
    const provider = new ApnsProvider(apnsConfigurationFromEnv(providerEnvironment()), {
      connect: vi.fn(() => session),
      now: () => 1_800_000_000_000,
    });
    const result = await provider.send({
      deviceToken: 'ab'.repeat(32),
      environment: 'production',
      kind: 'friend_request',
      notificationId: '123e4567-e89b-12d3-a456-426614174000',
      apnsId: '123e4567-e89b-12d3-a456-426614174001',
      collapseId: 'tl-friend-request',
      expiration: 1_800_000_600,
    });

    expect(result).toMatchObject({ status: 200 });
    expect(requests).toHaveLength(2);
    expect(requests[0].headers).toMatchObject({
      ':method': 'POST',
      'apns-topic': trackLabApnsTopic,
      'apns-push-type': 'alert',
      'apns-priority': '5',
    });
    expect(requests[0].headers.authorization).toMatch(/^bearer /u);
    expect(JSON.parse(requests[0].body)).toMatchObject({ route: 'friends' });
  });
});
