import { createHash, createHmac } from 'node:crypto';

export const zoomVideoSdkVersion = '2.4.5';
export const zoomVideoParticipantLimit = 4;

function configuredValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function normalizedRoomId(value) {
  return configuredValue(value)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32);
}

export function zoomVideoConfigStatus(environment = process.env) {
  const sdkKey = configuredValue(environment.ZOOM_VIDEO_SDK_KEY);
  const sdkSecret = configuredValue(environment.ZOOM_VIDEO_SDK_SECRET);
  return {
    configured: Boolean(sdkKey && sdkSecret),
    sdkKey,
    sdkSecret,
  };
}

export function zoomVideoSessionName(roomId) {
  const safeRoomId = normalizedRoomId(roomId);
  if (!safeRoomId) {
    throw new Error('A valid multiplayer room is required for workout video.');
  }

  return `tracklab-${safeRoomId}`;
}

export function zoomVideoSessionKey(roomId) {
  const safeRoomId = normalizedRoomId(roomId);
  if (!safeRoomId) {
    throw new Error('A valid multiplayer room is required for workout video.');
  }

  return safeRoomId.slice(0, 36);
}

export function zoomVideoUserKey(profileKey) {
  const normalizedProfileKey = configuredValue(profileKey);
  if (!normalizedProfileKey) {
    throw new Error('A signed-in TrackLab profile is required for workout video.');
  }

  return `tl_${createHash('sha256').update(normalizedProfileKey).digest('hex').slice(0, 32)}`;
}

export function createZoomVideoToken({
  sdkKey,
  sdkSecret,
  roomId,
  profileKey,
  role = 0,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const normalizedSdkKey = configuredValue(sdkKey);
  const normalizedSdkSecret = configuredValue(sdkSecret);
  if (!normalizedSdkKey || !normalizedSdkSecret) {
    throw new Error('Zoom Video SDK credentials are not configured.');
  }

  const issuedAt = Math.floor(Number(nowSeconds)) - 30;
  const payload = {
    app_key: normalizedSdkKey,
    role_type: role === 1 ? 1 : 0,
    tpc: zoomVideoSessionName(roomId),
    version: 1,
    iat: issuedAt,
    exp: issuedAt + (60 * 60 * 2),
    user_key: zoomVideoUserKey(profileKey),
    session_key: zoomVideoSessionKey(roomId),
    video_webrtc_mode: 1,
    audio_webrtc_mode: 1,
  };
  const encodedHeader = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac('sha256', normalizedSdkSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return {
    expiresAt: payload.exp,
    payload,
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
  };
}
