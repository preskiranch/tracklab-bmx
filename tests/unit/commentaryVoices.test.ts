import { describe, expect, it } from 'vitest';
import { commentaryVoiceDefinition } from '../../cloud/commentaryVoices.mjs';

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
});
