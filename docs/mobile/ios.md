# TrackLab BMX for iPhone and iPad

TrackLab BMX uses Capacitor for its native iOS shell. The shell loads the live
TrackLab service so account, club, rider, race, sprint, and Explore the World
data remain shared with the web dashboard. Native Bluetooth support is added
inside the shell because iPhone and iPad browsers do not expose Web Bluetooth.

## App identity

- App name: `TrackLab BMX`
- Bundle identifier: `com.preskilabs.tracklabbmx`
- URL scheme: `tracklabbmx`
- Minimum iOS version: iOS 15
- Supported layouts: portrait and landscape on iPhone and iPad

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

## Native Wattbike pairing

The iOS shell installs a Web Bluetooth-compatible adapter over Capacitor's BLE
plugin before the React app starts. This lets the existing four-bike race entry
and metric parsing code run unchanged. A rider can choose a Wattbike from the
native device list, and TrackLab remembers up to four selected native device
identifiers on that device for reconnection on later launches. The chooser is
intentionally labeled as nearby Bluetooth devices because some Model B monitors
advertise only a PM serial rather than the Wattbike name. TrackLab validates the
selected device through the expected Wattbike metric services before using its
data. iOS may still show its Bluetooth permission prompt or require the monitor
to be awake.

## Release architecture decision

The current native shell intentionally loads the live HTTPS TrackLab service so
web, iOS, account, club, and training data stay on the same deployed version.
Before App Store submission, this remote-shell design needs an explicit security,
native-version compatibility, outage, and App Review decision. A future bundled
asset release would need a stable, explicit API origin before removing the live
server URL; changing it prematurely would break the app's relative API calls.

## App Store Connect checklist

The repository includes public App Store URL shells at `/privacy` and
`/support`. See [`app-store-public-pages.md`](./app-store-public-pages.md) for
the deployed URLs, implementation scope, and the required legal-review steps.

Do not submit the current native shell for public App Review until these product
and policy items are resolved:

- provide an in-app account-deletion workflow with defined club ownership,
  club-session retention/anonymization, and paid-subscription cancellation rules;
- replace or supplement Square-only digital membership checkout with an Apple
  StoreKit-compliant purchase path for every intended storefront;
- add reporting, blocking, objectionable-content filtering, and a moderation
  response workflow for room text and voice features, or omit those features
  from the submitted build;
- resolve the live remote-shell release architecture described above; and
- complete the physical one-to-four Wattbike acceptance matrix on iPhone and
  iPad hardware.

After those blockers are cleared:

1. Select the approved Preski Ranch LLC organization team in Xcode Signing & Capabilities.
2. Register `com.preskilabs.tracklabbmx` if Xcode does not create it automatically.
3. Create the TrackLab BMX app record in App Store Connect.
4. Add the support URL, privacy-policy URL, category, age rating, and screenshots.
5. Archive from Xcode and upload the build to TestFlight.
6. Test login, profile photos, one-to-four Wattbike pairing, all three ride
   modes, landscape fullscreen, and account data sync on physical iPhone and
   iPad hardware before external TestFlight review.

Never commit an Apple password, verification code, signing certificate, or
App Store Connect API key to this repository.
