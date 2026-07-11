import { describe, expect, it } from 'vitest';
import {
  assignBluetoothBikeDeviceId,
  parseBluetoothBikeIdentityAssignments,
  serializeBluetoothBikeIdentityAssignments,
  wattbikeMonitorIdFromName,
} from '../../src/lib/bluetoothBikeIdentity';

describe('Bluetooth bike identity', () => {
  it('uses the Wattbike monitor number from the advertised name', () => {
    expect(wattbikeMonitorIdFromName('WattbikePM25058701')).toBe(58701);
  });

  it('keeps physical browser devices separate when advertised monitor IDs collide', () => {
    const assignments = new Map<string, number>();
    const firstId = assignBluetoothBikeDeviceId('browser-bike-a', 'WattbikePM25058701', assignments);
    const secondId = assignBluetoothBikeDeviceId('browser-bike-b', 'WattbikePM25058701', assignments);

    expect(firstId).toBe(58701);
    expect(secondId).not.toBe(firstId);
    expect(assignBluetoothBikeDeviceId('browser-bike-b', 'WattbikePM25058701', assignments)).toBe(secondId);
  });

  it('persists stable unique assignments across browser refreshes', () => {
    const assignments = new Map<string, number>();
    assignBluetoothBikeDeviceId('browser-bike-a', 'WattbikePM25058701', assignments);
    const secondId = assignBluetoothBikeDeviceId('browser-bike-b', 'WattbikePM25058701', assignments);

    const restored = parseBluetoothBikeIdentityAssignments(
      serializeBluetoothBikeIdentityAssignments(assignments),
    );

    expect(restored.get('browser-bike-a')).toBe(58701);
    expect(restored.get('browser-bike-b')).toBe(secondId);
  });
});
