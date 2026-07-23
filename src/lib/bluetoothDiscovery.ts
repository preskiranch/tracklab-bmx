export type BluetoothDeviceFilter = {
  name?: string;
  namePrefix?: string;
  services?: string[];
};

export type BluetoothRequestDeviceOptions = {
  acceptAllDevices?: boolean;
  filters?: BluetoothDeviceFilter[];
  optionalServices: string[];
};

export const wattbikeBluetoothServices = {
  battery: '0000180f-0000-1000-8000-00805f9b34fb',
  cyclingPower: '00001818-0000-1000-8000-00805f9b34fb',
  cyclingSpeedCadence: '00001816-0000-1000-8000-00805f9b34fb',
  fitnessMachine: '00001826-0000-1000-8000-00805f9b34fb',
  wattbike: 'f7461223-d7c1-11e4-9ab1-0002a5d5c51b',
} as const;

export const wattbikeBluetoothFilters: BluetoothDeviceFilter[] = [
  { namePrefix: 'Wattbike' },
  { namePrefix: 'WattbikePM' },
  { services: [wattbikeBluetoothServices.cyclingPower] },
  { services: [wattbikeBluetoothServices.cyclingSpeedCadence] },
  { services: [wattbikeBluetoothServices.fitnessMachine] },
];

export function isWindowsBluetoothPlatform(userAgent: string) {
  return /\bWindows\b/i.test(userAgent);
}

export function wattbikeBluetoothRequestOptions(userAgent: string): BluetoothRequestDeviceOptions {
  const optionalServices = Object.values(wattbikeBluetoothServices);
  if (isWindowsBluetoothPlatform(userAgent)) {
    // Some Wattbike Model B monitors are visible to Windows but omit their
    // local name or standard services from the advertisement packet. Let the
    // Windows chooser display nearby BLE devices, then validate the selected
    // device by discovering its supported Wattbike metric services.
    return {
      acceptAllDevices: true,
      optionalServices,
    };
  }

  // Preserve the narrower, proven chooser on macOS and other platforms.
  return {
    filters: wattbikeBluetoothFilters,
    optionalServices,
  };
}
