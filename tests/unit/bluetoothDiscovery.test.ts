import { describe, expect, it } from 'vitest';
import {
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
});
