const commentaryVoice = {
  voice: 'cedar',
  persona: 'a natural American male BMX race announcer using contemporary American English',
};

function commentarySpeechDirection(eventKind, deliveryStyle) {
  const wryDirection = deliveryStyle === 'wry'
    ? 'Let the brief dry aside land with a small knowing shift in tone, then return immediately to energetic race calling. Keep it playful, never cruel or cynical.'
    : '';
  const intensityDirection = deliveryStyle === 'surge'
    ? 'The race order just changed. React with a genuine spontaneous lift in pitch and intensity on the decisive action, then settle just enough to state the new order clearly.'
    : deliveryStyle === 'pressure'
      ? 'Build tension through the battle: begin focused, tighten the rhythm as the riders stay close, and use rising intonation without rushing the words.'
      : deliveryStyle === 'sprint'
        ? 'Use a strong broadcast crescendo with controlled urgency, brighter pitch on the key action, and a clean resolved ending.'
        : '';
  if (eventKind === 'pre-race') {
    return `Deliver a polished pre-race television desk report with lively anticipation, confident authority, and enough breathing room for every rider name. Build energy toward the final gate-ready phrase without sounding rushed. ${intensityDirection}`;
  }
  if (eventKind === 'race-start') {
    return `Hit the gate drop with an immediate burst of excitement, then carry bright momentum into the opening charge. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'positions-established') {
    return `Sound alert and invested as the early battle takes shape. Give the full running order clearly with lively forward motion. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'lead-change') {
    return `React to the pass like a genuine live surprise: a quick lift, a sharp surge of excitement, and strong emphasis on the new leader’s name. Make “takes the lead” feel decisive, then stay urgently connected to the displaced leader and nearest front-pack chase. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'position-change') {
    return `React immediately to the overtake with a bright surge of excitement. Punch the passing rider’s name, make the position change unmistakable, and keep the delivery connected to the surrounding battle. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'pedal-zone') {
    return `Keep the live battle urgent and flowing. Keep the leader connected to the story, but give the tightest passing threat a clear lift of excitement wherever it is in the field. Give any coverage rider a concise natural update without letting it overshadow the action. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'pro-set') {
    return `Give the line choice a quick lift of excitement and stay emotionally connected to the chase. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'final-push') {
    return `Build powerful, controlled urgency through the last straight. Make every named rider’s run to the stripe feel immediate. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'finish') {
    return `Reach a celebratory peak on the winner’s name and victory, then complete the sentence cleanly with a strong finish. ${intensityDirection} ${wryDirection}`;
  }
  if (eventKind === 'rider-finish') {
    return `Call the supplied finishing result exactly. Give every named rider and placement a fresh lift, then resolve cleanly once the field result is complete. Never claim that anybody is still racing. ${intensityDirection}`;
  }
  return `Give this preview a warm, confident sports-broadcast delivery with lively anticipation. ${intensityDirection} ${wryDirection}`;
}

export function commentarySpeechSpeed(eventKind) {
  if (eventKind === 'pre-race') {
    return 0.94;
  }
  if (
    eventKind === 'lead-change'
    || eventKind === 'position-change'
    || eventKind === 'pro-set'
    || eventKind === 'final-push'
  ) {
    return 0.99;
  }
  if (eventKind === 'race-start' || eventKind === 'finish' || eventKind === 'rider-finish') {
    return 0.98;
  }
  return 0.96;
}

export function commentaryVoiceDefinition(_preset, eventKind, deliveryStyle) {
  return {
    voice: commentaryVoice.voice,
    instructions: [
      `Perform as ${commentaryVoice.persona}.`,
      eventKind === 'pre-race'
        ? 'This is a concise, energetic pre-race BMX television briefing, not a commercial or dramatic voice-over. Sound informed, anticipatory, and fully present at the track.'
        : 'This is passionate, high-energy live BMX play-by-play, not a commercial or dramatic voice-over. Sound fully engaged in a real head-to-head race.',
      'Speak like a real live broadcaster talking to fans, not a synthetic narrator: conversational, spontaneous, warm, and emotionally responsive to the action.',
      'Keep a natural, clearly articulated pace without over-enunciating. Create excitement through dynamic emphasis, rising and falling intonation, and punch on rider names and action verbs—not by racing through the words.',
      'Use subtle natural breaths, short thinking pauses, and varied sentence timing. Let important moments breathe. Vary rhythm and emphasis from call to call so the delivery never settles into a repeated robotic pattern.',
      'Pronounce every rider name clearly as a person’s name, exactly as written in the call. Do not skip, abbreviate, or spell out a name.',
      'Match the intensity to the event: lively throughout, a clear surge for passes, maximum controlled urgency on the final straight, and a passionate celebration at the finish.',
      commentarySpeechDirection(eventKind, deliveryStyle),
      'Project strongly without screaming, distorting words, using fake crowd noise, singing, adopting a commercial voice, or imitating any real person.',
    ].join(' '),
  };
}
