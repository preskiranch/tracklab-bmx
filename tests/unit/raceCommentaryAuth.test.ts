import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  raceCommentaryAccessPrincipalKey,
  raceCommentaryRequestHeaders,
} from '../../src/hooks/useRaceCommentary';

describe('race commentary request authorization', () => {
  it('adds the exact active club-tablet athlete credential to protected requests', () => {
    expect(raceCommentaryRequestHeaders('audio/wav', '  exact-tablet-session-token  ')).toEqual({
      Accept: 'audio/wav',
      'Content-Type': 'application/json',
      'X-TrackLab-Club-Tablet-Session': 'exact-tablet-session-token',
    });
  });

  it('leaves signed-in account requests on cookie authentication', () => {
    expect(raceCommentaryRequestHeaders('application/json', null)).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(raceCommentaryRequestHeaders('application/json', '   '))
      .not.toHaveProperty('X-TrackLab-Club-Tablet-Session');
  });

  it('isolates prepared private briefings by the exact current authorization principal', () => {
    expect(raceCommentaryAccessPrincipalKey(null, ' user:account-a '))
      .toBe('account:user:account-a');
    expect(raceCommentaryAccessPrincipalKey(null, 'user:account-a'))
      .not.toBe(raceCommentaryAccessPrincipalKey(null, 'user:account-b'));
    expect(raceCommentaryAccessPrincipalKey(null, null)).toBe('anonymous');
    expect(raceCommentaryAccessPrincipalKey(' tablet-athlete-a '))
      .toBe('club-tablet:tablet-athlete-a');
    expect(raceCommentaryAccessPrincipalKey('tablet-athlete-a'))
      .not.toBe(raceCommentaryAccessPrincipalKey('tablet-athlete-b'));

    const source = readFileSync(new URL('../../src/hooks/useRaceCommentary.ts', import.meta.url), 'utf8');
    expect(source).toContain('raceCommentaryAccessPrincipalKey(\n    clubTabletSessionToken,\n    accountProfileKey,');
    expect(source).toContain('if (accessPrincipalRef.current === accessPrincipalKey) return;');
    expect(source).toContain('stopPlayback();');
  });

  it('rotates commentary authorization with the active shared-tablet athlete', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('clubTabletSessionToken: clubTabletSessionActive');
    expect(appSource).toContain('? clubTabletSession?.sessionToken');
    expect(appSource).toContain(': null,');
    expect(appSource).toContain('accountProfileKey: cloudProfileKey,');
  });
});
