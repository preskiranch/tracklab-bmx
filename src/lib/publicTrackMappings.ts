import type { StoredTrackMappings } from './trackMapping';

type PublicTrackMappingsPayload = {
  trackMappings?: StoredTrackMappings;
};

function normalizePublicTrackMappings(value: PublicTrackMappingsPayload | null | undefined): StoredTrackMappings {
  return value?.trackMappings && typeof value.trackMappings === 'object' ? value.trackMappings : {};
}

export async function readPublicTrackMappings(): Promise<StoredTrackMappings> {
  const response = await fetch('/api/public-track-mappings', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Public track maps returned ${response.status}`);
  }

  return normalizePublicTrackMappings(await response.json() as PublicTrackMappingsPayload);
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
