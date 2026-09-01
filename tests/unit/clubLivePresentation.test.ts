import { describe, expect, it } from 'vitest';
import type { ClubLiveSession } from '../../src/lib/clubLive';
import {
  clubLiveCanonicalSelections,
  clubLivePresentationId,
  clubLiveSessionUsesSharedPresentation,
  selectClubLivePresentations,
  type ClubLivePresentationSource,
} from '../../src/lib/clubLivePresentation';

function session(
  rider: number,
  activityType: ClubLiveSession['activityType'],
  replacements: Partial<ClubLiveSession> = {},
): ClubLiveSession {
  return {
    id: `club-1:rider-${rider}`,
    clubId: 'club-1',
    studioRiderId: `rider-${rider}`,
    riderName: `Rider ${rider}`,
    athleteName: `Athlete ${rider}`,
    sessionId: `random-tablet-session-${rider}`,
    deviceId: `tablet-${rider}`,
    activityType,
    status: 'active',
    progress: { fraction: rider / 10 },
    metrics: {
      watts: 400,
      cadence: 100,
      speedKph: 32,
      distanceMeters: rider * 100,
      elapsedMs: 5_000,
      position: rider,
      participantCount: 4,
    },
    multiplayer: true,
    updatedAt: 10_000 + rider,
    expiresAt: 20_000,
    ...replacements,
  };
}

type TestMedia = Readonly<{ frame: string }>;

function source(
  value: ClubLiveSession,
  mediaLive = true,
): ClubLivePresentationSource<TestMedia> {
  return {
    id: `${value.deviceId}:${value.sessionId}`,
    session: value,
    media: mediaLive ? { frame: value.studioRiderId } : null,
    mediaLive,
  };
}

function sharedSessions(activityType: ClubLiveSession['activityType']) {
  return Array.from({ length: 4 }, (_, index) => source(session(index + 1, activityType, {
    sharedViewId: 'verified-event-1',
    presentation: 'shared',
  })));
}

