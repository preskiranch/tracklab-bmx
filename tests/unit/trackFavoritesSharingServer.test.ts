import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeTrackShare } from '../../src/lib/trackShares';

let child: ChildProcess;
let baseUrl = '';
const officialBootstrapToken = 'track-sharing-official-bootstrap-token-0001';
const eventControllers = new Set<AbortController>();

type TestAccount = {
  cookie: string;
  user: { id: string; username: string };
};

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Track sharing test server did not become healthy.');
}

async function request(
  pathname: string,
  options: {
    cookie?: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    origin?: string;
  } = {},
) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Origin: options.origin ?? baseUrl,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function register(email: string, name: string, ip: string, official = false): Promise<TestAccount> {
  const response = await request('/api/auth/register', {
    method: 'POST',
    headers: {
      'X-Forwarded-For': ip,
      ...(official ? { 'X-TrackLab-Official-Bootstrap-Token': officialBootstrapToken } : {}),
    },
    body: { email, name, password: 'track-sharing-test-password' },
  });
  expect(response.status).toBe(201);
  return {
    cookie: String(response.headers.get('set-cookie')).split(';')[0],
    user: (await body(response)).user,
  };
}

async function connectByInvite(inviter: TestAccount, claimant: TestAccount) {
  const created = await body(await request('/api/friends/invites', {
    cookie: inviter.cookie,
    method: 'POST',
  }));
  const token = new URL(created.invite.inviteUrl).searchParams.get('friendInvite');
  const claimed = await request('/api/friends/invites/claim', {
    cookie: claimant.cookie,
    method: 'POST',
    body: { token },
  });
  expect(claimed.status).toBe(200);
}

