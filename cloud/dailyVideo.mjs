import { createHash } from 'node:crypto';

export const dailyVideoSdkVersion = '0.91.0';
export const dailyVideoParticipantLimit = 4;
export const dailyVideoSessionSeconds = 30 * 60;
const dailyRoomLifetimeSeconds = 2 * 60 * 60;
const defaultDailyApiBaseUrl = 'https://api.daily.co/v1';

function configuredValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedApiBaseUrl(value) {
  return (configuredValue(value) || defaultDailyApiBaseUrl).replace(/\/+$/, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function dailyVideoConfigStatus(environment = process.env) {
  const apiKey = configuredValue(environment.DAILY_API_KEY);
  return {
    apiBaseUrl: normalizedApiBaseUrl(environment.DAILY_API_BASE_URL),
    apiKey,
    configured: Boolean(apiKey),
  };
}

export function dailyVideoRoomName(roomId) {
  const normalizedRoomId = configuredValue(roomId);
  if (!normalizedRoomId) {
    throw new Error('A valid multiplayer room is required for workout video.');
  }

  return `tracklab-${sha256(normalizedRoomId).slice(0, 24)}`;
}

export function dailyVideoUserId(profileKey) {
  const normalizedProfileKey = configuredValue(profileKey);
  if (!normalizedProfileKey) {
    throw new Error('A signed-in TrackLab profile is required for workout video.');
  }

  return `tl_${sha256(normalizedProfileKey).slice(0, 32)}`;
}

export function dailyVideoPermissions() {
  return {
    hasPresence: true,
    canSend: ['video'],
    canReceive: { base: true },
    canAdmin: false,
  };
}

export function dailyVideoRoomRequest({
  roomId,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const expiresAt = Math.floor(Number(nowSeconds)) + dailyRoomLifetimeSeconds;
  return {
    name: dailyVideoRoomName(roomId),
    privacy: 'private',
    properties: {
      exp: expiresAt,
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
      sfu_switchover: 0.5,
      permissions: dailyVideoPermissions(),
    },
  };
}

export function dailyVideoTokenRequest({
  roomId,
  profileKey,
  userName,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const issuedAt = Math.floor(Number(nowSeconds));
  const expiresAt = issuedAt + dailyVideoSessionSeconds;
  return {
    expiresAt,
    request: {
      properties: {
        room_name: dailyVideoRoomName(roomId),
        user_id: dailyVideoUserId(profileKey),
        user_name: configuredValue(userName).slice(0, 64) || 'TrackLab rider',
        exp: expiresAt,
        eject_at_token_exp: true,
        eject_after_elapsed: dailyVideoSessionSeconds,
        start_video_off: true,
        start_audio_off: true,
        enable_screenshare: false,
        enable_live_captions_ui: false,
        enable_recording_ui: false,
        start_cloud_recording: false,
        auto_start_transcription: false,
        permissions: dailyVideoPermissions(),
      },
    },
  };
}

async function dailyApiRequest({
  apiBaseUrl,
  apiKey,
  body,
  method = 'GET',
  pathname,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await fetchImpl(`${apiBaseUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('Daily workout video could not reach its secure room service.');
  }

  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload, status: response.status };
}

async function ensureDailyRoom({
  apiBaseUrl,
  apiKey,
  fetchImpl,
  roomId,
  nowSeconds,
}) {
  const roomRequest = dailyVideoRoomRequest({ roomId, nowSeconds });
  const existing = await dailyApiRequest({
    apiBaseUrl,
    apiKey,
    fetchImpl,
    pathname: `/rooms/${encodeURIComponent(roomRequest.name)}`,
  });

  if (existing.ok) {
    const existingUrl = configuredValue(existing.payload?.url);
    if (!existingUrl) {
      throw new Error('Daily returned an invalid private workout room.');
    }
    return { roomName: roomRequest.name, roomUrl: existingUrl };
  }

  if (existing.status !== 404) {
    throw new Error('Daily could not verify the private workout room.');
  }

  const created = await dailyApiRequest({
    apiBaseUrl,
    apiKey,
    body: roomRequest,
    fetchImpl,
    method: 'POST',
    pathname: '/rooms',
  });
  const roomUrl = configuredValue(created.payload?.url);
  if (!created.ok || !roomUrl) {
    throw new Error('Daily could not create the private workout room.');
  }

  return { roomName: roomRequest.name, roomUrl };
}

export async function createDailyMeetingAccess({
  apiBaseUrl = defaultDailyApiBaseUrl,
  apiKey,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
  profileKey,
  roomId,
  userName,
}) {
  const normalizedApiKey = configuredValue(apiKey);
  if (!normalizedApiKey) {
    throw new Error('Daily workout video credentials are not configured.');
  }

  const normalizedBaseUrl = normalizedApiBaseUrl(apiBaseUrl);
  const room = await ensureDailyRoom({
    apiBaseUrl: normalizedBaseUrl,
    apiKey: normalizedApiKey,
    fetchImpl,
    roomId,
    nowSeconds,
  });
  const tokenRequest = dailyVideoTokenRequest({
    roomId,
    profileKey,
    userName,
    nowSeconds,
  });
  const createdToken = await dailyApiRequest({
    apiBaseUrl: normalizedBaseUrl,
    apiKey: normalizedApiKey,
    body: tokenRequest.request,
    fetchImpl,
    method: 'POST',
    pathname: '/meeting-tokens',
  });
  const token = configuredValue(createdToken.payload?.token);
  if (!createdToken.ok || !token) {
    throw new Error('Daily could not authorize this private workout camera.');
  }

  return {
    expiresAt: tokenRequest.expiresAt,
    roomName: room.roomName,
    roomUrl: room.roomUrl,
    token,
  };
}
