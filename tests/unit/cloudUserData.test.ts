import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCloudUserData, patchCloudUserData, readCloudUserData } from '../../src/lib/cloudUserData';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud user data unit preferences', () => {
  it('keeps small preference saves alive on navigation without exceeding the upload budget for photos', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    await patchCloudUserData('user:units', { unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 123 } });
    await patchCloudUserData('user:units', { accountProfile: { photoUrl: 'x'.repeat(65_536), updatedAt: 123 } });
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    expect(fetchMock.mock.calls[1][1].keepalive).toBe(false);
  });
  it('normalizes unit preferences returned by the cloud and rejects malformed snapshots', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 123.6, ignored: true },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        unitPreferences: { speedUnit: 'mph', distanceUnit: 'yards', updatedAt: 200 },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(readCloudUserData('user:units')).resolves.toMatchObject({
      unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 124 },
    });
    await expect(readCloudUserData('user:units')).resolves.toMatchObject({ unitPreferences: null });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user-data?profileKey=user%3Aunits',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('creates empty cloud state with no inherited unit preference', () => {
    expect(createEmptyCloudUserData().unitPreferences).toBeNull();
  });
});
