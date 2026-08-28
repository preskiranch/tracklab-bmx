import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleMapsApiKey } from '../../src/lib/googleMaps';
import {
  getRuntimeGoogleMapsApiKey,
  loadNativeRuntimeConfig,
  resetNativeRuntimeConfigForTests,
} from '../../src/lib/nativeRuntimeConfig';

const runtimeKey = `AIza${'R'.repeat(35)}`;
const bundledKey = `AIza${'B'.repeat(35)}`;

afterEach(() => {
  resetNativeRuntimeConfigForTests();
  vi.unstubAllEnvs();
});

describe('native runtime configuration', () => {
  it('loads the versioned Maps key without caching or persistent storage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      version: 1,
      googleMaps: { configured: true, apiKey: runtimeKey },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(loadNativeRuntimeConfig({ fetcher, native: true })).resolves.toEqual({
      googleMapsConfigured: true,
      state: 'loaded',
    });
    expect(fetcher).toHaveBeenCalledWith('/api/native/runtime-config', expect.objectContaining({
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }));
    expect(getRuntimeGoogleMapsApiKey()).toBe(runtimeKey);
    expect(readFileSync('src/lib/nativeRuntimeConfig.ts', 'utf8')).not.toMatch(/localStorage|sessionStorage/u);
  });

  it('skips the endpoint outside the native shell', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(loadNativeRuntimeConfig({ fetcher, native: false })).resolves.toEqual({
      googleMapsConfigured: false,
      state: 'skipped',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for malformed keys without blocking app startup', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      version: 1,
      googleMaps: { configured: true, apiKey: 'not-a-google-maps-key' },
    }), { status: 200 }));

    await expect(loadNativeRuntimeConfig({ fetcher, native: true })).resolves.toEqual({
      googleMapsConfigured: false,
      state: 'unavailable',
    });
    expect(getRuntimeGoogleMapsApiKey()).toBe('');
  });

  it('prefers runtime configuration and preserves the web bundle fallback', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', `  ${bundledKey}  `);
    expect(getGoogleMapsApiKey()).toBe(bundledKey);

    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      version: 1,
      googleMaps: { configured: true, apiKey: runtimeKey },
    }), { status: 200 }));
    await loadNativeRuntimeConfig({ fetcher, native: true });

    expect(getGoogleMapsApiKey()).toBe(runtimeKey);
  });

  it('loads native configuration before importing the application bundle', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main.indexOf('await loadNativeRuntimeConfig({ native: true })'))
      .toBeLessThan(main.indexOf("await import('./App')"));
  });
});
