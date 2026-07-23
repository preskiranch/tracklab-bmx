export const commentaryResearchMetadata = Object.freeze({
  knowledgeVersion: 'usabmx-national-2026-07-22-v3-natural-race',
  method: 'aggregate-caption-and-broadcast-audio-context',
  officialChannel: 'https://www.youtube.com/@usabmxvideos/streams',
  broadcastAudioReference: 'https://www.youtube.com/watch?v=JRfRMptCE-I',
  coverageCutoff: '2026-07-22',
  indexedVideos: 166,
  indexedEventsByYear: Object.freeze({ 2025: 29, 2026: 20 }),
  analyzedCaptionTracks: 14,
  analyzedCaptionWords: 642_428,
  analyzedRaceCallSegments: 18_208,
  analyzedRaceAudioSections: 6,
  pendingCaptionTracks: 150,
  captionsDisabledBySource: 2,
  retainsFullTranscripts: false,
  retainsSourceAudio: false,
});

const eventLanguage = Object.freeze({
  'race-start': [
    'gate is down',
    'opening drive',
    'first straight',
    'field is underway',
  ],
  'positions-established': [
    'out front',
    'early advantage',
    'the order settles',
    'in the two spot',
  ],
  'lead-change': [
    'takes over',
    'moves to the front',
    'new leader',
    'coming back',
  ],
  'pedal-zone': [
    'rider giving chase',
    'pressure from behind',
    'through the rhythm section',
    'down the straight',
  ],
  'pro-set': [
    'commits to the Pro Set',
    'blue Pro line',
    'attacks the split',
  ],
  'final-push': [
    'last straight',
    'final drive',
    'out front',
    'to the stripe',
  ],
  finish: [
    'gets the win',
    'at the line',
    'to the stripe',
    'takes the race',
  ],
});

const eventDelivery = Object.freeze({
  'race-start': 'Open promptly with an exciting gate-drop burst and carry that momentum into the first straight.',
  'positions-established': 'Sound alert and invested; give the early order with lively forward motion.',
  'lead-change': 'Let the pass trigger a sharp, authentic surge of excitement.',
  'pedal-zone': 'Describe the rider battle and current track phase with urgent flow, not the mapped input zone.',
  'pro-set': 'Give the line choice a quick lift and connect it directly to the chase.',
  'final-push': 'Build powerful, controlled urgency through the last straight and toward the line.',
  finish: 'Celebrate the winner passionately, emphasize the name, and complete the result cleanly.',
});

export function commentaryGuideForEvent(eventKind) {
  const cues = eventLanguage[eventKind] ?? [];
  return [
    'Create fresh wording; these are short vocabulary cues, not quotations or required phrases.',
    `Relevant race-phase vocabulary: ${cues.join(', ')}.`,
    eventDelivery[eventKind] ?? 'Match the vocal energy to the live action.',
    'Lead with the live action, name a rider only when the telemetry identifies that rider, and keep the call easy to understand at race speed.',
    'Focus on racer against racer: the leader, the chaser, pressure, passes, straights, turns, rhythm, and the run to the line.',
    'Professional BMX calls use short clauses, occasional fragments, varied pacing, and high energy that surges naturally with passes and the run to the line.',
    'Do not imitate, identify, or reproduce the voice, catchphrases, or signature delivery of any source announcer.',
  ].join(' ');
}
