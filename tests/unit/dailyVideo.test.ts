import { describe, expect, it, vi } from 'vitest';
import {
  createDailyMeetingAccess,
  dailyVideoConfigStatus,
  dailyVideoParticipantLimit,
  dailyVideoRoomName,
  dailyVideoRoomRequest,
  dailyVideoSessionSeconds,
  dailyVideoTokenRequest,
  dailyVideoUserId,
} from '../../cloud/dailyVideo.mjs';

describe('Daily private workout video authorization', () => {
  it('reports configuration without exposing credentials', () => {
    expect(dailyVideoConfigStatus({ DAILY_API_KEY: '' }).configured).toBe(false);
    const configured = dailyVideoConfigStatus({
      DAILY_API_KEY: 'daily-secret',
      DAILY_API_BASE_URL: 'https://daily.test/v1/',
    });
    expect(configured).toMatchObject({
      apiBaseUrl: 'https://daily.test/v1',
      configured: true,
    });
    expect(configured.apiKey).toBe('daily-secret');
  });

  it('builds private, four-racer, camera-only rooms', () => {
    const room = dailyVideoRoomRequest({
      roomId: 'ROOM-ABCD1234',
      nowSeconds: 2_000_000_000,
    });

    expect(room).toMatchObject({
      name: dailyVideoRoomName('ROOM-ABCD1234'),
      privacy: 'private',
      properties: {
        exp: 2_000_007_200,
        max_participants: dailyVideoParticipantLimit,
        start_video_off: true,
        start_audio_off: true,
        enable_screenshare: false,
        enable_chat: false,
        enable_shared_chat_history: false,
        enable_advanced_chat: false,
        enable_transcription_storage: false,
        eject_at_room_exp: true,
        eject_after_elapsed: dailyVideoSessionSeconds,
        enforce_unique_user_ids: true,
        permissions: {
          hasPresence: true,
          canSend: ['video'],
          canReceive: { base: true },
          canAdmin: false,
        },
      },
    });
    expect(room.properties).not.toHaveProperty('enable_recording');
  });

  it('creates short-lived room-bound tokens without profile PII or audio permission', () => {
    const generated = dailyVideoTokenRequest({
      roomId: 'ROOM-ABCD1234',
      profileKey: 'user:private-account-id',
      userName: 'Video Test Rider',
      nowSeconds: 2_000_000_000,
    });

    expect(generated).toMatchObject({
      expiresAt: 2_000_001_800,
      request: {
        properties: {
          room_name: dailyVideoRoomName('ROOM-ABCD1234'),
          user_id: dailyVideoUserId('user:private-account-id'),
          user_name: 'Video Test Rider',
          exp: 2_000_001_800,
          eject_at_token_exp: true,
          eject_after_elapsed: dailyVideoSessionSeconds,
          start_video_off: true,
          start_audio_off: true,
          enable_screenshare: false,
          enable_live_captions_ui: false,
          enable_recording_ui: false,
          start_cloud_recording: false,
          auto_start_transcription: false,
          permissions: {
            canSend: ['video'],
            canAdmin: false,
          },
        },
      },
    });
    expect(JSON.stringify(generated)).not.toContain('private-account-id');
    expect(generated.request.properties.user_id).toHaveLength(35);
  });

  it('creates a Daily room and token through server-only authenticated requests', async () => {
    const requests: Array<{ body: Record<string, unknown> | null; url: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
        url,
      });
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer daily-secret');
      if (url.includes('/rooms/') && init?.method === 'GET') {
        return new Response('{}', { status: 404 });
      }
      if (url.endsWith('/rooms') && init?.method === 'POST') {
        return Response.json({
          name: dailyVideoRoomName('ROOM-ABCD1234'),
          url: 'https://tracklab.daily.co/private-room',
        });
      }
      if (url.endsWith('/meeting-tokens') && init?.method === 'POST') {
        return Response.json({ token: 'private-daily-token' });
      }
      return new Response('{}', { status: 500 });
    });

    const access = await createDailyMeetingAccess({
      apiBaseUrl: 'https://daily.test/v1',
      apiKey: 'daily-secret',
      fetchImpl,
      nowSeconds: 2_000_000_000,
      profileKey: 'user:private-account-id',
      roomId: 'ROOM-ABCD1234',
      userName: 'Video Test Rider',
    });

    expect(access).toEqual({
      expiresAt: 2_000_001_800,
      roomName: dailyVideoRoomName('ROOM-ABCD1234'),
      roomUrl: 'https://tracklab.daily.co/private-room',
      token: 'private-daily-token',
    });
    expect(requests).toHaveLength(3);
    expect(requests[1].body).toMatchObject({ privacy: 'private' });
    expect(requests[2].body).toMatchObject({
      properties: { permissions: { canSend: ['video'] } },
    });
    expect(JSON.stringify(access)).not.toContain('daily-secret');
  });

  it('uses opaque room and user identifiers and rejects missing identities', () => {
    expect(dailyVideoRoomName('ROOM-ABCD1234')).toMatch(/^tracklab-[0-9a-f]{24}$/);
    expect(dailyVideoRoomName('ROOM-ABCD1234')).not.toContain('ABCD1234');
    expect(() => dailyVideoRoomName('')).toThrow(/valid multiplayer room/i);
    expect(() => dailyVideoUserId('')).toThrow(/signed-in TrackLab profile/i);
  });
});
