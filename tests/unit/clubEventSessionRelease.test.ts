import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(new URL('../../cloud/server.mjs', import.meta.url), 'utf8');
const persistenceSource = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');

function sourceFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, nextFunction < 0 ? source.length : nextFunction);
}

describe('Club Event participant session release grace', () => {
  it('bounds the configurable release grace with timing buffer around the 15-second results review', () => {
    expect(serverSource).toContain('TRACKLAB_CLUB_EVENT_SESSION_RELEASE_GRACE_MS');
    expect(serverSource).toContain('Math.max(20_000, Math.min(60_000');
    expect(serverSource).toContain(': 30_000;');
  });

  it('caps and reschedules only an exact participant session match', () => {
    const helper = sourceFunction(serverSource, 'capClubEventParticipantSessionExpiries');
    expect(helper).toContain("event.status !== 'cancelled'");
    expect(helper).toContain('session.clubId !== event.clubId');
    expect(helper).toContain('session.deviceId !== participant.deviceId');
    expect(helper).toContain('session.studioRiderId !== participant.studioRiderId');
    expect(helper).toContain('session.bikeDeviceId !== participant.bikeDeviceId');
    expect(helper).toContain('session.expiresAt = Math.min(session.expiresAt, releaseAt)');
    expect(helper).toContain('session.maxExpiresAt = Math.min(session.maxExpiresAt, releaseAt)');
    expect(helper).toContain('scheduleClubTabletSessionExpiry(session)');
  });

  it('returns the closed participant snapshot and applies the cap for cancellation and replacement', () => {
    expect(persistenceSource).toContain("return { status: 'cancelled', event: cloneMemoryClubEvent(event) }");
    expect(persistenceSource).toContain('replacedEvent,');
    expect(serverSource).toContain('capClubEventParticipantSessionExpiries(created.replacedEvent)');
    expect(serverSource).toContain('capClubEventParticipantSessionExpiries(cancelled.event)');
  });
});