async function openShareEventStream(cookie: string) {
  const controller = new AbortController();
  eventControllers.add(controller);
  const response = await fetch(`${baseUrl}/api/friends/events`, {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('Share event stream has no body.');
  return {
    controller,
    reader: response.body.getReader(),
    decoder: new TextDecoder(),
    buffer: '',
  };
}

async function waitForShareInvalidation(stream: Awaited<ReturnType<typeof openShareEventStream>>) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const frame = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      if (/^event:\s*track-shares-invalidated$/m.test(frame)) return frame;
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for track share invalidation.')), remaining);
      }),
    ]);
    if (chunk.done) throw new Error('Share event stream ended early.');
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
  throw new Error('Timed out waiting for track share invalidation.');
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TRACKLAB_ADMIN_EMAILS: 'preskiranch@gmail.com',
      TRACKLAB_OFFICIAL_ACCOUNT_BOOTSTRAP_TOKEN: officialBootstrapToken,
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  eventControllers.forEach((controller) => controller.abort());
  eventControllers.clear();
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('account track favorites and explicit-friend track shares API', () => {
  it('keeps favorites private and always resolves their snapshot from the server catalog', async () => {
    const trackId = 'apple-valley-bmx-moto-park';
    expect((await request('/api/track-favorites')).status).toBe(401);

    const alice = await register('favorite-api-alice@tracklab.test', 'Favorite API Alice', '198.51.100.101');
    const bob = await register('favorite-api-bob@tracklab.test', 'Favorite API Bob', '198.51.100.102');
    expect((await request(`/api/track-favorites/${trackId}`, {
      cookie: alice.cookie,
      method: 'PUT',
      headers: { Authorization: 'Bearer kiosk-token' },
    })).status).toBe(403);
    expect((await request(`/api/track-favorites/${trackId}`, {
      cookie: alice.cookie,
      method: 'PUT',
      origin: 'https://evil.example',
    })).status).toBe(403);

    const saveResponse = await request(`/api/track-favorites/${trackId}`, {
      cookie: alice.cookie,
      method: 'PUT',
    });
    expect(saveResponse.status).toBe(200);
    const saved = await body(saveResponse);
    expect(saved.favorite).toMatchObject({
      trackId,
      track: {
        id: trackId,
        name: 'Apple Valley BMX Moto Park',
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      },
    });
    expect(JSON.stringify(saved)).not.toMatch(/password|email/i);

    const aliceFavorites = await body(await request('/api/track-favorites', { cookie: alice.cookie }));
    expect(aliceFavorites.trackIds).toEqual([trackId]);
    expect(aliceFavorites.favorites).toEqual([expect.objectContaining({ trackId })]);
    expect(await body(await request('/api/track-favorites', { cookie: bob.cookie })))
      .toEqual({ trackIds: [], favorites: [] });
    expect((await request('/api/track-favorites/not-a-real-track', {
      cookie: alice.cookie,
      method: 'PUT',
    })).status).toBe(404);
    expect((await request(`/api/track-favorites/${trackId}`, {
      cookie: alice.cookie,
      method: 'DELETE',
    })).status).toBe(200);
    expect((await body(await request('/api/track-favorites', { cookie: alice.cookie }))).trackIds).toEqual([]);
  }, 20_000);

  it('shares only with an explicit friend, emits SSE invalidation, and authorizes recipient actions', async () => {
    const trackId = 'apple-valley-bmx-moto-park';
    const alice = await register('share-api-alice@tracklab.test', 'Share API Alice', '198.51.100.111');
    const bob = await register('share-api-bob@tracklab.test', 'Share API Bob', '198.51.100.112');
    const outsider = await register('share-api-outsider@tracklab.test', 'Share API Outsider', '198.51.100.113');
    const official = await register('preskiranch@gmail.com', 'Preski Ranch', '198.51.100.114', true);

    const shareBody = (recipientProfileId: string, clientRequestId: string) => ({
      recipientProfileId,
      trackId,
      clientRequestId,
      track: { id: trackId, name: 'Spoofed Track', latitude: 0, longitude: 0 },
    });
    expect((await request('/api/friends/track-shares')).status).toBe(401);
    expect((await request('/api/friends/track-shares', {
      cookie: alice.cookie,
      method: 'POST',
      body: shareBody(outsider.user.id, '10000000-0000-4000-8000-000000000001'),
    })).status).toBe(409);
    expect((await request('/api/friends/track-shares', {
      cookie: alice.cookie,
      method: 'POST',
      body: shareBody(official.user.id, '10000000-0000-4000-8000-000000000002'),
    })).status).toBe(409);
    expect((await request('/api/friends/track-shares', {
      cookie: alice.cookie,
      method: 'POST',
      headers: { 'X-TrackLab-Club-Tablet-Session': 'kiosk-token' },
      body: shareBody(bob.user.id, '10000000-0000-4000-8000-000000000003'),
    })).status).toBe(403);

    await connectByInvite(alice, bob);
    const shareableFriends = await body(await request('/api/friends?limit=20', { cookie: alice.cookie }));
    expect(shareableFriends.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bob.user.id, canShareTrack: true }),
      expect.objectContaining({ id: official.user.id, canShareTrack: false }),
    ]));
    const stream = await openShareEventStream(bob.cookie);
    const createdResponse = await request('/api/friends/track-shares', {
      cookie: alice.cookie,
      method: 'POST',
      body: shareBody(bob.user.id, '10000000-0000-4000-8000-000000000004'),
    });
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get('ratelimit-limit')).toBe('30');
    const created = (await body(createdResponse)).share;
    expect(created).toMatchObject({
      id: '10000000-0000-4000-8000-000000000004',
      trackId,
      track: { id: trackId, name: 'Apple Valley BMX Moto Park' },
      recipient: {
        id: bob.user.id,
        handle: bob.user.username,
        displayName: 'Share API Bob',
      },
      sender: {
        id: alice.user.id,
        handle: alice.user.username,
        displayName: 'Share API Alice',
      },
      openedAt: null,
    });
    expect(created.track.name).not.toBe('Spoofed Track');
    expect(normalizeTrackShare(created)).toMatchObject({
      id: created.id,
      trackId,
      sender: { id: alice.user.id },
    });
    expect(await waitForShareInvalidation(stream)).toBe('event: track-shares-invalidated\ndata: {}');
    stream.controller.abort();
    eventControllers.delete(stream.controller);

    const received = await body(await request('/api/friends/track-shares?limit=20', { cookie: bob.cookie }));
    expect(received).toMatchObject({
      total: 1,
      unreadTotal: 1,
      nextCursor: null,
      items: [{
        id: created.id,
        trackId,
        sender: {
          id: alice.user.id,
          handle: alice.user.username,
          displayName: 'Share API Alice',
        },
        openedAt: null,
      }],
    });
    expect(JSON.stringify(received)).not.toMatch(/@tracklab\.test|friendshipSource|officialType|source.*invite/i);
    expect((await body(await request('/api/friends/track-shares', { cookie: alice.cookie }))).items).toEqual([]);

    expect((await request(`/api/friends/track-shares/${created.id}/open`, {
      cookie: alice.cookie,
      method: 'POST',
    })).status).toBe(404);
    const openedResponse = await request(`/api/friends/track-shares/${created.id}/open`, {
      cookie: bob.cookie,
      method: 'POST',
    });
    expect(openedResponse.status).toBe(200);
    expect((await body(openedResponse)).share).toMatchObject({
      id: created.id,
      openedAt: expect.any(String),
      sender: { id: alice.user.id },
    });
    expect((await body(await request('/api/friends/track-shares?unread=1', { cookie: bob.cookie }))))
      .toMatchObject({ items: [], total: 1, unreadTotal: 0 });
    expect((await request(`/api/friends/track-shares/${created.id}`, {
      cookie: alice.cookie,
      method: 'DELETE',
    })).status).toBe(404);

    const replayResponse = await request('/api/friends/track-shares', {
      cookie: alice.cookie,
      method: 'POST',
      body: shareBody(bob.user.id, '10000000-0000-4000-8000-000000000005'),
    });
    expect(replayResponse.status).toBe(201);
    expect((await body(replayResponse)).share).toMatchObject({ id: created.id, openedAt: null });
    expect((await body(await request('/api/friends/track-shares', { cookie: bob.cookie }))).total).toBe(1);

    expect((await request('/api/friends/blocks', {
      cookie: bob.cookie,
      method: 'POST',
      body: { profileId: alice.user.id },
    })).status).toBe(201);
    expect(await body(await request('/api/friends/track-shares', { cookie: bob.cookie })))
      .toMatchObject({ items: [], total: 0, unreadTotal: 0 });
    expect((await request(`/api/friends/track-shares/${created.id}/open`, {
      cookie: bob.cookie,
      method: 'POST',
    })).status).toBe(404);
  }, 25_000);

  it('limits one sender to six hourly shares per recipient', async () => {
    const trackId = 'apple-valley-bmx-moto-park';
    const sender = await register('share-limit-sender@tracklab.test', 'Share Limit Sender', '198.51.100.121');
    const recipient = await register('share-limit-recipient@tracklab.test', 'Share Limit Recipient', '198.51.100.122');
    await connectByInvite(sender, recipient);

    for (let index = 0; index < 6; index += 1) {
      const response = await request('/api/friends/track-shares', {
        cookie: sender.cookie,
        method: 'POST',
        body: {
          recipientProfileId: recipient.user.id,
          trackId,
          clientRequestId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        },
      });
      expect(response.status).toBe(201);
    }
    const limited = await request('/api/friends/track-shares', {
      cookie: sender.cookie,
      method: 'POST',
      body: {
        recipientProfileId: recipient.user.id,
        trackId,
        clientRequestId: '20000000-0000-4000-8000-999999999999',
      },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('ratelimit-limit')).toBe('6');
    expect(limited.headers.get('retry-after')).toEqual(expect.any(String));
  }, 25_000);

  it('limits each sender account to 30 hourly track shares across recipients', async () => {
    const trackId = 'apple-valley-bmx-moto-park';
    const sender = await register('share-total-sender@tracklab.test', 'Share Total Sender', '198.51.100.131');
    const recipients = await Promise.all(Array.from({ length: 6 }, (_, index) => register(
      `share-total-recipient-${index}@tracklab.test`,
      `Share Total Recipient ${index}`,
      `198.51.100.${132 + index}`,
    )));
    for (const recipient of recipients) await connectByInvite(sender, recipient);

    let requestIndex = 0;
    for (const recipient of recipients.slice(0, 5)) {
      for (let recipientIndex = 0; recipientIndex < 6; recipientIndex += 1) {
        const response = await request('/api/friends/track-shares', {
          cookie: sender.cookie,
          method: 'POST',
          body: {
            recipientProfileId: recipient.user.id,
            trackId,
            clientRequestId: `30000000-0000-4000-8000-${String(requestIndex).padStart(12, '0')}`,
          },
        });
        expect(response.status).toBe(201);
        expect(response.headers.get('ratelimit-limit')).toBe('30');
        requestIndex += 1;
      }
    }

    const limited = await request('/api/friends/track-shares', {
      cookie: sender.cookie,
      method: 'POST',
      body: {
        recipientProfileId: recipients[5].user.id,
        trackId,
        clientRequestId: '30000000-0000-4000-8000-999999999999',
      },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('ratelimit-limit')).toBe('30');
    expect(limited.headers.get('retry-after')).toEqual(expect.any(String));
  }, 25_000);
});