describe('Club Live activity-aware presentation selector', () => {
  it.each(['bmx-race', 'straight-sprint', 'explore'] as const)(
    'collapses a verified shared %s activity despite random per-tablet session ids',
    (activityType) => {
      const presentations = selectClubLivePresentations(sharedSessions(activityType));

      expect(presentations).toHaveLength(1);
      expect(presentations[0]).toMatchObject({
        kind: 'shared',
        activityType,
      });
      expect(presentations[0].sources).toHaveLength(4);
    },
  );

  it('collapses four Club Tablet demos into one shared owner screen only when the backend view id matches', () => {
    const demoSources = Array.from({ length: 4 }, (_, index) => source(session(index + 1, 'bmx-race', {
      studioRiderId: `demo:tablet-${index + 1}`,
      deviceId: `tablet-${index + 1}`,
      demo: true,
      sharedViewId: 'club-demo-room-1',
      presentation: 'shared',
    })));

    const presentations = selectClubLivePresentations(demoSources);
    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      kind: 'shared',
      activityType: 'bmx-race',
      canonicalSource: {
        session: { demo: true, sharedViewId: 'club-demo-room-1' },
      },
    });
    expect(presentations[0].sources.map(({ session: value }) => value.deviceId)).toEqual([
      'tablet-1',
      'tablet-2',
      'tablet-3',
      'tablet-4',
    ]);
  });

  it('always keeps Get Pulled as individual screens and enforces the four-tablet maximum', () => {
    const presentations = selectClubLivePresentations([
      ...sharedSessions('get-pulled'),
      source(session(5, 'get-pulled', {
        sharedViewId: 'verified-event-1',
        presentation: 'shared',
      })),
    ]);

    expect(presentations).toHaveLength(4);
    expect(presentations.every((presentation) => presentation.kind === 'individual')).toBe(true);
  });

  it('keeps independent Explore sessions separate', () => {
    const presentations = selectClubLivePresentations(Array.from({ length: 4 }, (_, index) => (
      source(session(index + 1, 'explore', {
        multiplayer: false,
        presentation: 'individual',
      }))
    )));

    expect(presentations).toHaveLength(4);
    expect(presentations.every((presentation) => presentation.kind === 'individual')).toBe(true);
  });

  it('never groups by activity, track name, start time, or session id alone', () => {
    const matchingIncidentalValues = Array.from({ length: 4 }, (_, index) => source(session(
      index + 1,
      'bmx-race',
      {
        sessionId: 'same-session-id',
        trackName: 'Same track',
        startedAt: 12_345,
      },
    )));

    expect(selectClubLivePresentations(matchingIncidentalValues)).toHaveLength(4);
  });

  it('keeps different verified shared activities and view ids in separate stages', () => {
    const presentations = selectClubLivePresentations([
      source(session(1, 'bmx-race', { sharedViewId: 'event-a', presentation: 'shared' })),
      source(session(2, 'bmx-race', { sharedViewId: 'event-a', presentation: 'shared' })),
      source(session(3, 'bmx-race', { sharedViewId: 'event-b', presentation: 'shared' })),
      source(session(4, 'straight-sprint', { sharedViewId: 'event-a', presentation: 'shared' })),
    ]);

    expect(presentations).toHaveLength(3);
    expect(presentations.map((presentation) => presentation.sources.length).sort()).toEqual([1, 1, 2]);
  });

  it('keeps the prior live canonical source and fails over deterministically when it stalls', () => {
    const candidates = sharedSessions('bmx-race');
    const initial = selectClubLivePresentations(candidates);
    const presentationId = initial[0].id;
    const previousSourceId = candidates[2].id;
    const sticky = selectClubLivePresentations(candidates, {
      [presentationId]: previousSourceId,
    });
    expect(sticky[0].canonicalSource.id).toBe(previousSourceId);

    const stalled = candidates.map((candidate) => (
      candidate.id === previousSourceId ? { ...candidate, mediaLive: false } : candidate
    ));
    const failedOver = selectClubLivePresentations(stalled, {
      [presentationId]: previousSourceId,
    });
    expect(failedOver[0].canonicalSource.id).toBe(candidates[0].id);
    expect(clubLiveCanonicalSelections(failedOver)).toEqual({
      [presentationId]: candidates[0].id,
    });

    const allStalled = candidates.map((candidate) => ({ ...candidate, mediaLive: false }));
    const waitingForRecovery = selectClubLivePresentations(allStalled, {
      [presentationId]: previousSourceId,
    });
    expect(waitingForRecovery[0].canonicalSource.id).toBe(previousSourceId);
  });

  it('prefers a standby direct stream when the prior shared source has only JPEG fallback', () => {
    const candidates = sharedSessions('bmx-race').map((candidate, index) => ({
      ...candidate,
      mediaTransport: index === 2 ? 'direct' as const : 'fallback' as const,
    }));
    const presentationId = clubLivePresentationId(candidates[0].session);

    const failedOver = selectClubLivePresentations(candidates, {
      [presentationId]: candidates[0].id,
    });

    expect(failedOver[0].canonicalSource.id).toBe(candidates[2].id);
    expect(failedOver[0].canonicalSource.mediaTransport).toBe('direct');
  });

  it('requires all explicit shared-presentation guards', () => {
    const shared = session(1, 'explore', {
      sharedViewId: 'event-a',
      presentation: 'shared',
    });
    expect(clubLiveSessionUsesSharedPresentation(shared)).toBe(true);
    expect(clubLiveSessionUsesSharedPresentation({ ...shared, multiplayer: false })).toBe(false);
    expect(clubLiveSessionUsesSharedPresentation({ ...shared, sharedViewId: undefined })).toBe(false);
    expect(clubLiveSessionUsesSharedPresentation({ ...shared, presentation: 'individual' })).toBe(false);
    expect(clubLivePresentationId({ ...shared, presentation: 'individual' })).toContain('individual:');
  });
});
