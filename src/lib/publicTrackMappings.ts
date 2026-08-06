import type { TrackRecord } from '../types';
import type { StoredTrackMappings } from './trackMapping';

type PublicTrackMappingsPayload = {
  trackMappings?: StoredTrackMappings;
  customRoutes?: TrackRecord[];
};

function normalizePublicTrackMappings(value: PublicTrackMappingsPayload | null | undefined): StoredTrackMappings {
  return value?.trackMappings && typeof value.trackMappings === 'object' ? value.trackMappings : {};
}

export async function readPublicTrackCatalog(): Promise<{
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
}> {
  const response = await fetch('/api/public-track-mappings', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Public track maps returned ${response.status}`);
  }

  const payload = await response.json() as PublicTrackMappingsPayload;
  return {
    trackMappings: normalizePublicTrackMappings(payload),
    customRoutes: Array.isArray(payload.customRoutes) ? payload.customRoutes : [],
  };
}

export async function publishPublicTrackMappings(
  trackMappings: StoredTrackMappings,
  profileKey?: string | null,
): Promise<StoredTrackMappings> {
  const response = await fetch('/api/public-track-mappings', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trackMappings, profileKey }),
  });

  if (!response.ok) {
    throw new Error(`Public track map publish returned ${response.status}`);
  }

  return normalizePublicTrackMappings(await response.json() as PublicTrackMappingsPayload);
}
