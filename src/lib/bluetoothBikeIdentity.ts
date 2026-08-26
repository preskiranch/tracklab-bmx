const fallbackDeviceIdStart = 700_001;
const fallbackDeviceIdEnd = 899_999;
export const bluetoothBikePreferencesStorageKey = 'tracklab.bluetooth-bike-preferences.v1';

function validDeviceId(value: unknown) {
  const deviceId = Number(value);
  return Number.isSafeInteger(deviceId) && deviceId > 0 ? deviceId : null;
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function wattbikeMonitorIdFromName(name: string | undefined) {
  const digits = name?.match(/(\d{4,})/g)?.at(-1);
  if (!digits) {
    return null;
  }

  const monitorDigits = digits.length > 5 ? digits.slice(-5) : digits;
  return validDeviceId(monitorDigits);
}

export function assignBluetoothBikeDeviceId(
  browserDeviceId: string,
  advertisedName: string | undefined,
  assignments: Map<string, number>,
) {
  const existing = validDeviceId(assignments.get(browserDeviceId));
  if (existing != null) {
    return existing;
  }

  const assignedIds = new Set(assignments.values());
  const monitorId = wattbikeMonitorIdFromName(advertisedName);
  if (monitorId != null && !assignedIds.has(monitorId)) {
    assignments.set(browserDeviceId, monitorId);
    return monitorId;
  }

  const fallbackCount = fallbackDeviceIdEnd - fallbackDeviceIdStart + 1;
  let fallbackId = fallbackDeviceIdStart + (stableHash(browserDeviceId) % fallbackCount);
  const firstFallbackId = fallbackId;

  while (assignedIds.has(fallbackId)) {
    fallbackId = fallbackId === fallbackDeviceIdEnd ? fallbackDeviceIdStart : fallbackId + 1;
    if (fallbackId === firstFallbackId) {
      throw new Error('No unique Bluetooth bike IDs are available.');
    }
  }

  assignments.set(browserDeviceId, fallbackId);
  return fallbackId;
}

export function parseBluetoothBikeIdentityAssignments(serialized: string | null) {
  const assignments = new Map<string, number>();
  if (!serialized) {
    return assignments;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return assignments;
    }

    const assignedIds = new Set<number>();
    Object.entries(parsed).forEach(([browserDeviceId, rawDeviceId]) => {
      const deviceId = validDeviceId(rawDeviceId);
      if (!browserDeviceId || deviceId == null || assignedIds.has(deviceId)) {
        return;
      }

      assignments.set(browserDeviceId, deviceId);
      assignedIds.add(deviceId);
    });
  } catch {
    return assignments;
  }

  return assignments;
}

export function serializeBluetoothBikeIdentityAssignments(assignments: Map<string, number>) {
  return JSON.stringify(Object.fromEntries(assignments));
}

export function parseBluetoothBikePreferences(serialized: string | null) {
  const preferences = new Map<string, string>();
  if (!serialized) return preferences;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return preferences;
    Object.entries(value).slice(-32).forEach(([scope, browserDeviceId]) => {
      const safeScope = scope.trim().slice(0, 160);
      const safeDeviceId = typeof browserDeviceId === 'string'
        ? browserDeviceId.trim().slice(0, 240)
        : '';
      if (safeScope && safeDeviceId) preferences.set(safeScope, safeDeviceId);
    });
  } catch {
    return preferences;
  }
  return preferences;
}

export function serializeBluetoothBikePreferences(preferences: Map<string, string>) {
  return JSON.stringify(Object.fromEntries([...preferences.entries()].slice(-32)));
}

export function prioritizePreferredBluetoothDevice<T extends { id: string }>(
  devices: readonly T[],
  preferredBrowserDeviceId: string | null | undefined,
) {
  if (!preferredBrowserDeviceId) return [...devices];
  return [...devices].sort((left, right) => (
    Number(right.id === preferredBrowserDeviceId) - Number(left.id === preferredBrowserDeviceId)
  ));
}
