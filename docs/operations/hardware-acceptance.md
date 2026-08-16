# TrackLab Wattbike Acceptance Matrix

Automated tests validate protocol parsing, connection lifecycle, race state,
and browser behavior with controlled data. They cannot prove that every real
Wattbike monitor, radio, dongle, operating system, and browser combination
works. Complete this matrix before public beta and after any change to live
bike input, speed physics, cadence, race timing, or connector code.

## Test Equipment Record

Record for every run:

- application commit and Render deploy ID;
- computer/tablet model, operating system, and browser version;
- TrackLab Bike Connector version and input mode;
- Bluetooth adapter or ANT+ dongle make, model, and firmware;
- each Wattbike Model B monitor ID, monitor firmware, and connection profile;
- tester, date, track, route variant, and selected pedal zones.

Use Just Ride mode. Level 1 resistance is the recommended shared race setup.
Enable the Model B Bluetooth remote setting for BLE tests and the appropriate
ANT+ channels for ANT+ tests.

## Connection Matrix

Run each supported path with one, two, three, and four bikes where applicable.

| Platform | Connection path | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| macOS Chrome | Direct Web Bluetooth | | | | |
| macOS Chrome | Bike Connector BLE | | | | |
| macOS Chrome | Bike Connector ANT+ | | | | |
| Windows Chrome | Direct Web Bluetooth | | | | |
| Windows Chrome | Bike Connector BLE | | | | |
| Windows Chrome | Bike Connector ANT+ | | | | |
| Supported Android Chrome | Direct Web Bluetooth | | | | |

iPadOS and iOS browsers do not expose Web Bluetooth. Validate those browsers as
display/control clients while a nearby Mac or PC runs the Bike Connector.
Validate direct Wattbike pairing separately in the native TrackLab BMX
iPhone/iPad app on physical hardware; the iOS Simulator has no BLE device
support. See `docs/mobile/ios.md` for the native acceptance path. Mark
unsupported combinations clearly; do not report them as failed connections.

For each populated cell, require all of the following:

- every physical monitor appears exactly once with its own monitor ID;
- only currently connected bikes appear in Bike Check and Live Monitor;
- saved bike names return for the matching monitor ID after reconnect/refresh;
- watts and cadence update promptly and independently for each bike;
- monitor speed uses the configured BMX 44/16 rollout logic;
- a stopped or powered-off bike changes to disconnected within the configured timeout;
- reconnecting does not duplicate riders, listeners, samples, or race entries;
- repeated refresh, reconnect, and race cycles do not require renaming or reassignment.

## Race Acceptance

Run these cases in demo mode and then with live bikes:

| Case | Expected result | Pass |
| --- | --- | --- |
| Full-track, no zones | Fullscreen opens, preparation countdown and UCI cadence play, riders remain staged until gate release and input. | |
| Mapped pedal zones | Pedaling affects speed only in mapped zones; zone transitions do not cancel the race. | |
| Coasting section | Entry speed is held through the unmapped section and drive resumes smoothly in the next pedal zone. | |
| Two live bikes | Both riders stage, start, move from their own signals, finish, and retain separate metrics. | |
| Four live bikes | All four remain distinct with no missing or crossed samples. | |
| Split route | Amateur and Pro Set choices follow the saved split/merge route and configured eligibility rules. | |
| Loop route | Selected lap count repeats the course and finishes only after the final lap. | |
| Ghost race | Selected ghost stages visibly, replays its own timeline, and never drives the live rider. | |
| Cancel | Cancel exits fullscreen, resets race state, and preserves bike connections. | |
| Repeated race | A second race starts without stale metrics, samples, timers, or riders. | |

Input-to-motion acceptance should be measured from a timestamped bike sample to
the next rendered rider frame. Record median and p95 latency. The initial beta
target is less than 150 ms median and less than 300 ms p95 on the local network;
any visible multi-second delay is a failure.

## Data Acceptance

For at least one rider, vary cadence and power intentionally by zone. Confirm:

- every zone reports that zone's own peak/average cadence, speed, and power;
- values are not repeated from the overall race summary;
- 30-foot time, reaction, finish time, placement, and top/average metrics agree
  with captured samples and route distance;
- the post-race analysis appears for 20 seconds, can be paused, and returns to
  the dashboard without losing the saved result;
- exported JSON/CSV identifies the correct monitor and assigned studio rider;
- a private ghost hides zone analytics and a shared ghost exposes only the
  fields the owner elected to publish.

## Multiplayer Acceptance

Use two independent internet connections and at least two accounts:

- create and join a private room from an invite link;
- verify ready state, selected track, route choice, and rider count on both clients;
- start a synchronized race and record clock offset and visible movement delay;
- interrupt and restore one connection without duplicating the rider;
- verify spectators cannot control racers or read private analytics;
- confirm race results and ghost visibility match each account's permissions.

The current single-region service must be tested from the intended launch
regions. Record median and p95 WebSocket latency. Regional or shared-state
architecture should be introduced only when measured traffic and latency show
that it is required.

## Sign-Off

| Field | Value |
| --- | --- |
| Application commit | |
| Render deploy | |
| Matrix rows completed | |
| Failed cases | |
| Input-to-motion median / p95 | |
| Multiplayer median / p95 | |
| Known limitations | |
| Tester | |
| Reviewer | |
| Release decision | |

A release that changes live bike or race behavior is not a 10/10 validated
release until the applicable hardware and multiplayer rows pass with evidence.
