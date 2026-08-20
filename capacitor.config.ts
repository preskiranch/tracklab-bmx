import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.preskilranch.tracklabbmx',
  appName: 'TrackLab BMX',
  webDir: 'dist',
  backgroundColor: '#05080c',
  appendUserAgent: ' TrackLabBMX-iOS',
  ios: {
    allowsLinkPreview: false,
    backgroundColor: '#05080c',
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scrollEnabled: true,
  },
  server: {
    cleartext: false,
    url: 'https://tracklab-bmx.onrender.com',
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        availableDevices: 'Nearby Bluetooth devices',
        cancel: 'Cancel',
        noDeviceFound: 'No compatible device found. Wake the Wattbike monitor and open Just Ride.',
        scanning: 'Looking for nearby Bluetooth devices…',
      },
    },
  },
};

export default config;
