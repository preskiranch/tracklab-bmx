const defaultTimeoutMs = 10_000;
const minimumTrackCount = 500;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function normalizedBaseUrl(value) {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

const target = argument('--url') || process.env.TRACKLAB_SMOKE_URL;
if (!target) {
  throw new Error('Set TRACKLAB_SMOKE_URL or pass --url https://your-tracklab-host.example.');
}

const baseUrl = normalizedBaseUrl(target);
const timeoutMs = Number(process.env.TRACKLAB_SMOKE_TIMEOUT_MS) || defaultTimeoutMs;
const expectPostgres = process.env.TRACKLAB_EXPECT_POSTGRES === '1';
const expectFriends = process.env.TRACKLAB_EXPECT_FRIENDS === '1';
const expectApns = process.env.TRACKLAB_EXPECT_APNS === '1';
const expectAppleIap = process.env.TRACKLAB_EXPECT_APPLE_IAP === '1';
const expectAppleOnlyCutover = process.env.TRACKLAB_EXPECT_APPLE_ONLY_CUTOVER === '1';

async function request(pathname, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    ...init,
    headers: {
      'User-Agent': 'TrackLab-Deployment-Smoke/1.0',
      ...init.headers,
    },
  });
  return { response, durationMs: performance.now() - startedAt };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const results = [];
const healthRequest = await request('/api/health');
assert(healthRequest.response.ok, `/api/health returned ${healthRequest.response.status}.`);
assert(healthRequest.response.headers.get('cache-control') === 'no-store', '/api/health must be no-store.');
assert(/^[0-9a-f-]{36}$/i.test(healthRequest.response.headers.get('x-request-id') || ''), 'Health response has no valid request ID.');
assert(healthRequest.response.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is missing.');
assert(healthRequest.response.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options is missing.');
assert(Boolean(healthRequest.response.headers.get('referrer-policy')), 'Referrer-Policy is missing.');
if (baseUrl.startsWith('https://')) {
  assert(Boolean(healthRequest.response.headers.get('strict-transport-security')), 'HSTS is missing on HTTPS.');
}
const health = await healthRequest.response.json();
assert(health.status === 'ok' && health.storage?.ready === true, 'Health payload reports an unavailable service.');
if (expectPostgres) {
  assert(
    health.storage?.configured === true
      && health.storage?.mode === 'postgres'
      && health.requirements?.database === true,
    'Production smoke expected required PostgreSQL persistence, but the service is not configured to fail closed.',
  );
}
if (expectApns) {
  assert(
    health.requirements?.apns === true
      && health.push?.enabled === true
      && health.push?.ready === true
      && health.push?.degraded === false,
    `Production smoke expected operational APNs, but push health is ${health.push?.reason || 'unavailable'}.`,
  );
}
if (expectAppleIap || expectAppleOnlyCutover) {
  assert(
    health.requirements?.appleIap === true
      && health.billing?.provider === 'apple-app-store'
      && health.billing?.enabled === true
      && health.billing?.configured === true
      && health.billing?.ready === true,
    'Deployment smoke expected configured Apple in-app purchases, but billing is not ready.',
  );
}
if (expectAppleOnlyCutover) {
  assert(
    health.requirements?.appleOnlyCutover === true
      && health.billing?.appleOnlyCutover === true,
    'Deployment smoke expected Apple-only Wattbike billing, but final cutover is not active.',
  );
}
results.push(['health', healthRequest.durationMs]);

const nativeRuntimeRequest = await request('/api/native/runtime-config', {
  headers: {
    Accept: 'application/json',
    Origin: 'capacitor://localhost',
    'X-TrackLab-Native-Session': '1',
  },
});
assert(
  nativeRuntimeRequest.response.ok,
  `/api/native/runtime-config returned ${nativeRuntimeRequest.response.status}.`,
);
assert(
  nativeRuntimeRequest.response.headers.get('cache-control') === 'no-store',
  'Native runtime configuration must be no-store.',
);
assert(
  nativeRuntimeRequest.response.headers.get('access-control-allow-origin') === 'capacitor://localhost',
  'Native runtime configuration did not preserve the exact Capacitor CORS origin.',
);
const nativeRuntime = await nativeRuntimeRequest.response.json();
assert(
  nativeRuntime.version === 1
    && nativeRuntime.googleMaps?.configured === true
    && /^AIza[0-9A-Za-z_-]{35}$/u.test(nativeRuntime.googleMaps?.apiKey || ''),
  'Native runtime configuration does not contain a valid Maps JavaScript client key.',
);
results.push(['native satellite configuration', nativeRuntimeRequest.durationMs]);

const publicRuntimeRequest = await request('/api/native/runtime-config', {
  headers: { Accept: 'application/json' },
});
assert(
  publicRuntimeRequest.response.status === 403,
  'Native runtime configuration was exposed outside the native request contract.',
);
results.push(['native configuration boundary', publicRuntimeRequest.durationMs]);

const rootRequest = await request('/', { headers: { Accept: 'text/html' } });
assert(rootRequest.response.ok, `/ returned ${rootRequest.response.status}.`);
assert(rootRequest.response.headers.get('content-type')?.includes('text/html'), 'Root response is not HTML.');
const html = await rootRequest.response.text();
assert(html.includes('<div id="root"></div>'), 'Root HTML does not contain the application mount point.');
assert(html.includes('TrackLab BMX'), 'Root HTML does not identify TrackLab BMX.');
results.push(['application shell', rootRequest.durationMs]);

const assetPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
assert(assetPath, 'Production JavaScript asset could not be discovered from index.html.');
const assetRequest = await request(assetPath, { headers: { 'Accept-Encoding': 'br, gzip' } });
assert(assetRequest.response.ok, `Production asset returned ${assetRequest.response.status}.`);
assert(assetRequest.response.headers.get('cache-control')?.includes('immutable'), 'Hashed asset is not immutable.');
assert(['br', 'gzip'].includes(assetRequest.response.headers.get('content-encoding')), 'Production asset was not served compressed.');
await assetRequest.response.arrayBuffer();
results.push(['compressed application asset', assetRequest.durationMs]);

const locatorRequest = await request('/data/track-locator.json', { headers: { Accept: 'application/json' } });
assert(locatorRequest.response.ok, `Track locator returned ${locatorRequest.response.status}.`);
const locator = await locatorRequest.response.json();
assert(
  Number(locator.trackCount) >= minimumTrackCount
    && Array.isArray(locator.tracks)
    && locator.tracks.length === Number(locator.trackCount),
  `Track locator contains fewer than ${minimumTrackCount} valid tracks.`,
);
results.push([`track locator (${locator.trackCount} tracks)`, locatorRequest.durationMs]);

const bikeShopBoundaryRequest = await request('/api/bike-shops/nearby', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: baseUrl,
  },
  body: JSON.stringify({ latitude: 0, longitude: 0, radiusMiles: 12 }),
});
assert(
  bikeShopBoundaryRequest.response.status === 400,
  `Public bike-shop search validation returned ${bikeShopBoundaryRequest.response.status} instead of 400.`,
);
assert(
  bikeShopBoundaryRequest.response.headers.get('cache-control') === 'no-store',
  'Public bike-shop search validation must be no-store.',
);
results.push(['public bike-shop search boundary', bikeShopBoundaryRequest.durationMs]);

