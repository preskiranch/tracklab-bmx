# TrackLab BMX for iPhone and iPad

TrackLab BMX uses Capacitor for its native iOS shell. Release builds load the
audited web bundle packaged inside the app; they are not a wrapper around the
hosted website. An explicit HTTPS service transport keeps account, club, rider,
race, sprint, and Explore the World data synchronized with the web dashboard.
Native Bluetooth support is added inside the shell because iPhone and iPad
browsers do not expose Web Bluetooth.

## App identity

- App name: `TrackLab BMX`
- Bundle identifier: `com.preskilranch.tracklabbmx`
- URL scheme: `tracklabbmx`
- Minimum iOS version: iOS 15
- Supported layouts: portrait and landscape on iPhone and iPad
- Push-capable native release baseline: version 1.1, build 12

## Local validation

Install dependencies and build the web and native projects:

```sh
npm ci
npm run ios:build
```

The unsigned build helper verifies and caches Capacitor's official iOS binary
frameworks before invoking Xcode. This avoids a SwiftPM/URLSession download
stall seen on some development Macs while preserving the upstream SHA-256
checksums. The cache lives under the system temporary directory and contains no
Apple credentials or signing material.

Open the project for signing or a physical-device test:

```sh
npm run ios:open
```

Bluetooth cannot be validated in the iOS Simulator. Use a physical iPhone or
iPad with a Wattbike monitor awake and showing Just Ride.

## Native notifications

Build 12 includes the Push Notifications capability and the native TrackLab
installation bridge. Notification permission is requested only after the rider
explicitly opts in from personal account settings. A shared Club Tablet session
must unregister any personal installation and cannot register for account
pushes. Talk live, friend request/connection, and explicit track-share pushes
contain only generic routing data; the app refetches the signed-in account's
authoritative Friends state and never accepts, joins, or enables the microphone
from a notification payload.

Development-signed builds use APNs sandbox tokens. TestFlight and App Store
builds use production tokens. Validate both on physical hardware; Simulator and
unsigned builds do not prove APNs delivery. Before TestFlight, follow the
server-secret, health, rotation, and rollback procedure in
[`../operations/apns-notifications.md`](../operations/apns-notifications.md).

## Native Wattbike pairing

The iOS shell installs a Web Bluetooth-compatible adapter over Capacitor's BLE
plugin before the React app starts. This lets the existing four-bike race entry
and metric parsing code run unchanged. A rider can choose a Wattbike from the
native device list, and TrackLab remembers up to four selected native device
identifiers on that device for reconnection on later launches. The iOS scan uses
the `Wattbike` name prefix so Model B names such as `WattbikePM…` remain visible
even when the advertisement omits service UUIDs. TrackLab then validates the
selected device through the expected Wattbike metric services before using its
data. iOS may still show its Bluetooth permission prompt or require the monitor
to be awake.

## Release architecture decision

The release architecture is bundled-native. `capacitor.config.ts` has no remote
`server.url`; `dist` is copied into the signed application. Only relative
`/api/` calls are routed to the fixed TrackLab HTTPS service. Packaged `/data/`
and audio assets and loopback Wattbike connector URLs remain local.

On iOS, the server returns a 256-bit opaque session only to the exact
`capacitor://localhost` origin. The app stores it in a non-synchronizing,
device-only Keychain item and sends it as an HTTPS Bearer credential. Browser
sessions retain the HttpOnly, SameSite cookie contract. WebSocket connections
use a scoped, one-use, short-lived ticket, because browser WebSocket APIs cannot
set Authorization. Friends, training history, and live heart-rate updates use
authenticated fetch streaming instead of placing credentials in EventSource
URLs. The bundled offline view is available even when the service cannot load.

The bundled shell obtains its public Google Maps JavaScript client key from
`GET /api/native/runtime-config` after the cloud health check and keeps it only
in web-view memory. The production key must authorize
`capacitor://localhost/*`; the deployment smoke verifies the endpoint is
configured, but a signed iPhone and iPad map check remains required because
WebView referrer behavior cannot be proven by the server test.

## App Store Connect checklist

The repository includes public App Store URL shells at `/privacy` and
`/support`. See [`app-store-public-pages.md`](./app-store-public-pages.md) for
the deployed URLs, implementation scope, and the required legal-review steps.

Do not submit for public App Review until these release items are resolved:

- finish App Store Connect metadata and sandbox acceptance for the implemented
  StoreKit Wattbike-connection subscriptions;
- complete the physical one-to-four Wattbike acceptance matrix on iPhone and
  iPad hardware.

Room text now has server-side pre-persistence filtering, and rider reporting,
blocking, voice mute/end controls, and an authenticated administrator review
queue are implemented. Run the complete
[`community-safety.md`](../operations/community-safety.md) verification and
confirm the 24-hour moderation process before every App Store submission.

After those blockers are cleared:

1. Select the approved Preski Ranch LLC organization team in Xcode Signing & Capabilities.
2. Use the existing App Store Connect identifier `com.preskilranch.tracklabbmx`.
3. Create the TrackLab BMX app record in App Store Connect.
4. Add the support URL, privacy-policy URL, category, age rating, and screenshots.
5. Archive from Xcode and upload the build to TestFlight.
6. Explicitly opt in to notifications, background and terminate the app, send
   each eligible social alert, and confirm a tap only opens/refetches Friends
   for the same authenticated account. Confirm denied permission and logout do
   not leave an active installation.
7. Test login, profile photos, one-to-four Wattbike pairing, all three ride
   modes, landscape fullscreen, and account data sync on physical iPhone and
   iPad hardware before external TestFlight review.

Never commit an Apple password, verification code, signing certificate, or
App Store Connect API key to this repository.
