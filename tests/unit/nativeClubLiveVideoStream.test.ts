import { describe, expect, it } from 'vitest';
import {
  nativeClubLiveVideoStreamAvailable,
  normalizeNativeClubLiveOffer,
} from '../../src/lib/nativeClubLiveVideoStream';

describe('native Club Live video stream bridge', () => {
  it('accepts a bounded native WebRTC offer', () => {
    expect(normalizeNativeClubLiveOffer({
      peerId: 'viewer:123',
      negotiationId: 'offer-generation-1',
      type: 'offer',
      sdp: 'v=0\r\n',
    })).toEqual({
      peerId: 'viewer:123',
      negotiationId: 'offer-generation-1',
      type: 'offer',
      sdp: 'v=0\r\n',
    });
  });

  it('rejects malformed peer identifiers, descriptions, and oversized SDP', () => {
    expect(normalizeNativeClubLiveOffer({
      peerId: '../viewer',
      negotiationId: 'offer-1',
      type: 'offer',
      sdp: 'v=0',
    })).toBeNull();
    expect(normalizeNativeClubLiveOffer({
      peerId: 'viewer',
      negotiationId: 'offer-1',
      type: 'answer',
      sdp: 'v=0',
    })).toBeNull();
    expect(normalizeNativeClubLiveOffer({
      peerId: 'viewer',
      type: 'offer',
      sdp: 'v=0',
    })).toBeNull();
    expect(normalizeNativeClubLiveOffer({
      peerId: 'viewer',
      negotiationId: 'offer-1',
      type: 'offer',
      sdp: 'x'.repeat(64 * 1_024 + 1),
    })).toBeNull();
  });

  it('is available only in an installed native iOS shell', () => {
    expect(nativeClubLiveVideoStreamAvailable({
      getPlatform: () => 'ios',
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    })).toBe(true);
    expect(nativeClubLiveVideoStreamAvailable({
      getPlatform: () => 'web',
      isNativePlatform: () => false,
      isPluginAvailable: () => true,
    })).toBe(false);
  });
});
