import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
let admin = '';
let rider = '';
let other = '';
let riderUser: { id: string; profileKey: string };
const sockets = new Set<WebSocket>();

async function request(path: string, cookie = '', body?: unknown) {
  return fetch(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: baseUrl, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function register(email: string) {
  const response = await request('/api/auth/register', '', { email, name: 'Beta test rider', password: 'beta-test-long-password' });
  expect(response.status).toBe(201);
  return { cookie: String(response.headers.get('set-cookie')).split(';')[0], user: (await response.json()).user };
}

beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address && typeof address === 'object' ? address.port : 0));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], { cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', OPENAI_API_KEY: '',
      TRACKLAB_PUBLIC_BETA_ENDS_AT: new Date(Date.now()+86400000).toISOString(), TRACKLAB_APPLE_IAP_ENABLED: '0', TRACKLAB_APPLE_ONLY_CUTOVER: '0',
      TRACKLAB_ADMIN_EMAILS: 'beta-admin@tracklab.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await request('/api/health')).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  admin = (await register('beta-admin@tracklab.test')).cookie;
  const registered = await register('beta-rider@tracklab.test');
  rider = registered.cookie;
  riderUser = registered.user;
  other = (await register('beta-other@tracklab.test')).cookie;
}, 25000);

afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
});

describe('automatic beta API', () => {
  it('enrolls the child’s native phone with its own access and identity', async () => {
    const created=await request('/api/family/children',other,{name:'Child Beta'});
    expect(created.status).toBe(201); const body=await created.json();
    const child=body.child;
    const invite=await request(`/api/family/children/${child.id}/device-invite`,other,{});
    expect(invite.status).toBe(201); const invitation=await invite.json(); const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('childDevice');
    const accepted=await fetch(`${baseUrl}/api/auth/child-device/accept`,{method:'POST',headers:{Origin:'capacitor://localhost','Content-Type':'application/json','X-TrackLab-Native-Session':'1'},body:JSON.stringify({token,confirm:true})});
    expect(accepted.status).toBe(200);const account=await accepted.json();
    expect(account.user).toMatchObject({managedChild:true,name:'Child Beta',membership:{tier:'racer',bikeSeats:4}});
    expect(account.user.id).not.toBe(riderUser.id);
    expect(account.nativeSessionToken).toBeTruthy();
  });
  it('automatically enrolls signed-in testers without a purchase or invitation', async () => {
    expect((await request('/api/beta-access')).status).toBe(401);
    expect((await (await request('/api/auth/me',rider)).json()).user).toMatchObject({admin:false,membership:{tier:'racer',bikeSeats:4}});
    const beta=await (await request('/api/beta-access',rider)).json();
    expect(beta.beta).toMatchObject({active:true,bikeSeats:4});
    expect((await request('/api/race-results',rider,{})).status).not.toBe(403);
    expect((await request('/api/admin/beta-access',rider)).status).toBe(403);
    const login=await request('/api/auth/login','',{email:'beta-rider@tracklab.test',password:'beta-test-long-password'});
    expect((await login.json()).user.membership).toEqual({tier:'racer',bikeSeats:4});
    expect((await (await request('/api/beta-access',rider)).json()).beta.id).toBe(beta.beta.id);
    expect((await request('/api/admin/beta-access/revoke',admin,{grantId:beta.beta.id})).status).toBe(200);
    expect((await (await request('/api/auth/me',rider)).json()).user.membership.tier).toBe('spectator');
    expect((await (await request('/api/beta-access',rider)).json()).beta.active).toBe(false);
  });
});
