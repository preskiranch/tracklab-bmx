import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';

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

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      return await fetch(`${baseUrl}/api/health`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Production health test server did not start.');
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
      TRACKLAB_REQUIRE_DATABASE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
}, 20_000);

afterAll(async () => {
  if (!child || child.exitCode != null) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('production persistence requirement', () => {
  it('fails health checks instead of accepting ephemeral memory storage', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unavailable',
      storage: { mode: 'memory', configured: false, ready: true },
      requirements: { database: true },
    });
  });
});
