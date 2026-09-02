import type { PlayerSlot, StudioRider, StudioRiderAssignments } from '../types';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';
import { normalizePersonalRecords } from './personalRecords';

export const studioRiderNameMaxLength = 64;
export const studioRiderRosterMaxSize = 250;

export function normalizeStudioRiderName(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, studioRiderNameMaxLength)
    : '';
}

function normalizeTimestamp(value: unknown, fallback: number) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

export function normalizeStudioRider(value: unknown, fallbackNow = Date.now()): StudioRider | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<StudioRider>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 100) : '';
  const name = normalizeStudioRiderName(candidate.name);
  if (!id || !name) {
    return null;
  }

  const createdAt = normalizeTimestamp(candidate.createdAt, fallbackNow);
  const updatedAt = Math.max(createdAt, normalizeTimestamp(candidate.updatedAt, createdAt));
  const deletedAt = candidate.deletedAt == null
    ? undefined
    : Math.max(updatedAt, normalizeTimestamp(candidate.deletedAt, updatedAt));
  const photoUrl = normalizeRiderPhotoDataUrl(candidate.photoUrl);
  const personalRecords = normalizePersonalRecords(candidate.personalRecords);

  return {
    id,
    name,
    ...(photoUrl ? { photoUrl } : {}),
    ...(personalRecords ? { personalRecords } : {}),
    createdAt,
    updatedAt: deletedAt ?? updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
  };
}

export function mergeStudioRiders(...collections: unknown[]): StudioRider[] {
  const byId = new Map<string, StudioRider>();
  collections.forEach((collection) => {
    if (!Array.isArray(collection)) {
      return;
    }

    collection.forEach((value) => {
      const rider = normalizeStudioRider(value);
      if (!rider) {
        return;
      }

      const current = byId.get(rider.id);
      if (!current || rider.updatedAt >= current.updatedAt) {
        byId.set(rider.id, rider);
      }
    });
  });

  return [...byId.values()]
    .sort((left, right) => {
      if (Boolean(left.deletedAt) !== Boolean(right.deletedAt)) {
        return left.deletedAt ? 1 : -1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        || left.createdAt - right.createdAt;
    })
    .slice(0, studioRiderRosterMaxSize);
}

export function activeStudioRiders(riders: StudioRider[]) {
  return riders.filter((rider) => !rider.deletedAt);
}

export function createStudioRider(
  name: string,
  options: { id?: string; now?: number } = {},
): StudioRider | null {
  const normalizedName = normalizeStudioRiderName(name);
  if (!normalizedName) {
    return null;
  }

  const now = options.now ?? Date.now();
  const generatedId = globalThis.crypto?.randomUUID?.()
    ?? `rider-${now}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: options.id ?? generatedId,
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
  };
}

export function renameStudioRider(rider: StudioRider, name: string, now = Date.now()) {
  const normalizedName = normalizeStudioRiderName(name);
  if (!normalizedName || rider.deletedAt) {
    return rider;
  }

  return {
    ...rider,
    name: normalizedName,
    updatedAt: now,
  };
}

export function updateStudioRiderPhoto(
  rider: StudioRider,
  photoUrl: string | undefined,
  now = Date.now(),
) {
  if (rider.deletedAt) {
    return rider;
  }

  const normalizedPhotoUrl = normalizeRiderPhotoDataUrl(photoUrl);
  const next = {
    ...rider,
    updatedAt: now,
  };
  if (normalizedPhotoUrl) {
    return { ...next, photoUrl: normalizedPhotoUrl };
  }

  delete next.photoUrl;
  return next;
}

export function removeStudioRider(rider: StudioRider, now = Date.now()): StudioRider {
  return {
    ...rider,
    updatedAt: now,
    deletedAt: now,
  };
}

export function assignStudioRider(
  assignments: StudioRiderAssignments,
  deviceId: number,
  riderId: string | null,
): StudioRiderAssignments {
  const next = { ...assignments };
  delete next[deviceId];

  if (!riderId) {
    return next;
  }

  Object.entries(next).forEach(([assignedDeviceId, assignedRiderId]) => {
    if (assignedRiderId === riderId) {
      delete next[Number(assignedDeviceId)];
    }
  });
  next[deviceId] = riderId;
  return next;
}

export function applyStudioRiderAssignments(
  players: PlayerSlot[],
  riders: StudioRider[],
  assignments: StudioRiderAssignments,
) {
  const riderById = new Map(activeStudioRiders(riders).map((rider) => [rider.id, rider]));
  return players.map((player) => {
    if (player.deviceId == null) {
      return player;
    }

    const rider = riderById.get(assignments[player.deviceId]);
    if (!rider) {
      return player;
    }

    return {
      ...player,
      name: rider.name,
      riderId: rider.id,
      bikeName: player.name,
      ...(rider.photoUrl ? { photoUrl: rider.photoUrl } : {}),
    };
  });
}
