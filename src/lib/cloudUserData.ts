import type { AccountProfile, BikeProfile, RaceViewPreferences, StudioRider, TrackRecord, UnitPreferences, UserTrackMapping } from '../types';
import { normalizeRaceViewPreferences } from './raceViewPreferences';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';
import { normalizeUnitPreferences } from './unitPreferences';
import { normalizePersonalRecords } from './personalRecords';
import type { StoredTrackMappings } from './trackMapping';
import { createPatchBatcher } from './patchBatcher';

export type CloudUserData = {
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
  bikeProfiles: BikeProfile[];
  studioRiders: StudioRider[];
  accountProfile: AccountProfile;
  raceViewPreferences: RaceViewPreferences | null;
  unitPreferences: UnitPreferences | null;
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
  accountProfile: { updatedAt: 0 },
  raceViewPreferences: null,
  unitPreferences: null,
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
    accountProfile: value?.accountProfile && typeof value.accountProfile === 'object'
      ? {
        ...(normalizeRiderPhotoDataUrl(value.accountProfile.photoUrl)
          ? { photoUrl: normalizeRiderPhotoDataUrl(value.accountProfile.photoUrl) }
          : {}),
        ...(normalizePersonalRecords(value.accountProfile.personalRecords)
          ? { personalRecords: normalizePersonalRecords(value.accountProfile.personalRecords) }
          : {}),
        updatedAt: Math.max(0, Number(value.accountProfile.updatedAt) || 0),
      }
      : { updatedAt: 0 },
    raceViewPreferences: value?.raceViewPreferences && typeof value.raceViewPreferences === 'object'
      ? normalizeRaceViewPreferences(value.raceViewPreferences)
      : null,
    unitPreferences: normalizeUnitPreferences(value?.unitPreferences),
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
  const body = JSON.stringify(patch);
  const response = await fetch(userDataUrl(profileKey), {
    method: 'PATCH',
    // Small preference saves may be flushed as the page closes. Photos/maps
    // can exceed the browser's keepalive budget, so they use normal requests.
    keepalive: new TextEncoder().encode(body).byteLength <= 60_000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Cloud user data save returned ${response.status}`);
  }

  const payload = await response.json() as Partial<CloudUserData>;
  return normalizeCloudUserData(payload);
}

export async function saveCloudTrackMapping(
  mapping: UserTrackMapping,
  track?: TrackRecord | null,
): Promise<CloudTrackMappingSaveResult> {
  const response = await fetch('/api/user-data/track-mapping', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mapping, track }),
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
    accountProfile: emptyCloudUserData.accountProfile,
    raceViewPreferences: emptyCloudUserData.raceViewPreferences,
    unitPreferences: emptyCloudUserData.unitPreferences,
  };
}
