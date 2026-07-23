import { describe, expect, it } from 'vitest';
import {
  commentaryAudioBuffer,
  commentaryAudioRequest,
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

  it('builds the current natural audio request without storing race calls', () => {
    const line = 'Riley takes charge while Jordan fights back down the second straight!';
    const request = commentaryAudioRequest(
      line,
      'american-man',
      'lead-change',
      'surge',
    );

    expect(commentarySpeechModel).toBe('gpt-audio-1.5');
    expect(request).toMatchObject({
      model: 'gpt-audio-1.5',
      modalities: ['text', 'audio'],
      audio: { voice: 'cedar', format: 'wav' },
      store: false,
    });
    expect(request.messages[0]).toMatchObject({ role: 'developer' });
    expect(request.messages[0].content).toMatch(/word for word/i);
    expect(request.messages[0].content).toMatch(/entire call/i);
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: `Perform this exact TrackLab BMX race call:\n${JSON.stringify(line)}`,
    });
  });

  it('decodes the WAV bytes returned by Chat Completions audio output', () => {
    const wav = Buffer.from('RIFF-tracklab-WAVE');
    const decoded = commentaryAudioBuffer({
      choices: [{ message: { audio: { data: wav.toString('base64') } } }],
    });

    expect(decoded.equals(wav)).toBe(true);
    expect(() => commentaryAudioBuffer({ choices: [] })).toThrow(/no usable WAV data/i);
  });
});
