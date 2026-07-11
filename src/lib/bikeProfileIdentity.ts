import type { BikeProfile, PlayerSlot } from '../types';

type NamedBike = Pick<PlayerSlot, 'deviceId' | 'name'>;

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function defaultBikeName(deviceId: number) {
  return `Bike ${deviceId}`;
}

export function reconcileClonedBikeProfileNames(
  profiles: BikeProfile[],
  connectedDeviceIds: number[],
) {
  const connectedIds = new Set(connectedDeviceIds);
  const groups = new Map<string, BikeProfile[]>();

  profiles.forEach((profile) => {
    if (!connectedIds.has(profile.deviceId)) {
      return;
    }

    const key = normalizedName(profile.name);
    const group = groups.get(key) ?? [];
    group.push(profile);
    groups.set(key, group);
  });

  const repairedNames = new Map<number, { name: string; updatedAt: number }>();
  groups.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const owners = group.filter((profile) => normalizedName(profile.name).includes(String(profile.deviceId)));
    if (owners.length !== 1) {
      return;
    }

    const owner = owners[0];
    const nextUpdatedAt = Math.max(...group.map((profile) => profile.updatedAt), Date.now()) + 1;
    group.forEach((profile) => {
      if (profile.deviceId !== owner.deviceId) {
        repairedNames.set(profile.deviceId, {
          name: defaultBikeName(profile.deviceId),
          updatedAt: nextUpdatedAt,
        });
      }
    });
  });

  if (repairedNames.size === 0) {
    return profiles;
  }

  return profiles.map((profile) => {
    const repair = repairedNames.get(profile.deviceId);
    return repair ? { ...profile, ...repair } : profile;
  });
}

export function distinctBikeDisplayName(bike: NamedBike, connectedBikes: NamedBike[]) {
  const duplicateCount = connectedBikes.filter(
    (candidate) => normalizedName(candidate.name) === normalizedName(bike.name),
  ).length;

  return duplicateCount > 1 && bike.deviceId != null
    ? `${bike.deviceId} · ${bike.name}`
    : bike.name;
}
