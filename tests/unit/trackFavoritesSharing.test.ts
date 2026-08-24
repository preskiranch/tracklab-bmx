import { describe, expect, it, vi } from 'vitest';
import { createTrackFavoritesApi, normalizeFavoriteTrackIds } from '../../src/lib/trackFavorites';
import {
  copyTrackLocatorLink,
  normalizeTrackLocatorId,
  trackLocatorIdFromHref,
  trackLocatorShareUrl,
} from '../../src/lib/mapLinks';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('favorite tracks and public locator links', () => {
  it('builds one clean canonical link without copying private or transient query state', () => {
    expect(trackLocatorShareUrl(
      'apple-valley-bmx-moto-park',
      'https://tracklab.test/current?friendInvite=secret&checkout=private#settings',
    )).toBe('https://tracklab.test/?locator=apple-valley-bmx-moto-park#track-locator');
    expect(trackLocatorIdFromHref(
      'https://tracklab.test/?locator=apple-valley-bmx-moto-park#track-locator',
    )).toBe('apple-valley-bmx-moto-park');
    expect(normalizeTrackLocatorId('track/private')).toBe('');
    expect(normalizeTrackLocatorId('x'.repeat(141))).toBe('');
    expect(trackLocatorShareUrl('', 'https://tracklab.test')).toBe('');
  });

  it('copies the canonical link through the device clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(copyTrackLocatorLink('apple-valley-bmx-moto-park', {
      origin: 'https://tracklab.test',
      clipboard: { writeText },
    })).resolves.toBe('https://tracklab.test/?locator=apple-valley-bmx-moto-park#track-locator');
    expect(writeText).toHaveBeenCalledWith(
      'https://tracklab.test/?locator=apple-valley-bmx-moto-park#track-locator',
    );
  });

  it('normalizes unique safe favorite IDs and uses idempotent account endpoints', async () => {
    expect(normalizeFavoriteTrackIds({
      trackIds: [' track-one ', 'track-one', 'track/two', false, 'track-two'],
    })).toEqual(['track-one', 'track-two']);
    const calls: Array<{ url: string; method: string }> = [];
    const api = createTrackFavoritesApi(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return jsonResponse(String(input) === '/api/track-favorites' ? { trackIds: ['track-one'] } : { favorite: true });
    }));
    await expect(api.list()).resolves.toEqual(['track-one']);
    await api.save('track-one');
    await api.remove('track-one');
    expect(calls).toEqual([
      { url: '/api/track-favorites', method: 'GET' },
      { url: '/api/track-favorites/track-one', method: 'PUT' },
      { url: '/api/track-favorites/track-one', method: 'DELETE' },
    ]);
  });

  it('surfaces bounded server failures and rejects invalid IDs before mutation', async () => {
    const api = createTrackFavoritesApi(vi.fn(async () => jsonResponse({ error: 'Sign in to continue.' }, 401)));
    await expect(api.list()).rejects.toMatchObject({ status: 401, message: 'Sign in to continue.' });
    await expect(api.save('track/private')).rejects.toMatchObject({ status: 400 });
  });
});
