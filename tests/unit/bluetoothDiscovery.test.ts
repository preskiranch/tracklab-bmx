import { describe, expect, it } from 'vitest';
import {
  isLikelyWattbikeBluetoothName,
  shouldReconnectWattbikeBluetoothDevice,
  wattbikeBluetoothFilters,
  wattbikeBluetoothRequestOptions,
  wattbikeBluetoothServices,
} from '../../src/lib/bluetoothDiscovery';

describe('Bluetooth device discovery', () => {
  it('widens the Windows chooser when Wattbike advertisement fields are missing', () => {
    expect(wattbikeBluetoothRequestOptions(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0',
    )).toEqual({
      acceptAllDevices: true,
      optionalServices: Object.values(wattbikeBluetoothServices),
    });
  });

  it('preserves the proven filtered chooser on macOS', () => {
    expect(wattbikeBluetoothRequestOptions(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0',
    )).toEqual({
      filters: wattbikeBluetoothFilters,
      optionalServices: Object.values(wattbikeBluetoothServices),
    });
  });

  it('recognizes Wattbike PM-only monitor names after a browser refresh', () => {
    expect(isLikelyWattbikeBluetoothName('PM25043950')).toBe(true);
    expect(isLikelyWattbikeBluetoothName('PM-25043851')).toBe(true);
    expect(isLikelyWattbikeBluetoothName('Nearby headphones')).toBe(false);
  });

  it('restores a previously connected browser device even if its advertised name changes', () => {
    expect(shouldReconnectWattbikeBluetoothDevice(
      'saved-browser-bike-id',
      'PM Monitor',
      new Set(['saved-browser-bike-id']),
    )).toBe(true);
    expect(shouldReconnectWattbikeBluetoothDevice(
      'unknown-browser-device',
      'PM Monitor',
      new Set(['saved-browser-bike-id']),
    )).toBe(false);
  });
});
