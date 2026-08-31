import { describe, expect, it } from 'vitest';
import {
  frameMatchesSession,
  normalizeClubLiveFrames,
  unexpiredClubLiveFrames,
} from '../../src/components/ClubLiveMonitor';
import type { ClubLiveSession } from '../../src/lib/clubLive';

const exactBackendFrame = {
  clubId: 'club-preski-ranch',
  studioRiderId: 'rider-rasheen',
  riderName: 'Rasheen “The Machine” Hicks',
  sessionId: 'straight-sprint-1',
  activityType: 'straight-sprint',
  contentType: 'image/jpeg',
  jpegDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  width: 1_280,
  height: 720,
  capturedAt: 1_788_179_696_789,
  updatedAt: 1_788_179_696_800,
  expiresAt: 1_788_179_705_800,
  byteLength: 4,
  deviceId: 'club-tablet-bike-701',
};

describe('Club Live owner screen frames', () => {
  it('accepts the exact owner endpoint contract and derives a stable private view id', () => {
    expect(normalizeClubLiveFrames({ frames: [exactBackendFrame] })).toEqual([{
      ...exactBackendFrame,
      id: 'club-preski-ranch:rider-rasheen:straight-sprint-1',
    }]);
  });

  it.each([
    ['non-JPEG content type', { contentType: 'image/png' }],
    ['non-JPEG data URL', { jpegDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['zero width', { width: 0 }],
    ['fractional height', { height: 719.5 }],
    ['oversized dimensions', { width: 8_192 }],
    ['unknown activity type', { activityType: 'screen-share' }],
  ])('rejects %s', (_label, replacement) => {
    expect(normalizeClubLiveFrames({
      frames: [{ ...exactBackendFrame, ...replacement }],
    })).toEqual([]);
  });

  it('keeps the newest frame per athlete and caps the owner view at four athletes', () => {
    const frames = [
      { ...exactBackendFrame, updatedAt: 100, capturedAt: 100 },
      { ...exactBackendFrame, sessionId: 'new-session', updatedAt: 900, capturedAt: 900 },
      ...Array.from({ length: 5 }, (_, index) => ({
        ...exactBackendFrame,
        studioRiderId: `other-rider-${index + 1}`,
        riderName: `Other Rider ${index + 1}`,
        sessionId: `other-session-${index + 1}`,
        updatedAt: 800 - index,
        capturedAt: 800 - index,
      })),
    ];

    const normalized = normalizeClubLiveFrames({ frames });

    expect(normalized).toHaveLength(4);
    expect(normalized[0]).toMatchObject({
      studioRiderId: 'rider-rasheen',
      sessionId: 'new-session',
      updatedAt: 900,
    });
    expect(normalized.filter((frame) => frame.studioRiderId === 'rider-rasheen')).toHaveLength(1);
    expect(normalized.map((frame) => frame.studioRiderId)).not.toContain('other-rider-4');
    expect(normalized.map((frame) => frame.studioRiderId)).not.toContain('other-rider-5');
  });

  it('fails closed for malformed endpoint payloads', () => {
    expect(normalizeClubLiveFrames(null)).toEqual([]);
    expect(normalizeClubLiveFrames({ frames: {} })).toEqual([]);
    expect(normalizeClubLiveFrames({ frames: [null, {}, { ...exactBackendFrame, sessionId: '' }] })).toEqual([]);
  });

  it('hides expired images locally even when owner polling is offline', () => {
    const normalized = normalizeClubLiveFrames({ frames: [exactBackendFrame] });
    expect(unexpiredClubLiveFrames(normalized, exactBackendFrame.expiresAt - 1)).toHaveLength(1);
    expect(unexpiredClubLiveFrames(normalized, exactBackendFrame.expiresAt)).toEqual([]);
  });

  it('matches only the exact athlete session and exact tablet device', () => {
    const [frame] = normalizeClubLiveFrames({ frames: [exactBackendFrame] });
    const session = {
      ...exactBackendFrame,
      id: 'club-preski-ranch:rider-rasheen',
      athleteName: exactBackendFrame.riderName,
      progress: { fraction: 0.5 },
      metrics: {
        watts: 500,
        cadence: 100,
        speedKph: 30,
        distanceMeters: 100,
        elapsedMs: 5_000,
        position: 1,
        participantCount: 1,
      },
      status: 'active',
      multiplayer: false,
      startedAt: exactBackendFrame.updatedAt,
    } as ClubLiveSession;

    expect(frameMatchesSession(frame, session)).toBe(true);
    expect(frameMatchesSession(frame, { ...session, sessionId: 'another-session' })).toBe(false);
    expect(frameMatchesSession(frame, { ...session, deviceId: 'another-tablet' })).toBe(false);
  });
});
