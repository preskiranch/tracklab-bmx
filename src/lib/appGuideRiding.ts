import type { AppGuideSection } from './appGuideTypes';

export const ridingGuideSections: AppGuideSection[] = [
  {
    id: 'wattbike',
    title: 'Connect your Wattbike',
    summary: 'Prepare your Trainer or Pro, choose the right connection, and confirm live riding data.',
    articles: [
      {
        title: 'Get ready to ride',
        paragraphs: [
          'Use a Wattbike Trainer or Pro with a monitor that supplies compatible Bluetooth or ANT+ data. Compatibility depends on the monitor and its firmware; the bike model alone does not guarantee that every connection works. Sign in to the account with your active beta access or Wattbike membership.',
          'You can ride away from the studio wherever you have internet, your compatible bike, and a supported local connection. Keep the phone, tablet, or connector computer near the bike. Internet provides maps and account services; your nearby device receives the bike signal.',
        ],
        steps: [
          'Wake the Wattbike monitor. On Model B, open Settings → Remote → Bluetooth On when using Bluetooth.',
          'Enter Just Ride and pedal for a few seconds. Level 1 is the standard shared race starting setup; follow the selected activity’s AIR instructions afterward.',
          'Close Wattbike Hub or another app using that monitor if TrackLab cannot connect. Disconnect another computer’s Bluetooth connector from the same bike before trying direct pairing.',
        ],
      },
      {
        title: 'Pair directly with Bluetooth',
        paragraphs: [
          'The native TrackLab iPhone/iPad app uses a native Bluetooth device list. Desktop Chrome or Edge, and supported Android Chrome devices, use the browser’s Bluetooth chooser. Allow Bluetooth permission when requested.',
          'Safari and Chrome websites on iPhone/iPad cannot pair Wattbikes directly. Use the native TrackLab app for direct pairing. A browser connected through a Mac/PC helper needs a separately configured, reachable connector.',
        ],
        steps: [
          'Choose Bluetooth in the sidebar, then Pair Wattbike.',
          'Choose first Wattbike opens the device chooser. Select the Wattbike or its monitor serial; Windows may show other nearby devices too.',
          'Pedal in Just Ride and confirm live watts and cadence. A paired status alone does not confirm that the monitor is sending fresh riding data.',
          'Use Choose another Wattbike or Pair Another Wattbike for additional authorized bikes, then select Done. Your account’s connection allowance applies, up to four bikes.',
          'Previously approved bikes attempt to reconnect automatically. Use Reconnect saved bikes if needed, with the monitors awake and nearby.',
        ],
      },
      {
        title: 'Use Connector or ANT+',
        paragraphs: [
          'The TrackLab Bike Connector runs on the computer near your bikes. Its automatic mode can receive Bluetooth and ANT+ signals. ANT+ needs a supported USB dongle attached to that computer. Ask your beta administrator for the appropriate connector setup if it is not installed.',
        ],
        steps: [
          'Open the installed helper and choose Connector in the TrackLab sidebar. Its accessibility label is Advanced Connector.',
          'On a configured Mac, Open Connector launches the local helper. Once it is connected, choose Start Connector.',
          'Keep each monitor in Just Ride and pedal. Watch Scanning change to connected/live bikes, then confirm the correct rider and bike assignments.',
          'Leave the helper running while riding. Stop Connector stops its bike input. ANT+ bikes are rediscovered by their device IDs when they broadcast again.',
        ],
      },
      {
        title: 'Check the numbers and report a connection issue',
        paragraphs: [
          'Watts and cadence come from the monitor when available. Virtual speed depends on the activity’s riding model and can differ from the monitor’s speed. Explore needs both fresh cadence and power to propel the rider; a connection supplying only one can appear paired without moving the map.',
          'TrackLab’s AIR instructions ask you to move the physical lever. They do not automatically change the bike’s resistance. A USB cable alone is not a general replacement for the supported Bluetooth or ANT+ connection.',
        ],
        bullets: [
          'For feedback, include Trainer/Pro model, monitor model and firmware, device/OS/browser, native app versus website, and Bluetooth versus Connector/ANT+.',
          'Include the exact status or error, number of connected bikes, whether watts and cadence change while pedaling, and a screenshot with the approximate time.',
        ],
      },
    ],
  },
  {
    id: 'explore-world',
    title: 'Explore the World',
    summary: 'Build a real-world virtual route, pedal through satellite maps, and continue your ride later.',
    articles: [
      {
        title: 'Find an experience with Smart Route',
        paragraphs: [
          'Open Explore the World and use Local bikes. Assign each connected bike its Rider profile, or choose Use Wattbike name. Private room shows Coming soon during beta.',
          'Smart Route researches one ride from your description. Include a location, approximate distance, scenery, a loop, or an event stage and year. Examples: “A 10-mile coastal ride in Malibu with ocean views” or “Stage 3 of the 2026 Tour de France.” Distance and event-course matches may be approximate.',
        ],
        steps: [
          'Enter your request in Describe your Smart Route, then select Find and build this ride.',
          'Review the map, start, finish, actual Route distance, description, and any Research sources. Google estimate is a route estimate, not your guaranteed finishing time.',
          'Refine the request if needed. Explore does not have a separate curated-route catalog or distance/difficulty filter; describe those preferences in your request.',
        ],
      },
      {
        title: 'Choose your own start and destination',
        steps: [
          'Optionally add a Route name, then select Build Explore the World route.',
          'Alternatively, choose Choose start and destination on map. Tap the start and finish; Set start and Set destination change which point you place next.',
          'Pan or zoom to the desired place. Start over clears the points. Choose Use these map points, then Build Explore the World route.',
        ],
        paragraphs: [
          'For a specific journey, enter Starting location and Destination. Use an address, landmark, city, or coordinates, and choose the matching suggestion when offered. Use my current location can fill the start after location permission; type it instead if permission is unavailable.',
          'After editing locations, select Build again to update the displayed map. Routes use Google bicycle routing for indoor virtual riding, not outdoor navigation.',
        ],
      },
      {
        title: 'Start, pause, and continue',
        paragraphs: [
          'Review distance, elevation gain and descent before starting. Built routes are remembered automatically in Recent routes, which keeps up to eight routes for reuse. This list is separate from completed ride history.',
        ],
        steps: [
          'Confirm your connected riders, then select Start Explore the World ride. The ride opens full screen; pedal to move.',
          'Use Pause and Resume ride to take a break. Exit full screen changes the view; Reset clears the current ride progress.',
          'When a local real ride is backgrounded, it pauses and saves a recovery checkpoint on that device. Return, reconnect if needed, and use Resume ride. Recovery depends on that device’s saved storage.',
          'At Route complete, choose Ride again, Reverse route, or New destination. New destination uses the previous finish as the next start; build the next route before riding.',
        ],
      },
      {
        title: 'Terrain, maps, and your records',
        paragraphs: [
          'Explore calculates virtual speed from cadence with gradual acceleration, hills, and coasting. Watch distance, speed, average speed, progress percentage, and available heart rate on the rider cards. AIR 1–10 recommends a manual air-lever setting for the grade. If grade is unavailable, the app shows its retry status and recommends minimum.',
          'The standard view is Google satellite. Use Follow zoom, Behind/Centered/Ahead, Free camera/Auto camera, North up/Travel up, and Miles/Kilometers to adjust it. Maps split automatically when local riders spread apart. Street names enables labels and interactive landmarks; available place details and Street View can open while the ride continues.',
          'Review completed real rides in My Profile’s training calendar. Recent routes reopens routes, while recovery checkpoints resume unfinished local progress on the same device. If a Demo is shown, its riders and metrics are simulated; Explore demo rides do not create real training records.',
        ],
      },
    ],
  },
];
