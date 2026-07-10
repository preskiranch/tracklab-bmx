import type { BikeProfile, TrackRecord } from '../types';
import type { StoredTrackMappings } from './trackMapping';
import { createPatchBatcher } from './patchBatcher';

export type CloudUserData = {
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
  bikeProfiles: BikeProfile[];
};

export type CloudUserDataPatch = Partial<CloudUserData>;

const emptyCloudUserData: CloudUserData = {
  trackMappings: {},
  customRoutes: [],
  bikeProfiles: [],
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
  };
}

export async function readCloudUserData(profileKey: string): Promise<CloudUserData> {
  const response = await fetch(userDataUrl(profileKey), {
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

export function createEmptyCloudUserData(): CloudUserData {
  return {
    trackMappings: emptyCloudUserData.trackMappings,
    customRoutes: emptyCloudUserData.customRoutes,
    bikeProfiles: emptyCloudUserData.bikeProfiles,
  };
}
