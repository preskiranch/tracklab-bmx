import { describe, expect, it } from 'vitest';
import {
  commentaryPcmToWav,
  commentaryRealtimeResponseCreate,
  commentaryRealtimeSessionUpdate,
  commentarySpeechModel,
  commentaryVoiceDefinition,
} from '../../cloud/commentaryVoices.mjs';

const legacyVoicePresets = [
  'australian-woman',
  'australian-man',
  'american-woman',
  'american-man',
  'british-woman',
  'british-man',
] as const;

describe('commentary voice', () => {
  it.each(legacyVoicePresets)(
    'normalizes the legacy %s preset to the sole American male announcer',
    (preset) => {
      const definition = commentaryVoiceDefinition(preset, 'preview', 'straight');
      expect(definition.voice).toBe('cedar');
      expect(definition.instructions).toMatch(/natural American male/i);
      expect(definition.instructions).toMatch(/preview/i);
    },
  );

  it('asks for conversational human timing without imitating a real person', () => {
    const definition = commentaryVoiceDefinition('american-man', 'lead-change', 'surge');
    expect(definition.instructions).toMatch(/conversational, spontaneous/i);
    expect(definition.instructions).toMatch(/subtle natural breaths/i);
    expect(definition.instructions).toMatch(/without.*imitating any real person/i);
  });

  it('forbids stale still-racing claims in delayed finishing calls', () => {
    const definition = commentaryVoiceDefinition('american-man', 'rider-finish', 'sprint');
    expect(definition.instructions).toMatch(/Never claim that anybody is still racing/i);
  });

  it('builds a private Realtime session using the natural American male voice', () => {
    const request = commentaryRealtimeSessionUpdate(
      'american-man',
      'lead-change',
      'surge',
    );

    expect(commentarySpeechModel).toBe('gpt-realtime-2.1-mini');
    expect(request).toMatchObject({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        audio: {
          output: {
            format: {
              type: 'audio/pcm',
              rate: 24_000,
            },
            voice: 'cedar',
          },
        },
      },
    });
    expect(request.session).not.toHaveProperty('model');
    expect(request.session.instructions).toMatch(/natural American male/i);
  });

  it('builds an out-of-band exact race-call response', () => {
    const line = 'Riley takes charge while Jordan fights back down the second straight!';
    const request = commentaryRealtimeResponseCreate(
      line,
      'american-man',
      'lead-change',
      'surge',
    );

    expect(request).toMatchObject({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
      },
    });
    expect(request.response.instructions).toMatch(/word for word/i);
    expect(request.response.instructions).toMatch(/entire call/i);
    expect(request.response.input).toEqual([{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: `Perform this exact TrackLab BMX race call:\n${JSON.stringify(line)}`,
      }],
    }]);
  });

  it('wraps streamed Realtime PCM chunks in a playable WAV container', () => {
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 0, 0]);
    const wav = commentaryPcmToWav([pcm.subarray(0, 4), pcm.subarray(4)]);

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
    expect(() => commentaryPcmToWav([])).toThrow(/no usable PCM audio/i);
  });
});
