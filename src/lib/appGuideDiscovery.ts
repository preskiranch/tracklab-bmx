import type { AppGuideSection } from './appGuideTypes';

export const discoveryGuideSections: AppGuideSection[] = [
  {
    id: 'tracks-shops',
    title: 'Find tracks and bike shops',
    summary: 'Plan a BMX visit, explore the surroundings, and find nearby shops in either direction.',
    articles: [
      {
  "title": "Recommended companion: Google Earth (optional)",
  "paragraphs": [
    "We highly recommend installing Google Earth on your phone or tablet if you enjoy exploring the places you discover in TrackLab. It is an optional companion for a more immersive look at satellite imagery and available 3D terrain—not a requirement for TrackLab, Wattbike training, or recording results.",
    "In BMX Tracks, select a track and choose Google Earth. TrackLab passes that track’s coordinates to Google Earth through a web link. Your device may open the browser or offer to open the installed app. If it stays in the browser, you can also search for the track in Google Earth. Return to TrackLab to train or review your data.",
    "When browsing bike shops, open a nearby BMX track and use its Google Earth link to explore the area. For Explore the World, use Google Earth separately to preview a destination; Smart Route search and the ride itself run in TrackLab. Installing Earth does not change TrackLab’s built-in maps, automatically import routes, or sync your training records to Google Earth.",
    "On a PC, Google Earth on the web works without an installation. Earth Pro is an optional desktop download; TrackLab’s links open the web version rather than controlling Earth Pro. Imagery and 3D coverage vary by location."
  ],
  "steps": [
    "Use the official Google Earth download page linked above to choose the version for your device.",
    "Select a BMX track in TrackLab, then choose Google Earth to explore its location.",
    "Zoom and tilt where supported, then return to TrackLab for activities, route search, and saved results."
  ]
},
      {
        title: 'Find your next BMX track',
        paragraphs: [
          'Open BMX Tracks to search the public directory by track name, city, state, or country. Narrow the list with the Country and State / region filters, then choose a track to see its location on satellite imagery. You can browse the directory without an account.',
          'Track details include the listed address and source, plus available official website, federation, phone, and social links. Use Maps for Google Maps directions or Google Earth to explore the location in 3D. The global directory includes places to visit; training uses the courses that have a saved race mapping.',
        ],
        bullets: [
          'Sign in to save favorite tracks and return to them through Favorites.',
          'Copy a track link or share a track with a TrackLab friend. Received tracks appear in Friends under Shared tracks.',
          'Global BMX search lists race venues from federation and sanctioning-body directories. Unverified community-map locations are excluded while awaiting race-venue verification. Coverage varies by country; confirm opening times and current racing with the club.',
        ],
      },
      {
        title: 'Explore tracks and shops together in 3D',
        paragraphs: [
          'Select a track, then choose Explore all tracks in 3D. The Global 3D Track Explorer starts there; zoom out to reveal more named red track pins. Select another track pin to open its details, toggle map labels and boundaries, or use Return to track to go back to your starting view.',
          'Turn on Bike shops to add clickable blue shop pins. Zoom closer if the explorer asks you to, then select a pin to open the shop directory. Maps and 3D imagery depend on service and device availability; a Google Earth link remains available if the in-app 3D view cannot open.',
        ],
      },
      {
        title: 'Search the global bike shop directory',
        paragraphs: [
          'Open Bike Shops and choose Location or Bike shop name. Location accepts a city, state, country, ZIP code, or address and offers suggestions as you type. Use current location searches around your device after you allow location access. Choose a map area from 5 to 50 miles.',
          'You can also browse Country → State / province → City without entering a location. Load more shops when additional results are available. On the global map, move or zoom into an area; grouped markers open into smaller groups and individual shops as you zoom closer.',
          'The result list stays available if the map cannot load. Listings combine a preloaded shop catalog with mapped directory sources, so available details and coverage vary. Dense views may ask you to zoom in for more results.',
        ],
      },
      {
        title: 'Go from a track to a shop, or a shop to a track',
        paragraphs: [
          'Planning a track visit and need parts or repairs? Track details show the closest three mapped bike shops within 25 miles. Select one to open its details, or choose View all nearby bike shops to browse the wider list around that track.',
          'Starting with a shop instead? Its detail card lists BMX tracks within 50 miles. Select a track to see its satellite view, contact links, directions, and nearby shops. Distances describe proximity; use Directions to plan the actual journey.',
          'TrackLab keeps your search context as you move between these views. In the same browser tab, returning from a track to the shop directory restores the retained results, selection, filters, map position, and scrolling. This browsing history is separate from your account’s saved track favorites.',
        ],
      },
      {
        title: 'Read shop details and request a claim',
        paragraphs: [
          'Select a shop to see its address, directory source, and available hours, phone, website, and services. Listed services may include bike sales, repairs, rentals, and e-bike service. Google Maps, Directions, and Street View links help you inspect the location. Check with the shop before relying on its hours or services.',
          'A shop owner or authorized representative can sign in with a free account and choose Claim this shop. Submit the requested verification information, follow the request under My shop claims, or withdraw it while pending. Requests are reviewed before a listing receives its claimed and verified status.',
        ],
      },
    ],
  },
  {
    id: 'training',
    title: 'Train your start, sprint, and power',
    summary: 'Choose a skill drill or a mapped Wattbike session, then review the result.',
    articles: [
      {
        title: 'Reaction Test',
        paragraphs: [
          'Practice your response to the randomized start sequence using the four-light tree and moving gate. Start the test, then tap the reaction area after the first red light to record your response. A keyboard can use Space or Enter. Timing is measured from the first red tone, and the result identifies the light reached when you reacted.',
          'Your card shows Average PR (your best average of three consecutive valid attempts) and Single best (your fastest individual attempt). After every completed group, This group’s average shows that group’s result and the difference from Average PR, even when it is slower. Only Average PR ranks on the leaderboard. A false start resets the unfinished group to zero; completing three attempts starts a new group. Leaving Reaction Test starts a fresh group. Previous single-attempt leaderboard scores do not qualify. Times are measured from the first red tone and displayed to hundredths. Use Hide my time or Show my time to control your entry. Free and paid accounts are eligible.',
        ],
      },
      {
        title: 'BMX Race Intervals',
        paragraphs: [
          'Choose Ready to race in BMX Race Intervals to see the currently playable mapped courses. All tracks · Request mapping keeps the complete directory available: search by track, state, or country, then choose Request mapping for an unmapped track. A checkmark confirms the request and the team receives an email. Requests are saved to your account; a future release date is not guaranteed.',
          'BMX Race Intervals is a fun way to practice intervals using mapped BMX tracks. Pedal zones represent typical places a rider might pedal, based on the imagery available when the course was mapped. They are approximate: track layouts may have changed, and the mapping is not an exact reproduction of every current track or riding line.',
          'For BMX Race Intervals, we recommend setting your Wattbike to level 1 using its physical Air resistance control. TrackLab does not change that control for you. The activity is designed to help riders practice the rhythm of pedaling and recovery around a BMX track, with the aim of improving pedaling efficiency; improvement is not guaranteed.',
          'Choose an available mapped BMX course, assign the riding athletes to their connected bikes, and work through the race setup. The course’s pedal zones and coasting or technical sections shape the session. The start sequence launches the race, and rider progress and results follow the mapped course.',
          'Courses with saved alternatives offer Amateur or Pro layouts and race lines. Pro branches retain their speed requirement at the split. Loop courses support 1–20 laps, with pedal zones repeating each lap. Optional Race commentary and Ambient track sound have separate controls; spoken commentary depends on service availability.',
        ],
      },
      {
        title: 'Straight Sprint',
        paragraphs: [
          'Choose a saved sprint venue, distance, and Wattbike Air setting. Available distances are 30, 100, and 145 feet, followed by 200–1,500 feet in 100-foot steps. The saved route must be long enough for your selected distance. Only that distance’s finish line appears during the sprint.',
          'Select the physical Air setting you are using, from 1–10. This records your setup; it does not move the bike’s resistance control. Sprint records and ghosts match the selected distance and Air setting. Creating sprint venues and editing course mappings are administrator tools; testers can choose the saved venues available to them.',
        ],
      },
      {
        title: 'Get Pulled',
        paragraphs: [
          'Use this timed Wattbike drill to test power and cadence against the sled scene. Select a connected bike and athlete, choose a 3-, 6-, or 30-second preset or a custom duration from 1–300 seconds, and record the physical Air setting. After the six-second countdown, the drill waits for the first 1-watt power signal before timing the pull.',
          'Watch watts, cadence, and speed during the effort, then review averages, peak watts, peak cadence, and the athlete’s maximum-watts personal record. Power results are private to the selected athlete and authorized club monitors. Demo pulls use simulated data and are not saved to athlete history or published.',
        ],
      },
    ],
  },
  {
    id: 'ghosts-results',
    title: 'Race ghosts and review results',
    summary: 'Keep online records, compare compatible runs, and learn from each completed session.',
    articles: [
      {
        title: 'Race a recorded performance',
        paragraphs: [
          'Ghosts let you race recorded performances without another rider being online at the same time. Choose up to four compatible prior runs in Race a ghost, or use Race ghost on a friend with an available shared performance. Finish an eligible live Wattbike run to create a personal ghost.',
          'Comparisons use matching course settings, including the route and lap configuration or the sprint distance and Air setting. A ghost from different settings may not appear in your current selection. Public live multiplayer is Coming soon during beta; compatible personal and shared ghost racing remains available.',
        ],
      },
      {
        title: 'Keep your records online',
        paragraphs: [
          'Eligible completed physical-bike sessions continue to upload race results, training history, and ghost recordings while you have the required access and connection. Beta Wattbike access supports these existing cloud records. Simulated demo sessions are for trying the app and do not become real athlete records.',
          'Shared ghosts follow the existing sharing and privacy rules. A friend connection does not expose private training history, power, or heart-rate records. Expiring or revoking beta access does not delete saved history or cancel an active paid membership.',
        ],
      },
      {
        title: 'Review, compare, and export',
        paragraphs: [
          'Post-race analysis brings together finish times, reaction, cadence, speed, and results by zone and rider. The immediate review can be paused, extended by 20 seconds, or closed to return to the dashboard. Open Results to revisit saved sessions and the training results spreadsheet.',
          'Race captures can be exported as CSV or JSON. Saved training results offer activity-specific sheets and workbook exports; private exports can include authorized heart-rate information when available. Shared race exports exclude private power. Choose the appropriate export for your own review or for sharing with someone else.',
        ],
      },
    ],
  },
  {
    id: 'community',
    title: 'Build your community and train with a club',
    summary: 'Connect with riders you know and use the studio tools available to your role.',
    articles: [
      {
        title: 'Find friends and share tracks',
        paragraphs: [
          'Friends brings together your connections, received and sent requests, trusted suggestions, and shared tracks. Ordinary friend requests require approval. Create a secure personal invitation or QR code to connect with someone you know; invitation links are single-use, expire automatically, and can be revoked.',
          'Rider discoverability is off by default. Turn on Appear in rider search and trusted suggestions if you want to be found that way; personal invites work either way. Eligible online friends may offer Talk live, and friends with a shared performance can offer Race ghost. Use the Shared tracks inbox to open locations sent to you.',
          'Use More on a rider card to unfriend, block, or report. Blocked riders cannot find you or interact with your TrackLab activity. Explicitly accepted friends can see online presence, but friendship does not grant access to private rides, live location, or training history.',
        ],
      },
      {
        title: 'Use an authorized club tablet',
        paragraphs: [
          'An enrolled Club Tablet keeps its Wattbike pairing while athletes take turns. Choose the athlete and activity in either order. Claimed and unclaimed club profiles can train, and completed results stay with the selected athlete. Ending the athlete session clears that identity while retaining the tablet’s bike pairing.',
          'Independent Training lets riders choose their own activity. A club owner’s Studio Tablet Monitor shows authorized tablet, bike, athlete, and session status, with live metrics and temporary read-only activity views. The owner does not need to keep the monitor open for the athlete’s bike access to work.',
        ],
      },
      {
        title: 'Follow a managed studio session',
        paragraphs: [
          'Authorized club owners also have Studio Race controls for a managed 2–4-rider BMX or Straight Sprint session. The owner chooses the course and settings, checks tablet readiness, and starts or ends the event. Ready tablets receive the same configured activity.',
          'These club tools depend on owner authorization, enrolled tablets, and the selected athlete’s session. They are separate from public live multiplayer, which remains Coming soon during beta. A regular beta invitation supplies its stated Wattbike access; it does not turn a tester into a club owner or administrator.',
        ],
      },
    ],
  },
];
