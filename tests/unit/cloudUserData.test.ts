import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCloudUserData, readCloudUserData } from '../../src/lib/cloudUserData';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud user data unit preferences', () => {
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
