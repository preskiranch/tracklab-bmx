import type { BikeProfile, RaceViewPreferences, StudioRider, TrackRecord, UserTrackMapping } from '../types';
import { normalizeRaceViewPreferences } from './raceViewPreferences';
import type { StoredTrackMappings } from './trackMapping';
import { createPatchBatcher } from './patchBatcher';

export type CloudUserData = {
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
  bikeProfiles: BikeProfile[];
  studioRiders: StudioRider[];
  raceViewPreferences: RaceViewPreferences | null;
};

export type CloudUserDataPatch = Partial<CloudUserData>;

export type CloudTrackMappingSaveResult = {
  mapping: UserTrackMapping;
  published: boolean;
  publicMapping: UserTrackMapping | null;
};

const emptyCloudUserData: CloudUserData = {
  trackMappings: {},
  customRoutes: [],
  bikeProfiles: [],
  studioRiders: [],
  raceViewPreferences: null,
};

function userDataUrl(profileKey: string) {
  const params = new URLSearchParams({ profileKey });
  return `/api/user-data?${params.toString()}`;
}

function normalizeCloudUserData(value: Partial<CloudUserData> | null | undefined): CloudUserData {
  return {
    trackMappings: value?.trackMappings && typeof value.trackMappings === 'object' ? value.trackMappings : {},
    customRoutes: Array.isArray(value?.customRoutes) ? value.customRoutes : [],
    bikeProfiles: Array.isArray(value?.bikeProfiles) ? value.bikeProfiles : [],
    studioRiders: Array.isArray(value?.studioRiders) ? value.studioRiders : [],
    raceViewPreferences: value?.raceViewPreferences && typeof value.raceViewPreferences === 'object'
      ? normalizeRaceViewPreferences(value.raceViewPreferences)
      : null,
  };
}

export async function readCloudUserData(profileKey: string): Promise<CloudUserData> {
  const response = await fetch(userDataUrl(profileKey), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Cloud user data returned ${response.status}`);
  }

  const payload = await response.json() as Partial<CloudUserData>;
  return normalizeCloudUserData(payload);
}

export async function patchCloudUserData(profileKey: string, patch: CloudUserDataPatch): Promise<CloudUserData> {
  const response = await fetch(userDataUrl(profileKey), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Cloud user data save returned ${response.status}`);
  }

  const payload = await response.json() as Partial<CloudUserData>;
  return normalizeCloudUserData(payload);
}

export async function saveCloudTrackMapping(mapping: UserTrackMapping): Promise<CloudTrackMappingSaveResult> {
  const response = await fetch('/api/user-data/track-mapping', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mapping }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Track map save returned ${response.status}`);
  }

  const payload = await response.json() as Partial<CloudTrackMappingSaveResult>;
  if (!payload.mapping?.trackId) {
    throw new Error('Track map save returned an invalid response.');
  }

  return {
    mapping: payload.mapping,
    published: Boolean(payload.published),
    publicMapping: payload.publicMapping?.trackId ? payload.publicMapping : null,
  };
}

const cloudPatchBatchers = new Map<string, ReturnType<typeof createPatchBatcher<CloudUserDataPatch, CloudUserData>>>();

export function queueCloudUserDataPatch(profileKey: string, patch: CloudUserDataPatch) {
  let batcher = cloudPatchBatchers.get(profileKey);
  if (!batcher) {
    batcher = createPatchBatcher((nextPatch) => patchCloudUserData(profileKey, nextPatch));
    cloudPatchBatchers.set(profileKey, batcher);
  }
  const queued = batcher.enqueue(patch);
  const releaseIdleBatcher = () => {
    if (!batcher?.hasPending() && cloudPatchBatchers.get(profileKey) === batcher) {
      cloudPatchBatchers.delete(profileKey);
    }
  };
  void queued.then(releaseIdleBatcher, releaseIdleBatcher);
  return queued;
}

export function flushCloudUserDataPatches(profileKey?: string) {
  const batchers = profileKey
    ? [cloudPatchBatchers.get(profileKey)].filter(Boolean)
    : [...cloudPatchBatchers.values()];
  return Promise.allSettled(batchers.map((batcher) => batcher!.flush()));
}

export function createEmptyCloudUserData(): CloudUserData {
  return {
    trackMappings: emptyCloudUserData.trackMappings,
    customRoutes: emptyCloudUserData.customRoutes,
    bikeProfiles: emptyCloudUserData.bikeProfiles,
    studioRiders: emptyCloudUserData.studioRiders,
    raceViewPreferences: emptyCloudUserData.raceViewPreferences,
  };
}
