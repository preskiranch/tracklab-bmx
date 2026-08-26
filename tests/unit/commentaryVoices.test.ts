import { describe, expect, it } from 'vitest';
import {
  commentaryPcmToWav,
  commentaryRealtimeResponseCreate,
  commentaryRealtimeSessionUpdate,
  commentarySpeechMixVersion,
  commentarySpeechModel,
  commentaryVoiceDefinition,
  normalizeCommentaryPcm16,
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

  it('raises quiet active speech to a bounded tablet-friendly broadcast level', () => {
    const quiet = Buffer.alloc(240 * 2);
    for (let index = 0; index < 240; index += 1) {
      quiet.writeInt16LE(Math.round(Math.sin(index / 5) * 1_200), index * 2);
    }

    const mixed = normalizeCommentaryPcm16(quiet);
    const rms = (buffer: Buffer) => Math.sqrt(
      Array.from({ length: buffer.length / 2 }, (_, index) => (
        buffer.readInt16LE(index * 2) / 32_768
      )).reduce((sum, sample) => sum + sample * sample, 0) / (buffer.length / 2),
    );
    const mixedPeaks = Array.from(
      { length: mixed.length / 2 },
      (_, index) => Math.abs(mixed.readInt16LE(index * 2)),
    );

    expect(commentarySpeechMixVersion).toBe('broadcast-v2');
    expect(rms(mixed)).toBeGreaterThan(rms(quiet) * 3.5);
    expect(Math.max(...mixedPeaks)).toBeLessThanOrEqual(Math.round(32_767 * 0.92));
  });

  it('leaves silence intact and soft-limits already-hot PCM', () => {
    const silence = Buffer.alloc(240 * 2);
    expect(normalizeCommentaryPcm16(silence).equals(silence)).toBe(true);

    const hot = Buffer.alloc(240 * 2);
    for (let index = 0; index < 240; index += 1) {
      hot.writeInt16LE(index % 2 === 0 ? 32_767 : -32_768, index * 2);
    }
    const limited = normalizeCommentaryPcm16(hot);
    const peak = Math.max(...Array.from(
      { length: limited.length / 2 },
      (_, index) => Math.abs(limited.readInt16LE(index * 2)),
    ));
    expect(peak).toBeLessThanOrEqual(Math.round(32_767 * 0.92));
  });
});
