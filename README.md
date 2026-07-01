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

## Wattbike Monitor Control

The race UI now sends three monitor-control commands to the local bridge:

- `race-arm` when Start is pressed and the countdown/cadence begins.
- `race-start` at the exact green-light/gate-drop moment.
- `race-reset` when Reset is pressed.

By default the bridge runs in safe log mode, so it records those commands but does not send unknown bytes to the monitors. Reverse-engineering notes from the official installers are in `docs/reverse-engineering/wattbike-expert-findings.md`.

For USB HID control after the Model B reports are captured:

```sh
npm install node-hid
WATTBIKE_CONTROL=usb-hid \
WATTBIKE_HID_PRODUCT_MATCH=Wattbike \
WATTBIKE_RACE_ARM_HEX=... \
WATTBIKE_RACE_START_HEX=... \
WATTBIKE_RACE_RESET_HEX=... \
npm run bridge
```

For USB serial/FTDI control, which matches the Wattbike Expert Model B code path found in the official binaries:

```sh
WATTBIKE_CONTROL=serial \
WATTBIKE_SERIAL_PORTS=COM3,COM4,COM5,COM6 \
WATTBIKE_SERIAL_BAUD=... \
WATTBIKE_RACE_ARM_HEX=... \
WATTBIKE_RACE_START_HEX=... \
WATTBIKE_RACE_RESET_HEX=... \
npm run bridge
```

Each `*_HEX` value is the output command captured from Wattbike Expert or Wattbike Power Cycling software. Multiple command frames can be separated with semicolons. The older `WATTBIKE_USB_RACE_*_HEX` variable names still work as aliases. If needed, narrow HID matching with `WATTBIKE_HID_VENDOR_ID` and `WATTBIKE_HID_PRODUCT_ID`, or serial matching with `WATTBIKE_SERIAL_VENDOR_ID`, `WATTBIKE_SERIAL_PRODUCT_ID`, and `WATTBIKE_SERIAL_PRODUCT_MATCH`.

Capture workflow:

1. Install the official Wattbike desktop software on the PC that already controls the bikes.
2. Install Wireshark with USBPcap on Windows.
3. Start a USB capture for the USB hub containing the four Wattbike monitors.
4. In the official software, run one short race/session start and reset.
5. Filter the capture to the Wattbike monitor interface. On Model B, check FTDI/serial COM traffic first; for newer monitors, check HID interrupt/control transfers.
6. Extract the output command frames sent at arm/countdown, gate drop/start, and reset.
7. Put those reports into the environment variables above and test with one bike first.

This keeps the implementation focused on interoperability with your own hardware. It does not require decompiling Wattbike software or bypassing licensing.

## Wattbike BLE Inspector

The BLE inspector is a local bridge utility for researching what a Wattbike Model B exposes over Bluetooth. It scans BLE advertisements, connects to one monitor, lists all GATT services and characteristics, safely reads readable characteristics, subscribes to notifications/indications, and writes a JSONL capture file under `captures/`.

Install dependencies first:

```sh
npm install
```

Scan for nearby BLE devices:

```sh
npm run ble:inspect -- --scan --seconds 30
```

Look for the Wattbike monitor name, id, or address in the terminal output and the generated capture file. Then connect to one monitor and capture data while you interact with it:

```sh
npm run ble:inspect -- --name Wattbike --seconds 120 --read
```

If the scan shows a clearer id or address, target that exact device:

```sh
npm run ble:inspect -- --id 12ab34cd56ef --seconds 120 --read
```

Recommended Model B capture steps:

1. On the Model B monitor, open `Settings > Remote > Bluetooth On`.
2. Make sure Wattbike Hub is closed so the monitor is free for the inspector.
3. Run the scan command and identify the monitor.
4. Run the connect command for 120 seconds.
5. During the capture, press the monitor buttons that are safe to press, start/stop a basic session on the monitor if available, and pedal briefly.
6. Send back the generated `captures/wattbike-ble-*.jsonl` file.

The first file tells us whether the monitor exposes standard services such as Cycling Power, Cycling Speed/Cadence, Fitness Machine, and any proprietary Wattbike service with writable characteristics. A writable proprietary characteristic is the likely target for Hub-style `Play` / session-start behavior.

Important limitation: this inspector cannot eavesdrop on Wattbike Hub while the Hub app is already connected, because BLE central-to-peripheral traffic is not exposed to a second app like a normal network packet stream. If the inspector finds proprietary writable characteristics but not the exact command bytes, the next step is a phone-side Hub packet capture:

1. Use an Android phone if possible.
2. Enable Developer Options.
3. Enable Bluetooth HCI snoop log.
4. Open Wattbike Hub, connect to the Model B, start a Quick Ride/program, stop/reset.
5. Export the generated Bluetooth HCI log and share it for analysis.

