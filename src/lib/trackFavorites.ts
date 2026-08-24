import { normalizeTrackLocatorId } from './mapLinks';

export type TrackFavoritesApi = {
  list: () => Promise<string[]>;
  save: (trackId: string) => Promise<void>;
  remove: (trackId: string) => Promise<void>;
};

export class TrackFavoritesApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TrackFavoritesApiError';
    this.status = status;
  }
}

async function favoriteFetch(fetcher: typeof fetch, path: string, options: RequestInit = {}) {
  const response = await fetcher(path, {
    ...options,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...options.headers },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error.trim().slice(0, 240) : '';
    throw new TrackFavoritesApiError(message || `TrackLab favorites returned ${response.status}.`, response.status);
  }
  return payload;
}

export function normalizeFavoriteTrackIds(value: unknown) {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return [...new Set((Array.isArray(envelope.trackIds) ? envelope.trackIds : [])
    .map(normalizeTrackLocatorId)
    .filter(Boolean))];
}

export function createTrackFavoritesApi(fetcher: typeof fetch = fetch): TrackFavoritesApi {
  return {
    async list() {
      return normalizeFavoriteTrackIds(await favoriteFetch(fetcher, '/api/track-favorites'));
    },
    async save(trackId) {
      const id = normalizeTrackLocatorId(trackId);
      if (!id) throw new TrackFavoritesApiError('Choose a valid BMX track.', 400);
      await favoriteFetch(fetcher, `/api/track-favorites/${encodeURIComponent(id)}`, { method: 'PUT' });
    },
    async remove(trackId) {
      const id = normalizeTrackLocatorId(trackId);
      if (!id) throw new TrackFavoritesApiError('Choose a valid BMX track.', 400);
      await favoriteFetch(fetcher, `/api/track-favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
