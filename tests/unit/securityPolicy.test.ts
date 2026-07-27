import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bridgeCorsOrigin, bridgeOriginAllowed } from '../../bridge/originPolicy.mjs';
import {
  createRateLimiter,
  mutationOriginAllowed,
  pathIsInside,
  publicRequestOrigin,
  staticCacheControl,
} from '../../cloud/httpSecurity.mjs';

function request(headers: Record<string, string>) {
  return { headers, socket: { remoteAddress: '127.0.0.1' } };
}

afterEach(() => {
  delete process.env.TRACKLAB_ALLOWED_ORIGINS;
});

describe('HTTP security policy', () => {
  it('accepts same-origin mutations and rejects cross-site requests', () => {
    const sameOrigin = request({ host: 'tracklab.example', origin: 'https://tracklab.example', 'x-forwarded-proto': 'https' });
    expect(publicRequestOrigin(sameOrigin)).toBe('https://tracklab.example');
    expect(mutationOriginAllowed(sameOrigin)).toBe(true);
    expect(mutationOriginAllowed(request({
      host: 'tracklab.example',
      origin: 'https://attacker.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site',
    }))).toBe(false);
  });

  it('only marks fingerprinted assets immutable', () => {
    expect(staticCacheControl('/assets/index-BC9umi0p.js')).toContain('immutable');
    expect(staticCacheControl('/data/track-database.json')).toBe('no-cache');
    expect(staticCacheControl('/manifest.webmanifest')).toBe('no-cache');
  });

  it('prevents resolved paths from escaping the static directory', () => {
    const parent = path.resolve('/srv/tracklab/dist');
    expect(pathIsInside(parent, path.join(parent, 'assets/app.js'), path)).toBe(true);
    expect(pathIsInside(parent, path.resolve(parent, '../secrets.txt'), path)).toBe(false);
  });

  it('enforces bounded request windows', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, maxEntries: 10 });
    expect(limiter.check('login:one', 2, 1_000).allowed).toBe(true);
    expect(limiter.check('login:one', 2, 1_100).allowed).toBe(true);
    expect(limiter.check('login:one', 2, 1_200).allowed).toBe(false);
    expect(limiter.check('login:one', 2, 2_001).allowed).toBe(true);
  });
});

describe('local connector origin policy', () => {
  it('allows TrackLab and loopback but blocks unrelated websites', () => {
    expect(bridgeOriginAllowed('https://tracklab-bmx.onrender.com')).toBe(true);
    expect(bridgeOriginAllowed('http://127.0.0.1:5174')).toBe(true);
    expect(bridgeOriginAllowed('https://attacker.example')).toBe(false);
    expect(bridgeCorsOrigin('https://attacker.example')).toBeNull();
  });

  it('supports explicitly configured hosted origins', () => {
    process.env.TRACKLAB_ALLOWED_ORIGINS = 'https://staging.tracklab.example';
    expect(bridgeCorsOrigin('https://staging.tracklab.example/path')).toBe('https://staging.tracklab.example');
  });
});