That capture should show the exact BLE write sent by Hub when Play is pressed. Once identified, the bridge can send the same command from this app.

## Current Platform Features

- **Track locator database**: country, state/region, and track selectors load the generated database at `public/data/track-database.json`, including USA BMX/BMX Canada official locator records.
- **Google Earth-style viewer**: Google Maps Platform satellite imagery with tilt/heading controls, route overlays, rider markers, and a Google Earth link. A Google Maps API key is required.
- **Sprint mode**: full-track race distance based on the selected track length.
- **Manual track mapping**: users can enter Edit map mode on the satellite view, drag to trace the real centerline through straights and turns, click sprint-zone split points along that traced route, then save a user-mapped ride line for that selected track.
- **Interval mode**: auto-selected pedaling zones or manually chosen track zones. User-mapped routes generate sprint zones from the saved zone split points.
- **Audible interval cues**: mapped sprint zones can store a rest-gap duration. During a race, the app beeps at the end of a sprint zone and again when the rest gap expires.
- **Metric selection**: choose cadence, speed, and/or power before the race; post-race tables follow that choice.
- **Monitor mode**: large-format Wattbike readouts for watts, RPM, speed, signal, source, and last update.
- **Local/multiplayer shell**: local or multiplayer mode, account-optional toggle, private room code, roster, track sync label, and chat.
- **Leaderboards**: seeded best RPM, top speed, and watts by track.

## Google Earth / Maps Integration

The old Google Earth browser plugin is not a viable production target. The app uses the supported Google Maps JavaScript API path for Google satellite imagery and overlays the track GPS outline, zone strokes, and rider markers on top of Google imagery.

The app is intentionally Google-only. Without a Google key, the map panel shows a key-required state instead of loading a non-Google fallback.

Required Google Cloud setup:

1. Create or select a Google Cloud project with billing enabled.
2. Enable **Maps JavaScript API**.
3. Create an API key under Google Maps Platform credentials.
4. Restrict the key by website referrer:
   - `https://tracklab-bmx.onrender.com/*`
   - `http://127.0.0.1:*/*`
   - `http://localhost:*/*`
5. Restrict the key to **Maps JavaScript API**.

Create a local `.env` from `.env.example`:

```sh
cp .env.example .env
```

Then set:

```text
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

For Render, add `VITE_GOOGLE_MAPS_API_KEY` as a static site environment variable and redeploy.

## Track Data Status

The included catalog combines hand-seeded race routes with official locator imports. USA BMX/BMX Canada records can be refreshed from the public finder backend with:

```sh
npm run tracks:import:usabmx
```

Then rebuild the generated database:

```sh
npm run tracks:build
```

That command writes:

```text
public/data/track-database.json
```

USA BMX/BMX Canada imported rows include official names, addresses, states/provinces, countries, postal codes, and lat/lng. They are marked `routeStatus: "locator-only"` until a real `centerline`, `startGate`, and `finishLine` are verified. Hand-routed tracks are marked `estimated` or `verified`.

Approved UCI, British Cycling, AusCycling, Cycling Canada, or other federation exports can be added under `data/imports/` and merged into the generated database. Do not use Google imagery screenshots as data input.

## Manual Track Mapping

Each track can be fine-tuned from the dashboard:

1. Select the country, state/region, and track.
2. Open **Track Mapping** and switch to **Edit map**.
3. Use **Draw path** and drag along the track centerline from the start gate, around every 90-degree and 180-degree turn, to the finish.
4. Use **Add zones** and click the traced route where each sprint zone should end.
5. Set the rest-gap seconds for the stop/start cue between sprint zones.
6. Save the mapping. The app stores it locally and immediately uses it for rider movement, sprint zones, analytics, and multiplayer track sync.

The saved JSON can be exported and imported on another machine. Because the current Render deployment is a static site, browser saves cannot publish themselves into the global online catalog yet. The next production step is a database-backed mapping service, for example Supabase or Firebase, where authenticated users can publish a mapping, moderation can approve it, and every user selecting that track receives the approved centerline automatically.

## Render Deployment

`render.yaml` is included for a Render Static Site deployment.

Render environment variables:

```text
VITE_GOOGLE_MAPS_API_KEY
VITE_WATTBIKE_BRIDGE_URL
```

Render can host the web platform and show Google imagery when `VITE_GOOGLE_MAPS_API_KEY` is configured. Render cannot directly read a USB ANT+ dongle on your local PC. For real bikes, the PC still needs to run the local bridge, and the hosted app needs a reachable WebSocket bridge URL. Local development defaults to:

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
