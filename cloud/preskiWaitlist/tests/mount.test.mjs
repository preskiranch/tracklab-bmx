import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreskiWaitlistMount } from '../mount.mjs';

function response() {
  return { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('disabled module never initializes or intercepts TrackLab routes', async () => {
  const mount = createPreskiWaitlistMount({}, () => { throw Error('Must not initialize'); });
  assert.equal(mount({ url: '/api/auth/login' }, response()), false);
  assert.equal(mount({ url: '/api/health' }, response()), false);
  const res = response();
  assert.equal(mount({ url: '/api/preski-labs/waitlist' }, res), true);
  await settle();
  assert.equal(res.status, 503);
});

test('namespace is translated without losing query parameters', async () => {
  let received;
  const mount = createPreskiWaitlistMount({ PRESKI_WAITLIST_ENABLED: '1' }, async () => async req => { received = req.url; });
  mount({ url: '/api/preski-labs/admin/waitlist?product=tracklab-bmx' }, response());
  await settle();
  assert.equal(received, '/api/admin/waitlist?product=tracklab-bmx');
  assert.equal(mount({ url: '/api/preski-labs-evil/waitlist' }, response()), false);
});

test('initialization failure is contained and never claims a saved signup', async () => {
  const mount = createPreskiWaitlistMount({ PRESKI_WAITLIST_ENABLED: '1' }, async () => { throw Error('private failure'); });
  const res = response();
  mount({ url: '/api/preski-labs/waitlist' }, res);
  await settle();
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).ok, false);
  assert.equal(res.body.includes('private failure'), false);
});
