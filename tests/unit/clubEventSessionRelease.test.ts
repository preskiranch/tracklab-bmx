import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(new URL('../../cloud/server.mjs', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const consoleSource = readFileSync(
  new URL('../../src/components/ClubEventConsole.tsx', import.meta.url),
  'utf8',
);

describe('Club Event participant session release boundary', () => {
  it('does not shorten athlete-session expiry when a Club Event is cancelled or replaced', () => {
    expect(serverSource).not.toContain('TRACKLAB_CLUB_EVENT_SESSION_RELEASE_GRACE_MS');
    expect(serverSource).not.toContain('clubEventSessionReleaseGraceMs');
    expect(serverSource).not.toContain('capClubEventParticipantSessionExpiries');
    expect(serverSource).toContain("closeClubEventRoom(created.replacedEventId, 'club-event-replaced')");
    expect(serverSource).toContain("closeClubEventRoom(eventId, 'club-event-cancelled')");
  });

  it('keeps the athlete selected until the tablet uses the explicit End activity path', () => {
    const explicitExitStart = appSource.indexOf(
      'const handleClubTabletEndAthlete = useCallback(async () => {',
    );
    const explicitExitEnd = appSource.indexOf('  useEffect(() => {', explicitExitStart);
    const explicitExit = appSource.slice(explicitExitStart, explicitExitEnd);

    expect(explicitExitStart).toBeGreaterThanOrEqual(0);
    expect(explicitExit).toContain('handleClubTabletSessionChange(null);');
    expect(explicitExit).toContain('await endClubTabletSession(activeSession).catch(() => undefined);');
    expect(explicitExit.indexOf('handleClubTabletSessionChange(null);'))
      .toBeLessThan(explicitExit.indexOf('await endClubTabletSession(activeSession)'));
    expect(consoleSource).toContain(
      'Completed activities stay open for rider review until End activity; tablets that had not completed return to Independent Training',
    );
  });
});
