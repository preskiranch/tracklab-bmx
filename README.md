# TrackLab BMX

A professional Wattbike-powered BMX training and racing platform prototype. The app keeps the local ANT+/simulator bridge from the original build, then adds a SaaS-style dashboard for real-track racing, interval training, live monitoring, multiplayer rooms, post-race analytics, and per-track leaderboards.

## Run The App

```sh
npm install --cache ./.npm-cache
npm run dev
```

Open the Vite URL printed by the terminal, usually:

```text
http://127.0.0.1:5174
```

The local bridge listens on:

```text
ws://127.0.0.1:8787
```

## ANT+ Mode

After the ANT+ USB dongle is plugged in:

```sh
npm run bridge:ant
```

Then run the web app in another terminal:

```sh
npm run web
```

The bridge scans for ANT+ Bicycle Power devices. Pedal each Wattbike for a few seconds so its monitor wakes and broadcasts. Detected device IDs appear in Bike Pairing and are auto-assigned to Player 1-4. The UI only creates riders from live connected bikes, capped at four.

## Current Platform Features

- **Track database pipeline**: country, state/region, and track selectors backed by `src/data/trackCatalog.ts`, plus generated public database output at `public/data/track-database.json`.
- **Google satellite / Earth viewer**: real Google Maps satellite imagery when `VITE_GOOGLE_MAPS_API_KEY` is configured; otherwise the app shows a clear configuration state and a Google Earth link.
- **Sprint mode**: full-track race distance based on the selected track length.
- **Interval mode**: auto-selected pedaling zones or manually chosen track zones.
- **Metric selection**: choose cadence, speed, and/or power before the race; post-race tables follow that choice.
- **Monitor mode**: large-format Wattbike readouts for watts, RPM, speed, signal, source, and last update.
- **Local/multiplayer shell**: local or multiplayer mode, account-optional toggle, private room code, roster, track sync label, and chat.
- **Leaderboards**: seeded best RPM, top speed, and watts by track.

## Google Maps / Earth Integration

The old Google Earth browser plugin is not a viable production target. The app now uses the supported Google Maps JavaScript API path for satellite imagery and overlays the track GPS outline, zone strokes, and rider markers on top of Google imagery.

Create a local `.env` from `.env.example`:

```sh
cp .env.example .env
```

Then set:

```text
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

Without that key, the app intentionally does not show fake satellite imagery.

## Track Data Status

The included catalog is a starter seed, not a licensed authoritative global BMX database. The database build pipeline is:

```sh
npm run tracks:build
```

That command writes:

```text
public/data/track-database.json
```

Approved USA BMX, UCI, British Cycling, AusCycling, Cycling Canada, or other organizer exports can be added under `data/imports/` and merged into the generated database. Do not use Google imagery screenshots as data input.

## Render Deployment

`render.yaml` is included for a Render Static Site deployment.

Required Render environment variables:

```text
VITE_GOOGLE_MAPS_API_KEY
VITE_WATTBIKE_BRIDGE_URL
```

Render can host the web platform and show Google imagery. It cannot directly read a USB ANT+ dongle on your local PC. For real bikes, the PC still needs to run the local bridge, and the hosted app needs a reachable WebSocket bridge URL. Local development defaults to:

```text
VITE_WATTBIKE_BRIDGE_URL=ws://127.0.0.1:8787
```

## Design Assets

- `docs/design/saas-platform-concept.png`: product direction concept.
- Existing BMX sprite assets remain in `public/assets/` for future richer rider rendering.

## Validation

The current build passes:

```sh
npm run build
```

Browser QA was run against the local simulator bridge with four virtual Wattbikes connected. Verified: dashboard render, four rider markers, race start, interval/manual zones, MPH toggle, track selection, chat, monitor mode, and clean console output.

## Hardware Notes

`ant-plus-next` uses the WinUSB/libusb path. On Windows, many ANT+ sticks need the WinUSB driver installed with Zadig before Node can open the dongle. If the bridge reports that the ANT+ USB stick cannot be opened, install WinUSB for the ANT stick and close Garmin Express or any fitness app that may already be using it.
