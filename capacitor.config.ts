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
  // Release builds intentionally load the audited `dist` bundle packaged in
  // the application. TrackLab cloud requests are routed explicitly by the
  // service transport; never restore a remote `server.url` here.
  plugins: {
    PushNotifications: {
      // Foreground remote alerts make one sound; TrackLab renders the visible,
      // account-fenced banner itself. Local Recovery cues use a separate
      // NotificationRouter handler and keep their existing presentation.
      presentationOptions: ['sound'],
    },
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