const bikeShopClaimBoundaryRequest = await request('/api/bike-shops/claim-requests', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: baseUrl,
  },
  body: JSON.stringify({}),
});
assert(
  bikeShopClaimBoundaryRequest.response.status === 401,
  `Anonymous bike-shop claim boundary returned ${bikeShopClaimBoundaryRequest.response.status} instead of 401.`,
);
results.push(['anonymous bike-shop claim boundary', bikeShopClaimBoundaryRequest.durationMs]);

const authRequest = await request('/api/auth/me');
assert(authRequest.response.ok, `/api/auth/me returned ${authRequest.response.status}.`);
const auth = await authRequest.response.json();
assert(Object.hasOwn(auth, 'user'), 'Anonymous auth response is malformed.');
results.push(['anonymous authentication boundary', authRequest.durationMs]);

if (expectFriends) {
  const friendsRequest = await request('/api/friends');
  assert(
    friendsRequest.response.status === 401,
    `Anonymous Friends boundary returned ${friendsRequest.response.status} instead of 401.`,
  );
  const friendsError = await friendsRequest.response.json();
  assert(typeof friendsError.error === 'string', 'Anonymous Friends response is malformed.');
  results.push(['anonymous Friends boundary', friendsRequest.durationMs]);
}

const missingAssetRequest = await request('/assets/tracklab-smoke-missing.js', { headers: { Accept: 'text/html' } });
assert(missingAssetRequest.response.status === 404, 'A missing static asset did not return 404.');
results.push(['missing asset boundary', missingAssetRequest.durationMs]);

for (const [label, durationMs] of results) {
  console.log(`PASS ${label}: ${Math.round(durationMs)} ms`);
}
console.log(`Deployment smoke passed for ${baseUrl} at version ${health.version || 'unknown'}.`);
