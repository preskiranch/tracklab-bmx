export const commentaryResearchMetadata = Object.freeze({
  knowledgeVersion: 'usabmx-national-2026-07-22-v2-audio',
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
    'back on the pedals',
    'attacks the straight',
    'drives through the section',
    'rhythm',
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
  'race-start': 'Open instantly and brightly, with a crisp gate-drop burst.',
  'positions-established': 'Sound alert and observant; lift the leader name without prematurely peaking.',
  'lead-change': 'Use a sudden, spontaneous vocal surge for the move and the new leader.',
  'pedal-zone': 'Give the call forward momentum and emphasize the attack.',
  'pro-set': 'Briefly lift the energy around the commitment and risk of the line choice.',
  'final-push': 'Build urgency through the last straight and toward the line.',
  finish: 'Peak decisively on the winner, celebrate briefly, and land the result cleanly.',
});

export function commentaryGuideForEvent(eventKind) {
  const cues = eventLanguage[eventKind] ?? [];
  return [
    'Create fresh wording; these are short vocabulary cues, not quotations or required phrases.',
    `Relevant race-phase vocabulary: ${cues.join(', ')}.`,
    eventDelivery[eventKind] ?? 'Match the vocal energy to the live action.',
    'Lead with the live action, name a rider only when the telemetry identifies that rider, and keep the call easy to understand at race speed.',
    'Professional BMX calls use short clauses, occasional fragments, varied pacing, and action-triggered excitement rather than constant shouting.',
    'Do not imitate, identify, or reproduce the voice, catchphrases, or signature delivery of any source announcer.',
  ].join(' ');
}
