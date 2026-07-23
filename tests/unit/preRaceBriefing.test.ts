import { describe, expect, it, vi } from 'vitest';
import {
  generatePreRaceLine,
  localPreRaceLine,
} from '../../cloud/preRaceBriefing.mjs';

const nicknameTrack = {
  id: 'north-bay-bmx',
  name: 'North Bay BMX',
  country: 'United States',
  city: 'Napa',
  state: 'California',
  surface: 'dirt',
  lengthMeters: 340,
  hasProSet: false,
  riders: [
    { playerId: 1, name: 'Connor Fields (The Captain)', colorName: 'blue' },
    { playerId: 2, name: 'Maya Torres', colorName: 'lime' },
  ],
};

describe('nickname-aware pre-race calls', () => {
  it('uses a supplied nickname naturally in the local briefing fallback', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const line = localPreRaceLine(nicknameTrack, { available: false });
    random.mockRestore();

    expect(line).toContain('The Captain');
    expect(line).toContain('Maya Torres');
  });

  it('accepts AI briefings that use a nickname instead of repeating the parenthetical entry', async () => {
    const lines = [
      'At North Bay BMX, The Captain and Maya Torres settle onto the gate as the dirt course waits and the opening charge draws close.',
      'The Captain joins Maya Torres on the North Bay BMX hill, where the dirt layout is ready and every eye turns toward the gate.',
      'North Bay BMX welcomes Maya Torres and The Captain to the gate, with a dirt course ahead and the next race only moments away.',
    ];
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{
          content: [{
            type: 'output_text',
            text: JSON.stringify({ lines }),
          }],
        }],
      }),
    });

    const report = await generatePreRaceLine({
      track: nicknameTrack,
      weather: { available: false },
      research: { facts: [] },
      apiKey: 'test-key',
      fetchImplementation,
    });

    expect(report.source).toBe('ai');
    expect(report.line).toContain('The Captain');
    expect(report.line).not.toContain('(The Captain)');
  });
});
