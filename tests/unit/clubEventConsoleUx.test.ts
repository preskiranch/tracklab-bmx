import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clubEventStudioRaceCanStart,
  clubEventStudioRaceReadinessMessage,
} from '../../src/components/ClubEventConsole';

describe('Studio Race owner console', () => {
  it('requires 2 ready riders and supports a 2-to-4 rider start', () => {
    expect(clubEventStudioRaceCanStart(0)).toBe(false);
    expect(clubEventStudioRaceCanStart(1)).toBe(false);
    expect(clubEventStudioRaceCanStart(2)).toBe(true);
    expect(clubEventStudioRaceCanStart(4)).toBe(true);
    expect(clubEventStudioRaceReadinessMessage(0)).toBe(
      '2 more riders must tap Ready before the race can start.',
    );
    expect(clubEventStudioRaceReadinessMessage(1)).toBe(
      '1 more rider must tap Ready before the race can start.',
    );
    expect(clubEventStudioRaceReadinessMessage(2)).toBe(
      '2 riders are ready. Start together now, or wait for 2 more.',
    );
    expect(clubEventStudioRaceReadinessMessage(4)).toBe(
      'All 4 riders are ready. Start together when everyone is set.',
    );
  });

  it('offers only Race Intervals and Straight Sprint in the Studio Race builder', () => {
    const source = readFileSync(
      new URL('../../src/components/ClubEventConsole.tsx', import.meta.url),
      'utf8',
    );
    const builderStart = source.indexOf("{!event && mode === 'coach'");
    const lobbyStart = source.indexOf('{event && (', builderStart);
    const builder = source.slice(builderStart, lobbyStart);

    expect(source).toContain('<Users size={17} /> Studio Race');
    expect(builder).toContain('<option value="bmx-race">BMX Race Intervals</option>');
    expect(builder).toContain('<option value="straight-sprint">Straight Sprint</option>');
    expect(builder).not.toContain('<option value="explore">');
    expect(builder).toContain('<span>Race route</span>');
    expect(builder).toContain("route.id === 'pro' ? 'Pro Track' : 'Amateur Track'");
    expect(source).toContain('trackRecord: selectedRaceTrackRecord');
    expect(source).toContain('routeVariantId: selectedRaceRouteVariant?.id ?? null');
    expect(builder).toContain("'Open race lobby'");
    expect(builder).toContain('<span>Riders tap Ready</span>');
    expect(source).not.toContain('can watch all four live');
  });
});
