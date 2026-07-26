import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createZoomVideoToken,
  zoomVideoConfigStatus,
  zoomVideoSessionName,
  zoomVideoUserKey,
} from '../../cloud/zoomVideo.mjs';

describe('Zoom workout video authorization', () => {
  it('reports configuration without exposing credentials', () => {
    expect(zoomVideoConfigStatus({
      ZOOM_VIDEO_SDK_KEY: '',
      ZOOM_VIDEO_SDK_SECRET: '',
    }).configured).toBe(false);
    expect(zoomVideoConfigStatus({
      ZOOM_VIDEO_SDK_KEY: 'sdk-key',
      ZOOM_VIDEO_SDK_SECRET: 'sdk-secret',
    }).configured).toBe(true);
  });

  it('creates a two-hour room-bound token without profile PII', () => {
    const generated = createZoomVideoToken({
      sdkKey: 'sdk-key',
      sdkSecret: 'sdk-secret',
      roomId: 'ROOM-ABCD1234',
      profileKey: 'user:private-account-id',
      role: 1,
      nowSeconds: 2_000_000_000,
    });
    const [header, payload, signature] = generated.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expectedSignature = createHmac('sha256', 'sdk-secret')
      .update(`${header}.${payload}`)
      .digest('base64url');

    expect(signature).toBe(expectedSignature);
    expect(decoded).toMatchObject({
      app_key: 'sdk-key',
      role_type: 1,
      tpc: 'tracklab-ROOM-ABCD1234',
      version: 1,
      iat: 1_999_999_970,
      exp: 2_000_007_170,
      session_key: 'ROOM-ABCD1234',
      video_webrtc_mode: 1,
      audio_webrtc_mode: 1,
    });
    expect(decoded.user_key).toBe(zoomVideoUserKey('user:private-account-id'));
    expect(decoded.user_key).toHaveLength(35);
    expect(generated.token).not.toContain('private-account-id');
  });

  it('normalizes session names and rejects empty rooms', () => {
    expect(zoomVideoSessionName(' ROOM:ONE! ')).toBe('tracklab-ROOMONE');
    expect(() => zoomVideoSessionName('***')).toThrow(/valid multiplayer room/i);
  });
});
