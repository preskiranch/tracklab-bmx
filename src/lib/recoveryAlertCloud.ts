import {
  defaultRecoveryAlertPreference,
  normalizeRecoveryAlertPreference,
  normalizeRecoveryEffortSummary,
  normalizeRecoveryEpisode,
  type RecoveryActivityType,
  type RecoveryAlertPreference,
  type RecoveryEffortSummary,
  type RecoveryEpisode,
} from './recoveryAlert';

export type CreateRecoveryEpisodeInput = Readonly<{
  requestId: string;
  activityType: RecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  finishedAt: number;
  effortSummary?: RecoveryEffortSummary;
}>;

export type RecoveryPreferencePatch = Partial<Pick<
  RecoveryAlertPreference,
  'mode' | 'timerSeconds' | 'targetBpm' | 'minimumSeconds' | 'maximumSeconds'
>>;

function identifier(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(normalized) && normalized.length <= maximumLength
    ? normalized
    : '';
}

function requestId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{24,160}$/u.test(normalized) ? normalized : '';
}

export function normalizeRecoveryAccountId(value: unknown) {
  return typeof value === 'string' && /^recacct_[a-f0-9]{32}$/u.test(value.trim()) ? value.trim() : '';
}

async function recoveryResponse<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `${label} returned ${response.status}`,
    );
  }
  return payload;
}

function requiredEpisode(value: unknown, label: string) {
  const episode = normalizeRecoveryEpisode(value);
  if (!episode) throw new Error(`${label} returned an invalid recovery episode.`);
  return episode;
}

export async function loadRecoveryAlertPreference(): Promise<{
  accountId: string;
  preference: RecoveryAlertPreference;
}> {
  const response = await fetch('/api/recovery-alert/preferences', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await recoveryResponse<{ accountId?: unknown; preference?: unknown }>(response, 'Recovery Alert settings');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId) throw new Error('Recovery Alert settings returned an invalid account binding.');
  return {
    accountId,
    preference: normalizeRecoveryAlertPreference(payload.preference, defaultRecoveryAlertPreference),
  };
}

export async function saveRecoveryAlertPreference(
  patch: RecoveryPreferencePatch,
): Promise<{ accountId: string; preference: RecoveryAlertPreference }> {
  const response = await fetch('/api/recovery-alert/preferences', {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const payload = await recoveryResponse<{ accountId?: unknown; preference?: unknown }>(response, 'Recovery Alert settings');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  const preference = normalizeRecoveryAlertPreference(payload.preference, defaultRecoveryAlertPreference);
  if (!accountId || !preference.updatedAt) throw new Error('Recovery Alert settings returned an invalid response.');
  return { accountId, preference };
}

export async function createRecoveryEpisode(
  input: CreateRecoveryEpisodeInput,
): Promise<{
  accountId: string;
  episode: RecoveryEpisode | null;
  activeEpisode: RecoveryEpisode | null;
  replayed: boolean;
}> {
  const normalizedRequestId = requestId(input.requestId);
  const sessionId = identifier(input.sessionId);
  const repetitionId = identifier(input.repetitionId);
  const finishedAt = Number(input.finishedAt);
  const effortSummary = normalizeRecoveryEffortSummary(input.effortSummary);
  if (
    !normalizedRequestId || !sessionId || !repetitionId
    || !Number.isSafeInteger(finishedAt) || finishedAt < 0 || effortSummary == null
  ) throw new Error('Recovery Alert needs a valid finished repetition.');
  const response = await fetch('/api/recovery-alert/episodes', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, requestId: normalizedRequestId, sessionId, repetitionId, effortSummary }),
  });
  const payload = await recoveryResponse<{
    accountId?: unknown;
    episode?: unknown;
    activeEpisode?: unknown;
    replayed?: unknown;
  }>(response, 'Recovery Alert');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId) throw new Error('Recovery Alert returned an invalid account binding.');
  if (!Object.hasOwn(payload, 'episode') || !Object.hasOwn(payload, 'activeEpisode')) {
    throw new Error('Recovery Alert returned an incomplete authoritative response.');
  }
  const episode = payload.episode == null ? null : requiredEpisode(payload.episode, 'Recovery Alert');
  if (episode && (
    episode.activityType !== input.activityType
    || episode.sessionId !== sessionId
    || episode.repetitionId !== repetitionId
  )) throw new Error('Recovery Alert response did not match the finished repetition.');
  const activeEpisode = payload.activeEpisode == null
    ? null
    : requiredEpisode(payload.activeEpisode, 'Recovery Alert active status');
  return { accountId, episode, activeEpisode, replayed: payload.replayed === true };
}

export async function loadActiveRecoveryEpisode(): Promise<{
  accountId: string;
  episode: RecoveryEpisode | null;
}> {
  const response = await fetch('/api/recovery-alert/episodes/active', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await recoveryResponse<{ accountId?: unknown; episode?: unknown }>(response, 'Recovery Alert status');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId) throw new Error('Recovery Alert status returned an invalid account binding.');
  return {
    accountId,
    episode: payload.episode == null ? null : requiredEpisode(payload.episode, 'Recovery Alert status'),
  };
}

async function recoveryAction(
  episodeId: string,
  action: 'add-time' | 'start-anyway' | 'stop',
  seconds?: number,
) {
  const id = identifier(episodeId);
  if (!id) throw new Error('Choose a valid recovery period.');
  const response = await fetch(`/api/recovery-alert/episodes/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(seconds == null ? {} : { seconds }) }),
  });
  const payload = await recoveryResponse<{ accountId?: unknown; episode?: unknown }>(response, 'Recovery Alert action');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId) throw new Error('Recovery Alert action returned an invalid account binding.');
  return { accountId, episode: requiredEpisode(payload.episode, 'Recovery Alert action') };
}

export function addRecoveryTime(episodeId: string, seconds = 30) {
  if (!Number.isInteger(seconds) || seconds < 15 || seconds > 600) {
    return Promise.reject(new Error('Add between 15 seconds and 10 minutes.'));
  }
  return recoveryAction(episodeId, 'add-time', seconds);
}

export function startRecoveryAnyway(episodeId: string) {
  return recoveryAction(episodeId, 'start-anyway');
}

export function stopRecoveryEpisode(episodeId: string) {
  return recoveryAction(episodeId, 'stop');
}

/** Foreground fallback; normal Watch data is evaluated during authenticated relay ingest. */
export async function submitRecoveryHeartRate(
  episodeId: string,
  reading: Readonly<{ streamId: string; bpm: number; recordedAt: number }>,
) {
  const id = identifier(episodeId);
  const streamId = identifier(reading.streamId);
  if (
    !id || !streamId || !Number.isInteger(reading.bpm) || reading.bpm < 20 || reading.bpm > 260
    || !Number.isSafeInteger(reading.recordedAt) || reading.recordedAt < 0
  ) throw new Error('Recovery Alert needs a fresh Apple Watch reading.');
  const response = await fetch(`/api/recovery-alert/episodes/${encodeURIComponent(id)}/heart-rate`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamId, bpm: reading.bpm, recordedAt: reading.recordedAt }),
  });
  const payload = await recoveryResponse<{ accountId?: unknown; episode?: unknown }>(response, 'Recovery heart rate');
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId) throw new Error('Recovery heart rate returned an invalid account binding.');
  return { accountId, episode: requiredEpisode(payload.episode, 'Recovery heart rate') };
}
