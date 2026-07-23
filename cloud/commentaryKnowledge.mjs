export const commentaryResearchMetadata = Object.freeze({
  knowledgeVersion: 'usabmx-national-2026-07-22-v1',
  method: 'aggregate-caption-context',
  officialChannel: 'https://www.youtube.com/@usabmxvideos/streams',
  coverageCutoff: '2026-07-22',
  indexedVideos: 166,
  indexedEventsByYear: Object.freeze({ 2025: 29, 2026: 20 }),
  analyzedCaptionTracks: 14,
  analyzedCaptionWords: 642_428,
  analyzedRaceCallSegments: 18_208,
  pendingCaptionTracks: 150,
  captionsDisabledBySource: 2,
  retainsFullTranscripts: false,
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
    'putting power down',
    'drives through the straight',
    'rhythm',
  ],
  'pro-set': [
    'commits to the Pro Set',
    'blue Pro line',
    'carries speed through the split',
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

export function commentaryGuideForEvent(eventKind) {
  const cues = eventLanguage[eventKind] ?? [];
  return [
    'Create fresh wording; these are short vocabulary cues, not quotations or required phrases.',
    `Relevant race-phase vocabulary: ${cues.join(', ')}.`,
    'Lead with the live action, name a rider only when the telemetry identifies that rider, and keep the call easy to understand at race speed.',
    'Do not imitate, identify, or reproduce the voice, catchphrases, or signature delivery of any source announcer.',
  ].join(' ');
}
