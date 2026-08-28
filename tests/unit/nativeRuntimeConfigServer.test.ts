import { describe, expect, it } from 'vitest';
import {
  clientGoogleMapsJsApiKey,
  nativeRuntimeConfigPayload,
} from '../../cloud/nativeRuntimeConfig.mjs';

describe('native runtime configuration payload', () => {
  it('prefers the dedicated client key and never falls through to the Routes key', () => {
    const dedicated = `AIza${'N'.repeat(35)}`;
    const fallback = `AIza${'F'.repeat(35)}`;
    const payload = nativeRuntimeConfigPayload({
      GOOGLE_ROUTES_API_KEY: 'server-only-routes-key',
      TRACKLAB_GOOGLE_MAPS_JS_API_KEY: dedicated,
      VITE_GOOGLE_MAPS_API_KEY: fallback,
    });

    expect(clientGoogleMapsJsApiKey({
      TRACKLAB_GOOGLE_MAPS_JS_API_KEY: dedicated,
      VITE_GOOGLE_MAPS_API_KEY: fallback,
    })).toBe(dedicated);
    expect(payload).toEqual({
      version: 1,
      googleMaps: { configured: true, apiKey: dedicated },
    });
    expect(JSON.stringify(payload)).not.toContain('server-only-routes-key');
  });

  it('uses the migration fallback and reports a missing client key explicitly', () => {
    const fallback = `AIza${'F'.repeat(35)}`;
    expect(nativeRuntimeConfigPayload({ VITE_GOOGLE_MAPS_API_KEY: fallback }))
      .toEqual({
        version: 1,
        googleMaps: { configured: true, apiKey: fallback },
      });
    expect(nativeRuntimeConfigPayload({ GOOGLE_ROUTES_API_KEY: 'server-only-routes-key' }))
      .toEqual({
        version: 1,
        googleMaps: { configured: false, apiKey: null },
      });
  });
});
