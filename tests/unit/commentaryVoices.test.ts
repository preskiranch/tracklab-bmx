import { describe, expect, it } from 'vitest';
import { commentaryVoiceDefinition } from '../../cloud/commentaryVoices.mjs';

const voicePresets = [
  ['australian-woman', 'marin', /Australian female/i],
  ['australian-man', 'cedar', /Australian male/i],
  ['american-woman', 'coral', /American female/i],
  ['american-man', 'onyx', /American male/i],
  ['british-woman', 'shimmer', /female.*England/i],
  ['british-man', 'fable', /male.*England/i],
] as const;

describe('commentary voice presets', () => {
  it.each(voicePresets)(
    'maps %s previews to its own base voice and requested accent persona',
    (preset, expectedVoice, expectedPersona) => {
      const definition = commentaryVoiceDefinition(preset, 'preview', 'straight');
      expect(definition.voice).toBe(expectedVoice);
      expect(definition.instructions).toMatch(expectedPersona);
      expect(definition.instructions).toMatch(/preview/i);
    },
  );

  it('does not reuse one male or female base voice for different regional presets', () => {
    const voices = voicePresets.map(([preset]) => (
      commentaryVoiceDefinition(preset, 'preview', 'straight').voice
    ));
    expect(new Set(voices).size).toBe(voicePresets.length);
  });

  it('forbids stale still-racing claims in delayed finishing calls', () => {
    const definition = commentaryVoiceDefinition('australian-man', 'rider-finish', 'sprint');
    expect(definition.instructions).toMatch(/Never claim that anybody is still racing/i);
  });
});
