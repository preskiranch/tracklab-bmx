import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
let adminCookie = '';
let reporterCookie = '';
let reportedCookie = '';
let reporterId = '';
let reportedId = '';
let childOutput = '';
const sockets = new Set<WebSocket>();

type TestSocket = {
  socket: WebSocket;
  messages: Array<Record<string, any>>;
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
  throw new Error(`Moderation test server did not become healthy. ${childOutput}`);
}

async function request(
  pathname: string,
  options: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Origin: baseUrl,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function register(email: string, name: string, forwardedFor: string) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'X-Forwarded-For': forwardedFor },
    body: { email, name, password: 'moderation-test-password' },
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { user: { id: string } };
  return {
    cookie: String(response.headers.get('set-cookie')).split(';')[0],
    userId: body.user.id,
  };
}

async function openSocket(cookie: string): Promise<TestSocket> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/multiplayer`, {
    headers: { Cookie: cookie, Origin: baseUrl },
  });
  const state: TestSocket = { socket, messages: [] };
  socket.on('message', (data) => {
    try {
      state.messages.push(JSON.parse(data.toString()));
    } catch {
      // Protocol tests inspect JSON frames only.
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  sockets.add(socket);
  return state;
}

async function waitForSocketMessage(
  connection: TestSocket,
  predicate: (message: Record<string, any>) => boolean,
  afterIndex = 0,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = connection.messages.slice(afterIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for socket message: ${JSON.stringify(connection.messages.slice(afterIndex))}`);
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
      TRACKLAB_ADMIN_EMAILS: 'moderation-admin@tracklab.test',
      TRACKLAB_APPLE_IAP_ENABLED: '0',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data) => { childOutput += data.toString(); });
  child.stderr?.on('data', (data) => { childOutput += data.toString(); });
  await waitForHealth();

  const admin = await register('moderation-admin@tracklab.test', 'Safety Admin', '198.51.100.41');
  const reporter = await register('moderation-reporter@tracklab.test', 'Reporting Rider', '198.51.100.42');
  const reported = await register('moderation-reported@tracklab.test', 'Reported Rider', '198.51.100.43');
  adminCookie = admin.cookie;
  reporterCookie = reporter.cookie;
  reportedCookie = reported.cookie;
  reporterId = reporter.userId;
  reportedId = reported.userId;
}, 30_000);

afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
  sockets.clear();
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

