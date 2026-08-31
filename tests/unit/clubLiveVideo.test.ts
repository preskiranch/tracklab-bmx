import { describe, expect, it } from 'vitest';
import {
  clubLivePublisherSignalErrorIsRecoverable,
  normalizeClubLiveVideoPublishers,
  normalizeClubLiveVideoSignal,
} from '../../src/lib/clubLiveVideo';

describe('Club Live direct video publisher normalization', () => {
  it('keeps only exact, bounded publisher identities', () => {
    expect(normalizeClubLiveVideoPublishers([
      {
        publisherId: 'publisher:1',
        clubId: 'club-1',
        studioRiderId: 'rider-1',
        sessionId: 'session-1',
        deviceId: 'device-1',
        sharedViewId: 'event-1',
        presentation: 'shared',
      },
      { publisherId: '../bad', clubId: 'club-1', studioRiderId: 'rider-2', sessionId: 'session-2' },
    ])).toEqual([{
      id: 'publisher:1',
      clubId: 'club-1',
      studioRiderId: 'rider-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
      sharedViewId: 'event-1',
      presentation: 'shared',
    }]);
  });

  it('deduplicates and caps publishers to the four paid bike seats', () => {
    const publishers = Array.from({ length: 6 }, (_, index) => ({
      publisherId: `publisher:${index}`,
      clubId: 'club-1',
      studioRiderId: `rider-${index}`,
      sessionId: `session-${index}`,
    }));
    publishers.push(publishers[0]);
    expect(normalizeClubLiveVideoPublishers(publishers)).toHaveLength(4);
  });

  it('requires an exact negotiation generation on every relayed signal', () => {
    expect(normalizeClubLiveVideoSignal({
      type: 'offer',
      sdp: 'v=0\r\n',
    })).toBeNull();
    expect(normalizeClubLiveVideoSignal({
      type: 'candidate',
      candidate: 'candidate:old',
    })).toBeNull();
    expect(normalizeClubLiveVideoSignal({
      type: 'candidate',
      negotiationId: 'offer-generation-2',
      candidate: 'candidate:new',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })).toEqual({
      type: 'candidate',
      negotiationId: 'offer-generation-2',
      candidate: 'candidate:new',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
  });

  it('keeps the publisher socket alive for late per-peer signaling failures only', () => {
    expect(clubLivePublisherSignalErrorIsRecoverable('signal-not-authorized')).toBe(true);
    expect(clubLivePublisherSignalErrorIsRecoverable('invalid-signal')).toBe(true);
    expect(clubLivePublisherSignalErrorIsRecoverable('rate-limit')).toBe(true);
    expect(clubLivePublisherSignalErrorIsRecoverable('publisher-authorization-ended')).toBe(false);
    expect(clubLivePublisherSignalErrorIsRecoverable('viewer-capacity')).toBe(false);
  });
});