describe('community moderation server safeguards', () => {
  it('provides a private administrator queue and records a reporter-protection outcome', async () => {
    const created = await request('/api/friends/reports', {
      cookie: reporterCookie,
      method: 'POST',
      body: {
        profileId: reportedId,
        reason: 'harassment',
        details: 'Unsafe language in a private race room.',
      },
    });
    expect(created.status).toBe(201);
    const reportId = String((await created.json() as any).report.reportId);

    expect((await request('/api/admin/moderation/reports')).status).toBe(401);
    expect((await request('/api/admin/moderation/reports', { cookie: reportedCookie })).status).toBe(403);
    expect((await request('/api/admin/moderation/reports?status=invalid', { cookie: adminCookie })).status).toBe(400);

    let response = await request('/api/admin/moderation/reports?status=open', { cookie: adminCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    let queue = await response.json() as any;
    expect(queue).toMatchObject({ status: 'open', offset: 0, limit: 25, total: 1 });
    expect(queue.items).toEqual([expect.objectContaining({
      reportId,
      reporter: expect.objectContaining({ profileId: reporterId, displayName: 'Reporting Rider' }),
      reported: expect.objectContaining({ profileId: reportedId, displayName: 'Reported Rider' }),
      reason: 'harassment',
      details: 'Unsafe language in a private race room.',
      status: 'open',
      action: 'none',
      reviewedAt: null,
    })]);
    expect(JSON.stringify(queue)).not.toContain('@tracklab.test');

    response = await request(`/api/admin/moderation/reports/${reportId}`, {
      cookie: adminCookie,
      method: 'PATCH',
      body: { status: 'reviewing', action: 'investigating', note: 'Review started.' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      report: { reportId, status: 'reviewing', action: 'investigating', note: 'Review started.' },
    });

    expect((await request(`/api/admin/moderation/reports/${reportId}`, {
      cookie: adminCookie,
      method: 'PATCH',
      body: { status: 'dismissed', action: 'protect-reporter', note: 'Invalid combination.' },
    })).status).toBe(400);

    response = await request(`/api/admin/moderation/reports/${reportId}`, {
      cookie: adminCookie,
      method: 'PATCH',
      body: {
        status: 'resolved',
        action: 'protect-reporter',
        note: 'Applied a direct-interaction block for the reporter.',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      report: {
        reportId,
        status: 'resolved',
        action: 'protect-reporter',
        reviewedByUserId: expect.any(String),
        reviewedAt: expect.any(String),
      },
    });

    const blocked = await request('/api/friends/blocks', { cookie: reporterCookie });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toMatchObject({
      items: [expect.objectContaining({ id: reportedId, relationship: 'blocked' })],
      total: 1,
    });

    queue = await (await request('/api/admin/moderation/reports?status=resolved', {
      cookie: adminCookie,
    })).json() as any;
    expect(queue).toMatchObject({ total: 1, items: [{ reportId, action: 'protect-reporter' }] });
  });

  it('filters room text and lets a signed-in rider report and block a current room member', async () => {
    const connection = await openSocket(adminCookie);
    const reporterConnection = await openSocket(reporterCookie);
    await waitForSocketMessage(connection, (message) => message.type === 'connected');
    const reporterConnected = await waitForSocketMessage(
      reporterConnection,
      (message) => message.type === 'connected' && typeof message.clientId === 'string',
    );
    connection.socket.send(JSON.stringify({
      type: 'hello',
      available: true,
      bikeCount: 1,
      track: { id: 'moderation-test-track', name: 'Moderation Test Track' },
    }));
    reporterConnection.socket.send(JSON.stringify({
      type: 'hello',
      available: true,
      bikeCount: 1,
      track: { id: 'moderation-test-track', name: 'Moderation Test Track' },
    }));
    await waitForSocketMessage(connection, (message) => message.type === 'welcome');
    await waitForSocketMessage(reporterConnection, (message) => message.type === 'welcome');
    connection.socket.send(JSON.stringify({
      type: 'create-room',
      private: true,
      racerSeatCount: 1,
      track: { id: 'moderation-test-track', name: 'Moderation Test Track' },
    }));
    const initialRoomState = await waitForSocketMessage(
      connection,
      (message) => message.type === 'room-state'
        && message.room?.purpose === 'race'
        && message.room?.memberCount === 1,
    );
    const roomId = String(initialRoomState.room.id);
    reporterConnection.socket.send(JSON.stringify({ type: 'join-room', roomId }));
    await waitForSocketMessage(
      connection,
      (message) => message.type === 'room-state'
        && message.room?.id === roomId
        && message.room?.memberCount === 2,
    );
    await waitForSocketMessage(
      reporterConnection,
      (message) => message.type === 'room-state'
        && message.room?.id === roomId
        && message.room?.memberCount === 2,
    );

    let start = connection.messages.length;
    connection.socket.send(JSON.stringify({ type: 'room-chat', text: 'go kill yourself' }));
    const rejected = await waitForSocketMessage(
      connection,
      (message) => message.type === 'room-error' && message.code === 'objectionable-content',
      start,
    );
    expect(rejected.message).toContain('was not sent');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connection.messages.slice(start).some((message) => message.type === 'room-chat')).toBe(false);
    expect(JSON.stringify(connection.messages.slice(start))).not.toContain('go kill yourself');

    start = connection.messages.length;
    connection.socket.send(JSON.stringify({ type: 'room-chat', text: 'Great lap — see you at the gate!' }));
    await expect(waitForSocketMessage(
      connection,
      (message) => message.type === 'room-chat'
        && message.message?.text === 'Great lap — see you at the gate!',
      start,
    )).resolves.toMatchObject({
      message: { author: 'Safety Admin', text: 'Great lap — see you at the gate!' },
    });
    await expect(waitForSocketMessage(
      reporterConnection,
      (message) => message.type === 'room-chat'
        && message.message?.text === 'Great lap — see you at the gate!',
    )).resolves.toMatchObject({
      message: { author: 'Safety Admin', text: 'Great lap — see you at the gate!' },
    });

    start = connection.messages.length;
    connection.socket.send(JSON.stringify({
      type: 'room-report',
      targetId: reporterConnected.clientId,
      reason: 'harassment',
    }));
    await expect(waitForSocketMessage(
      connection,
      (message) => message.type === 'room-safety-result'
        && message.action === 'reported'
        && message.targetId === reporterConnected.clientId,
      start,
    )).resolves.toMatchObject({
      reportId: expect.any(String),
      message: expect.stringContaining('Report received'),
    });

    const openQueueResponse = await request('/api/admin/moderation/reports?status=open', {
      cookie: adminCookie,
    });
    expect(openQueueResponse.status).toBe(200);
    const openQueue = await openQueueResponse.json() as any;
    expect(openQueue.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reporter: expect.objectContaining({ profileId: expect.any(String), displayName: 'Safety Admin' }),
        reported: expect.objectContaining({ profileId: reporterId, displayName: 'Reporting Rider' }),
        reason: 'harassment',
        details: expect.stringContaining(`active room ${roomId}`),
        status: 'open',
      }),
    ]));

    // The server rate-limits consecutive safety actions without preventing a
    // rider from reporting and then blocking the same current-room account.
    await new Promise((resolve) => setTimeout(resolve, 2_050));
    start = connection.messages.length;
    connection.socket.send(JSON.stringify({
      type: 'room-block',
      targetId: reporterConnected.clientId,
    }));
    await expect(waitForSocketMessage(
      connection,
      (message) => message.type === 'room-safety-result'
        && message.action === 'blocked'
        && message.targetId === reporterConnected.clientId,
      start,
    )).resolves.toMatchObject({ message: expect.stringContaining('is blocked') });
    await waitForSocketMessage(
      connection,
      (message) => message.type === 'room-left' && message.roomId === roomId,
      start,
    );

    const afterBlock = connection.messages.length;
    reporterConnection.socket.send(JSON.stringify({
      type: 'room-chat',
      text: 'This message must not reach the rider who blocked me.',
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connection.messages.slice(afterBlock).some((message) => message.type === 'room-chat')).toBe(false);

    connection.socket.send(JSON.stringify({ type: 'join-room', roomId }));
    await expect(waitForSocketMessage(
      connection,
      (message) => message.type === 'room-error' && message.message === 'That room is not available.',
      afterBlock,
    )).resolves.toBeTruthy();
    expect(connection.messages.slice(afterBlock).some((message) => (
      message.type === 'room-state' && message.room?.id === roomId
    ))).toBe(false);
  }, 15_000);
});
